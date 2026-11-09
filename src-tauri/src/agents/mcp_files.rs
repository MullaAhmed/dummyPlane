//! The files that give a Claude session OpenVibe's tools (spec orchestrateur
//! §4.2): `--mcp-config <nodeId>.json` and `--append-system-prompt-file <nodeId>.md`.

use std::io;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use super::hooks_server::valid_node_id;

pub struct McpFiles {
    pub config: PathBuf,
    pub prompt: PathBuf,
}

pub fn config_json(url: &str, token: &str) -> Value {
    json!({ "mcpServers": { "openvibe": {
        "type": "http",
        "url": url,
        "headers": { "Authorization": format!("Bearer {token}") }
    } } })
}

/// Rewritten at each launch: the port and the token change.
pub fn write(
    dir: &Path,
    node_id: &str,
    url: &str,
    token: &str,
    prompt: &str,
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
    std::fs::write(
        &files.config,
        serde_json::to_vec_pretty(&config_json(url, token))?,
    )?;
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
    fn points_claude_at_openvibe_with_the_node_s_token() {
        assert_eq!(
            config_json("http://127.0.0.1:4242/mcp", "tok"),
            serde_json::json!({ "mcpServers": { "openvibe": {
                "type": "http",
                "url": "http://127.0.0.1:4242/mcp",
                "headers": { "Authorization": "Bearer tok" }
            } } })
        );
    }

    #[test]
    fn writes_removes_and_clears_a_session_s_files() {
        let dir = tempfile::tempdir().unwrap();
        let mcp = dir.path().join("mcp");
        let files = write(
            &mcp,
            "n1",
            "http://127.0.0.1:1/mcp",
            "tok",
            "Tu travailles dans OpenVibe.",
        )
        .unwrap();
        assert_eq!(files.config, mcp.join("n1.json"));
        assert_eq!(files.prompt, mcp.join("n1.md"));
        assert_eq!(
            std::fs::read_to_string(&files.prompt).unwrap(),
            "Tu travailles dans OpenVibe."
        );
        assert!(write(&mcp, "../evil", "u", "t", "p").is_err());
        let english =
            write(&mcp, "../evil", "u", "t", "p").err().unwrap();
        assert_eq!(english.to_string(), "invalid node id: ../evil");
        remove(&mcp, "n1");
        assert!(!files.config.exists() && !files.prompt.exists());
        write(&mcp, "a", "u", "t", "p").unwrap();
        std::fs::write(mcp.join("keep.txt"), "x").unwrap();
        clear(&mcp);
        let left: Vec<_> = std::fs::read_dir(&mcp)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(left, vec![std::ffi::OsString::from("keep.txt")]);
    }
}
