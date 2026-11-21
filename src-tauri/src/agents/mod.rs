pub mod activity;
pub mod claude_settings;
pub mod claude_theme;
pub mod codex_profile;
pub mod delete_guard;
pub mod extensions;
pub mod extras;
pub mod forked_skills;
pub mod hooks_server;
pub mod mcp;
pub mod mcp_files;
pub mod prompts;
pub mod subagent_transcript;
pub mod subagents;
pub mod transcripts;

use std::process::Command;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::process::hide_window;
use crate::pty::shell::{Agent, Locate, ShellKind, binary, find_git_bash};

/// Availability of an agent; labels, logos and tints live in the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: Agent,
    pub available: bool,
}

/// Menu order of the catalog.
pub(crate) const CATALOG: [Agent; 10] = [
    Agent::Claude,
    Agent::Codex,
    Agent::Gemini,
    Agent::Qwen,
    Agent::Cursor,
    Agent::Opencode,
    Agent::Aider,
    Agent::Ollama,
    Agent::Shell,
    Agent::Custom,
];

pub fn list_agents(locate: Locate) -> Vec<AgentInfo> {
    CATALOG
        .iter()
        .map(|&id| AgentInfo {
            id,
            available: matches!(id, Agent::Shell | Agent::Custom) || locate(binary(id)).is_some(),
        })
        .collect()
}

/// Whether the npm of an agent's install can run.
pub fn npm_available(locate: Locate) -> bool {
    locate("npm").is_some()
}

/// Shells that can actually be started on this machine, default first.
/// `wsl_distro`: whether WSL has a distribution to open (`shell::wsl_distro_installed`).
pub fn list_shells(locate: Locate, wsl_distro: &dyn Fn() -> bool) -> Vec<ShellKind> {
    let mut shells = if cfg!(windows) {
        vec![ShellKind::PowerShell, ShellKind::Cmd]
    } else {
        vec![ShellKind::Default]
    };
    if locate("pwsh").is_some() {
        shells.push(ShellKind::Pwsh);
    }
    if cfg!(windows) && locate("git").and_then(|git| find_git_bash(&git)).is_some() {
        shells.push(ShellKind::GitBash);
    }
    if cfg!(windows) && locate("wsl").is_some() && wsl_distro() {
        shells.push(ShellKind::Wsl);
    }
    shells
}

/// Model names of `ollama list`: the first column, header line skipped.
pub fn parse_ollama_list(output: &str) -> Vec<String> {
    output
        .lines()
        .skip(1)
        .filter_map(|line| line.split_whitespace().next())
        .map(str::to_string)
        .collect()
}

/// The models installed in Ollama.
pub fn ollama_models() -> AppResult<Vec<String>> {
    let output = hide_window(Command::new("ollama").arg("list"))
        .output()
        .map_err(|err| AppError::NotFound(format!("ollama not found: {err}")))?;
    if !output.status.success() {
        return Err(AppError::Io(std::io::Error::other(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        )));
    }
    Ok(parse_ollama_list(&String::from_utf8_lossy(&output.stdout)))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn marks_agents_available_only_when_found_on_path() {
        let locate = |name: &str| {
            matches!(name, "claude" | "cursor-agent")
                .then(|| PathBuf::from(format!("C:/bin/{name}.cmd")))
        };
        let available: Vec<_> = list_agents(&locate)
            .into_iter()
            .filter(|a| a.available)
            .map(|a| a.id)
            .collect();
        assert_eq!(
            available,
            vec![Agent::Claude, Agent::Cursor, Agent::Shell, Agent::Custom]
        );
    }

    #[test]
    fn finds_npm_on_the_path() {
        assert!(npm_available(&|name: &str| {
            (name == "npm").then(|| PathBuf::from("C:/node/npm.cmd"))
        }));
        assert!(!npm_available(&|_| None));
    }

    #[test]
    fn lists_the_whole_catalog_in_menu_order() {
        let agents = list_agents(&|_| None);
        assert_eq!(agents.len(), 10);
        assert_eq!(agents[0].id, Agent::Claude);
        assert_eq!(agents[9].id, Agent::Custom);
    }

    #[test]
    fn serializes_agent_ids_in_lowercase() {
        let json = serde_json::to_value(AgentInfo {
            id: Agent::Opencode,
            available: true,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "id": "opencode", "available": true })
        );
    }

    #[test]
    fn reads_model_names_from_ollama_list() {
        let output = "NAME                ID              SIZE      MODIFIED\n\
                      qwen2.5-coder:7b    2b0496514337    4.7 GB    2 days ago\n\
                      llama3:latest       365c0bd3c000    4.7 GB    3 weeks ago\n\n";
        assert_eq!(
            parse_ollama_list(output),
            vec!["qwen2.5-coder:7b", "llama3:latest"]
        );
        assert!(parse_ollama_list("NAME ID SIZE MODIFIED\n").is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn lists_builtin_windows_shells_and_optional_pwsh() {
        assert_eq!(
            list_shells(&|_| None, &|| false),
            vec![ShellKind::PowerShell, ShellKind::Cmd]
        );
        let with_pwsh = list_shells(
            &|name: &str| (name == "pwsh").then(|| PathBuf::from("C:/pwsh.exe")),
            &|| false,
        );
        assert_eq!(
            with_pwsh,
            vec![ShellKind::PowerShell, ShellKind::Cmd, ShellKind::Pwsh]
        );
    }

    /// `wsl.exe` ships with Windows: WSL is offered only when a distribution is there to open.
    #[cfg(windows)]
    #[test]
    fn lists_wsl_only_with_a_distribution() {
        let wsl =
            |name: &str| (name == "wsl").then(|| PathBuf::from("C:/Windows/System32/wsl.exe"));
        assert_eq!(
            list_shells(&wsl, &|| false),
            vec![ShellKind::PowerShell, ShellKind::Cmd]
        );
        assert_eq!(
            list_shells(&wsl, &|| true),
            vec![ShellKind::PowerShell, ShellKind::Cmd, ShellKind::Wsl]
        );
        assert_eq!(
            list_shells(&|_| None, &|| true),
            vec![ShellKind::PowerShell, ShellKind::Cmd]
        );
    }
}
