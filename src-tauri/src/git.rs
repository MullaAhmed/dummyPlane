use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::process::{hide_window, output_within};
use crate::sync::lock;

/// A repository's own config may name a program for git to run whenever it reads the index (`core.fsmonitor`).
const NO_FSMONITOR: [&str; 2] = ["-c", "core.fsmonitor=false"];

/// The keys of a config whose values git runs, or that point to what it runs: a filter's commands (and whether it
/// must run), a merge driver's, and the folder of the hooks. Read with the includes, which name more files to watch.
const DRIVERS: &str = r"^(filter\..+\.(clean|smudge|process|required)|merge\..+\.driver|core\.hookspath|include\.path|includeif\..+\.path)$";

/// How long reading a repository's config may take: past it, dummyPlane runs none of its git.
const CONFIG_READ_LIMIT: Duration = Duration::from_secs(10);

/// What `local_drivers` read of a repository, kept until one of the files it came from changes.
struct Drivers {
    /// The repository's config files (its own, its worktree's, those they include), with their time of change.
    watched: Vec<(PathBuf, Option<SystemTime>)>,
    /// Each driver the repository's own config defines, and the value dummyPlane's git takes instead.
    overrides: Vec<(String, String)>,
}

static DRIVERS_READ: LazyLock<Mutex<HashMap<PathBuf, Drivers>>> = LazyLock::new(Default::default);

/// A git command for the repository at `dir`, as dummyPlane runs all of its own: its window hidden, and nothing
/// the repository's own config (`.git/config`, the files it includes, its worktree's config) names for git to run.
/// Such a repository may come from an archive, or an agent may have written to it, and dummyPlane reads it unasked
/// (the branch chip every 5 s, the review panel, the Code Studio, the git window, a mission's merge). Its filters
/// (`clean`, `smudge`, `process`), merge drivers and hooks folder are switched off, or given back the user's own
/// (global or system) values when theirs replaced those; `core.fsmonitor` is off whoever set it. Its diff drivers
/// run only for a diff's text, which `review::file_diff` asks for without them. Agents' own git, in their
/// terminals, is theirs. An error when the repository's config could not be read: then nothing runs.
pub(crate) fn command(dir: &Path) -> Result<Command, String> {
    command_with(dir, &[])
}

/// `command`, with `env` given to its git and to the read of its config (a test's own global config).
fn command_with(dir: &Path, env: &[(&str, &OsStr)]) -> Result<Command, String> {
    let overrides = local_drivers(dir, env)?;
    let mut command = Command::new("git");
    hide_window(&mut command);
    command
        .envs(env.iter().copied())
        .args(NO_FSMONITOR)
        .arg("-C")
        .arg(dir);
    // As `-c` would, but a driver's name may hold a `=`, which `-c` would read as the end of the key. After those
    // the environment already gives.
    let base = std::env::var("GIT_CONFIG_COUNT")
        .ok()
        .and_then(|count| count.parse::<usize>().ok())
        .unwrap_or(0);
    for (i, (key, value)) in overrides.iter().enumerate() {
        command
            .env(format!("GIT_CONFIG_KEY_{}", base + i), key)
            .env(format!("GIT_CONFIG_VALUE_{}", base + i), value);
    }
    if !overrides.is_empty() {
        command.env("GIT_CONFIG_COUNT", (base + overrides.len()).to_string());
    }
    Ok(command)
}

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
}

/// The overrides of the repository at `dir` (`Drivers`), read again only when one of its config files changed.
fn local_drivers(dir: &Path, env: &[(&str, &OsStr)]) -> Result<Vec<(String, String)>, String> {
    if let Some(read) = lock(&DRIVERS_READ).get(dir)
        && read.watched.iter().all(|(path, at)| modified(path) == *at)
    {
        return Ok(read.overrides.clone());
    }
    let read = read_drivers(dir, env)?;
    let overrides = read.overrides.clone();
    // A folder that is no repository yet is read again next time: it may become one.
    if !read.watched.is_empty() {
        lock(&DRIVERS_READ).insert(dir.to_path_buf(), read);
    }
    Ok(overrides)
}

