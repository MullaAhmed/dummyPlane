//! The settings file given to Claude with `--settings`: http hooks that report its state, and one that asks dummyPlane
//! before Claude starts a built-in sub-agent (the hook server decides), for an
//! agent, a fleet and a Manager alike.

use std::io;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use super::delete_guard::GUARDED_TOOLS;
use super::hooks_server::{ASKED_TOOLS, manager_hook_url, valid_node_id};
use crate::pty::shell::{Permission, Role};

const NOTIFICATIONS: &str =
    "permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input|idle_prompt";

/// What a fleet and a Manager are denied: they read the repository and run nothing in it.
const READ_ONLY_DENIED: [&str; 5] = ["Edit", "Write", "NotebookEdit", "Bash", "PowerShell"];

pub fn settings_json(url: &str, role: Role) -> Value {
    let hook = json!({ "type": "http", "url": url, "timeout": 2 });
    let every = json!([{ "hooks": [hook] }]);
    // dummyPlane's own tools never ask.
    let mut permissions = json!({ "allow": ["mcp__dummyplane"] });
    if role.reads_only() {
        // A fleet or a Manager does not code itself, nor run commands in the user's folder: neither
        // of the shells Claude has on Windows, Bash and PowerShell.
        permissions["deny"] = json!(READ_ONLY_DENIED);
    }
    // A Manager has no spawn_agent: its question says so, and is answered with the queue instead.
    let pre_tool = if role == Role::Manager {
        json!({ "type": "http", "url": manager_hook_url(url), "timeout": 2 })
    } else {
        hook.clone()
    };
    json!({
        "hooks": {
            "UserPromptSubmit": every,
            "PostToolUse": every,
            "Stop": every,
            "StopFailure": every,
            "SessionEnd": every,
            "SubagentStart": every,
            "SubagentStop": every,
            "Notification": [{ "matcher": NOTIFICATIONS, "hooks": [hook] }],
            // Always asked, decided at each call: the user's "Sub-agents open as
            // terminals" reaches the sessions already running. A fleet's go to
            // spawn_agent too, as regular agents in terminals of their own; a
            // Manager's team starts from the queue. The matcher names exactly the
            // tools the hook server may refuse: the Workflow tool among them, and the
            // Skill tool, for a skill that forks into a sub-agent of its own.
            "PreToolUse": [
                { "matcher": ASKED_TOOLS.join("|"), "hooks": [pre_tool] },
                // The commands of an agent, read for deletes (`delete_guard`): the folder it was
                // started in travels in the URL.
                { "matcher": GUARDED_TOOLS.join("|"), "hooks": [hook] },
            ],
        },
        "permissions": permissions,
    })
}

/// What needs a yes in Claude, for an agent nobody watches. Read-only tools ask nothing.
const WORK_TOOLS: [&str; 8] = [
    "Edit",
    "Write",
    "NotebookEdit",
    "Bash",
    "PowerShell",
    "WebFetch",
    "WebSearch",
    "Agent",
];

/// What reaches the remote without `git push`, then `git push` itself, for Bash and for
/// PowerShell alike (the same commands, the same rules: every Bash rule has its twin).
/// Text rules, not a sandbox: they read the command as written, and an agent that
/// runs commands can word it otherwise (see `NO_PUSH_ENV`, also passed in review).
const MISSION_DENIES: [&str; 14] = [
    "Bash(git push *)",
    "Bash(git push)",
    "Bash(gh pr create *)",
    "Bash(gh pr merge *)",
    "Bash(gh api *)",
    "Bash(gh issue comment *)",
    "Bash(gh release create *)",
    "PowerShell(git push *)",
    "PowerShell(git push)",
    "PowerShell(gh pr create *)",
    "PowerShell(gh pr merge *)",
    "PowerShell(gh api *)",
    "PowerShell(gh issue comment *)",
    "PowerShell(gh release create *)",
];

/// A mission's choice, in this session's settings only: the user's files stay as they are.
/// A fleet takes the push block only: at night it refuses what would ask (`--permission-mode dontAsk`), and a
/// manager is never opened the tools its deny list closes.
pub fn apply_permission(settings: &mut Value, permission: Option<Permission>, role: Role) {
    let Some(permission) = permission else {
        return;
    };
    let rules = &mut settings["permissions"];
    if permission == Permission::Work && role == Role::Agent {
        let allow = rules["allow"].as_array_mut();
        allow
            .into_iter()
            .for_each(|allow| allow.extend(WORK_TOOLS.map(Value::from)));
    }
    let mut deny: Vec<Value> = rules["deny"].as_array().cloned().unwrap_or_default();
    deny.extend(MISSION_DENIES.map(Value::from));
    rules["deny"] = Value::Array(deny);
}

