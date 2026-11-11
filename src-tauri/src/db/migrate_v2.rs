//! Migration 002: workspaces move into projects — one per
//! folder, taken from each workspace's first terminal — and nodes accept the
//! `orchestrator` kind (the stored name of the fleet node kind, see
//! `nodes::STORED_FLEET_KIND`). Both tables are rebuilt: SQLite cannot add a NOT NULL
//! foreign key or change a CHECK constraint in place.

use std::collections::HashMap;

use rusqlite::{Transaction, params};

use super::now_ms;
use super::projects::{name_from_path, normalize_path, path_key};

pub fn run(tx: &Transaction, home: &str) -> rusqlite::Result<()> {
    tx.execute_batch(include_str!("migrations/002_projects.sql"))?;
    let workspaces = {
        let mut stmt = tx.prepare(
            "SELECT id, name, position, created_at, updated_at FROM workspaces ORDER BY position, created_at",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let now = now_ms();
    let mut projects: HashMap<String, String> = HashMap::new();
    for (id, name, position, created_at, updated_at) in workspaces {
        let path = first_terminal_folder(tx, &id)?.unwrap_or_else(|| normalize_path(home));
        let project_id =
            match projects.get(&path_key(&path)) {
                Some(project_id) => project_id.clone(),
                None => {
                    let project_id = uuid::Uuid::new_v4().to_string();
                    tx.execute(
                    "INSERT INTO projects (id, name, path, position, created_at, last_opened_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                    params![project_id, name_from_path(&path), path, projects.len() as i64, now],
                )?;
                    projects.insert(path_key(&path), project_id.clone());
                    project_id
                }
            };
        tx.execute(
            "INSERT INTO workspaces_new (id, project_id, name, position, pantheon, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)",
            params![id, project_id, name, position, created_at, updated_at],
        )?;
    }
    tx.execute_batch(
        "INSERT INTO nodes_new (id, workspace_id, kind, payload_json, updated_at)
           SELECT id, workspace_id, kind, payload_json, updated_at FROM nodes;
         DROP TABLE nodes;
         DROP TABLE workspaces;
         ALTER TABLE workspaces_new RENAME TO workspaces;
         ALTER TABLE nodes_new RENAME TO nodes;
         CREATE INDEX nodes_workspace ON nodes(workspace_id);
         CREATE INDEX workspaces_project ON workspaces(project_id);",
    )
}

/// The folder of the oldest-saved terminal of a workspace that names one.
fn first_terminal_folder(tx: &Transaction, workspace_id: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = tx.prepare(
        "SELECT payload_json FROM nodes WHERE workspace_id = ?1 AND kind = 'terminal' ORDER BY updated_at",
    )?;
    let payloads = stmt.query_map([workspace_id], |row| row.get::<_, String>(0))?;
    for payload in payloads {
        let payload = payload?;
        let folder = serde_json::from_str::<serde_json::Value>(&payload)
            .ok()
            .and_then(|value| {
                value
                    .get("cwd")?
                    .as_str()
                    .map(str::trim)
                    .filter(|cwd| !cwd.is_empty())
                    .map(normalize_path)
            });
        if folder.is_some() {
            return Ok(folder);
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::super::migrate_up_to;

    fn v1_database() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate_up_to(&mut conn, 1, "unused").unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO workspaces VALUES ('w1', 'API', 0, 1, 1), ('w2', 'API bis', 1, 2, 2),
                                          ('w3', 'Notes', 2, 3, 3), ('w4', 'Vide', 3, 4, 4);
            INSERT INTO nodes VALUES
              ('t1', 'w1', 'terminal', '{"cwd":"C:\\code\\api\\","title":"a"}', 10),
              ('t2', 'w2', 'terminal', '{"cwd":"c:/code/API","title":"b"}', 11),
              ('n3', 'w3', 'note', '{}', 12),
              ('t4', 'w4', 'terminal', '{"cwd":"  "}', 13);
            INSERT INTO scenes VALUES ('w1', '[]', '{}', 20);
            INSERT INTO terminal_scrollback VALUES ('t1', x'41', 21);
            "#,
        )
        .unwrap();
        conn
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn groups_workspaces_into_projects_by_the_folder_of_their_first_terminal() {
        let mut conn = v1_database();
        migrate_up_to(&mut conn, 2, r"C:\Users\me").unwrap();
        let projects: Vec<(String, String)> = conn
            .prepare("SELECT name, path FROM projects ORDER BY position")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            projects,
            vec![
                ("api".to_string(), r"C:\code\api".to_string()),
                ("me".to_string(), r"C:\Users\me".to_string()),
            ]
        );
        let project_of = |workspace: &str| -> String {
            conn.query_row(
                "SELECT p.name FROM workspaces w JOIN projects p ON p.id = w.project_id WHERE w.id = ?1",
                [workspace],
                |row| row.get(0),
            )
            .unwrap()
        };
        assert_eq!(
            [
                project_of("w1"),
                project_of("w2"),
                project_of("w3"),
                project_of("w4")
            ],
            ["api", "api", "me", "me"]
        );
    }

    #[test]
    fn keeps_nodes_scenes_and_scrollbacks() {
        let mut conn = v1_database();
        migrate_up_to(&mut conn, 2, r"C:\Users\me").unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM nodes"), 4);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM scenes"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM terminal_scrollback"), 1);
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM pragma_foreign_key_check"),
            0
        );
    }

    #[test]
    fn deleting_a_project_cascades_to_the_content_of_its_workspaces() {
        let mut conn = v1_database();
        migrate_up_to(&mut conn, 2, r"C:\Users\me").unwrap();
        conn.execute("DELETE FROM projects WHERE name = 'api'", [])
            .unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM workspaces"), 2);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM scenes"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM terminal_scrollback"), 0);
    }

    #[test]
    fn accepts_fleet_nodes() {
        let mut conn = v1_database();
        migrate_up_to(&mut conn, 2, "C:/home").unwrap();
        // Stored data: a fleet node's kind is still 'orchestrator' in the table.
        conn.execute(
            "INSERT INTO nodes VALUES ('o1', 'w1', 'orchestrator', '{}', 1)",
            [],
        )
        .unwrap();
    }

    #[test]
    fn a_failed_migration_leaves_version_1_untouched() {
        let mut conn = v1_database();
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             INSERT INTO nodes VALUES ('ghost', 'missing', 'note', '{}', 1);
             PRAGMA foreign_keys = ON;",
        )
        .unwrap();
        assert!(migrate_up_to(&mut conn, 2, "C:/home").is_err());
        assert_eq!(count(&conn, "PRAGMA user_version"), 1);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'projects'"
            ),
            0
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM workspaces"), 4);
    }

    /// `DUMMYPLANE_DB_COPY=<copie de dummyplane.db> cargo test --lib -- --ignored --nocapture`
    #[test]
    #[ignore = "needs DUMMYPLANE_DB_COPY, a copy of a real dummyplane.db"]
    fn migrates_a_copy_of_the_real_database() {
        let path = std::env::var("DUMMYPLANE_DB_COPY").expect("DUMMYPLANE_DB_COPY");
        let mut conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate_up_to(&mut conn, 2, &crate::db::home_dir()).unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT p.name, p.path, COUNT(w.id) FROM projects p
                 LEFT JOIN workspaces w ON w.project_id = p.id GROUP BY p.id",
            )
            .unwrap();
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .unwrap();
        for row in rows {
            println!("{:?}", row.unwrap());
        }
    }
}