/// Runs a git that reads, never one that runs a driver: `rev-parse` and `config`, bounded in time.
fn read_git(
    dir: &Path,
    env: &[(&str, &OsStr)],
    args: &[&str],
) -> Result<std::process::Output, String> {
    let mut command = Command::new("git");
    hide_window(&mut command);
    command
        .envs(env.iter().copied())
        .arg("-C")
        .arg(dir)
        .args(args);
    output_within(&mut command, CONFIG_READ_LIMIT).map_err(|err| {
        format!("the repository's git config was not read, so its git was not run: {err}")
    })
}

fn read_drivers(dir: &Path, env: &[(&str, &OsStr)]) -> Result<Drivers, String> {
    let located = read_git(
        dir,
        env,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--show-toplevel",
            "--git-path",
            "config",
            "--git-path",
            "config.worktree",
        ],
    )?;
    let located = String::from_utf8_lossy(&located.stdout).into_owned();
    let mut lines = located.lines().map(PathBuf::from);
    let (Some(top), Some(config), Some(worktree)) = (lines.next(), lines.next(), lines.next())
    else {
        // No repository here (or no work tree): it has no config of its own.
        return Ok(Drivers {
            watched: Vec::new(),
            overrides: Vec::new(),
        });
    };
    let listed = read_git(
        dir,
        env,
        &[
            "config",
            "--show-scope",
            "--show-origin",
            "-z",
            "--get-regexp",
            DRIVERS,
        ],
    )?;
    // 1: nothing matches.
    if !matches!(listed.status.code(), Some(0 | 1)) {
        let said = String::from_utf8_lossy(&listed.stderr);
        return Err(format!(
            "the repository's git config was not read, so its git was not run: {}",
            said.trim()
        ));
    }
    let entries = parse_config_entries(&String::from_utf8_lossy(&listed.stdout));
    let mut watched: Vec<PathBuf> = vec![config, worktree];
    for entry in entries.iter().filter(|entry| entry.local) {
        let origin = entry.origin.as_deref().map(|file| {
            if Path::new(file).is_absolute() {
                PathBuf::from(file)
            } else {
                top.join(file)
            }
        });
        if let Some(origin) = &origin {
            watched.push(origin.clone());
        }
        // An included file, which may define drivers later.
        if (entry.key == "include.path"
            || (entry.key.starts_with("includeif.") && entry.key.ends_with(".path")))
            && let (Some(value), Some(origin)) = (&entry.value, &origin)
        {
            watched.push(included(value, origin));
        }
    }
    Ok(Drivers {
        watched: watched
            .into_iter()
            .map(|path| {
                let at = modified(&path);
                (path, at)
            })
            .collect(),
        overrides: overrides_of(&entries),
    })
}

/// Where an `include.path` points: `~/` from the home folder, a relative path from the including file's folder.
fn included(value: &str, origin: &Path) -> PathBuf {
    if let Some(rest) = value.strip_prefix("~/") {
        let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .unwrap_or_default();
        return PathBuf::from(home).join(rest);
    }
    if Path::new(value).is_absolute() {
        return PathBuf::from(value);
    }
    origin.parent().unwrap_or(Path::new("")).join(value)
}

/// One entry of `git config --show-scope --show-origin -z --get-regexp`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ConfigEntry {
    /// Set by the repository's own config (`local` or `worktree` scope, its includes included).
    local: bool,
    /// The file it was read from, when one.
    origin: Option<String>,
    /// Its section and name in lower case, its subsection as written.
    key: String,
    /// None for a key written without `=`.
    value: Option<String>,
}

/// The entries of `git config --show-scope --show-origin -z --get-regexp`: its scope, its origin and its
/// `key\nvalue`, each closed by a NUL.
fn parse_config_entries(output: &str) -> Vec<ConfigEntry> {
    let fields: Vec<&str> = output.split('\0').collect();
    fields
        .as_chunks::<3>()
        .0
        .iter()
        .map(|entry| {
            let (key, value) = match entry[2].split_once('\n') {
                Some((key, value)) => (key, Some(value.to_string())),
                None => (entry[2], None),
            };
            ConfigEntry {
                local: matches!(entry[0], "local" | "worktree"),
                origin: entry[1].strip_prefix("file:").map(str::to_string),
                key: key.to_string(),
                value,
            }
        })
        .collect()
}

