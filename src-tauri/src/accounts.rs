//! Claude profiles: a name and a folder, nothing else. The
//! folder is Claude Code's own `CLAUDE_CONFIG_DIR`. dummyPlane reads its
//! `settings.json` for the status line and the names under `projects` to know
//! whether a conversation can be resumed; it never reads a conversation or the
//! login, and copies or logs nothing.

use std::path::{Component, Path, PathBuf};

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::settings;
use crate::error::{AppError, AppResult};

const KEY: &str = "accounts";
const MAX_NAME: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub config_dir: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Accounts {
    #[serde(default)]
    pub profiles: Vec<Profile>,
    /// The profile new Claude agents start with; `None`: the default one.
    #[serde(default)]
    pub active: Option<String>,
}

/// A folder as typed or pasted: trimmed, and out of the quotes Explorer's "Copy as path" puts round it.
fn unquoted(dir: &str) -> &str {
    let dir = dir.trim();
    dir.strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .map_or(dir, str::trim)
}

/// A folder dummyPlane may hand to Claude as `CLAUDE_CONFIG_DIR`: absolute,
/// without `..` or control characters. Returned as given, but for its quotes.
pub fn checked_dir(dir: &str) -> AppResult<PathBuf> {
    let clean = unquoted(dir);
    let path = Path::new(clean);
    let bad = clean.is_empty()
        || dir.chars().any(char::is_control)
        || !path.is_absolute()
        || path.components().any(|c| matches!(c, Component::ParentDir));
    if bad {
        return Err(AppError::InvalidInput(format!(
            "invalid profile folder: {dir}"
        )));
    }
    if path.exists() && !path.is_dir() {
        return Err(AppError::InvalidInput(format!("not a folder: {dir}")));
    }
    Ok(path.to_path_buf())
}

/// The stored profiles: none while none were ever stored. A row that is there and cannot be
/// read is an error, never an empty list: the next add, remove or use would store its list
/// over it, and every profile would be gone. (`settings::get` reads a value that does not
/// parse as unset, so the row is read here.)
pub fn load(conn: &Connection) -> AppResult<Accounts> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            [KEY],
            |row| row.get(0),
        )
        .optional()?;
    let Some(raw) = raw else {
        return Ok(Accounts::default());
    };
    serde_json::from_str(&raw).map_err(|err| {
        AppError::InvalidInput(format!(
            "the saved Claude accounts cannot be read, and are left as they are: {err}"
        ))
    })
}

fn store(conn: &Connection, accounts: &Accounts) -> AppResult<()> {
    settings::set(
        conn,
        KEY,
        &serde_json::to_value(accounts).expect("plain data"),
    )
}

/// Whether two spellings name one folder: in any case, with either separator, and without
/// what changes nothing in a path (a doubled or a final separator, a `.` segment).
fn same_folder(a: &str, b: &str) -> bool {
    let clean = |s: &str| {
        unquoted(s)
            .to_lowercase()
            .split(['\\', '/'])
            .filter(|segment| !segment.is_empty() && *segment != ".")
            .collect::<Vec<_>>()
            .join("/")
    };
    clean(a) == clean(b)
}

/// Adds a profile and creates its folder when missing. Never touches an existing one.
pub fn add(conn: &Connection, name: &str, config_dir: &str) -> AppResult<Profile> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME || name.chars().any(char::is_control) {
        return Err(AppError::InvalidInput(
            "invalid profile name (1 to 40 characters)".to_string(),
        ));
    }
    let dir = checked_dir(config_dir)?;
    let mut accounts = load(conn)?;
    let taken = accounts.profiles.iter().any(|p| {
        p.name.eq_ignore_ascii_case(name) || same_folder(&p.config_dir, &dir.to_string_lossy())
    });
    if taken {
        return Err(AppError::InvalidInput(
            "a profile already has this name or folder".to_string(),
        ));
    }
    std::fs::create_dir_all(&dir)?;
    let profile = Profile {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        config_dir: dir.to_string_lossy().into_owned(),
    };
    accounts.profiles.push(profile.clone());
    store(conn, &accounts)?;
    Ok(profile)
}

