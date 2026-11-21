use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::mission::{
    self, AgentBranch, Cleanup, HeldOpen, LandOutcome, Landing, Leftovers, LeftoversChosen,
    MergeReport, Probe, ProbeAgent, Worktree,
};
use crate::power::KeepAwake;
use crate::tickets::{self, ProjectChecks};

/// Git can take seconds on a large repository: off the async runtime.
async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|err| AppError::Io(std::io::Error::other(err.to_string())))?
        .map_err(|err| {
            // In the log a tester sends.
            log::warn!("mission: {err}");
            AppError::InvalidInput(err)
        })
}

/// The mission's branch and worktree.
#[tauri::command]
pub async fn mission_prepare(project: String, name: String) -> AppResult<Worktree> {
    blocking(move || mission::prepare(Path::new(&project), &name)).await
}

#[tauri::command]
pub async fn mission_add_agent(
    project: String,
    mission: String,
    agent: String,
) -> AppResult<Worktree> {
    blocking(move || mission::add_agent(Path::new(&project), &mission, &agent)).await
}

/// `mission` and `agent` are the worktrees' paths; `message`, the squash's commit message; `since`, the head the
/// agent's last merge took in.
#[tauri::command]
pub async fn mission_merge(
    mission: String,
    agent: String,
    branch: String,
    message: String,
    since: Option<String>,
) -> AppResult<MergeReport> {
    blocking(move || {
        mission::merge_agent(
            Path::new(&mission),
            Path::new(&agent),
            &branch,
            &message,
            since.as_deref(),
        )
    })
    .await
}

/// What landing the mission would bring onto the user's branch, read-only: what the user is asked (`land`).
#[tauri::command]
pub async fn mission_landing(
    project: String,
    worktree: String,
    base: Option<String>,
) -> AppResult<Landing> {
    blocking(move || mission::landing(Path::new(&project), Path::new(&worktree), base.as_deref()))
        .await
}

/// The user's Land click, and only theirs: no tool of an agent reaches it.
#[tauri::command]
pub async fn mission_land(
    project: String,
    worktree: String,
    target: String,
    tip: String,
) -> AppResult<LandOutcome> {
    blocking(move || mission::land(Path::new(&project), Path::new(&worktree), &target, &tip)).await
}

/// What a merge reads first of each agent (`mission::probe_agents`), all at once: `mission` is the mission's worktree.
#[tauri::command]
pub async fn mission_probe(
    mission: String,
    agents: Vec<ProbeAgent>,
) -> AppResult<Vec<Option<Probe>>> {
    blocking(move || mission::probe_agents(Path::new(&mission), &agents)).await
}

/// The project's `BACKLOG.md`.
#[tauri::command]
pub async fn mission_backlog(project: String) -> AppResult<String> {
    blocking(move || tickets::backlog(Path::new(&project))).await
}

/// The open issues with a label, as `gh` gives them.
#[tauri::command]
pub async fn mission_issues(project: String, label: String) -> AppResult<String> {
    blocking(move || tickets::github_issues(Path::new(&project), &label)).await
}

/// What the Overnight run dialog shows before the user leaves.
#[tauri::command]
pub async fn mission_checks(project: String) -> AppResult<ProjectChecks> {
    blocking(move || Ok(tickets::checks(Path::new(&project)))).await
}

/// Held while an overnight mission runs.
#[tauri::command]
pub fn set_keep_awake(awake: tauri::State<'_, KeepAwake>, on: bool) {
    awake.set(on);
}

/// An agent whose work is squashed into the mission's cleans up after itself: its worktree, then its branch while it
/// is still what the squash took in. What git refuses is kept, with why.
#[tauri::command]
pub async fn mission_remove_agent(
    project: String,
    mission: String,
    agent: AgentBranch,
) -> AppResult<Cleanup> {
    blocking(move || mission::remove_agent(Path::new(&project), &mission, &agent)).await
}

/// A launch that failed: what it created goes (final review H2).
#[tauri::command]
pub async fn mission_discard(project: String, trees: Vec<Worktree>) -> AppResult<Cleanup> {
    blocking(move || mission::discard(Path::new(&project), &trees)).await
}

/// « Nettoyer la mission »: never loses work (`mission::cleanup`). `base`, the user's branch the mission started from;
/// `open`, the terminals left open, whose worktrees stay.
#[tauri::command]
pub async fn mission_cleanup(
    project: String,
    mission: String,
    agents: Vec<AgentBranch>,
    base: Option<String>,
    open: Option<Vec<HeldOpen>>,
) -> AppResult<Cleanup> {
    blocking(move || {
        mission::cleanup(
            Path::new(&project),
            &mission,
            &agents,
            base.as_deref(),
            &open.unwrap_or_default(),
        )
    })
    .await
}

/// What "Clean up leftovers" would do in the project, read only (`mission::leftovers`): what the user is asked.
/// `live`, the slugs of the missions a Fleet still holds; `open`, every terminal's folder.
#[tauri::command]
pub async fn mission_leftovers(
    project: String,
    live: Vec<String>,
    open: Vec<HeldOpen>,
) -> AppResult<Leftovers> {
    blocking(move || mission::leftovers(Path::new(&project), &live, &open)).await
}

/// The user's "Clean up" click on the leftovers, and only theirs: no tool of an agent reaches it.
#[tauri::command]
pub async fn mission_clean_leftovers(
    project: String,
    live: Vec<String>,
    open: Vec<HeldOpen>,
    chosen: LeftoversChosen,
) -> AppResult<Cleanup> {
    blocking(move || mission::clean_leftovers(Path::new(&project), &live, &open, &chosen)).await
}
