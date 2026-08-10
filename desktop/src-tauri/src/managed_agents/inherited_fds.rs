//! Unix child-descriptor installation for trusted Luca control channels.

use std::io;
use std::os::fd::RawFd;

/// Install permission, continuity, cognition, and optional MCP channels at
/// their reserved descriptor numbers immediately before the child execs.
///
/// Every source is first duplicated above the reserved range so an allocator
/// collision cannot clobber a later source while targets are replaced.
pub(crate) fn install_managed_descriptors(
    permission_fd: RawFd,
    continuity_fd: RawFd,
    cognition_fd: RawFd,
    mcp_fd: Option<RawFd>,
    presentation_fd: RawFd,
) -> io::Result<()> {
    let sources = [
        Some(permission_fd),
        Some(continuity_fd),
        Some(cognition_fd),
        mcp_fd,
        Some(presentation_fd),
    ];
    let targets = [3, 4, 5, 6, 7];
    let mut copies = [-1; 5];

    for (index, source) in sources.into_iter().enumerate() {
        let Some(source) = source else { continue };
        let copy = unsafe { libc::fcntl(source, libc::F_DUPFD_CLOEXEC, 10) };
        if copy == -1 {
            close_copies(copies);
            return Err(io::Error::last_os_error());
        }
        copies[index] = copy;
    }

    for (index, copy) in copies.into_iter().enumerate() {
        if copy == -1 {
            continue;
        }
        let target = targets[index];
        if unsafe { libc::dup2(copy, target) } == -1
            || unsafe { libc::fcntl(target, libc::F_SETFD, 0) } == -1
        {
            close_copies(copies);
            return Err(io::Error::last_os_error());
        }
    }

    close_copies(copies);
    Ok(())
}

fn close_copies(copies: [RawFd; 5]) {
    for copy in copies {
        if copy != -1 {
            unsafe { libc::close(copy) };
        }
    }
}