/// Linear's read-only server (`mcp_files::LINEAR`) exposes read tools only: they never ask, so a night that
/// reads its tickets there does not stop on a prompt, and `dontAsk` does not refuse them.
pub fn allow_linear(settings: &mut Value) {
    if let Some(allow) = settings["permissions"]["allow"].as_array_mut() {
        allow.push(Value::from(format!("mcp__{}__*", super::mcp_files::LINEAR)));
    }
}

/// The status line dummyPlane gives Claude: the session's usage
/// posted to dummyPlane, then the user's own status line, shown as before.
#[derive(Debug, Clone, PartialEq)]
pub struct StatusLine {
    pub script: PathBuf,
    /// dummyPlane's URL, without the token.
    pub url: String,
    /// The curl config file that carries the token (`write_curl_config`).
    pub config: PathBuf,
    /// The bash that runs the script: Git Bash's own on Windows. A bare `bash`
    /// on the PATH is often WSL's launcher, which cannot read `C:/` paths.
    pub bash: PathBuf,
    /// The user's `statusLine` setting, when it runs a command.
    pub user: Option<Value>,
}

/// Run by Claude through bash, Git Bash on Windows: `$1` is dummyPlane's URL,
/// `$2` the curl config that carries the token, `$3` the user's own status
/// line command, given the same JSON.
pub const STATUS_SCRIPT: &str = "#!/usr/bin/env bash\n\
# dummyPlane: Claude's status line passes the session's usage on, then shows the user's own.\n\
input=$(cat; printf x); input=${input%x}\n\
printf '%s' \"$input\" | curl -s -m 1 -K \"$2\" -X POST -H 'Content-Type: application/json' --data-binary @- \"$1\" >/dev/null 2>&1 &\n\
if [ -n \"${3:-}\" ]; then printf '%s' \"$input\" | bash -c \"$3\"; fi\n";

/// The curl config that gives the local server's token to curl as a header
///: on a command line, any program of the
/// account could read it. Rewritten at each start, next to the settings
/// files that already hold the token.
pub fn write_curl_config(dir: &Path, token: &str) -> io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join("curl.cfg");
    std::fs::write(
        &path,
        format!(
            "header = \"{}: {token}\"\n",
            super::hooks_server::TOKEN_HEADER
        ),
    )?;
    Ok(path)
}

/// A word for bash: single quotes, a quote inside closed and reopened.
fn bash_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

pub fn status_line_json(status: &StatusLine) -> Value {
    // bash reads Windows paths with forward slashes.
    let script = status.script.to_string_lossy().replace('\\', "/");
    let config = status.config.to_string_lossy().replace('\\', "/");
    let bash = status.bash.to_string_lossy().replace('\\', "/");
    let mut command = format!(
        "{} {} {} {}",
        bash_quote(&bash),
        bash_quote(&script),
        bash_quote(&status.url),
        bash_quote(&config)
    );
    let user = status.user.as_ref();
    if let Some(own) = user.and_then(|u| u["command"].as_str()) {
        command.push(' ');
        command.push_str(&bash_quote(own));
    }
    let mut line = json!({ "type": "command", "command": command });
    for key in ["padding", "refreshInterval"] {
        if let Some(value) = user.and_then(|u| u.get(key)) {
            line[key] = value.clone();
        }
    }
    line
}

/// The `statusLine` of Claude's user settings when it runs a command.
pub fn user_status_line(settings: &Path) -> Option<Value> {
    let bytes = std::fs::read(settings).ok()?;
    // Notepad saves with a byte order mark.
    let bytes = bytes.strip_prefix("\u{feff}".as_bytes()).unwrap_or(&bytes);
    let read: Value = serde_json::from_slice(bytes).ok()?;
    let line = read.get("statusLine")?;
    let runs = line["type"] == "command"
        && line["command"]
            .as_str()
            .is_some_and(|c| !c.trim().is_empty());
    runs.then(|| line.clone())
}

/// The status line Claude would show in `cwd`: its local settings', its
/// project's, then the user's (`--settings` outranks them all).
pub fn status_line_for(cwd: &Path, user: Option<&Path>) -> Option<Value> {
    let project = cwd.join(".claude");
    [
        project.join("settings.local.json"),
        project.join("settings.json"),
    ]
    .iter()
    .find_map(|file| user_status_line(file))
    .or_else(|| user.and_then(user_status_line))
}

/// Claude's folder: `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
pub fn claude_config_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Some(PathBuf::from(dir));
    }
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".claude"))
}