/// Forgets a profile; its folder stays on the disk.
pub fn remove(conn: &Connection, id: &str) -> AppResult<()> {
    let mut accounts = load(conn)?;
    accounts.profiles.retain(|p| p.id != id);
    if accounts.active.as_deref() == Some(id) {
        accounts.active = None;
    }
    store(conn, &accounts)
}

/// The profile new agents use: `None` for the default one.
pub fn set_active(conn: &Connection, id: Option<&str>) -> AppResult<()> {
    let mut accounts = load(conn)?;
    if let Some(id) = id
        && !accounts.profiles.iter().any(|p| p.id == id)
    {
        return Err(AppError::NotFound(format!("profile not found: {id}")));
    }
    accounts.active = id.map(str::to_string);
    store(conn, &accounts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn db() -> Db {
        Db::open_in_memory().unwrap()
    }

    #[test]
    fn adds_a_profile_and_creates_only_its_own_folder() {
        let db = db();
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("work");
        let profile = db
            .with(|conn| add(conn, " Travail ", &dir.to_string_lossy()))
            .unwrap();
        assert_eq!(profile.name, "Travail");
        assert!(dir.is_dir(), "the folder is created for the login to fill");
        let accounts = db.with(|conn| load(conn)).unwrap();
        assert_eq!(accounts.profiles, vec![profile]);
        assert_eq!(accounts.active, None);
    }

    #[test]
    fn an_existing_folder_is_left_exactly_as_it_was() {
        let db = db();
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("keep.txt"), "mine").unwrap();
        db.with(|conn| add(conn, "Perso", &root.path().to_string_lossy()))
            .unwrap();
        let names: Vec<_> = std::fs::read_dir(root.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, ["keep.txt"]);
        assert_eq!(
            std::fs::read_to_string(root.path().join("keep.txt")).unwrap(),
            "mine"
        );
    }

    #[test]
    fn refuses_bad_names_folders_and_duplicates() {
        let db = db();
        let root = tempfile::tempdir().unwrap();
        let a = root.path().join("a");
        let a = a.to_string_lossy().into_owned();
        db.with(|conn| add(conn, "A", &a)).unwrap();
        let bad = |name: &str, dir: &str| db.with(|conn| add(conn, name, dir)).is_err();
        assert!(bad("", &a), "empty name");
        assert!(bad(
            &"x".repeat(41),
            &root.path().join("b").to_string_lossy()
        ));
        assert!(bad("B", "relative/dir"), "relative folder");
        assert!(
            bad("B", &format!("{}/../up", root.path().display())),
            "parent segment"
        );
        assert!(bad("B", "C:\\\u{7}bell"), "control character");
        assert!(
            bad("a", &root.path().join("c").to_string_lossy()),
            "same name, any case"
        );
        assert!(bad("C", &a.to_uppercase()), "same folder");
        let file = root.path().join("file.txt");
        std::fs::write(&file, "x").unwrap();
        assert!(bad("D", &file.to_string_lossy()), "a file is not a folder");
    }

    /// Explorer's "Copy as path" puts the folder in quotes: the box was refused as "invalid
    /// profile folder", and the quotes are no part of the folder.
    #[test]
    fn takes_a_folder_pasted_with_its_quotes() {
        let db = db();
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("quoted");
        let plain = dir.to_string_lossy().into_owned();
        let profile = db
            .with(|conn| add(conn, "Q", &format!("  \"{plain}\" ")))
            .unwrap();
        assert_eq!(profile.config_dir, plain);
        assert!(dir.is_dir());
        // Quoted or not, it is the same folder.
        assert!(
            db.with(|conn| add(conn, "R", &format!("\"{plain}\"")))
                .is_err()
        );
        assert_eq!(checked_dir(&format!("\"{plain}\"")).unwrap(), dir);
        // A lone quote, or quotes round nothing, are no folder.
        assert!(checked_dir("\"").is_err());
        assert!(checked_dir("\"\"").is_err());
    }

    /// `.` segments and doubled separators name the same folder: it was added twice.
    #[test]
    fn a_folder_spelled_another_way_is_the_same_folder() {
        let db = db();
        let root = tempfile::tempdir().unwrap();
        let base = root.path().to_string_lossy().into_owned();
        let first = root.path().join("a").join("b");
        db.with(|conn| add(conn, "A", &first.to_string_lossy()))
            .unwrap();
        for (n, spelled) in [
            format!("{base}/./a/b"),
            format!("{base}\\a\\\\b"),
            format!("{base}//a/b//"),
            format!("{base}\\.\\a\\.\\b\\"),
        ]
        .into_iter()
        .enumerate()
        {
            assert!(
                db.with(|conn| add(conn, &format!("N{n}"), &spelled))
                    .is_err(),
                "{spelled}"
            );
        }
        // Another folder is another folder.
        db.with(|conn| add(conn, "B", &format!("{base}/./a/c")))
            .unwrap();
    }

    /// What the row holds, as it is stored.
    fn stored_text(db: &Db) -> Option<String> {
        db.with(|conn| {
            Ok(conn
                .query_row(
                    "SELECT value_json FROM settings WHERE key = ?1",
                    [KEY],
                    |row| row.get::<_, String>(0),
                )
                .ok())
        })
        .unwrap()
    }

    /// A row that no longer reads was an empty list, and the next add, remove or use stored
    /// that list over it: every profile gone. It is refused, and the row stays as it is.
    #[test]
    fn never_writes_over_accounts_it_could_not_read() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("w").to_string_lossy().into_owned();
        // Valid JSON of another shape (a profile without its folder), then no JSON at all.
        for text in [
            r#"{"profiles":[{"id":"p1","name":"Keep"}],"active":null}"#,
            "{not json",
        ] {
            let db = db();
            db.with(|conn| {
                conn.execute(
                    "INSERT INTO settings (key, value_json) VALUES (?1, ?2)",
                    [KEY, text],
                )?;
                Ok(())
            })
            .unwrap();
            assert!(db.with(|conn| load(conn)).is_err(), "{text}");
            assert!(
                db.with(|conn| add(conn, "New", &dir)).is_err(),
                "add {text}"
            );
            assert!(db.with(|conn| remove(conn, "p1")).is_err(), "remove {text}");
            assert!(
                db.with(|conn| set_active(conn, None)).is_err(),
                "use {text}"
            );
            assert_eq!(stored_text(&db).as_deref(), Some(text));
            assert!(!Path::new(&dir).exists(), "no folder was made for it");
        }
        // Nothing stored yet is an empty list, as before.
        let fresh = db();
        assert_eq!(fresh.with(|conn| load(conn)).unwrap(), Accounts::default());
    }

    #[test]
    fn uses_and_removes_profiles_leaving_their_folder() {
        let db = db();
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("w");
        let profile = db
            .with(|conn| add(conn, "W", &dir.to_string_lossy()))
            .unwrap();
        db.with(|conn| set_active(conn, Some(&profile.id))).unwrap();
        assert_eq!(
            db.with(|conn| load(conn)).unwrap().active,
            Some(profile.id.clone())
        );
        assert!(db.with(|conn| set_active(conn, Some("nope"))).is_err());
        db.with(|conn| remove(conn, &profile.id)).unwrap();
        let accounts = db.with(|conn| load(conn)).unwrap();
        assert!(accounts.profiles.is_empty());
        assert_eq!(accounts.active, None, "the active profile went with it");
        assert!(dir.is_dir(), "the folder is not dummyPlane's to delete");
        db.with(|conn| set_active(conn, None)).unwrap();
    }
}
