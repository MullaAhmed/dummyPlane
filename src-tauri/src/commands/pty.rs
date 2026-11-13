use serde::Serialize;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::agents::{self as catalog, AgentInfo, claude_settings, transcripts};
use crate::commands::agents;
use crate::db::{Db, scrollback};
use crate::error::{AppError, AppResult};
use crate::pty::session::OutputSink;
use crate::pty::shell::{
    Agent, ClaudeMode, ShellKind, SpawnSpec, build_plan, fleet_tools, interrupt_sequence,
    pick_applied, which_locate,
};
use crate::pty::watch::{self, Change, Sighting, SystemProbe};
use crate::pty::{PtyManager, pty_size};
use crate::sync::lock;

/// Forwards PTY output to the webview as raw bytes (an `ArrayBuffer` in JS).
struct ChannelSink(Channel<Response>);

impl OutputSink for ChannelSink {
    fn send(&self, bytes: &[u8]) -> bool {
        self.0.send(Response::new(bytes.to_vec())).is_ok()
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExitEvent {
    node_id: String,
    exit_code: Option<u32>,
    /// The process that exited, as `pty_spawn` returned it: an event whose pid
    /// is not the terminal's current one comes from an older process.
    pid: Option<u32>,
}

/// How a terminal starts, for the log: a conversation of an agent, new or
/// resumed (Claude's `continue` too), or a plain process.
fn mode_label(spec: &SpawnSpec) -> &'static str {
    match spec.agent {
        Agent::Claude => match spec.claude.as_ref().map(|claude| claude.mode) {
            Some(ClaudeMode::New) => "new",
            Some(ClaudeMode::Resume) => "resume",
            Some(ClaudeMode::Continue) => "continue",
            None => "plain",
        },
        Agent::Codex => match spec.codex.as_ref() {
            Some(codex) if codex.session_id.is_some() => "resume",
            Some(_) => "new",
            None => "plain",
        },
        _ => "plain",
    }
}

/// An agent the user started by hand in a Shell terminal: the interface turns the terminal into that agent's.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProcessEvent {
    node_id: String,
    #[serde(flatten)]
    sighting: Sighting,
}

/// Looks, as long as the app runs, for the agents started by hand in the Shell terminals that run.
pub fn watch_shells(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(watch::SCAN_EVERY);
            // A scan that panics must not end the watch of every later one.
            let scan = std::panic::AssertUnwindSafe(|| scan_shells(&app));
            if std::panic::catch_unwind(scan).is_err() {
                log::error!("agents in shells: a scan panicked");
            }
        }
    });
}

/// One scan: nothing is listed while no Shell terminal runs.
fn scan_shells(app: &AppHandle) {
    let pty = app.state::<PtyManager>();
    let roots = pty.watched_roots();
    let procs = if roots.is_empty() {
        Vec::new()
    } else {
        watch::processes()
    };
    let changes = lock(&pty.watch).scan(&roots, &procs, &SystemProbe);
    for (node_id, change) in changes {
        match change {
            Change::Running(sighting) => {
                log::info!(
                    "terminal {node_id}: {:?} started by hand in its shell, process {}",
                    sighting.agent,
                    sighting.pid
                );
                pty.set_interrupt(&node_id, interrupt_sequence(sighting.agent));
                agents::agent_back(app, &node_id);
                let _ = app.emit("agent-process", AgentProcessEvent { node_id, sighting });
            }
            Change::Ended(pid) => {
                log::info!(
                    "terminal {node_id}: the agent started by hand in its shell ended, process {pid}"
                );
                pty.set_interrupt(&node_id, None);
                agents::agent_left(app, &node_id);
            }
        }
    }
}

/// The agents started by hand in their Shell terminals that still run: what a page that reloads missed.
#[tauri::command]
pub async fn agent_process_snapshot(
    pty: State<'_, PtyManager>,
) -> AppResult<Vec<AgentProcessEvent>> {
    Ok(lock(&pty.watch)
        .running()
        .into_iter()
        .map(|(node_id, sighting)| AgentProcessEvent { node_id, sighting })
        .collect())
}

