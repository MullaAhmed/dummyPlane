mod accounts;
mod agents;
mod commands;
mod db;
mod error;
mod git;
mod github;
mod logging;
mod mission;
mod notes;
mod power;
mod process;
mod pty;
mod repo;
mod review;
mod studio;
mod sync;
mod tickets;
mod tokens;

use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use db::Db;
use pty::PtyManager;

/// Changed scrollbacks are written to SQLite every 10 s.
const SCROLLBACK_FLUSH_INTERVAL: Duration = Duration::from_secs(10);

/// A second launch comes back to the running window. It may be a click on a
/// notification already in the Action Center: Windows starts the app again,
/// without saying which notification.
fn focus_main_window(app: &AppHandle) {
    log::info!("second launch: back to the running window");
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Err(error) = window.unminimize().and_then(|()| window.set_focus()) {
        log::warn!("the running window did not come back: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::install_panic_hook();
    let app = tauri::Builder::default()
        // Before everything: a second launch must exit before it touches the
        // log or the database, which two instances would corrupt.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app)
        }))
        // Next: the other plugins and the setup can already write to the log.
        .plugin(logging::plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::default())
        .manage(power::KeepAwake::default())
        .setup(|app| {
            // Built here, not from the config, for the one thing the config cannot
            // say: the page reads the clipboard without WebView2's prompt, since
            // the radial menu's Coller has no Ctrl+V to carry it.
            let main = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .ok_or("no window labelled main in tauri.conf.json")?;
            WebviewWindowBuilder::from_config(app.handle(), main)?
                .enable_clipboard_access()
                .build()?;
            log::info!(
                "dummyPlane {} on {} {}",
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            let path = app.path().app_data_dir()?.join("dummyplane.db");
            let db = match Db::open(&path) {
                Ok(db) => db,
                Err(err) => {
                    log::error!("base not opened: {err}");
                    // A blocking dialog with the file path, then stop. The one native
                    // alert left: without its database the interface cannot run to show its own.
                    let (title, message) = database_failure(&path, &err);
                    app.dialog()
                        .message(message)
                        .kind(MessageDialogKind::Error)
                        .title(title)
                        .blocking_show();
                    return Err(err.into());
                }
            };
            app.manage(db);
            pty::env_path::refresh();
            spawn_scrollback_flusher(app.handle().clone());
            commands::agents::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::accounts::accounts_list,
            commands::accounts::account_add,
            commands::accounts::account_remove,
            commands::accounts::account_use,
            commands::app::open_log_dir,
            commands::app::open_data_dir,
            commands::app::diagnostics,
            commands::app::prepare_for_update,
            commands::paste::save_pasted_image,
            commands::pty::pty_spawn,
            commands::pty::pty_attach,
            commands::pty::pty_write,
            commands::pty::pty_send_text,
            commands::pty::pty_interrupt,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            commands::pty::pty_list,
            commands::pty::get_scrollback,
            commands::pty::refresh_path,
            commands::pty::list_agents,
            commands::pty::list_ollama_models,
            commands::pty::npm_available,
            commands::pty::list_shells,
            commands::tokens::token_usage,
            commands::workspace::list_workspaces,
            commands::workspace::create_workspace,
            commands::workspace::rename_workspace,
            commands::workspace::delete_workspace,
            commands::workspace::load_workspace,
            commands::workspace::save_scene,
            commands::workspace::save_files,
            commands::workspace::save_node,
            commands::workspace::get_setting,
            commands::workspace::set_setting,
            commands::project::list_projects,
            commands::project::create_project,
            commands::project::rename_project,
            commands::project::relocate_project,
            commands::project::open_project,
            commands::project::delete_project,
            commands::workspace::set_workspace_pantheon,
            commands::workspace::set_workspace_folder,
            commands::git::git_status,
            commands::repo::repo_state,
            commands::repo::repo_history,
            commands::repo::repo_commit,
            commands::repo::repo_discard,
            commands::repo::repo_push,
            commands::github::github_detect_repo,
            commands::github::github_list_issues,
            commands::github::github_list_project_items,
            commands::github::github_project_statuses,
            commands::github::github_create_issue,
            commands::github::github_set_issue_state,
            commands::github::github_move_project_item,
            commands::review::review_changes,
            commands::review::review_file_diff,
            commands::review::review_files,
            commands::review::review_read_file,
            commands::review::review_default_base,
            commands::studio::studio_tree,
            commands::studio::studio_read,
            commands::studio::studio_version,
            commands::studio::studio_write,
            commands::mission::mission_prepare,
            commands::mission::mission_add_agent,
            commands::mission::mission_merge,
            commands::mission::mission_cleanup,
            commands::mission::mission_cleanup_unsaved,
            commands::mission::mission_discard,
            commands::mission::mission_backlog,
            commands::mission::mission_issues,
            commands::mission::mission_checks,
            commands::mission::set_keep_awake,
            commands::notes::notes_all,
            commands::notes::notes_read,
            commands::notes::notes_version,
            commands::notes::notes_write,
            commands::notes::notes_agent_list,
            commands::notes::notes_agent_read,
            commands::agents::agent_activity_snapshot,
            commands::agents::subagent_snapshot,
            commands::agents::mcp_reply,
            commands::agents::set_subagent_terminals,
            commands::agents::claude_extensions,
            commands::agents::claude_launch_defaults,
            commands::agents::codex_linear_login,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the dummyPlane application");

    app.run(|handle, event| {
        // Agents must not outlive the window that shows them; their screens are
        // saved first so they can be shown again, stopped, on the next start.
        if let tauri::RunEvent::Exit = event {
            commands::pty::flush_scrollbacks(handle, true);
            handle.state::<PtyManager>().kill_all();
        }
    });
}

/// The dialog of a database that does not open, in the app's voice (docs/design-system.md,
/// Alerts): what failed and what to do, then the file, the error's own text last.
fn database_failure(path: &std::path::Path, err: &dyn std::fmt::Display) -> (String, String) {
    let shown = path.display();
    (
        "dummyPlane could not start".to_string(),
        format!(
            "dummyPlane could not open its database, so it will close.\n\nCheck that this file can be read and written, then start dummyPlane again:\n{shown}\n\nDetails: {err}"
        ),
    )
}

fn spawn_scrollback_flusher(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(SCROLLBACK_FLUSH_INTERVAL);
            commands::pty::flush_scrollbacks(&app, false);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::database_failure;

    /// The database's dialog says what failed and what to do first, the raw error last.
    #[test]
    fn a_database_that_does_not_open_says_what_to_do_before_the_error() {
        let path = std::path::Path::new("C:/data/dummyplane.db");
        let (title, message) = database_failure(path, &"disk I/O error");
        assert_eq!(title, "dummyPlane could not start");
        assert!(message.starts_with("dummyPlane could not open its database"));
        let next = message.find("start dummyPlane again").unwrap();
        let file = message.find("C:/data/dummyplane.db").unwrap();
        let detail = message.find("Details: disk I/O error").unwrap();
        assert!(next < file && file < detail);
        assert!(message.ends_with("Details: disk I/O error"));
        assert!(!message.contains('!'));
    }

    /// `run` builds the window from the config by its label, not its position.
    #[test]
    fn the_config_declares_a_window_labelled_main() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let windows = config["app"]["windows"].as_array().unwrap();
        assert!(windows.iter().any(|window| window["label"] == "main"));
    }
}
