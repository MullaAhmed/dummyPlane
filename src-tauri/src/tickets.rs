//! Where an overnight mission takes its tasks. The
//! fleet may not run commands: dummyPlane reads the source for it.

use std::path::Path;
use std::process::Command;
use std::time::Duration;

use serde::Serialize;

use crate::github;
use crate::process::hide_window;
use crate::pty::shell::which_locate;

/// A backlog is a text file; past this it is not one to read whole.
const MAX_BACKLOG: u64 = 4 * 1024 * 1024;
const MAX_ISSUES: &str = "100";

/// `BACKLOG.md` at the project's root, without the byte order mark a Windows
/// editor may put first: its first line would start with neither `- ` nor `#`.
/// Its real path, never one a link leads to outside the project: what it says
/// goes to the fleet's model.
pub fn backlog(project: &Path) -> Result<String, String> {
    let path = crate::studio::resolve(project, "BACKLOG.md").map_err(|err| {
        if err.starts_with("path refused") {
            "BACKLOG.md leads outside the project: it was not read".to_string()
        } else {
            err
        }
    })?;
    let size = std::fs::metadata(&path)
        .map_err(|_| "no BACKLOG.md in this project".to_string())?
        .len();
    if size > MAX_BACKLOG {
        return Err("BACKLOG.md is too large".to_string());
    }
    let text = std::fs::read_to_string(&path).map_err(|err| err.to_string())?;
    Ok(match text.strip_prefix('\u{feff}') {
        Some(rest) => rest.to_string(),
        None => text,
    })
}

/// Only labelled issues: the repository may be public, and anybody's text
/// would guide agents nobody watches. Labelling takes rights on the repository.
/// Those of `repo`, named: in a fork, `gh` left to choose may read `upstream`'s.
fn issue_args(repo: &str, label: &str) -> Vec<String> {
    [
        "issue",
        "list",
        "--state",
        "open",
        "--limit",
        MAX_ISSUES,
        "--json",
        "number,title,body,url",
        "--repo",
        repo,
    ]
    .iter()
    .map(|arg| arg.to_string())
    .chain([format!("--label={label}")])
    .collect()
}

/// The open issues with `label` of the project's `origin`, as `gh` gives them in JSON:
/// the repository and the `gh` call are the Kanban's (`crate::github`).
pub fn github_issues(project: &Path, label: &str) -> Result<String, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("a label is needed".to_string());
    }
    let repo = github::detect_repo(project)
        .ok_or_else(|| "this project's origin is not a GitHub repository".to_string())?;
    let args = issue_args(&repo, label);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    github::gh(project, &args).map_err(|err| err.to_string())
}

/// What a night needs of the project before it starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ProjectChecks {
    pub git: bool,
    /// `gh` answers and is logged in.
    pub gh: bool,
}

fn succeeds(command: &mut Command) -> bool {
    hide_window(command)
        .output()
        .is_ok_and(|output| output.status.success())
}

pub fn checks(project: &Path) -> ProjectChecks {
    let git = crate::git::command(project, crate::git::Asked::Unasked)
        .is_ok_and(|mut command| succeeds(command.args(["rev-parse", "--is-inside-work-tree"])));
    let gh = which_locate("gh").is_some_and(|gh| logged_in(&gh, project, github::GH_TIMEOUT));
    ProjectChecks { git, gh }
}

