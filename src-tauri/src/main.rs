// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Fix PATH for macOS GUI apps launched via launchd (which don't inherit shell PATH).
    // Without this, sidecars can't find `claude` CLI at /opt/homebrew/bin.
    let _ = fix_path_env::fix();
    oncraft_lib::run()
}
