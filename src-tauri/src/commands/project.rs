use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;
use tauri::State;

use crate::commands::agents::AgentState;
use crate::db::Db;
use crate::db::projects::{self, Project};
use crate::error::{AppError, AppResult};
use crate::pty::PtyManager;

/// A project as the home screen shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    #[serde(flatten)]
    pub project: Project,
    /// Its folder no longer exists (moved or deleted while the app was closed).
    pub missing: bool,
    /// Its live agents, counted as the interface's tab badges count them: Fleets and agent terminals whose
    /// process runs, never a plain shell nor a terminal whose agent exited (`left`).
    pub live_agents: usize,
}

/// `left`: the terminals whose agent exited back to their shell (`AgentState::left_nodes`).
pub fn project_views(
    db: &Db,
    pty: &PtyManager,
    left: &HashSet<String>,
) -> AppResult<Vec<ProjectView>> {
    project_views_with(db, pty, left, |path| path.is_dir())
}

/// `is_dir` runs after the database lock is released: an offline network
/// drive would otherwise hold every command up.
fn project_views_with(
    db: &Db,
    pty: &PtyManager,
    left: &HashSet<String>,
    is_dir: impl Fn(&Path) -> bool,
) -> AppResult<Vec<ProjectView>> {
    let live: HashSet<String> = pty.list().into_iter().collect();
    let counted = db.with(|conn| {
        projects::list(conn)?
            .into_iter()
            .map(|project| {
                let live_agents = projects::agent_node_ids(conn, &project.id)?
                    .iter()
                    .filter(|id| live.contains(*id) && !left.contains(*id))
                    .count();
                Ok((project, live_agents))
            })
            .collect::<AppResult<Vec<_>>>()
    })?;
    Ok(counted
        .into_iter()
        .map(|(project, live_agents)| ProjectView {
            missing: !is_dir(Path::new(&project.path)),
            project,
            live_agents,
        })
        .collect())
}

#[cfg(test)]
mod lock_tests {
    use std::sync::mpsc;
    use std::time::Duration;

    use super::*;

    #[test]
    fn folders_are_checked_without_holding_the_database() {
        let db = Db::open_in_memory().unwrap();
        db.with(|conn| projects::create(conn, "C:/somewhere"))
            .unwrap();
        let pty = PtyManager::default();
        let views = project_views_with(&db, &pty, &HashSet::new(), |_| {
            // Another command, meanwhile, must get the database.
            let (tx, rx) = mpsc::channel();
            std::thread::scope(|scope| {
                scope.spawn(|| {
                    let _ = db.with(|_| Ok(()));
                    let _ = tx.send(());
                });
                assert!(
                    rx.recv_timeout(Duration::from_secs(3)).is_ok(),
                    "the database stayed locked during the folder check"
                );
            });
            false
        })
        .unwrap();
        assert!(views[0].missing);
    }
}

fn existing_folder(path: &str) -> AppResult<()> {
    let path = path.trim();
    if Path::new(path).is_dir() {
        Ok(())
    } else {
        Err(AppError::NotFound(format!("folder not found: {path}")))
    }
}

#[tauri::command]
pub async fn list_projects(
    db: State<'_, Db>,
    pty: State<'_, PtyManager>,
    agents: State<'_, AgentState>,
) -> AppResult<Vec<ProjectView>> {
    project_views(&db, &pty, &agents.left_nodes())
}

#[tauri::command]
pub async fn create_project(db: State<'_, Db>, path: String) -> AppResult<ProjectView> {
    existing_folder(&path)?;
    let project = db.with(|conn| projects::create(conn, &path))?;
    Ok(ProjectView {
        project,
        missing: false,
        live_agents: 0,
    })
}

#[tauri::command]
pub async fn rename_project(db: State<'_, Db>, id: String, name: String) -> AppResult<()> {
    db.with(|conn| projects::rename(conn, &id, &name))
}

#[tauri::command]
pub async fn relocate_project(db: State<'_, Db>, id: String, path: String) -> AppResult<()> {
    existing_folder(&path)?;
    db.with(|conn| projects::relocate(conn, &id, &path))
}

#[tauri::command]
pub async fn open_project(db: State<'_, Db>, id: String) -> AppResult<()> {
    db.with(|conn| projects::touch(conn, &id))
}

#[tauri::command]
pub async fn delete_project(
    db: State<'_, Db>,
    pty: State<'_, PtyManager>,
    id: String,
) -> AppResult<Vec<String>> {
    delete_project_and_stop(&db, &pty, &id)
}

/// Deletes a project, then stops the terminals of all its workspaces, including
/// those the front never displayed. Returns the ids of the deleted workspaces.
pub fn delete_project_and_stop(db: &Db, pty: &PtyManager, id: &str) -> AppResult<Vec<String>> {
    let deleted = db.with(|conn| projects::delete(conn, id))?;
    for node_id in deleted.node_ids {
        pty.kill(&node_id);
    }
    Ok(deleted.workspace_ids)
}

#[cfg(all(test, windows))]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::commands::test_support::run_terminal;
    use crate::db::{nodes, workspaces};

    #[test]
    fn a_missing_folder_is_named_in_english() {
        let error = existing_folder(" Z:/not here ").unwrap_err();
        assert_eq!(error.to_string(), "folder not found: Z:/not here");
    }

    #[test]
    fn deleting_a_project_stops_the_terminals_of_all_its_workspaces() {
        let db = Db::open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let project = db
            .with(|conn| projects::create(conn, &dir.path().to_string_lossy()))
            .unwrap();
        let second = db
            .with(|conn| workspaces::create(conn, &project.id, "B", "canvas"))
            .unwrap();
        db.with(|conn| nodes::save(conn, "t", &second.id, nodes::NodeKind::Terminal, "{}"))
            .unwrap();
        let pty = PtyManager::default();
        let exited = run_terminal(&pty, "t");
        let deleted = delete_project_and_stop(&db, &pty, &project.id).unwrap();
        assert_eq!(deleted.len(), 2);
        exited
            .recv_timeout(Duration::from_secs(20))
            .expect("the terminals of a deleted project must stop");
    }

    #[test]
    fn counts_live_agents_and_missing_folders() {
        let db = Db::open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let project = db
            .with(|conn| projects::create(conn, &dir.path().to_string_lossy()))
            .unwrap();
        let first = db
            .with(|conn| workspaces::list(conn, &project.id))
            .unwrap()
            .remove(0);
        let terminal = nodes::NodeKind::Terminal;
        db.with(|conn| nodes::save(conn, "t", &first.id, terminal, r#"{"agent":"claude"}"#))
            .unwrap();
        db.with(|conn| nodes::save(conn, "console", &first.id, terminal, r#"{"agent":"shell"}"#))
            .unwrap();
        let pty = PtyManager::default();
        let _exited = run_terminal(&pty, "t");
        let _console = run_terminal(&pty, "console");
        let nobody_left = HashSet::new();
        // The console runs, but holds no agent: only Claude's terminal counts, as the tab badges count.
        let views = project_views(&db, &pty, &nobody_left).unwrap();
        assert_eq!((views[0].live_agents, views[0].missing), (1, false));
        // Its Claude exited back to the shell ("Agent exited"): no agent is there.
        let left = HashSet::from(["t".to_string()]);
        assert_eq!(project_views(&db, &pty, &left).unwrap()[0].live_agents, 0);
        pty.kill_all();
        drop(dir);
        let views = project_views(&db, &pty, &nobody_left).unwrap();
        assert!(views[0].missing);
    }
}