/// The user made the terminal a Shell again while its agent runs: that process is not reported again.
#[tauri::command]
pub async fn agent_process_dismiss(pty: State<'_, PtyManager>, node_id: String) -> AppResult<()> {
    lock(&pty.watch).dismiss(&node_id);
    pty.set_interrupt(&node_id, None);
    Ok(())
}

/// A path or program name on one line: a control character in it must not
/// start a line of the log of its own.
fn one_line(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_control() { '?' } else { c })
        .collect()
}

/// The log line of a terminal that started: where (the folder), with which
/// shell (its program name, not its path), how (the agent and the launch mode),
/// and whether it picks up the output saved by an earlier run. It takes the
/// parts and not the plan: the command line, the environment and the prompt are
/// not for the log.
fn started_line(
    node_id: &str,
    spec: &SpawnSpec,
    shell: &std::path::Path,
    cwd: &std::path::Path,
    relaunch: bool,
) -> String {
    let shell = shell.file_name().unwrap_or(shell.as_os_str());
    format!(
        "terminal {node_id} started: {:?}, mode {}, shell {}, folder \"{}\", relaunch {}",
        spec.agent,
        mode_label(spec),
        one_line(&shell.to_string_lossy()),
        one_line(&cwd.to_string_lossy()),
        if relaunch { "yes" } else { "no" },
    )
}

