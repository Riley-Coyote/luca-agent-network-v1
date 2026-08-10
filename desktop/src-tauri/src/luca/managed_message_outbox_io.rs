//! Restricted atomic persistence for the encrypted managed-message outbox.

use std::{io::Write, path::Path};

use atomic_write_file::AtomicWriteFile;

use super::managed_message_outbox::ManagedMessageOutboxError;

pub(super) fn atomic_write_ciphertext(
    path: &Path,
    ciphertext: &[u8],
) -> Result<(), ManagedMessageOutboxError> {
    let parent = path
        .parent()
        .ok_or(ManagedMessageOutboxError::Persistence)?;
    std::fs::create_dir_all(parent).map_err(|_| ManagedMessageOutboxError::Persistence)?;
    let mut file =
        AtomicWriteFile::open(path).map_err(|_| ManagedMessageOutboxError::Persistence)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| ManagedMessageOutboxError::Persistence)?;
    }
    file.write_all(ciphertext)
        .map_err(|_| ManagedMessageOutboxError::Persistence)?;
    file.commit()
        .map_err(|_| ManagedMessageOutboxError::Persistence)
}
