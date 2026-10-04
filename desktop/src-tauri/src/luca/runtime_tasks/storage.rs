//! Private, bounded persistence for runtime-task receipts and textual results.

use std::{
    cmp::Reverse,
    collections::BinaryHeap,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::SystemTime,
};

/// Create or repair a desktop-owned task directory before storing private bytes.
pub(super) fn prepare_private_directory(path: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt as _;
        builder.mode(0o700);
    }
    builder.create(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "runtime task storage is not a private directory",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Replace an owned file through a synced, owner-only temporary in its directory.
pub(super) fn atomic_write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    atomic_write_private_with(path, |file| file.write_all(bytes))
}

fn atomic_write_private_with(
    path: &Path,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing storage directory"))?;
    #[cfg(unix)]
    let directory = File::open(parent)?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".runtime-task-")
        .tempfile_in(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    write(temporary.as_file_mut())?;
    temporary.as_file().sync_all()?;
    // PersistError retains the temporary file. Dropping it on error cleans up
    // even when replacement fails, without touching the old destination.
    temporary.persist(path).map_err(|error| error.error)?;
    #[cfg(unix)]
    directory.sync_all()?;
    Ok(())
}

/// Gate dispatch on a durable receipt; a persistence error never invokes it.
pub(super) fn persist_before_dispatch<T, E>(
    persist: impl FnOnce() -> Result<(), E>,
    dispatch: impl FnOnce() -> Result<T, E>,
) -> Result<T, E> {
    persist()?;
    dispatch()
}

/// Read a regular file without allocating or reading an unbounded payload.
pub(super) fn read_bounded(path: &Path, max_bytes: usize) -> io::Result<Vec<u8>> {
    if !fs::symlink_metadata(path)?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "runtime task storage requires a regular file",
        ));
    }
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > max_bytes as u64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "runtime task file exceeds its read limit",
        ));
    }
    let mut bytes = Vec::new();
    file.take((max_bytes as u64).saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() > max_bytes {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "runtime task file exceeds its read limit",
        ));
    }
    Ok(bytes)
}

#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct ReceiptCandidate {
    modified: SystemTime,
    path: PathBuf,
}

/// Select newest stored receipts by filesystem modification time before reading
/// their bodies, retaining only a bounded candidate heap. This avoids reading
/// every body to rank its `updatedAt`. Ties use the filename deterministically.
pub(super) fn newest_receipt_paths(
    directory: &Path,
    limit: usize,
    max_bytes: usize,
) -> io::Result<Vec<PathBuf>> {
    let mut candidates = BinaryHeap::new();
    for entry in fs::read_dir(directory)?.flatten() {
        if limit == 0 {
            break;
        }
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.len() == 0 || metadata.len() > max_bytes as u64 {
            continue;
        }
        candidates.push(Reverse(ReceiptCandidate {
            modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            path,
        }));
        if candidates.len() > limit {
            candidates.pop();
        }
    }
    let mut selected = candidates
        .into_iter()
        .map(|Reverse(candidate)| candidate)
        .collect::<Vec<_>>();
    selected.sort_by(|left, right| right.cmp(left));
    Ok(selected
        .into_iter()
        .map(|candidate| candidate.path)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, fs::FileTimes, time::Duration};

    #[test]
    fn replacement_is_complete_and_private() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("task.json");
        fs::write(&path, b"old receipt").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        }

        atomic_write_private(&path, b"new complete receipt").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new complete receipt");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn failed_partial_write_keeps_old_receipt_and_cleans_temporary() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("task.json");
        fs::write(&path, b"old receipt").unwrap();

        let result = atomic_write_private_with(&path, |file| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt as _;
                assert_eq!(file.metadata()?.permissions().mode() & 0o777, 0o600);
            }
            file.write_all(b"partial private receipt")?;
            assert_eq!(fs::read(&path)?, b"old receipt");
            Err(io::Error::other("injected write failure"))
        });

        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"old receipt");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_replacement_cleans_temporary_without_removing_destination() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("task.json");
        fs::create_dir(&path).unwrap();

        assert!(atomic_write_private(&path, b"receipt").is_err());

        assert!(path.is_dir());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn persistence_failure_never_dispatches() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("missing-parent").join("task.json");
        let dispatched = Cell::new(false);

        let result = persist_before_dispatch(
            || atomic_write_private(&path, b"intent"),
            || {
                dispatched.set(true);
                Ok(())
            },
        );

        assert!(result.is_err());
        assert!(!dispatched.get());
        assert!(!path.exists());
    }

    #[test]
    fn dispatch_observes_the_complete_persisted_intent() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("task.json");
        let dispatched = Cell::new(false);

        persist_before_dispatch(
            || atomic_write_private(&path, b"intent"),
            || {
                assert_eq!(fs::read(&path)?, b"intent");
                dispatched.set(true);
                Ok(())
            },
        )
        .unwrap();

        assert!(dispatched.get());
    }

    #[test]
    fn bounded_reader_rejects_oversized_files_and_directories() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("task.txt");
        fs::write(&path, b"bounded").unwrap();

        assert_eq!(read_bounded(&path, 7).unwrap(), b"bounded");
        assert!(read_bounded(&path, 6).is_err());
        assert!(read_bounded(directory.path(), 7).is_err());
        #[cfg(unix)]
        {
            let link = directory.path().join("linked-result.txt");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert!(read_bounded(&link, 7).is_err());
        }
    }

    fn receipt_file(directory: &Path, name: &str, modified_seconds: u64, contents: &[u8]) {
        let path = directory.join(name);
        fs::write(&path, contents).unwrap();
        File::open(path)
            .unwrap()
            .set_times(
                FileTimes::new()
                    .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(modified_seconds)),
            )
            .unwrap();
    }

    #[test]
    fn selects_newest_receipts_before_limiting_and_ignores_non_receipts() {
        let directory = tempfile::tempdir().unwrap();
        receipt_file(directory.path(), "newest.json", 30, b"new");
        receipt_file(directory.path(), "oldest.json", 10, b"old");
        receipt_file(directory.path(), "middle.json", 20, b"mid");
        receipt_file(directory.path(), "ignored.txt", 40, b"text");
        receipt_file(directory.path(), "oversized.json", 50, b"too large");
        receipt_file(directory.path(), "empty.json", 60, b"");
        fs::create_dir(directory.path().join("directory.json")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            directory.path().join("newest.json"),
            directory.path().join("symlink.json"),
        )
        .unwrap();

        let selected = newest_receipt_paths(directory.path(), 2, 8).unwrap();

        assert_eq!(
            selected,
            vec![
                directory.path().join("newest.json"),
                directory.path().join("middle.json")
            ]
        );
        assert!(newest_receipt_paths(directory.path(), 0, 8)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn newest_receipt_ties_are_deterministic() {
        let directory = tempfile::tempdir().unwrap();
        receipt_file(directory.path(), "a.json", 10, b"a");
        receipt_file(directory.path(), "b.json", 10, b"b");

        assert_eq!(
            newest_receipt_paths(directory.path(), 1, 8).unwrap(),
            vec![directory.path().join("b.json")]
        );
    }

    #[test]
    fn private_directory_permissions_are_repaired() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("receipts");
        fs::create_dir(&path).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }

        prepare_private_directory(&path).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn private_directory_rejects_a_symlink() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("receipts");
        std::os::unix::fs::symlink(directory.path(), &path).unwrap();

        assert!(prepare_private_directory(&path).is_err());
    }
}