/// Re-reads Windows' PATH so an agent installed meanwhile is found.
#[tauri::command]
pub async fn refresh_path() {
    crate::pty::env_path::refresh();
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    pty: State<'_, PtyManager>,
    node_id: String,
    spec: SpawnSpec,
    cols: u16,
    rows: u16,
    on_data: Channel<Response>,
) -> AppResult<Option<u32>> {
    // Refused before anything else: a second start must leave the live
    // session's MCP token and launch files alone (seen in the app, H3).
    // Claimed, not just checked: two starts racing would else both pass, and the
    // second one's token would replace the live session's (backlog B2).
    let _claim = pty.claim_start(&node_id)?;
    let mut spec = spec;
    // The profile's folder, else dummyPlane's environment: where
    // this terminal's Claude keeps its conversations and settings.
    let profile_dir = match spec.claude.as_ref().and_then(|c| c.config_dir.as_deref()) {
        Some(dir) => Some(crate::accounts::checked_dir(dir)?),
        None => None,
    };
    if let Some(claude) = spec.claude.as_mut() {
        let config = claude_settings::config_dir_for(profile_dir.as_deref());
        let cwd = std::path::Path::new(&spec.cwd);
        let mode =
            transcripts::launch_mode(claude.mode, &claude.session_id, cwd, config.as_deref());
        if mode != claude.mode {
            log::info!("terminal {node_id}: no saved conversation, a new one under the same id");
            claude.mode = mode;
        }
    }
    // A conversation Codex never saved (only its title was written) starts anew.
    if let Some(codex) = spec.codex.as_mut()
        && let Some(id) = codex.session_id.clone()
        && !crate::agents::codex_profile::codex_home()
            .is_some_and(|home| crate::agents::codex_profile::thread_saved_ever(&home, &id))
    {
        log::info!("terminal {node_id}: Codex saved no conversation {id}, a new one");
        codex.session_id = None;
    }
    let role = spec.role();
    let hooks = agents::hooks_for(
        &app,
        &node_id,
        spec.agent,
        spec.claude.as_ref(),
        spec.codex.as_ref(),
        std::path::Path::new(&spec.cwd),
        profile_dir.as_deref(),
    );
    if matches!(spec.agent, Agent::Claude | Agent::Codex)
        && role.reads_only()
        && let Err(cause) = fleet_tools(spec.agent, &hooks, agents::server_running(&app))
    {
        agents::ended(&app, &node_id);
        log::warn!("{role:?} {node_id} not started: {cause}");
        return Err(AppError::ToolsUnavailable(format!(
            "dummyPlane's tools are unavailable: {cause}."
        )));
    }
    if let Err(cause) = pick_applied(spec.agent, spec.extras().is_some(), &hooks) {
        agents::ended(&app, &node_id);
        log::warn!("sub-agent {node_id} not started: {cause}");
        return Err(AppError::ToolsUnavailable(format!(
            "the skills, MCP servers and plugins its spawner picked could not be set: {cause}."
        )));
    }
    let plan = match build_plan(&node_id, &spec, &which_locate, &hooks) {
        Ok(plan) => plan,
        Err(err) => {
            // The settings file written for this launch has no use any more.
            agents::ended(&app, &node_id);
            return Err(err);
        }
    };
    let exited_id = node_id.clone();
    let output_app = app.clone();
    let output_id = node_id.clone();
    let exit_app = app.clone();
    agents::started(&app, &node_id);
    // A relaunch keeps what the terminal's screen still shows: the buffer starts
    // from the saved output, so its first save does not replace it (backlog R1).
    let relaunch = match app
        .state::<Db>()
        .with(|conn| scrollback::load(conn, &node_id))
    {
        Ok(Some(history)) => {
            pty.seed_history(&node_id, history);
            true
        }
        Ok(None) => false,
        Err(err) => {
            log::warn!("saved output of {node_id} not read: {err}");
            false
        }
    };
    // Built before the plan moves into the session.
    let started = started_line(&node_id, &spec, &plan.program, &plan.cwd, relaunch);
    let spawned = pty.spawn(
        &node_id,
        plan,
        pty_size(cols, rows),
        Box::new(ChannelSink(on_data)),
        Box::new(move || agents::output(&output_app, &output_id)),
        move |info| {
            // A relaunch may already run under this id: its tracking, settings
            // and token are not this exit's to clear.
            if !exit_app.state::<PtyManager>().is_running(&exited_id) {
                agents::ended(&exit_app, &exited_id);
            }
            // Saved before the event so a restore right after the exit finds it.
            let saved = exit_app.state::<Db>().with(|conn| {
                scrollback::save_logged(conn, &exited_id, &info.scrollback.data, info.scrollback.at)
            });
            if let Err(err) = saved {
                log::error!("scrollback of {exited_id} not saved: {err}");
            }
            log::info!("terminal {exited_id} exited: {:?}", info.code);
            let _ = exit_app.emit(
                "pty-exit",
                PtyExitEvent {
                    node_id: exited_id,
                    exit_code: info.code,
                    pid: info.pid,
                },
            );
        },
    );
    match &spawned {
        Ok(_) => log::info!("{started}"),
        Err(err) => {
            log::warn!("terminal {node_id} not started: {err}");
            agents::ended(&app, &node_id);
        }
    }
    spawned
}

#[tauri::command]
pub async fn pty_attach(
    pty: State<'_, PtyManager>,
    node_id: String,
    on_data: Channel<Response>,
) -> AppResult<bool> {
    Ok(pty.attach(&node_id, Box::new(ChannelSink(on_data))))
}

#[tauri::command]
pub async fn pty_write(
    app: AppHandle,
    pty: State<'_, PtyManager>,
    node_id: String,
    data: String,
) -> AppResult<()> {
    pty.write(&node_id, data.as_bytes())?;
    agents::input(&app, &node_id, data.as_bytes());
    Ok(())
}

/// The command bar, the fleet and "Reprendre" type into terminals this
/// way, the paths of the images a message carries
/// first, each pasted alone. The Enter counts as the user's answer for the
/// agent's activity.
#[tauri::command]
pub async fn pty_send_text(
    app: AppHandle,
    node_id: String,
    text: String,
    images: Option<Vec<String>>,
) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let images = images.unwrap_or_default();
        app.state::<PtyManager>()
            .send_text(&node_id, &text, &images)?;
        agents::input(&app, &node_id, b"\r");
        Ok(())
    })
    .await
    .map_err(|err| AppError::Io(std::io::Error::other(err.to_string())))?
}