/// The folder one terminal's Claude uses: its profile's, else dummyPlane's environment's.
pub fn config_dir_for(profile: Option<&Path>) -> Option<PathBuf> {
    profile.map(Path::to_path_buf).or_else(claude_config_dir)
}

/// Claude's user settings for a terminal: `settings.json` in its profile's folder, else the usual one.
pub fn settings_file_in(profile: Option<&Path>) -> Option<PathBuf> {
    Some(config_dir_for(profile)?.join("settings.json"))
}

/// `write_with` without a terminal's own choice.
#[cfg(test)]
pub fn write(
    dir: &Path,
    node_id: &str,
    url: &str,
    role: Role,
    status: Option<&StatusLine>,
    permission: Option<Permission>,
) -> io::Result<PathBuf> {
    let grants = Grants {
        permission,
        linear: false,
    };
    write_with(dir, node_id, url, role, status, grants, None, None)
}

/// What a session is given beyond its role: a mission's permission, and Linear's read tools for a
/// fleet whose night reads its tickets there.
#[derive(Debug, Clone, Copy, Default)]
pub struct Grants {
    pub permission: Option<Permission>,
    pub linear: bool,
}

/// `<dir>/<nodeId>.json`, rewritten at each launch (port and token change
/// with each run of the app), with the terminal's own choice of skills,
/// plugins, MCP servers and subagents (`extensions::settings_patch`) added
/// after dummyPlane's rules, and Claude's colour theme (`claude_theme`).
#[allow(clippy::too_many_arguments)]
pub fn write_with(
    dir: &Path,
    node_id: &str,
    url: &str,
    role: Role,
    status: Option<&StatusLine>,
    grants: Grants,
    extensions: Option<&Value>,
    theme: Option<&str>,
) -> io::Result<PathBuf> {
    if !valid_node_id(node_id) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid node id: {node_id}"),
        ));
    }
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!("{node_id}.json"));
    let mut settings = settings_json(url, role);
    apply_permission(&mut settings, grants.permission, role);
    if grants.linear {
        allow_linear(&mut settings);
    }
    if let Some(patch) = extensions {
        super::extensions::apply(&mut settings, patch);
    }
    if let Some(theme) = theme {
        settings["theme"] = json!(theme);
    }
    if let Some(status) = status {
        // Without its script, Claude goes without the status line, never without its hooks.
        match std::fs::write(&status.script, STATUS_SCRIPT) {
            Ok(()) => settings["statusLine"] = status_line_json(status),
            Err(err) => log::warn!("status line of {node_id} not written: {err}"),
        }
    }
    std::fs::write(&path, serde_json::to_vec_pretty(&settings)?)?;
    Ok(path)
}

pub fn remove(dir: &Path, node_id: &str) {
    if valid_node_id(node_id) {
        let _ = std::fs::remove_file(dir.join(format!("{node_id}.json")));
    }
}

