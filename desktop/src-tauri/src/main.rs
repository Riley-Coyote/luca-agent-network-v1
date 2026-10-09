// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(unix)]
    if let Some(code) = buzz_lib::browser_awareness_native_host_entry() {
        std::process::exit(code);
    }
    buzz_lib::run()
}