/// "Pause": false for a plain shell. The key counts as the user's
/// answer, so a hooked agent's activity follows its output again.
#[tauri::command]
pub async fn pty_interrupt(
    app: AppHandle,
    pty: State<'_, PtyManager>,
    node_id: String,
) -> AppResult<bool> {
    let sent = pty.interrupt(&node_id)?;
    if let Some(key) = sent {
        agents::input(&app, &node_id, key);
    }
    Ok(sent.is_some())
}

#[tauri::command]
pub async fn pty_resize(
    pty: State<'_, PtyManager>,
    node_id: String,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    pty.resize(&node_id, pty_size(cols, rows))
}

#[tauri::command]
pub async fn pty_kill(pty: State<'_, PtyManager>, node_id: String) -> AppResult<()> {
    pty.kill(&node_id);
    Ok(())
}

#[tauri::command]
pub async fn pty_list(pty: State<'_, PtyManager>) -> AppResult<Vec<String>> {
    Ok(pty.list())
}

/// The live scrollback when the terminal runs, otherwise the last copy saved in SQLite.
#[tauri::command]
pub async fn get_scrollback(
    pty: State<'_, PtyManager>,
    db: State<'_, Db>,
    node_id: String,
) -> AppResult<Response> {
    let data = match pty.scrollback(&node_id) {
        Some(live) => live,
        None => db
            .with(|conn| scrollback::load(conn, &node_id))?
            .unwrap_or_default(),
    };
    Ok(Response::new(data))
}

#[tauri::command]
pub async fn list_agents() -> AppResult<Vec<AgentInfo>> {
    Ok(catalog::list_agents(&which_locate))
}

#[tauri::command]
pub async fn npm_available() -> AppResult<bool> {
    Ok(catalog::npm_available(&which_locate))
}

#[tauri::command]
pub async fn list_ollama_models() -> AppResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(catalog::ollama_models)
        .await
        .map_err(|err| AppError::Io(std::io::Error::other(err.to_string())))?
}

#[tauri::command]
pub async fn list_shells() -> AppResult<Vec<ShellKind>> {
    Ok(catalog::list_shells(&which_locate))
}