/// What dummyPlane's git takes instead of each driver the repository's own config defines: the user's own value
/// for it, global or system, when the repository replaced one; else nothing to run (a filter not required).
fn overrides_of(entries: &[ConfigEntry]) -> Vec<(String, String)> {
    let mut overrides: Vec<(String, String)> = Vec::new();
    for entry in entries.iter().filter(|entry| entry.local) {
        let key = entry.key.as_str();
        if key == "include.path"
            || key.starts_with("includeif.")
            || overrides.iter().any(|(seen, _)| seen == key)
        {
            continue;
        }
        let users = entries
            .iter()
            .rev()
            .filter(|other| !other.local && other.key == key)
            .find_map(|other| other.value.clone());
        let neutral = if key.ends_with(".required") {
            "false"
        } else {
            ""
        };
        overrides.push((
            key.to_string(),
            users.unwrap_or_else(|| neutral.to_string()),
        ));
    }
    overrides
}

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
    // Read every 5 s: never with a program the repository names (`command`).
    let output = command(path)
        .ok()?
        .arg("--no-optional-locks")
        .args(["status", "--porcelain=v1", "-b", "--untracked-files=normal"])
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

    /// The branch chip reads the status every 5 s: a filter the repository's own config defines never runs.
    #[test]
    fn reading_the_status_runs_no_filter_the_repository_defines() {
        let Some(dir) = test_repos::with_local_filter() else {
            return;
        };
        status(dir.path()).unwrap();
        assert!(
            !dir.path().join(test_repos::FILTER_RAN).exists(),
            "the status ran the filter the repository's own config defines"
        );
    }

    fn status_with(dir: &Path, env: &[(&str, &OsStr)]) {
        let out = command_with(dir, env)
            .unwrap()
            .args(["status", "--porcelain"])
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// The user's own filters, global or system (Git LFS's), keep running in dummyPlane's git; one the repository
    /// redefined runs as the user defined it.
    #[test]
    fn the_user_s_own_filters_keep_running_and_win_over_the_repository_s() {
        let Some(dir) = test_repos::with_local_filter() else {
            return;
        };
        let root = dir.path();
        let global = root.join("global.gitconfig");
        std::fs::write(
            &global,
            // Quoted: in a config file, `;` starts a comment.
            "[filter \"g\"]\n\tclean = \"sh -c 'echo ran > global-ran; cat'\"\n",
        )
        .unwrap();
        // The repository's own `g` would run something else.
        test_repos::git(
            root,
            &[
                "config",
                "filter.g.clean",
                "sh -c 'echo ran > local-ran; cat'",
            ],
        );
        std::fs::write(root.join(".gitattributes"), "* filter=g\n").unwrap();
        status_with(root, &[("GIT_CONFIG_GLOBAL", global.as_os_str())]);
        assert!(
            root.join("global-ran").exists(),
            "the user's own filter did not run"
        );
        assert!(
            !root.join("local-ran").exists(),
            "the repository's own filter ran"
        );
    }

    /// What the repository's config says is read again once it changed, and once a file it includes did.
    #[test]
    fn a_filter_added_after_a_read_never_runs_either() {
        let Some(dir) = test_repos::with_local_filter() else {
            return;
        };
        let root = dir.path();
        let marker = root.join(test_repos::FILTER_RAN);
        let filter = format!("sh -c 'echo ran > {}; cat'", test_repos::FILTER_RAN);
        test_repos::git(root, &["config", "--unset", "filter.x.clean"]);
        let extra = root.join(".git").join("extra.gitconfig");
        std::fs::write(&extra, "").unwrap();
        test_repos::git(root, &["config", "include.path", "extra.gitconfig"]);
        status(root).unwrap();
        // Defined in the file the config includes, the config itself untouched. Quoted: `;` starts a comment.
        std::fs::write(&extra, format!("[filter \"x\"]\n\tclean = \"{filter}\"\n")).unwrap();
        test_repos::stale(&root.join("a.txt"));
        status(root).unwrap();
        assert!(
            !marker.exists(),
            "a filter an included file defined after a read ran"
        );
        // Then in the config itself.
        std::fs::write(&extra, "").unwrap();
        status(root).unwrap();
        test_repos::git(root, &["config", "filter.x.clean", &filter]);
        test_repos::stale(&root.join("a.txt"));
        status(root).unwrap();
        assert!(
            !marker.exists(),
            "a filter the config defined after a read ran"
        );
    }

    #[test]
    fn reads_the_drivers_and_overrides_the_repository_s_own() {
        let output = [
            "system\0file:C:/Program Files/Git/etc/gitconfig\0filter.lfs.clean\ngit-lfs clean -- %f\0",
            "global\0file:C:/Users/me/.gitconfig\0core.hookspath\nC:/hooks\0",
            "local\0file:.git/config\0filter.lfs.clean\nevil\0",
            "local\0file:.git/config\0filter.x=y.smudge\nevil\0",
            "local\0file:.git/config\0filter.x=y.required\0",
            "local\0file:.git/config\0include.path\nextra.gitconfig\0",
            "local\0file:.git/extra.gitconfig\0merge.z.driver\nevil %A\0",
            "worktree\0file:.git/config.worktree\0core.hookspath\nhooks\0",
        ]
        .concat();
        let entries = parse_config_entries(&output);
        assert_eq!(entries.len(), 8);
        assert_eq!(
            entries[4],
            ConfigEntry {
                local: true,
                origin: Some(".git/config".into()),
                key: "filter.x=y.required".into(),
                value: None
            }
        );
        assert_eq!(
            overrides_of(&entries),
            [
                // Replaced by the repository: the user's own value comes back.
                ("filter.lfs.clean", "git-lfs clean -- %f"),
                ("filter.x=y.smudge", ""),
                ("filter.x=y.required", "false"),
                ("merge.z.driver", ""),
                ("core.hookspath", "C:/hooks"),
            ]
            .map(|(key, value)| (key.to_string(), value.to_string()))
        );
    }

    /// The Code Studio lists a repository's files through git: no filter of its own config runs either.
    #[test]
    fn the_code_studio_s_tree_runs_no_filter_the_repository_defines() {
        let Some(dir) = test_repos::with_local_filter() else {
            return;
        };
        crate::studio::tree(dir.path()).unwrap();
        assert!(
            !dir.path().join(test_repos::FILTER_RAN).exists(),
            "the tree ran the filter the repository's own config defines"
        );
    }
}

