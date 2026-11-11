use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::agents::CATALOG;
use crate::error::{AppError, AppResult};
use crate::process::hide_window;
use crate::pty::PtyManager;
use crate::pty::shell::{Agent, binary, find_git_bash, which_locate};

/// Right before the installer closes dummyPlane:
/// the agents stop and their final output is saved now, the scene and nodes
/// having been saved by the interface. The installer ends the process with
/// `std::process::exit`, so the app's own exit handling never runs.
#[tauri::command]
pub async fn prepare_for_update(app: AppHandle) {
    log::info!("installing an update");
    if !app.state::<PtyManager>().stop_all(UPDATE_STOP_TIMEOUT) {
        log::warn!("some terminals were still exiting when the update started");
    }
    crate::commands::pty::flush_scrollbacks(&app, true);
}

/// How long the agents get to stop before the installer runs.
const UPDATE_STOP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

fn log_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path().app_log_dir().map_err(|err| {
        AppError::NotFound(format!("Logs folder not found: {err}"))
    })
}

fn data_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path().app_data_dir().map_err(|err| {
        AppError::NotFound(format!("Data folder not found: {err}"))
    })
}

fn open_dir(app: &AppHandle, dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|err| AppError::Io(std::io::Error::other(err.to_string())))
}

/// Opens the folder of the log file, to send it with a bug report.
#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> AppResult<()> {
    open_dir(&app, &log_dir(&app)?)
}

/// Opens the folder of the database and the launch files.
#[tauri::command]
pub fn open_data_dir(app: AppHandle) -> AppResult<()> {
    open_dir(&app, &data_dir(&app)?)
}

#[derive(Debug, Serialize)]
pub struct FoundAgent {
    pub id: Agent,
    /// Home-shortened; `None` when the agent is not installed.
    pub path: Option<String>,
}

/// What the troubleshooting dialog shows and copies: no token, project path
/// or user name.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub version: String,
    pub os: String,
    pub agents: Vec<FoundAgent>,
    pub git: Option<String>,
    pub git_bash: Option<String>,
    /// dummyPlane's local hooks and MCP server runs.
    pub server: bool,
    pub data_dir: String,
    pub log_dir: String,
}

/// `path` with the home folder replaced by `~` (case-insensitive on Windows,
/// `\` and `/` both accepted); a path that only shares the prefix is untouched.
pub fn shorten_home(path: &str, home: &str) -> String {
    let home = home.trim_end_matches(['\\', '/']);
    if home.is_empty() {
        return path.to_string();
    }
    let Some(head) = path.get(..home.len()) else {
        return path.to_string();
    };
    let same = if cfg!(windows) {
        let slashed = |text: &str| text.replace('\\', "/").to_ascii_lowercase();
        slashed(head) == slashed(home)
    } else {
        head == home
    };
    let rest = &path[home.len()..];
    if same && (rest.is_empty() || rest.starts_with(['\\', '/'])) {
        format!("~{rest}")
    } else {
        path.to_string()
    }
}

fn home_dir() -> String {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var(var).unwrap_or_default()
}

fn shown(path: &Path, home: &str) -> String {
    shorten_home(&path.to_string_lossy(), home)
}

/// ProductName says "Windows 10" on Windows 11: the build tells them apart.
fn os_label(product: &str, build: &str) -> String {
    let name = match build.parse::<u32>() {
        Ok(number) if number >= 22000 => "Windows 11",
        _ if product.starts_with("Windows 10") => "Windows 10",
        _ => "Windows",
    };
    format!("{name} (build {build})")
}

fn os_description() -> String {
    #[cfg(windows)]
    {
        use winreg::RegKey;
        use winreg::enums::HKEY_LOCAL_MACHINE;
        if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
        {
            let product: String = key.get_value("ProductName").unwrap_or_default();
            let build: String = key.get_value("CurrentBuild").unwrap_or_default();
            return os_label(&product, &build);
        }
        "Windows".into()
    }
    #[cfg(not(windows))]
    std::env::consts::OS.into()
}

fn git_version(git: &Path) -> Option<String> {
    let output = hide_window(Command::new(git).arg("--version"))
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (output.status.success() && !text.is_empty()).then_some(text)
}

/// Scans the PATH for every agent and runs `git --version`: off the main
/// thread, or the window would freeze (final review R5d).
#[tauri::command]
pub async fn diagnostics(app: AppHandle) -> AppResult<Diagnostics> {
    tauri::async_runtime::spawn_blocking(move || collect(&app))
        .await
        .map_err(|err| AppError::Io(std::io::Error::other(err.to_string())))?
}

fn collect(app: &AppHandle) -> AppResult<Diagnostics> {
    let home = home_dir();
    let git = which_locate("git");
    Ok(Diagnostics {
        version: app.package_info().version.to_string(),
        os: os_description(),
        agents: CATALOG
            .iter()
            .filter(|id| !matches!(id, Agent::Shell | Agent::Custom))
            .map(|&id| FoundAgent {
                id,
                path: which_locate(binary(id)).map(|path| shown(&path, &home)),
            })
            .collect(),
        git: git.as_deref().and_then(git_version),
        git_bash: git
            .as_deref()
            .and_then(find_git_bash)
            .map(|path| shown(&path, &home)),
        server: crate::commands::agents::server_running(app),
        data_dir: shown(&data_dir(app)?, &home),
        log_dir: shown(&log_dir(app)?, &home),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortens_a_path_inside_the_home_folder() {
        let home = r"C:\Users\Me";
        assert_eq!(shorten_home(r"C:\Users\Me\AppData\x", home), r"~\AppData\x");
        assert_eq!(shorten_home("C:/Users/Me/bin", home), "~/bin");
        if cfg!(windows) {
            assert_eq!(shorten_home("c:/users/me/bin", home), "~/bin");
        }
        assert_eq!(shorten_home(r"C:\Users\Me", home), "~");
        assert_eq!(shorten_home(r"C:\Users\Me\", home), r"~\");
    }

    #[test]
    fn leaves_other_paths_alone() {
        let home = r"C:\Users\Me";
        assert_eq!(shorten_home(r"C:\Users\Me2\x", home), r"C:\Users\Me2\x");
        assert_eq!(shorten_home(r"D:\tools", home), r"D:\tools");
        assert_eq!(shorten_home(r"C:\Users\Me\x", ""), r"C:\Users\Me\x");
    }

    #[test]
    fn names_windows_11_from_its_build() {
        assert_eq!(
            os_label("Windows 10 Pro", "26300"),
            "Windows 11 (build 26300)"
        );
        assert_eq!(
            os_label("Windows 10 Pro", "19045"),
            "Windows 10 (build 19045)"
        );
        assert_eq!(os_label("", "x"), "Windows (build x)");
    }

    #[test]
    fn diagnostics_serialize_in_camel_case() {
        let json = serde_json::to_value(Diagnostics {
            version: "1".into(),
            os: "o".into(),
            agents: vec![FoundAgent {
                id: Agent::Claude,
                path: None,
            }],
            git: None,
            git_bash: None,
            server: true,
            data_dir: "d".into(),
            log_dir: "l".into(),
        })
        .unwrap();
        assert_eq!(json["agents"][0]["id"], "claude");
        assert!(json.get("gitBash").is_some() && json.get("dataDir").is_some());
    }
}
