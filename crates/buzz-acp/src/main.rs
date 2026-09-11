// LOCAL2-TRACE: capture the PID of whoever signals us, before tokio installs
// its own handlers. Temporary diagnostic for WP-LOCAL2 decision 1.
#[cfg(unix)]
mod local2_signal_trace {
    use std::sync::atomic::{AtomicI32, Ordering};
    pub static LAST_SENDER: AtomicI32 = AtomicI32::new(-1);

    unsafe extern "C" fn handler(sig: libc::c_int, info: *mut libc::siginfo_t, _ctx: *mut libc::c_void) {
        let pid = if info.is_null() { -1 } else { (*info).si_pid() };
        LAST_SENDER.store(pid, Ordering::SeqCst);
        let msg = format!("LOCAL2-TRACE buzz-acp received signal {sig} from pid {pid}\n");
        libc::write(2, msg.as_ptr() as *const libc::c_void, msg.len());
    }

    pub fn install_forever() {
        std::thread::spawn(|| loop {
            install();
            std::thread::sleep(std::time::Duration::from_millis(200));
        });
    }

    pub fn install() {
        unsafe {
            let mut sa: libc::sigaction = std::mem::zeroed();
            sa.sa_sigaction = handler as usize;
            sa.sa_flags = libc::SA_SIGINFO | libc::SA_RESTART;
            libc::sigemptyset(&mut sa.sa_mask);
            libc::sigaction(libc::SIGTERM, &sa, std::ptr::null_mut());
            libc::sigaction(libc::SIGINT, &sa, std::ptr::null_mut());
            libc::sigaction(libc::SIGHUP, &sa, std::ptr::null_mut());
        }
    }
}

fn main() -> anyhow::Result<()> {
    #[cfg(unix)]
    local2_signal_trace::install_forever();
    buzz_acp::run()
}
