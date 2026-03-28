mod commands;
mod pty;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(pty::PtyManager::new())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            commands::list_commands,
            commands::delete_session,
            commands::git_branch_status,
            commands::git_file_status,
            commands::list_orphaned_sessions,
            commands::list_orphaned_worktrees,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
