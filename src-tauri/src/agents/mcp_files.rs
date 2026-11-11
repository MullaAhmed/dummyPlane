//! The files that give a Claude session dummyPlane's tools: `--mcp-config <nodeId>.json` and `--append-system-prompt-file <nodeId>.md`.

use std::io;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};

use super::hooks_server::valid_node_id;

/// dummyPlane's own server's name: its tools are `mcp__dummyplane__…`.
const OWN_SERVER: &str = "dummyplane";

pub struct McpFiles {
    pub config: PathBuf,
    pub prompt: PathBuf,
}

/// dummyPlane's server, after `others` (a fleet's servers, `extensions::servers_on`):
/// none of them can take its name.
pub fn config_json(url: &str, token: &str, others: &Map<String, Value>) -> Value {
    let mut servers: Map<String, Value> = others
        .iter()
        .filter(|(name, _)| !name.eq_ignore_ascii_case(OWN_SERVER))
        .map(|(name, server)| (name.clone(), server.clone()))
        .collect();
    servers.insert(
        OWN_SERVER.to_string(),
        json!({
            "type": "http",
            "url": url,
            "headers": { "Authorization": format!("Bearer {token}") }
        }),
    );
    json!({ "mcpServers": servers })
}

/// The name Linear's server goes by in a session: its tools are `mcp__linear__<tool>`.
pub const LINEAR: &str = "linear";

/// Linear's own server, the endpoint that "only ever exposes read tools" (linear.app/docs/mcp). No key
/// here: the user signs in once with OAuth in the fleet's Claude (`/mcp`), which keeps the token.
pub const LINEAR_READONLY_URL: &str = "https://mcp.linear.app/mcp/readonly";

pub fn with_linear(config: &mut Value) {
    config["mcpServers"][LINEAR] = json!({ "type": "http", "url": LINEAR_READONLY_URL });
}

/// Rewritten at each launch: the port and the token change.
pub fn write(
    dir: &Path,
    node_id: &str,
    url: &str,
    token: &str,
    others: &Map<String, Value>,
    prompt: &str,
    linear: bool,
) -> io::Result<McpFiles> {
    if !valid_node_id(node_id) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid node id: {node_id}"),
        ));
    }
    std::fs::create_dir_all(dir)?;
    let files = McpFiles {
        config: dir.join(format!("{node_id}.json")),
        prompt: dir.join(format!("{node_id}.md")),
    };
    // Linear's read-only server comes after a fleet's own servers: on a night that reads
    // Linear, it takes the place of one the user named `linear`.
    let mut config = config_json(url, token, others);
    if linear {
        with_linear(&mut config);
    }
    std::fs::write(&files.config, serde_json::to_vec_pretty(&config)?)?;
    std::fs::write(&files.prompt, prompt)?;
    Ok(files)
}

pub fn remove(dir: &Path, node_id: &str) {
    if valid_node_id(node_id) {
        let _ = std::fs::remove_file(dir.join(format!("{node_id}.json")));
        let _ = std::fs::remove_file(dir.join(format!("{node_id}.md")));
    }
}

/// Files left by a previous run carry tokens that are gone.
pub fn clear(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .extension()
            .is_some_and(|ext| ext == "json" || ext == "md")
        {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn points_claude_at_dummyplane_with_the_node_s_token() {
        assert_eq!(
            config_json("http://127.0.0.1:4242/mcp", "tok", &Map::new()),
            serde_json::json!({ "mcpServers": { "dummyplane": {
                "type": "http",
                "url": "http://127.0.0.1:4242/mcp",
                "headers": { "Authorization": "Bearer tok" }
            } } })
        );
    }

    #[test]
    fn carries_a_fleet_s_servers_and_none_can_take_dummyplane_s_name() {
        let mut others = Map::new();
        others.insert(
            "linear".into(),
            json!({ "type": "http", "url": "https://mcp.linear.app/mcp" }),
        );
        others.insert(
            "DummyPlane".into(),
            json!({ "type": "http", "url": "https://evil.example" }),
        );
        let config = config_json("http://127.0.0.1:1/mcp", "tok", &others);
        let servers = config["mcpServers"].as_object().unwrap();
        assert_eq!(servers.len(), 2);
        assert_eq!(servers["linear"]["url"], "https://mcp.linear.app/mcp");
        assert_eq!(servers["dummyplane"]["url"], "http://127.0.0.1:1/mcp");
    }

    #[test]
    fn gives_a_fleet_linear_s_read_only_server_without_any_key() {
        let mut config = config_json("http://127.0.0.1:4242/mcp", "tok", &Map::new());
        with_linear(&mut config);
        assert_eq!(
            config["mcpServers"]["linear"],
            serde_json::json!({ "type": "http", "url": "https://mcp.linear.app/mcp/readonly" })
        );
        assert!(config["mcpServers"]["linear"].get("headers").is_none());
        assert_eq!(
            config["mcpServers"]["dummyplane"]["headers"]["Authorization"],
            "Bearer tok"
        );
    }

    #[test]
    fn on_a_linear_night_the_read_only_server_replaces_the_user_s_linear() {
        let dir = tempfile::tempdir().unwrap();
        let mut others = Map::new();
        others.insert(
            "linear".into(),
            json!({ "type": "http", "url": "https://mcp.linear.app/mcp" }),
        );
        others.insert(
            "supabase".into(),
            json!({ "type": "http", "url": "https://mcp.supabase.com/mcp" }),
        );
        let files = write(
            dir.path(),
            "n1",
            "http://127.0.0.1:1/mcp",
            "tok",
            &others,
            "p",
            true,
        )
        .unwrap();
        let config: Value =
            serde_json::from_str(&std::fs::read_to_string(&files.config).unwrap()).unwrap();
        assert_eq!(
            config["mcpServers"]["linear"]["url"],
            "https://mcp.linear.app/mcp/readonly"
        );
        assert_eq!(
            config["mcpServers"]["supabase"]["url"],
            "https://mcp.supabase.com/mcp"
        );
        assert_eq!(
            config["mcpServers"]["dummyplane"]["url"],
            "http://127.0.0.1:1/mcp"
        );
    }

    #[test]
    fn writes_removes_and_clears_a_session_s_files() {
        let dir = tempfile::tempdir().unwrap();
        let mcp = dir.path().join("mcp");
        let none = Map::new();
        let files = write(
            &mcp,
            "n1",
            "http://127.0.0.1:1/mcp",
            "tok",
            &none,
            "Tu travailles dans dummyPlane.",
            false,
        )
        .unwrap();
        assert_eq!(files.config, mcp.join("n1.json"));
        assert_eq!(files.prompt, mcp.join("n1.md"));
        assert_eq!(
            std::fs::read_to_string(&files.prompt).unwrap(),
            "Tu travailles dans dummyPlane."
        );
        assert!(write(&mcp, "../evil", "u", "t", &none, "p", false).is_err());
        let english = write(&mcp, "../evil", "u", "t", &none, "p", false)
            .err()
            .unwrap();
        assert_eq!(english.to_string(), "invalid node id: ../evil");
        remove(&mcp, "n1");
        assert!(!files.config.exists() && !files.prompt.exists());
        write(&mcp, "a", "u", "t", &none, "p", false).unwrap();
        std::fs::write(mcp.join("keep.txt"), "x").unwrap();
        clear(&mcp);
        let left: Vec<_> = std::fs::read_dir(&mcp)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(left, vec![std::ffi::OsString::from("keep.txt")]);
    }
}
