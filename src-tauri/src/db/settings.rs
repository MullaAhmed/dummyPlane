use rusqlite::{Connection, OptionalExtension, params};

use crate::error::AppResult;

/// Where the text of a row that did not parse is kept before a write replaces it: the key and this,
/// then this and `.2`, `.3`... for another text. A JSON string, so that it reads back as one.
const UNREADABLE: &str = ".unreadable";

/// What is stored under `key`, as it is; None when nothing is.
fn raw(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()?)
}

pub fn get(conn: &Connection, key: &str) -> AppResult<Option<serde_json::Value>> {
    // A value that no longer parses is treated as unset rather than blocking startup. It stays
    // on the disk as it is until a write replaces it, and `set` keeps it aside first.
    Ok(raw(conn, key)?.and_then(|json| serde_json::from_str(&json).ok()))
}

/// Keeps `text`, which did not parse, under another key: the stores read such a row as unset, build
/// their list from nothing and write it, and what the user had would be gone. A text already kept
/// is not kept twice, nor over another.
fn keep_aside(conn: &Connection, key: &str, text: &str) -> AppResult<()> {
    let kept = serde_json::Value::String(text.to_string()).to_string();
    let mut aside = format!("{key}{UNREADABLE}");
    let mut copies = 1;
    while let Some(held) = raw(conn, &aside)? {
        if held == kept {
            return Ok(());
        }
        copies += 1;
        aside = format!("{key}{UNREADABLE}.{copies}");
    }
    conn.execute(
        "INSERT INTO settings (key, value_json) VALUES (?1, ?2)",
        params![aside, kept],
    )?;
    log::warn!("setting {key} did not parse and is replaced: what it held is kept as {aside}");
    Ok(())
}

pub fn set(conn: &Connection, key: &str, value: &serde_json::Value) -> AppResult<()> {
    // Together: a write is refused if what it replaces cannot be kept.
    let tx = conn.unchecked_transaction()?;
    if let Some(text) = raw(&tx, key)?
        && serde_json::from_str::<serde_json::Value>(&text).is_err()
    {
        keep_aside(&tx, key, &text)?;
    }
    tx.execute(
        "INSERT INTO settings (key, value_json) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        params![key, value.to_string()],
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    /// A row stored as it is, however it reads.
    fn put_raw(conn: &Connection, key: &str, text: &str) {
        conn.execute(
            "INSERT INTO settings (key, value_json) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
            params![key, text],
        )
        .unwrap();
    }

    /// The store of the loops, the presets, the history... reads a row that does not parse as unset
    /// (`get` must not block startup), builds its list from nothing and writes it: the user's own
    /// text was replaced, and gone. It is kept beside the row before a write replaces it.
    #[test]
    fn keeps_a_row_that_does_not_parse_aside_before_a_write_replaces_it() {
        let lost = r#"[{"id":"nightly","every":3600,"text":"run the tests"#;
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                put_raw(conn, "loops.list", lost);
                // Startup is never blocked: the row reads as unset.
                assert_eq!(get(conn, "loops.list")?, None);
                // The loops store writes its list, built from that nothing.
                set(conn, "loops.list", &serde_json::json!([]))?;
                assert_eq!(get(conn, "loops.list")?, Some(serde_json::json!([])));
                // What was there is still there, as a string a person can read and the app never reads as a list.
                assert_eq!(
                    get(conn, "loops.list.unreadable")?,
                    Some(serde_json::json!(lost))
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn keeps_each_unreadable_text_once_and_never_over_another() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let aside = |key: &str| get(conn, key);
                put_raw(conn, "presets.teams", "{broken");
                set(conn, "presets.teams", &serde_json::json!([]))?;
                // The same text again (a backup put back by hand, broken the same way): nothing more kept.
                put_raw(conn, "presets.teams", "{broken");
                set(conn, "presets.teams", &serde_json::json!([]))?;
                assert_eq!(aside("presets.teams.unreadable.2")?, None);
                // Another text is kept too, the first one left where it is.
                put_raw(conn, "presets.teams", "[also broken");
                set(conn, "presets.teams", &serde_json::json!([1]))?;
                assert_eq!(
                    aside("presets.teams.unreadable")?,
                    Some(serde_json::json!("{broken"))
                );
                assert_eq!(
                    aside("presets.teams.unreadable.2")?,
                    Some(serde_json::json!("[also broken"))
                );
                assert_eq!(get(conn, "presets.teams")?, Some(serde_json::json!([1])));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn keeps_nothing_aside_for_a_row_that_reads_or_is_absent() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                // Never stored, then stored, then stored over, a null and a string among them: all valid JSON.
                for value in [
                    serde_json::json!({"a": 1}),
                    serde_json::json!(null),
                    serde_json::json!("text"),
                    serde_json::json!(false),
                ] {
                    set(conn, "ui.theme", &value)?;
                }
                let rows: i64 =
                    conn.query_row("SELECT count(*) FROM settings", [], |row| row.get(0))?;
                assert_eq!(rows, 1);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn stores_json_values_by_key() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                assert_eq!(get(conn, "ui.activeWorkspaceId")?, None);
                set(conn, "ui.activeWorkspaceId", &serde_json::json!("w1"))?;
                set(conn, "ui.activeWorkspaceId", &serde_json::json!("w2"))?;
                assert_eq!(
                    get(conn, "ui.activeWorkspaceId")?,
                    Some(serde_json::json!("w2"))
                );
                Ok(())
            })
            .unwrap();
    }
}
