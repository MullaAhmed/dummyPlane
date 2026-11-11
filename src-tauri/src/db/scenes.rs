use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::now_ms;
use crate::error::AppResult;

/// An image of the scene (e.g. a cloud icon), kept as the data URL Excalidraw uses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneFile {
    pub id: String,
    pub mime_type: String,
    pub data_url: String,
    pub created: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredNode {
    pub id: String,
    pub kind: String,
    pub payload_json: String,
}

/// Everything needed to show a workspace, except terminal scrollback (fetched per node).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceData {
    pub elements_json: Option<String>,
    pub app_state_json: Option<String>,
    pub files: Vec<SceneFile>,
    pub nodes: Vec<StoredNode>,
}

pub fn load(conn: &Connection, workspace_id: &str) -> AppResult<WorkspaceData> {
    let scene: Option<(String, String)> = conn
        .query_row(
            "SELECT elements_json, app_state_json FROM scenes WHERE workspace_id = ?1",
            [workspace_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let files = conn
        .prepare("SELECT file_id, mime_type, data_url, created_at FROM scene_files WHERE workspace_id = ?1")?
        .query_map([workspace_id], |row| {
            Ok(SceneFile { id: row.get(0)?, mime_type: row.get(1)?, data_url: row.get(2)?, created: row.get(3)? })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let nodes = conn
        .prepare("SELECT id, kind, payload_json FROM nodes WHERE workspace_id = ?1")?
        .query_map([workspace_id], |row| {
            Ok(StoredNode {
                id: row.get(0)?,
                kind: row.get(1)?,
                payload_json: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let (elements_json, app_state_json) = scene.unzip();
    Ok(WorkspaceData {
        elements_json,
        app_state_json,
        files,
        nodes,
    })
}

/// Saves the scene and, in the same transaction, deletes the nodes of this workspace
/// that are no longer on it (their scrollback follows by cascade).
pub fn save(
    conn: &mut Connection,
    workspace_id: &str,
    elements_json: &str,
    app_state_json: &str,
    node_ids: &[String],
) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO scenes (workspace_id, elements_json, app_state_json, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(workspace_id) DO UPDATE SET elements_json = excluded.elements_json,
           app_state_json = excluded.app_state_json, updated_at = excluded.updated_at",
        params![workspace_id, elements_json, app_state_json, now_ms()],
    )?;
    tx.execute(
        "DELETE FROM nodes WHERE workspace_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))",
        params![
            workspace_id,
            serde_json::to_string(node_ids).unwrap_or_else(|_| "[]".into())
        ],
    )?;
    tx.commit()?;
    Ok(())
}

/// Stores images not seen before; a file id is immutable, so existing ones are kept.
pub fn save_files(conn: &mut Connection, workspace_id: &str, files: &[SceneFile]) -> AppResult<()> {
    let tx = conn.transaction()?;
    for file in files {
        tx.execute(
            "INSERT OR IGNORE INTO scene_files (workspace_id, file_id, mime_type, data_url, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![workspace_id, file.id, file.mime_type, file.data_url, file.created],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::nodes::{self, NodeKind};
    use crate::db::{Db, scrollback, test_workspace, workspaces};

    fn file(id: &str, data_url: &str) -> SceneFile {
        SceneFile {
            id: id.into(),
            mime_type: "image/svg+xml".into(),
            data_url: data_url.into(),
            created: 1,
        }
    }

    #[test]
    fn an_unsaved_workspace_loads_empty() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let w = test_workspace(conn, "A")?;
                let data = load(conn, &w.id)?;
                assert_eq!(
                    data,
                    WorkspaceData {
                        elements_json: None,
                        app_state_json: None,
                        files: vec![],
                        nodes: vec![]
                    }
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn saves_the_scene_and_purges_nodes_that_left_it() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let w = test_workspace(conn, "A")?;
                nodes::save(conn, "kept", &w.id, NodeKind::Terminal, "{}")?;
                nodes::save(conn, "gone", &w.id, NodeKind::Terminal, "{}")?;
                scrollback::save(conn, "gone", b"old output", 1)?;
                save(conn, &w.id, "[1]", r#"{"zoom":1}"#, &["kept".to_string()])?;
                save(conn, &w.id, "[1,2]", r#"{"zoom":2}"#, &["kept".to_string()])?;
                let data = load(conn, &w.id)?;
                assert_eq!(data.elements_json.as_deref(), Some("[1,2]"));
                assert_eq!(data.app_state_json.as_deref(), Some(r#"{"zoom":2}"#));
                let ids: Vec<_> = data.nodes.iter().map(|n| n.id.as_str()).collect();
                assert_eq!(ids, vec!["kept"]);
                assert_eq!(scrollback::load(conn, "gone")?, None);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn purging_leaves_other_workspaces_alone() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let a = test_workspace(conn, "A")?;
                let b = test_workspace(conn, "B")?;
                nodes::save(conn, "in-b", &b.id, NodeKind::Note, "{}")?;
                save(conn, &a.id, "[]", "{}", &[])?;
                assert_eq!(load(conn, &b.id)?.nodes.len(), 1);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn keeps_the_first_copy_of_each_file() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let w = test_workspace(conn, "A")?;
                save_files(conn, &w.id, &[file("f1", "data:a")])?;
                save_files(conn, &w.id, &[file("f1", "data:b"), file("f2", "data:c")])?;
                let files = load(conn, &w.id)?.files;
                assert_eq!(files.len(), 2);
                assert_eq!(
                    files.iter().find(|f| f.id == "f1").unwrap().data_url,
                    "data:a"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn deleting_a_workspace_removes_everything_it_owned() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let a = test_workspace(conn, "A")?;
                test_workspace(conn, "B")?;
                nodes::save(conn, "t", &a.id, NodeKind::Terminal, "{}")?;
                scrollback::save(conn, "t", b"x", 1)?;
                save(conn, &a.id, "[]", "{}", &["t".to_string()])?;
                save_files(conn, &a.id, &[file("f", "data:x")])?;
                workspaces::delete(conn, &a.id)?;
                let leftovers: i64 = conn.query_row(
                    "SELECT (SELECT COUNT(*) FROM scenes) + (SELECT COUNT(*) FROM scene_files)
                          + (SELECT COUNT(*) FROM nodes) + (SELECT COUNT(*) FROM terminal_scrollback)",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(leftovers, 0);
                Ok(())
            })
            .unwrap();
    }
}