/// Repositories the git tests share.
#[cfg(test)]
pub(crate) mod test_repos {
    use std::path::Path;
    use std::process::Command;

    /// What the filter of `with_local_filter` leaves when it runs.
    pub const FILTER_RAN: &str = "filter-ran";

    pub fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("git is installed");
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// `path` as last changed in 2001: its stat data no longer match the index, as in a folder unpacked from an
    /// archive, and git reads it again to know whether it changed.
    pub fn stale(path: &Path) {
        let old = std::time::UNIX_EPOCH + std::time::Duration::from_secs(978_307_200);
        std::fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(old)
            .unwrap();
    }

    /// A repository with `a.txt` committed, whose own config defines a clean filter `x` that leaves `FILTER_RAN`
    /// when it runs, given to every file by `.gitattributes`; `a.txt` is `stale`, so a status reads it through the
    /// filter. None when git is not installed.
    pub fn with_local_filter() -> Option<tempfile::TempDir> {
        if Command::new("git").arg("--version").output().is_err() {
            return None;
        }
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        git(root, &["init", "-q", "-b", "main"]);
        for (key, value) in [
            ("user.name", "t"),
            ("user.email", "t@t"),
            ("commit.gpgsign", "false"),
            ("core.autocrlf", "false"),
        ] {
            git(root, &["config", key, value]);
        }
        std::fs::write(root.join("a.txt"), "a\n").unwrap();
        git(root, &["add", "a.txt"]);
        git(root, &["commit", "-q", "-m", "init"]);
        git(
            root,
            &[
                "config",
                "filter.x.clean",
                &format!("sh -c 'echo ran > {FILTER_RAN}; cat'"),
            ],
        );
        std::fs::write(root.join(".gitattributes"), "* filter=x\n").unwrap();
        stale(&root.join("a.txt"));
        Some(dir)
    }
}
