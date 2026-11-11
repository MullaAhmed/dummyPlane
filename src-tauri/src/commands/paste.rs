//! An image pasted into a terminal (Ctrl+V on a screenshot) is saved here and
//! its path pasted in its place: Claude Code, Codex and the others read an
//! image path pasted alone as an attached image, and a shell gets a usable path.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// Under the app's cache folder, never the user's project.
const DIR: &str = "pasted-images";
const PREFIX: &str = "paste-";
/// The agent copies the image when it is pasted: an old file is only clutter.
const MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// What Claude Code recognises as an image path; the frontend sends one of them.
const EXTENSIONS: [&str; 4] = ["png", "jpg", "gif", "webp"];
const EXTENSION_HEADER: &str = "x-image-extension";

/// Saves the raw bytes of a pasted image and returns the file's path. The body
/// is raw (a JSON array of a screenshot's bytes would weigh megabytes) and the
/// extension comes in a header; the file name is always built here.
#[tauri::command]
pub async fn save_pasted_image(app: AppHandle, request: Request<'_>) -> AppResult<String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::InvalidInput(
            "The image must be sent as raw bytes".into(),
        ));
    };
    let extension = request
        .headers()
        .get(EXTENSION_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let Some(extension) = EXTENSIONS.into_iter().find(|known| *known == extension) else {
        return Err(AppError::InvalidInput(format!(
            "Unsupported image type: {extension}"
        )));
    };
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| AppError::NotFound(format!("Cache folder not found: {err}")))?
        .join(DIR);
    let bytes = bytes.clone();
    // Off the async runtime's threads: writing a large screenshot blocks.
    let path = tauri::async_runtime::spawn_blocking(move || {
        save(&dir, &bytes, extension, SystemTime::now())
    })
    .await
    .map_err(|err| AppError::Io(io::Error::other(err.to_string())))??;
    // Not canonicalized: that would give `\\?\C:\…`, which agents do not read as a path.
    Ok(path.to_string_lossy().into_owned())
}

/// Writes `bytes` to a new file of `dir`, after removing the pastes older than `MAX_AGE`.
fn save(dir: &Path, bytes: &[u8], extension: &str, now: SystemTime) -> io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    prune(dir, now, MAX_AGE);
    let millis = now
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let path = dir.join(file_name(
        millis,
        &uuid::Uuid::new_v4().simple().to_string()[..8],
        extension,
    ));
    // create_new: two pastes never share a file, even within the same millisecond.
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    file.write_all(bytes)?;
    Ok(path)
}

/// `paste-<millis>-<tag>.<extension>`: sorted by time, unique thanks to the tag.
fn file_name(millis: u128, tag: &str, extension: &str) -> String {
    format!("{PREFIX}{millis}-{tag}.{extension}")
}

/// Removes this folder's pastes older than `max_age`. A failure is only logged:
/// it must not cost the user the paste.
fn prune(dir: &Path, now: SystemTime, max_age: Duration) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            log::warn!("could not list the pasted images: {err}");
            return;
        }
    };
    for entry in entries.flatten() {
        if !is_paste(&entry.path()) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        let old = now.duration_since(modified).is_ok_and(|age| age > max_age);
        if meta.is_file()
            && old
            && let Err(err) = fs::remove_file(entry.path())
        {
            log::warn!("could not remove an old pasted image: {err}");
        }
    }
}

/// Only files this command wrote: anything else in the folder is left alone.
fn is_paste(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default();
    name.starts_with(PREFIX) && EXTENSIONS.contains(&extension)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: Duration = Duration::from_secs(24 * 60 * 60);

    #[test]
    fn names_a_paste_by_its_time_and_tag() {
        assert_eq!(
            file_name(1_700_000_000_123, "ab12cd34", "png"),
            "paste-1700000000123-ab12cd34.png"
        );
    }

    #[test]
    fn saves_the_bytes_in_a_new_file_of_the_folder() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join(DIR);
        let now = SystemTime::now();
        let first = save(&dir, b"one", "png", now).unwrap();
        let second = save(&dir, b"two", "png", now).unwrap();
        assert_ne!(
            first, second,
            "two pastes in the same millisecond keep their own file"
        );
        assert_eq!(first.parent(), Some(dir.as_path()));
        assert!(is_paste(&first));
        assert_eq!(fs::read(&first).unwrap(), b"one");
        assert_eq!(fs::read(&second).unwrap(), b"two");
    }

    #[test]
    fn prunes_only_old_pastes() {
        let dir = tempfile::tempdir().unwrap();
        let write = |name: &str, age: Duration| {
            let path = dir.path().join(name);
            fs::write(&path, b"x").unwrap();
            let file = fs::File::options().write(true).open(&path).unwrap();
            file.set_modified(SystemTime::now() - age).unwrap();
            path
        };
        let old = write("paste-1-aaaaaaaa.png", 8 * DAY);
        let recent = write("paste-2-bbbbbbbb.jpg", DAY);
        let foreign = write("notes.png", 30 * DAY);
        let other_type = write("paste-3-cccccccc.txt", 30 * DAY);

        prune(dir.path(), SystemTime::now(), MAX_AGE);

        assert!(!old.exists());
        assert!(recent.exists());
        assert!(foreign.exists(), "a file this command did not write stays");
        assert!(other_type.exists());
    }

    #[test]
    fn saving_prunes_but_keeps_the_new_paste() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("paste-1-aaaaaaaa.png");
        fs::write(&old, b"x").unwrap();
        // Seen from eight days later, the file just written is new and the other one old.
        let later = SystemTime::now() + 8 * DAY;
        let saved = save(dir.path(), b"new", "webp", later).unwrap();
        assert!(!old.exists());
        assert!(saved.exists());
    }
}
