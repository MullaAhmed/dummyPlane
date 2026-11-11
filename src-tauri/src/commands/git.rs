use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::git::{self, GitStatus};

/// Branch and changed-file count of the project folder.
#[tauri::command]
pub async fn git_status(path: String) -> AppResult<Option<GitStatus>> {
    tauri::async_runtime::spawn_blocking(move || git::status(Path::new(&path)))
        .await
        .map_err(|err| AppError::Io(std::io::Error::other(err.to_string())))
}