/// Files left by a previous run point at a server that is gone.
pub fn clear(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // `curl.cfg` holds the previous run's token: gone with the server.
        let stale_token = path.file_name().is_some_and(|name| name == "curl.cfg");
        if stale_token || path.extension().is_some_and(|ext| ext == "json") {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "http://127.0.0.1:4242/hook/claude/n1?t=tok";

    #[test]
    fn reports_the_tracked_events_to_the_url() {
        let json = settings_json(URL, Role::Agent);
        let hooks = json["hooks"].as_object().unwrap();
        let mut events: Vec<_> = hooks.keys().map(String::as_str).collect();
        events.sort_unstable();
        assert_eq!(
            events,
            [
                "Notification",
                "PostToolUse",
                "PreToolUse",
                "SessionEnd",
                "Stop",
                "StopFailure",
                "SubagentStart",
                "SubagentStop",
                "UserPromptSubmit"
            ]
        );
        assert_eq!(
            json["hooks"]["Stop"][0]["hooks"][0],
            serde_json::json!({ "type": "http", "url": URL, "timeout": 2 })
        );
        assert_eq!(
            json["hooks"]["Notification"][0]["matcher"],
            "permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input|idle_prompt"
        );
    }

    #[test]
    fn an_agent_and_a_fleet_both_ask_dummyplane_before_starting_a_built_in_subagent() {
        let hook = json!({ "type": "http", "url": URL, "timeout": 2 });
        let agent = settings_json(URL, Role::Agent);
        assert_eq!(
            agent["hooks"]["PreToolUse"],
            json!([
                { "matcher": "Task|Agent|Workflow|Skill", "hooks": [hook] },
                { "matcher": "Bash|PowerShell", "hooks": [hook] },
            ])
        );
        // A fleet has spawn_agent too: its built-in sub-agents are asked about the same way,
        // and the hook server answers it as an agent (`hooks_server::pre_tool_use`); only a
        // Manager's question is tagged, for the wording.
        let manager = settings_json(URL, Role::Fleet);
        assert_eq!(manager["hooks"], agent["hooks"]);
        // Only its rails differ: it neither edits nor runs commands itself.
        assert_ne!(manager["permissions"], agent["permissions"]);
    }

    /// Regression: the matcher named Task and Agent only, so a Workflow's sub-agents
    /// ran unasked with "Sub-agents as terminals" on, drawn as read-only mirrors; then
    /// it missed the Skill tool, through which a skill that forks (/code-review) did the same.
    #[test]
    fn the_settings_file_asks_dummyplane_before_a_workflow_or_a_skill_too() {
        let dir = tempfile::tempdir().unwrap();
        for role in [Role::Agent, Role::Fleet, Role::Manager] {
            let path = write(dir.path(), "n1", URL, role, None, None).unwrap();
            let read: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            let matcher = read["hooks"]["PreToolUse"][0]["matcher"].as_str().unwrap();
            assert_eq!(
                matcher.split('|').collect::<Vec<_>>(),
                ["Task", "Agent", "Workflow", "Skill"],
                "{role:?}"
            );
        }
    }

    /// A second matcher, so the first one stays exactly the tools the hook server may refuse.
    #[test]
    fn the_settings_file_has_dummyplane_read_the_commands_of_every_role_for_deletes() {
        let dir = tempfile::tempdir().unwrap();
        for role in [Role::Agent, Role::Fleet, Role::Manager] {
            let path = write(dir.path(), "n1", URL, role, None, None).unwrap();
            let read: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            let entry = &read["hooks"]["PreToolUse"][1];
            assert_eq!(entry["matcher"], "Bash|PowerShell", "{role:?}");
            // Plain URL, not a Manager's tagged one: the guard needs no tag.
            assert_eq!(
                entry["hooks"],
                json!([{ "type": "http", "url": URL, "timeout": 2 }]),
                "{role:?}"
            );
        }
    }

    #[test]
    fn names_claude_s_colour_theme_only_when_given_one() {
        let dir = tempfile::tempdir().unwrap();
        let grants = Grants::default();
        let read = |path: PathBuf| -> Value {
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
        };
        let theme = Some("custom:dummyplane");
        let themed = write_with(
            dir.path(),
            "n1",
            URL,
            Role::Agent,
            None,
            grants,
            None,
            theme,
        );
        assert_eq!(read(themed.unwrap())["theme"], "custom:dummyplane");
        let plain = write_with(dir.path(), "n2", URL, Role::Agent, None, grants, None, None);
        assert!(read(plain.unwrap()).get("theme").is_none());
    }

    #[test]
    fn allows_dummyplane_s_tools_without_asking() {
        // The rule names the server, not its tools: show_output, output_guide and read_node need no rule of their own.
        assert_eq!(
            settings_json(URL, Role::Agent)["permissions"],
            serde_json::json!({ "allow": ["mcp__dummyplane"] })
        );
    }

    #[test]
    fn writes_rewrites_and_removes_a_terminal_s_file() {
        let dir = tempfile::tempdir().unwrap();
        let hooks = dir.path().join("hooks");
        let path = write(&hooks, "n1", URL, Role::Agent, None, None).unwrap();
        assert_eq!(path, hooks.join("n1.json"));
        let read: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(read, settings_json(URL, Role::Agent));
        write(
            &hooks,
            "n1",
            "http://127.0.0.1:1/other",
            Role::Agent,
            None,
            None,
        )
        .unwrap();
        assert!(
            std::fs::read_to_string(&path)
                .unwrap()
                .contains("127.0.0.1:1/other")
        );
        remove(&hooks, "n1");
        assert!(!path.exists());
    }

    #[test]
    fn refuses_a_node_id_that_would_leave_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert!(write(dir.path(), "../evil", URL, Role::Agent, None, None).is_err());
        assert!(!dir.path().join("../evil.json").exists());
        let english = { write(dir.path(), "../evil", URL, Role::Agent, None, None).unwrap_err() };
        assert_eq!(english.to_string(), "invalid node id: ../evil");
    }

    #[test]
    fn clears_the_files_of_the_previous_run() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a", URL, Role::Agent, None, None).unwrap();
        write(dir.path(), "b", URL, Role::Agent, None, None).unwrap();
        std::fs::write(dir.path().join("keep.txt"), "x").unwrap();
        clear(dir.path());
        let left: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(left, vec![std::ffi::OsString::from("keep.txt")]);
        clear(&dir.path().join("missing"));
    }

    const STATUS_URL: &str = "http://127.0.0.1:4242/status/n1";

    fn status(user: Option<serde_json::Value>) -> StatusLine {
        StatusLine {
            script: PathBuf::from(r"C:\data\hooks\statusline.sh"),
            url: STATUS_URL.into(),
            config: PathBuf::from(r"C:\data\Jean O'Brien\hooks\curl.cfg"),
            bash: PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"),
            user,
        }
    }

    #[test]
    fn its_status_line_tells_dummyplane_then_shows_the_user_s_own() {
        let config = "'C:/data/Jean O'\\''Brien/hooks/curl.cfg'";
        let bash = "'C:/Program Files/Git/bin/bash.exe'";
        assert_eq!(
            status_line_json(&status(None)),
            json!({ "type": "command", "command": format!("{bash} 'C:/data/hooks/statusline.sh' '{STATUS_URL}' {config}") })
        );
        let user = json!({ "type": "command", "command": "~/bin/it's.sh --x", "padding": 0, "refreshInterval": 5 });
        assert_eq!(
            status_line_json(&status(Some(user))),
            json!({
                "type": "command",
                "command": format!("{bash} 'C:/data/hooks/statusline.sh' '{STATUS_URL}' {config} '~/bin/it'\\''s.sh --x'"),
                "padding": 0,
                "refreshInterval": 5
            })
        );
    }

    /// Regression: on Windows a plain `bash` on the PATH resolves to WSL's launcher,
    /// which reads `C:/` paths as missing, so the script never ran and the meter stayed empty.
    #[test]
    fn the_status_line_names_git_bash_not_a_bash_found_on_the_path() {
        let command = status_line_json(&status(None))["command"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(!command.starts_with("bash "), "{command}");
        assert!(
            command.starts_with("'C:/Program Files/Git/bin/bash.exe' "),
            "{command}"
        );
    }

    #[test]
    fn the_token_travels_in_a_curl_config_file_not_on_a_command_line() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_curl_config(&dir.path().join("hooks"), "tok-1").unwrap();
        assert_eq!(path, dir.path().join("hooks").join("curl.cfg"));
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "header = \"X-dummyPlane-Token: tok-1\"\n"
        );
        let line = status_line_json(&status(None));
        assert!(!line["command"].as_str().unwrap().contains("t="));
    }

    #[test]
    fn a_terminal_reads_its_profile_s_folder_not_dummyplane_s_environment() {
        let profile = tempfile::tempdir().unwrap();
        assert_eq!(
            config_dir_for(Some(profile.path())),
            Some(profile.path().to_path_buf())
        );
        assert_eq!(
            settings_file_in(Some(profile.path())),
            Some(profile.path().join("settings.json"))
        );
        // Without a profile, it is the usual folder (the environment's, else ~/.claude).
        assert_eq!(config_dir_for(None), claude_config_dir());
    }

    #[test]
    fn reads_the_user_s_status_line_from_claude_s_settings() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        assert_eq!(user_status_line(&file), None);
        std::fs::write(
            &file,
            r#"{ "statusLine": { "type": "command", "command": "carbon.sh" }, "x": 1 }"#,
        )
        .unwrap();
        assert_eq!(
            user_status_line(&file),
            Some(json!({ "type": "command", "command": "carbon.sh" }))
        );
        std::fs::write(
            &file,
            r#"{ "statusLine": { "type": "static", "command": "x" } }"#,
        )
        .unwrap();
        assert_eq!(user_status_line(&file), None);
        std::fs::write(&file, "pas du json").unwrap();
        assert_eq!(user_status_line(&file), None);
    }

    #[test]
    fn takes_the_project_s_status_line_before_the_user_s_as_claude_does() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("proj");
        std::fs::create_dir_all(project.join(".claude")).unwrap();
        let user = dir.path().join("settings.json");
        let line = |command: &str| {
            format!(r#"{{ "statusLine": {{ "type": "command", "command": "{command}" }} }}"#)
        };
        std::fs::write(&user, line("user.sh")).unwrap();
        let read = || status_line_for(&project, Some(&user)).map(|v| v["command"].clone());
        assert_eq!(read(), Some(json!("user.sh")));
        std::fs::write(
            project.join(".claude").join("settings.json"),
            line("project.sh"),
        )
        .unwrap();
        assert_eq!(read(), Some(json!("project.sh")));
        std::fs::write(
            project.join(".claude").join("settings.local.json"),
            line("local.sh"),
        )
        .unwrap();
        assert_eq!(read(), Some(json!("local.sh")));
        assert_eq!(status_line_for(&dir.path().join("none"), None), None);
    }

    #[test]
    fn reads_a_settings_file_saved_with_a_byte_order_mark() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        std::fs::write(
            &file,
            "\u{feff}{ \"statusLine\": { \"type\": \"command\", \"command\": \"carbon.sh\" } }",
        )
        .unwrap();
        assert_eq!(
            user_status_line(&file),
            Some(json!({ "type": "command", "command": "carbon.sh" }))
        );
    }

    #[test]
    fn keeps_the_hooks_when_its_status_line_script_cannot_be_written() {
        let dir = tempfile::tempdir().unwrap();
        let line = StatusLine {
            script: dir.path().join("missing").join("statusline.sh"),
            url: STATUS_URL.into(),
            config: dir.path().join("curl.cfg"),
            bash: PathBuf::from("bash"),
            user: None,
        };
        let path = write(dir.path(), "n1", URL, Role::Agent, Some(&line), None).unwrap();
        let read: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert!(read.get("statusLine").is_none());
        assert_eq!(read["hooks"], settings_json(URL, Role::Agent)["hooks"]);
    }

    #[test]
    fn writes_the_status_line_and_its_script() {
        let dir = tempfile::tempdir().unwrap();
        let line = StatusLine {
            script: dir.path().join("statusline.sh"),
            url: STATUS_URL.into(),
            config: dir.path().join("curl.cfg"),
            bash: PathBuf::from("bash"),
            user: None,
        };
        let path = write(dir.path(), "n1", URL, Role::Agent, Some(&line), None).unwrap();
        let read: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(read["statusLine"], status_line_json(&line));
        let script = std::fs::read_to_string(dir.path().join("statusline.sh")).unwrap();
        assert!(
            script.contains("curl -s -m 1 -K \"$2\"")
                && script.contains("\"$1\"")
                && script.contains("bash -c \"$3\""),
            "{script}"
        );
        assert!(!script.contains('\r'), "bash needs LF line ends");
    }

    /// A bash that can run a script at a Windows path: `Command` alone finds
    /// System32's WSL launcher first, which cannot, and the test then proved nothing.
    fn real_bash() -> Option<std::path::PathBuf> {
        which::which_all("bash").ok()?.find(|path| {
            let path = path.to_string_lossy().to_lowercase();
            !path.contains("system32") && !path.contains("windowsapps")
        })
    }

    /// Found before the real curl: it keeps what it is sent and holds on until
    /// `release` exists, or the folder is gone: a failed test cleans up at once,
    /// and a curl left waiting would keep `cargo test`'s output open forever.
    const HELD_CURL: &str = "#!/bin/sh\n\
cat > sent.txt\n\
until [ -e release ] || [ ! -e statusline.sh ]; do sleep 0.05; done\n\
: > finished\n";

    /// Only a stall of the whole machine reaches this: a pass is never a matter of time.
    const STUCK: std::time::Duration = std::time::Duration::from_secs(120);

    #[test]
    fn the_status_script_keeps_the_trailing_newlines_and_does_not_wait_for_curl() {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let Some(bash) = real_bash() else {
            return; // no bash on this machine
        };
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("statusline.sh"), STATUS_SCRIPT).unwrap();
        let curl = dir.path().join("curl");
        std::fs::write(&curl, HELD_CURL).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&curl, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let input = b"{\"a\":1}\n\n";
        let mut child = Command::new(bash)
            .current_dir(dir.path())
            // This bash and its tools before any other: PATH may lead to System32's first.
            .args([
                "-c",
                "PATH=\"$PWD:${BASH%/*}:$PATH\" exec \"$BASH\" statusline.sh \"$@\"",
            ])
            .args(["bash", "http://127.0.0.1:1/status/n1", "none.cfg"])
            .arg("cat > out.txt")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(input).unwrap();

        // curl is let go after the script has ended, never before: a script
        // that waited for it would hold both forever.
        let (ended, end) = std::sync::mpsc::channel();
        std::thread::spawn(move || ended.send(child.wait()));
        let exit = end.recv_timeout(STUCK);
        let release = dir.path().join("release");
        std::fs::write(&release, b"").unwrap();
        assert!(exit.is_ok(), "the script waits for curl");

        let finished = dir.path().join("finished");
        let gave_up = std::time::Instant::now() + STUCK;
        while !finished.exists() {
            assert!(std::time::Instant::now() < gave_up, "curl never finished");
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(std::fs::read(dir.path().join("sent.txt")).unwrap(), input);
        assert_eq!(
            std::fs::read(dir.path().join("out.txt")).unwrap(),
            input,
            "the user's line must get the JSON as sent"
        );
    }

    #[test]
    fn clearing_removes_a_dead_token_s_curl_config_too() {
        let dir = tempfile::tempdir().unwrap();
        let config = write_curl_config(dir.path(), "old-token").unwrap();
        let script = dir.path().join("statusline.sh");
        std::fs::write(&script, "#!/bin/sh\n").unwrap();
        clear(dir.path());
        assert!(!config.exists(), "the dead token stayed on disk");
        assert!(script.exists(), "the script holds no token");
    }

    #[test]
    fn a_fleet_may_neither_edit_files_nor_run_commands() {
        let manager = settings_json(URL, Role::Fleet);
        assert_eq!(manager["permissions"]["allow"], json!(["mcp__dummyplane"]));
        // Neither shell: the PowerShell tool ran commands where only Bash was denied.
        assert_eq!(
            manager["permissions"]["deny"],
            json!(["Edit", "Write", "NotebookEdit", "Bash", "PowerShell"])
        );
        assert!(
            settings_json(URL, Role::Agent)["permissions"]
                .get("deny")
                .is_none()
        );
    }

    #[test]
    fn a_manager_has_the_fleet_s_rails_and_is_answered_for_its_queue() {
        let manager = settings_json(URL, Role::Manager);
        let fleet = settings_json(URL, Role::Fleet);
        assert_eq!(manager["permissions"], fleet["permissions"]);
        assert_eq!(
            manager["permissions"]["deny"],
            json!(["Edit", "Write", "NotebookEdit", "Bash", "PowerShell"])
        );
        // At night too, it is opened nothing its team gets, and pushes nothing.
        let mut night = manager.clone();
        apply_permission(&mut night, Some(Permission::Work), Role::Manager);
        assert_eq!(night["permissions"]["allow"], json!(["mcp__dummyplane"]));
        let deny = night["permissions"]["deny"].as_array().unwrap();
        for rule in ["Bash", "PowerShell", "Edit", "Bash(git push *)"] {
            assert!(deny.contains(&json!(rule)), "{rule}");
        }
        // Its hooks are everyone's, but for its sub-agent question, tagged so the refusal names its queue.
        let agent = settings_json(URL, Role::Agent);
        for (event, hooks) in manager["hooks"].as_object().unwrap() {
            if event != "PreToolUse" {
                assert_eq!(hooks, &agent["hooks"][event], "{event}");
            }
        }
        assert_eq!(
            manager["hooks"]["PreToolUse"],
            json!([
                {
                    "matcher": "Task|Agent|Workflow|Skill",
                    "hooks": [{ "type": "http", "url": format!("{URL}&role=manager"), "timeout": 2 }]
                },
                // The deletes are read for a Manager's team alike: its own tag only words a refusal.
                agent["hooks"]["PreToolUse"][1],
            ])
        );
    }

    #[test]
    fn a_mission_chooses_in_this_sessions_settings_only() {
        let work = |permission| {
            let mut settings = settings_json(URL, Role::Agent);
            apply_permission(&mut settings, permission, Role::Agent);
            settings["permissions"].clone()
        };
        assert_eq!(work(None), settings_json(URL, Role::Agent)["permissions"]);
        let full = work(Some(Permission::Work));
        let allow = full["allow"].as_array().unwrap();
        assert!(allow.contains(&json!("mcp__dummyplane")));
        assert!(allow.contains(&json!("Bash")));
        assert!(allow.contains(&json!("Edit")));
        // Asking and files alone open no command.
        for permission in [Permission::Ask, Permission::Edits] {
            assert!(
                !work(Some(permission))["allow"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("Bash"))
            );
        }
    }

    #[test]
    fn git_push_is_denied_whatever_the_mission_chose() {
        for permission in [Permission::Ask, Permission::Edits, Permission::Work] {
            let mut settings = settings_json(URL, Role::Agent);
            apply_permission(&mut settings, Some(permission), Role::Agent);
            let deny = settings["permissions"]["deny"].as_array().unwrap().clone();
            assert!(deny.contains(&json!("Bash(git push *)")), "{permission:?}");
            assert!(deny.contains(&json!("Bash(git push)")), "{permission:?}");
        }
    }

    #[test]
    fn a_mission_keeps_a_managers_own_refusals() {
        let mut settings = settings_json(URL, Role::Fleet);
        apply_permission(&mut settings, Some(Permission::Ask), Role::Fleet);
        let deny = settings["permissions"]["deny"].as_array().unwrap();
        assert!(deny.contains(&json!("Edit")));
        assert!(deny.contains(&json!("Bash(git push *)")));
    }

    #[test]
    fn a_fleet_at_night_is_opened_no_tool_its_team_may_get() {
        let mut settings = settings_json(URL, Role::Fleet);
        apply_permission(&mut settings, Some(Permission::Work), Role::Fleet);
        assert_eq!(settings["permissions"]["allow"], json!(["mcp__dummyplane"]));
        let deny = settings["permissions"]["deny"].as_array().unwrap();
        assert!(deny.contains(&json!("Bash")));
        assert!(deny.contains(&json!("Edit")));
    }

    #[test]
    fn linear_s_read_tools_never_ask_and_open_nothing_else() {
        let mut settings = settings_json(URL, Role::Fleet);
        allow_linear(&mut settings);
        assert_eq!(
            settings["permissions"]["allow"],
            json!(["mcp__dummyplane", "mcp__linear__*"])
        );
        assert!(
            settings["permissions"]["deny"]
                .as_array()
                .unwrap()
                .contains(&json!("Edit"))
        );
    }

    #[test]
    fn the_settings_file_denies_what_reaches_the_remote_through_gh() {
        for command in [
            "gh pr create",
            "gh pr merge",
            "gh api",
            "gh issue comment",
            "gh release create",
        ] {
            for permission in [Permission::Ask, Permission::Edits, Permission::Work] {
                let dir = tempfile::tempdir().unwrap();
                let path =
                    write(dir.path(), "n1", URL, Role::Agent, None, Some(permission)).unwrap();
                let read: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
                let deny = read["permissions"]["deny"].as_array().unwrap();
                assert!(
                    deny.contains(&json!(format!("Bash({command} *)"))),
                    "{command}"
                );
            }
        }
    }

    #[test]
    fn the_settings_file_carries_the_missions_choice() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(
            dir.path(),
            "n1",
            URL,
            Role::Agent,
            None,
            Some(Permission::Work),
        )
        .unwrap();
        let read: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert!(
            read["permissions"]["allow"]
                .as_array()
                .unwrap()
                .contains(&json!("Bash"))
        );
    }

    /// A Work agent's settings file, as `write` writes it.
    fn work_agent() -> Value {
        let dir = tempfile::tempdir().unwrap();
        let path = write(
            dir.path(),
            "n1",
            URL,
            Role::Agent,
            None,
            Some(Permission::Work),
        )
        .unwrap();
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    /// Regression: on Windows a Work agent's PowerShell calls prompted, though Bash was allowed.
    #[test]
    fn a_work_agent_may_run_powershell_as_it_runs_bash() {
        let read = work_agent();
        let allow = read["permissions"]["allow"].as_array().unwrap();
        assert!(allow.contains(&json!("Bash")));
        assert!(allow.contains(&json!("PowerShell")));
    }

    /// Every Bash rule has a PowerShell twin, so a future Bash rule without one fails here.
    #[test]
    fn every_bash_deny_rule_has_a_powershell_twin() {
        for permission in [Permission::Ask, Permission::Edits, Permission::Work] {
            let mut settings = settings_json(URL, Role::Agent);
            apply_permission(&mut settings, Some(permission), Role::Agent);
            let deny = settings["permissions"]["deny"].as_array().unwrap().clone();
            let bash_rules: Vec<&str> = deny
                .iter()
                .filter_map(Value::as_str)
                .filter(|rule| rule.starts_with("Bash("))
                .collect();
            assert!(!bash_rules.is_empty(), "{permission:?}");
            for rule in bash_rules {
                let twin = rule.replacen("Bash(", "PowerShell(", 1);
                assert!(
                    deny.contains(&json!(twin)),
                    "{permission:?}: no twin for {rule}"
                );
            }
        }
    }

    #[test]
    fn a_work_agent_is_refused_git_push_through_powershell_too() {
        let read = work_agent();
        let deny = read["permissions"]["deny"].as_array().unwrap();
        assert!(deny.contains(&json!("PowerShell(git push *)")));
        assert!(deny.contains(&json!("PowerShell(git push)")));
    }

    /// The delete guard reads the PowerShell calls of a Work agent as it reads its Bash calls.
    #[test]
    fn a_work_agent_s_delete_guard_reads_bash_and_powershell() {
        let read = work_agent();
        assert_eq!(read["hooks"]["PreToolUse"][1]["matcher"], "Bash|PowerShell");
    }
}