/// Writes scrollbacks to SQLite: only the changed ones, or all of them at exit.
pub fn flush_scrollbacks(app: &AppHandle, all: bool) {
    let pty = app.state::<PtyManager>();
    let batch = if all {
        pty.all_scrollbacks()
    } else {
        pty.dirty_scrollbacks()
    };
    let db = app.state::<Db>();
    for (node_id, capture) in batch {
        let saved =
            db.with(|conn| scrollback::save_logged(conn, &node_id, &capture.data, capture.at));
        if let Err(err) = saved {
            log::error!("scrollback of {node_id} not saved: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::pty::shell::{ClaudeLaunch, CodexLaunch, Role};

    const NODE: &str = "71629153-7cb7-497e-8ec9-908f7a4c5e7a";

    #[test]
    fn an_agent_started_in_a_shell_reaches_the_interface_in_the_shape_it_reads() {
        // `AgentProcessEvent` in `src/ipc/pty.ts`: camelCase, the agent's id as the launch menu names it.
        let event = |agent, session_id: Option<&str>, cwd: Option<&str>| {
            serde_json::to_value(AgentProcessEvent {
                node_id: NODE.into(),
                sighting: Sighting {
                    agent,
                    pid: 4242,
                    session_id: session_id.map(str::to_string),
                    cwd: cwd.map(str::to_string),
                },
            })
            .unwrap()
        };
        assert_eq!(
            event(
                Agent::Cursor,
                Some("0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10"),
                Some("D:/work")
            ),
            serde_json::json!({
                "nodeId": NODE,
                "agent": "cursor",
                "pid": 4242,
                "sessionId": "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10",
                "cwd": "D:/work",
            })
        );
        // What is not known is not sent: the interface reads an absent key as "unknown".
        assert_eq!(
            event(Agent::Opencode, None, None),
            serde_json::json!({ "nodeId": NODE, "agent": "opencode", "pid": 4242 })
        );
        for (agent, id) in [
            (Agent::Claude, "claude"),
            (Agent::Codex, "codex"),
            (Agent::Gemini, "gemini"),
            (Agent::Qwen, "qwen"),
            (Agent::Aider, "aider"),
        ] {
            assert_eq!(event(agent, None, None)["agent"], id);
        }
    }

    fn spec(agent: Agent) -> SpawnSpec {
        SpawnSpec {
            cwd: "/work/app".into(),
            shell: ShellKind::Default,
            agent,
            command: String::new(),
            claude: None,
            codex: None,
            ollama: None,
        }
    }

    fn claude(mode: ClaudeMode) -> ClaudeLaunch {
        ClaudeLaunch {
            mode,
            session_id: "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10".into(),
            title: "a secret title".into(),
            role: Role::Agent,
            remote_control: None,
            model: None,
            effort: None,
            permission: None,
            linear: false,
            config_dir: None,
            extensions: None,
            extras: None,
        }
    }

    fn line(spec: &SpawnSpec, relaunch: bool) -> String {
        started_line(
            NODE,
            spec,
            Path::new("/usr/local/bin/pwsh"),
            Path::new("/work/my project"),
            relaunch,
        )
    }

    #[test]
    fn the_started_line_names_the_folder_the_shell_and_the_mode() {
        let mut resumed = spec(Agent::Claude);
        resumed.claude = Some(claude(ClaudeMode::Resume));
        assert_eq!(
            line(&resumed, true),
            format!(
                "terminal {NODE} started: Claude, mode resume, shell pwsh, \
                 folder \"/work/my project\", relaunch yes"
            )
        );
        assert_eq!(
            line(&spec(Agent::Shell), false),
            format!(
                "terminal {NODE} started: Shell, mode plain, shell pwsh, \
                 folder \"/work/my project\", relaunch no"
            )
        );
    }

    #[test]
    fn the_mode_follows_the_agent_launch() {
        let mut new = spec(Agent::Claude);
        new.claude = Some(claude(ClaudeMode::New));
        let mut resumed = spec(Agent::Claude);
        resumed.claude = Some(claude(ClaudeMode::Continue));
        let mut codex_new = spec(Agent::Codex);
        codex_new.codex = Some(CodexLaunch::default());
        let mut codex_resumed = spec(Agent::Codex);
        codex_resumed.codex = Some(CodexLaunch {
            session_id: Some("thread".into()),
            ..CodexLaunch::default()
        });
        assert_eq!(mode_label(&new), "new");
        assert_eq!(mode_label(&resumed), "continue");
        assert_eq!(mode_label(&codex_new), "new");
        assert_eq!(mode_label(&codex_resumed), "resume");
        // Without a launch, or for a plain program: no conversation.
        assert_eq!(mode_label(&spec(Agent::Claude)), "plain");
        assert_eq!(mode_label(&spec(Agent::Codex)), "plain");
        assert_eq!(mode_label(&spec(Agent::Custom)), "plain");
    }

    #[test]
    fn the_started_line_leaves_out_what_is_private() {
        let mut custom = spec(Agent::Custom);
        custom.command = "tool --token hunter2 --prompt 'do the thing'".into();
        let mut claude_spec = spec(Agent::Claude);
        claude_spec.claude = Some(claude(ClaudeMode::New));
        for spec in [&custom, &claude_spec] {
            let line = line(spec, false);
            for secret in ["hunter2", "--token", "do the thing", "a secret title"] {
                assert!(!line.contains(secret), "{secret} reached the log: {line}");
            }
            assert!(!line.contains("/usr/local/bin"), "the shell's path: {line}");
        }
    }

    #[test]
    fn a_control_character_in_the_folder_does_not_break_the_line() {
        let line = started_line(
            NODE,
            &spec(Agent::Shell),
            Path::new("pwsh"),
            Path::new("/work/a\nb\u{1b}[0m"),
            false,
        );
        assert!(!line.contains('\n') && !line.contains('\u{1b}'), "{line}");
        assert!(line.contains("folder \"/work/a?b?[0m\""), "{line}");
    }
}
