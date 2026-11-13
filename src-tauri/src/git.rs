use std::path::Path;
use std::process::Command;

use serde::Serialize;

use crate::process::hide_window;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub changed: u32,
}

/// Reads `git status --porcelain=v1 -b`: the first line names the branch, every
/// other line is one changed path.
pub fn parse_status(output: &str) -> GitStatus {
    let mut lines = output.lines();
    let header = lines.next().unwrap_or("").trim_start_matches("## ");
    let branch = if let Some(rest) = header.strip_prefix("No commits yet on ") {
        rest
    } else if let Some(rest) = header.strip_prefix("Initial commit on ") {
        rest
    } else if header.starts_with("HEAD (no branch)") {
        "HEAD"
    } else {
        header
            .split("...")
            .next()
            .unwrap_or(header)
            .split(' ')
            .next()
            .unwrap_or("")
    };
    let changed = lines.filter(|line| !line.trim().is_empty()).count() as u32;
    GitStatus {
        branch: branch.to_string(),
        changed,
    }
}

/// None when `path` is not inside a git repository or git is not installed.
/// `--no-optional-locks`: agents commit in this repository, and a refresh of the
/// index would take `.git/index.lock` under them.
pub fn status(path: &Path) -> Option<GitStatus> {
    let output = hide_window(
        Command::new("git")
            .arg("--no-optional-locks")
            // Read every 5 s: never with a program the repository names (`review::NO_FSMONITOR`).
            .args(crate::review::NO_FSMONITOR)
            .arg("-C")
            .arg(path)
            .args(["status", "--porcelain=v1", "-b", "--untracked-files=normal"]),
    )
    .output()
    .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(parse_status(&String::from_utf8_lossy(&output.stdout)))
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    #[test]
    fn reads_the_branch_and_counts_changed_paths() {
        let status = parse_status("## main...origin/main [ahead 1]\n M src/a.ts\n?? b.txt\n");
        assert_eq!(
            status,
            GitStatus {
                branch: "main".into(),
                changed: 2
            }
        );
        assert_eq!(parse_status("## feat/x\n").branch, "feat/x");
        assert_eq!(parse_status("## No commits yet on main\n").branch, "main");
        assert_eq!(parse_status("## HEAD (no branch)\n").branch, "HEAD");
        assert_eq!(parse_status("").changed, 0);
    }

    #[test]
    fn is_none_outside_a_repository() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(status(dir.path()), None);
    }

    #[test]
    fn counts_the_changes_of_a_real_repository() {
        let dir = tempfile::tempdir().unwrap();
        let init = Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .arg("init")
            .output();
        if init.is_err() {
            return; // git is not installed on this machine
        }
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        let read = status(dir.path()).unwrap();
        assert_eq!(read.changed, 1);
        assert!(!read.branch.is_empty());
    }

    /// Agents commit in the same repository: a status read every 5 s must not take
    /// `.git/index.lock` to rewrite the index, or their `git commit` can fail.
    #[test]
    fn reading_the_status_never_rewrites_the_index() {
        let dir = tempfile::tempdir().unwrap();
        let git = |args: &[&str]| {
            Command::new("git")
                .arg("-C")
                .arg(dir.path())
                .args([
                    "-c",
                    "user.name=t",
                    "-c",
                    "user.email=t@t",
                    "-c",
                    "commit.gpgsign=false",
                ])
                .args(args)
                .output()
        };
        if git(&["init"]).is_err() {
            return; // git is not installed on this machine
        }
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        git(&["add", "a.txt"]).unwrap();
        git(&["commit", "-q", "-m", "init"]).unwrap();
        // Same content, newer timestamp: a plain `git status` refreshes and rewrites the index.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        let index = dir.path().join(".git").join("index");
        let before = std::fs::read(&index).unwrap();
        status(dir.path()).unwrap();
        assert_eq!(std::fs::read(&index).unwrap(), before);
    }

    /// A repository's own config can name a program git runs as it reads the status (`core.fsmonitor`): one
    /// unpacked from an archive, or written by an agent, would run it every 5 s as the branch chip reads it.
    #[test]
    fn reading_the_status_runs_no_program_the_repository_names() {
        let dir = tempfile::tempdir().unwrap();
        let git = |args: &[&str]| {
            Command::new("git")
                .arg("-C")
                .arg(dir.path())
                .args(args)
                .output()
        };
        if git(&["init", "-q"]).is_err() {
            return; // git is not installed on this machine
        }
        git(&["config", "core.fsmonitor", "echo ran > fsmonitor-ran"]).unwrap();
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        status(dir.path()).unwrap();
        assert!(
            !dir.path().join("fsmonitor-ran").exists(),
            "git ran the program the repository's core.fsmonitor names"
        );
    }
}