/// `gh auth status` through the Kanban's `gh` call (`github::run`): its PATH, no prompt, and
/// stopped past `limit`, so a network that never answers does not hold the night's checks.
fn logged_in(program: &Path, project: &Path, limit: Duration) -> bool {
    github::run(program, project, &["auth", "status"], limit).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What an overnight run reads of the project goes to the fleet's model: a `BACKLOG.md` the repository made a
    /// link to a file outside it (`~/.aws/credentials`; git stores links) is refused, never read. A file link needs
    /// rights Windows gives only to an administrator or in Developer Mode: without them this test has nothing to try.
    #[test]
    fn never_reads_a_backlog_that_links_out_of_the_project() {
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("credentials");
        std::fs::write(&secret, "- aws_secret_access_key = hunter2\n").unwrap();
        let project = tempfile::tempdir().unwrap();
        let link = project.path().join("BACKLOG.md");
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&secret, &link).is_ok();
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(&secret, &link).is_ok();
        if !linked {
            return;
        }
        let read = backlog(project.path());
        assert!(
            read.as_ref()
                .is_err_and(|err| err.contains("outside the project")),
            "{read:?}"
        );
    }

    /// The same refusal, for a `BACKLOG.md` this machine can make lead out without rights: a junction.
    #[cfg(windows)]
    #[test]
    fn refuses_a_backlog_that_leads_out_of_the_project() {
        let outside = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let done = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(project.path().join("BACKLOG.md"))
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(done.status.success(), "{done:?}");
        let read = backlog(project.path());
        assert!(
            read.as_ref()
                .is_err_and(|err| err.contains("outside the project")),
            "{read:?}"
        );
    }

    #[test]
    fn reads_the_backlog_at_the_projects_root() {
        let dir = tempfile::tempdir().unwrap();
        assert!(backlog(dir.path()).is_err());
        std::fs::write(dir.path().join("BACKLOG.md"), "- Un\n").unwrap();
        assert_eq!(backlog(dir.path()).unwrap(), "- Un\n");
    }

    #[test]
    fn reads_a_backlog_saved_with_a_byte_order_mark() {
        // As Notepad, Visual Studio or PowerShell's `Set-Content -Encoding utf8` save it on Windows.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("BACKLOG.md"), "\u{feff}- Un\n- Deux\n").unwrap();
        assert_eq!(backlog(dir.path()).unwrap(), "- Un\n- Deux\n");
    }

    #[test]
    fn asks_gh_for_open_issues_with_the_label_only() {
        let args = issue_args("acme/widget", "overnight");
        assert_eq!(args[..4], ["issue", "list", "--state", "open"]);
        assert!(args.contains(&"--label=overnight".to_string()));
    }

    #[test]
    fn asks_gh_for_the_issues_of_the_projects_origin_in_a_fork() {
        // A fork has an `upstream` too: `gh` left to choose may read its issues.
        let dir = tempfile::tempdir().unwrap();
        let git = |args: &[&str]| {
            assert!(succeeds(
                Command::new("git").arg("-C").arg(dir.path()).args(args)
            ))
        };
        git(&["init"]);
        git(&[
            "remote",
            "add",
            "upstream",
            "https://github.com/up/stream.git",
        ]);
        git(&["remote", "add", "origin", "git@github.com:acme/widget.git"]);
        let repo = crate::github::detect_repo(dir.path()).unwrap();
        let args = issue_args(&repo, "overnight");
        let at = args.iter().position(|arg| arg == "--repo").expect("--repo");
        assert_eq!(args[at + 1], "acme/widget");
    }

    #[test]
    fn a_label_stays_one_argument() {
        // Glued to its flag: a label starting with a dash cannot become an option of gh.
        assert!(issue_args("x/y", "--repo=x/y").contains(&"--label=--repo=x/y".to_string()));
    }

    #[test]
    fn says_whether_the_folder_is_a_repository() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!checks(dir.path()).git);
        assert!(succeeds(
            Command::new("git").arg("-C").arg(dir.path()).arg("init")
        ));
        assert!(checks(dir.path()).git);
    }

    #[test]
    fn a_gh_that_does_not_answer_is_not_ready_and_does_not_hold_the_check() {
        // A stand-in for a `gh auth status` waiting on a network that never answers: 30 s.
        let dir = tempfile::tempdir().unwrap();
        let program = if cfg!(windows) {
            let script = dir.path().join("gh.cmd");
            std::fs::write(&script, "@ping -n 30 127.0.0.1 >nul\r\n").unwrap();
            script
        } else {
            let script = dir.path().join("gh");
            std::fs::write(&script, "#!/bin/sh\nsleep 30\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            script
        };
        let started = std::time::Instant::now();
        assert!(!logged_in(&program, dir.path(), Duration::from_millis(500)));
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn refuses_no_label() {
        let dir = tempfile::tempdir().unwrap();
        assert!(github_issues(dir.path(), "  ").is_err());
    }
}
