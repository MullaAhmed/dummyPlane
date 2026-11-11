use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use super::now_ms;
use crate::error::AppResult;

/// Stored data: the kind of a fleet node in the nodes table, kept from the time
/// it was called the orchestrator. Never change it: saved databases, scenes and
/// older interfaces carry it. (`NodeKind::Fleet`'s serde name repeats it: an
/// attribute only takes a literal, and a test keeps both equal.)
pub const STORED_FLEET_KIND: &str = "orchestrator";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Terminal,
    /// The manager node. Its stored and wire name is `STORED_FLEET_KIND`.
    #[serde(rename = "orchestrator")]
    Fleet,
    Note,
    Kanban,
    Git,
    File,
    /// What an agent showed with show_output, in OpenUI Lang (migration 007).
    Output,
}

impl NodeKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            NodeKind::Terminal => "terminal",
            NodeKind::Fleet => STORED_FLEET_KIND,
            NodeKind::Note => "note",
            NodeKind::Kanban => "kanban",
            NodeKind::Git => "git",
            NodeKind::File => "file",
            NodeKind::Output => "output",
        }
    }
}

/// Creates or replaces the content of a node. The payload is opaque
/// JSON owned by the frontend.
pub fn save(
    conn: &Connection,
    id: &str,
    workspace_id: &str,
    kind: NodeKind,
    payload_json: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO nodes (id, workspace_id, kind, payload_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at",
        params![id, workspace_id, kind.as_str(), payload_json, now_ms()],
    )?;
    Ok(())
}

pub fn ids_of_workspace(conn: &Connection, workspace_id: &str) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM nodes WHERE workspace_id = ?1")?;
    let ids = stmt.query_map([workspace_id], |row| row.get(0))?;
    Ok(ids.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Db, test_workspace};

    #[test]
    fn upserts_the_payload() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let w = test_workspace(conn, "A")?;
                save(conn, "n1", &w.id, NodeKind::Terminal, r#"{"title":"a"}"#)?;
                save(conn, "n1", &w.id, NodeKind::Terminal, r#"{"title":"b"}"#)?;
                let payload: String =
                    conn.query_row("SELECT payload_json FROM nodes WHERE id = 'n1'", [], |r| {
                        r.get(0)
                    })?;
                assert_eq!(payload, r#"{"title":"b"}"#);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn lists_the_node_ids_of_one_workspace() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let a = test_workspace(conn, "A")?;
                let b = test_workspace(conn, "B")?;
                save(conn, "a1", &a.id, NodeKind::Terminal, "{}")?;
                save(conn, "b1", &b.id, NodeKind::Note, "{}")?;
                assert_eq!(ids_of_workspace(conn, &a.id)?, vec!["a1".to_string()]);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn stores_fleet_nodes() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let w = test_workspace(conn, "A")?;
                save(conn, "o1", &w.id, NodeKind::Fleet, r#"{"name":"Chef"}"#)?;
                let kind: String =
                    conn.query_row("SELECT kind FROM nodes WHERE id = 'o1'", [], |r| r.get(0))?;
                // Stored data: a fleet node is still saved under its old name.
                assert_eq!(kind, "orchestrator");
                assert_eq!(kind, STORED_FLEET_KIND);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn a_stored_orchestrator_kind_loads_as_the_fleet_kind() {
        assert_eq!(
            serde_json::from_str::<NodeKind>(r#""orchestrator""#).unwrap(),
            NodeKind::Fleet
        );
        assert_eq!(
            serde_json::to_string(&NodeKind::Fleet).unwrap(),
            r#""orchestrator""#
        );
        assert_eq!(
            serde_json::to_string(&NodeKind::Fleet).unwrap(),
            format!("\"{STORED_FLEET_KIND}\"")
        );
        // The kind of the saved rows is not a name the renamed code would invent.
        assert!(serde_json::from_str::<NodeKind>(r#""fleet""#).is_err());
    }

    #[test]
    fn stores_kanban_nodes() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let w = test_workspace(conn, "A")?;
                let board = r#"{"columns":[{"id":"c1","title":"To do","cardIds":["k1"]}],"cards":{"k1":{"id":"k1","title":"t","notes":"","priority":"high"}}}"#;
                save(conn, "k1", &w.id, NodeKind::Kanban, board)?;
                let (kind, payload): (String, String) = conn.query_row(
                    "SELECT kind, payload_json FROM nodes WHERE id = 'k1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )?;
                assert_eq!(kind, "kanban");
                assert_eq!(payload, board);
                assert_eq!(
                    serde_json::from_str::<NodeKind>(r#""kanban""#).unwrap(),
                    NodeKind::Kanban
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn stores_file_nodes() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let w = test_workspace(conn, "A")?;
                save(conn, "f1", &w.id, NodeKind::File, r#"{"path":"README.md"}"#)?;
                let kind: String =
                    conn.query_row("SELECT kind FROM nodes WHERE id = 'f1'", [], |r| r.get(0))?;
                assert_eq!(kind, "file");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn stores_output_nodes() {
        Db::open_in_memory()
            .unwrap()
            .with(|conn| {
                let w = test_workspace(conn, "A")?;
                let output =
                    r#"{"title":"Tests","source":"t1","ui":"root = Stack([])","updatedAt":1}"#;
                save(conn, "o1", &w.id, NodeKind::Output, output)?;
                let (kind, payload): (String, String) = conn.query_row(
                    "SELECT kind, payload_json FROM nodes WHERE id = 'o1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )?;
                assert_eq!(kind, "output");
                assert_eq!(payload, output);
                assert_eq!(
                    serde_json::from_str::<NodeKind>(r#""output""#).unwrap(),
                    NodeKind::Output
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn refuses_a_node_of_an_unknown_workspace() {
        let err = Db::open_in_memory()
            .unwrap()
            .with(|conn| save(conn, "n1", "nope", NodeKind::Note, "{}"))
            .unwrap_err();
        assert_eq!(err.kind(), "db");
    }
}
