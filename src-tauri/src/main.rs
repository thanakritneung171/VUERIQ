// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Called by the NSIS installer / uninstaller (see windows/hooks.nsh).
    match std::env::args().nth(1).as_deref() {
        Some("--register-associations") => {
            std::process::exit(if vueriq_lib::assoc::register_for_install().is_ok() { 0 } else { 1 });
        }
        Some("--unregister-associations") => {
            vueriq_lib::assoc::unregister_for_install();
            return;
        }
        _ => {}
    }
    vueriq_lib::run()
}
