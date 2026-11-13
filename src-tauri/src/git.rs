use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::process::{hide_window, output_within};
use crate::sync::lock;

/// A repository's own config may name a program for git to run whenever it reads the index (`core.fsmonitor`).
const NO_FSMONITOR: [&str; 2] = ["-c", "core.fsmonitor=false"];

/// A hooks folder no hook can be in: an empty `core.hooksPath` would have git look for them at the drive's root.
const NO_HOOKS: &str = if cfg!(windows) { "NUL" } else { "/dev/null" };

/// A submodule's state is read from its commit, not from its files: git would read those in a git of the
/// submodule's own, with its own config's filters, which `command` never sees. Its uncommitted changes go unseen.
const NO_SUBMODULE_STATUS: [&str; 2] = ["-c", "diff.ignoreSubmodules=dirty"];

/// The keys of a config whose values git runs, or that point to what it runs: a filter's commands (and whether it
/// must run), a merge driver's, the folder of the hooks, the signing programs, the SSH command and the credential
/// helpers; and whether commits are signed. Read with the includes, which name more files to watch.
const DRIVERS: &str = r"^(filter\..+\.(clean|smudge|process|required)|merge\..+\.driver|core\.hookspath|gpg\.program|gpg\..+\.program|gpg\.ssh\.defaultkeycommand|core\.sshcommand|credential\.helper|credential\..+\.helper|commit\.gpgsign|include\.path|includeif\..+\.path)$";

/// A program git runs to sign a commit: `gpg.program`, a format's own (`gpg.ssh.program`…), or the one that finds
/// an SSH key.
fn is_signing_program(key: &str) -> bool {
    key == "gpg.program"
        || key == "gpg.ssh.defaultkeycommand"
        || (key.starts_with("gpg.") && key.ends_with(".program"))
}

/// A credential helper, for every remote or for one (`credential.<url>.helper`): a list, which an empty value empties.
fn is_credential_helper(key: &str) -> bool {
    key == "credential.helper" || (key.starts_with("credential.") && key.ends_with(".helper"))
}

/// What git connects or signs with, which a click uses as the repository says and dummyPlane on its own never.
fn is_user_program(key: &str) -> bool {
    is_signing_program(key) || is_credential_helper(key) || key == "core.sshcommand"
}

/// Whether a signing program is set in the repository's own config and nowhere in the user's: dummyPlane's own
/// commits then go unsigned.
fn signing_here_only(entries: &[ConfigEntry]) -> bool {
    entries.iter().any(|entry| {
        entry.local
            && is_signing_program(&entry.key)
            && !entries
                .iter()
                .any(|other| !other.local && other.key == entry.key)
    })
}

/// A config boolean as git reads it; a key written without `=` is true.
fn config_true(value: Option<&str>) -> bool {
    value.is_none_or(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "true" | "yes" | "on"
        ) || value.trim().parse::<i64>().is_ok_and(|n| n != 0)
    })
}

/// How long reading a repository's config may take: past it, dummyPlane runs none of its git.
const CONFIG_READ_LIMIT: Duration = Duration::from_secs(10);

/// What `local_entries` read of a repository, kept until one of the files it came from changes.
struct Drivers {
    /// The repository's config files (its own, its worktree's, those they include), with their time of change.
    watched: Vec<(PathBuf, Option<SystemTime>)>,
    /// The driver keys its config and the user's define, in the order git reads them (`overrides_of` reads them).
    entries: Vec<ConfigEntry>,
}

/// Who a git call is for. What the user clicks in the git window runs as their terminal would; what dummyPlane
/// runs on its own runs no program the repository names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Asked {
    /// dummyPlane on its own: the branch chip, the review panel, the Code Studio, a mission's merges and cleanup.
    /// No hook runs, neither from `.git/hooks` nor from a folder the config names.
    Unasked,
    /// A git-window button the user clicked (Commit, Push, Switch, Discard): the repository's hooks run, and its
    /// signing, SSH and credential settings are used, as in their terminal. Filters and merge drivers stay off all
    /// the same (`writable`).
    Clicked,
}

static DRIVERS_READ: LazyLock<Mutex<HashMap<PathBuf, Drivers>>> = LazyLock::new(Default::default);

/// The oldest git that reads config from the environment (`GIT_CONFIG_COUNT`) and gives `rev-parse`'s paths
/// absolute: an older one would take none of `command`'s overrides, and run the repository's drivers.
const OLDEST_GIT: (u32, u32) = (2, 31);

/// Set once the installed git was found recent enough; checked again until then (git may be installed meanwhile).
static GIT_RECENT: AtomicBool = AtomicBool::new(false);

/// `major.minor` of `git --version`'s answer.
fn version_of(answer: &str) -> Option<(u32, u32)> {
    let mut parts = answer.trim().strip_prefix("git version ")?.split('.');
    Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
}

/// Whether `git --version`'s answer names a git `command` can keep a repository's drivers from running with.
fn recent_enough(answer: &str) -> Result<(), String> {
    match version_of(answer) {
        Some(version) if version >= OLDEST_GIT => Ok(()),
        Some((major, minor)) => Err(format!(
            "git {major}.{minor} is older than {}.{}: dummyPlane cannot keep a repository's own drivers from running with it, so it runs no git. Update git.",
            OLDEST_GIT.0, OLDEST_GIT.1
        )),
        None => Err(format!(
            "git's version was not understood: {}",
            answer.trim()
        )),
    }
}

fn check_git() -> Result<(), String> {
    if GIT_RECENT.load(Ordering::Relaxed) {
        return Ok(());
    }
    let mut command = Command::new("git");
    hide_window(&mut command);
    command.arg("--version");
    let answer = output_within(&mut command, CONFIG_READ_LIMIT)
        .map_err(|err| format!("git not found: {err}"))?;
    recent_enough(&String::from_utf8_lossy(&answer.stdout))?;
    GIT_RECENT.store(true, Ordering::Relaxed);
    Ok(())
}

/// A git command for the repository at `dir`, as dummyPlane runs all of its own: its window hidden, and nothing
/// the repository's own config (`.git/config`, the files it includes, its worktree's config) names for git to run.
/// Such a repository may come from an archive, or an agent may have written to it, and dummyPlane reads it unasked
/// (the branch chip every 5 s, the review panel, the Code Studio, the git window, a mission's merge). Its filters
/// (`clean`, `smudge`, `process`), merge drivers and hooks folder are switched off, or given back the user's own
/// (global or system) values when theirs replaced those; `core.fsmonitor` is off whoever set it. Its diff drivers
/// run only for a diff's text, which `review::file_diff` asks for without them. Agents' own git, in their
/// terminals, is theirs. An error when the repository's config could not be read: then nothing runs. `asked`: whether
/// the user clicked for it (`Asked`).
pub(crate) fn command(dir: &Path, asked: Asked) -> Result<Command, String> {
    command_with(dir, asked, &[])
}

/// `command`, with `env` given to its git and to the read of its config (a test's own global config).
fn command_with(dir: &Path, asked: Asked, env: &[(&str, &OsStr)]) -> Result<Command, String> {
    check_git()?;
    let overrides = overrides_of(&local_entries(dir, env)?, asked);
    let mut command = Command::new("git");
    hide_window(&mut command);
    command
        .envs(env.iter().copied())
        .args(NO_FSMONITOR)
        .args(NO_SUBMODULE_STATUS)
        .arg("-C")
        .arg(dir);
    if asked == Asked::Unasked {
        // Nobody is there to answer: an authentication that fails says nothing rather than asks.
        command
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "never");
    }
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

/// Refuses what would write the repository's index or files (a commit, a discard, a switch, a mission's
/// worktrees and merges) when its own config defines a filter `command` switches off: git would store the file as
/// it is on the disk where the filter stores something else (git-crypt's cipher, an LFS pointer), and check out
/// what the filter would have changed. Its reads go on.
pub(crate) fn writable(dir: &Path) -> Result<(), String> {
    let mut filters: Vec<&str> = Vec::new();
    let overrides = overrides_of(&local_entries(dir, &[])?, Asked::Clicked);
    for (key, value) in &overrides {
        let Some(rest) = key.strip_prefix("filter.") else {
            continue;
        };
        let name = [".clean", ".smudge", ".process"]
            .iter()
            .find_map(|step| rest.strip_suffix(step));
        if let Some(name) = name
            && value.is_empty()
            && !filters.contains(&name)
        {
            filters.push(name);
        }
    }
    if filters.is_empty() {
        return Ok(());
    }
    Err(format!(
        "This repository's own config defines the filter {}, which dummyPlane's git does not run: commit, discard, switch or merge from a terminal.",
        filters.join(", ")
    ))
}

/// Whether dummyPlane's own commits in this repository go unsigned where the user signs: commits are signed here,
/// with a signing program set in the repository's own config only, which `command` does not run unasked (and turns
/// signing off for). A mission's merge says so to its Manager.
pub(crate) fn unsigned(dir: &Path) -> Result<bool, String> {
    let entries = local_entries(dir, &[])?;
    let signs = entries
        .iter()
        .rev()
        .find(|entry| entry.key == "commit.gpgsign")
        .is_some_and(|entry| config_true(entry.value.as_deref()));
    Ok(signs && signing_here_only(&entries))
}

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
}

/// The driver keys of the repository at `dir` (`Drivers`), read again only when one of its config files changed.
fn local_entries(dir: &Path, env: &[(&str, &OsStr)]) -> Result<Vec<ConfigEntry>, String> {
    // Another environment (a test's own global config) reads other entries: never cached.
    if !env.is_empty() {
        return Ok(read_drivers(dir, env)?.entries);
    }
    if let Some(read) = lock(&DRIVERS_READ).get(dir)
        && read.watched.iter().all(|(path, at)| modified(path) == *at)
    {
        return Ok(read.entries.clone());
    }
    let read = read_drivers(dir, env)?;
    let entries = read.entries.clone();
    // A folder that is no repository yet is read again next time: it may become one.
    if !read.watched.is_empty() {
        lock(&DRIVERS_READ).insert(dir.to_path_buf(), read);
    }
    Ok(entries)
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
            entries: Vec::new(),
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
        entries,
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
/// for it, global or system, when the repository replaced one; else nothing to run (a filter not required). On a
/// call nobody clicked, no hook either (a hooks folder no hook can be in, `.git/hooks` left out too), and the repository's
/// signing programs, SSH command and credential helpers give way to the user's own, or to none: then its commits
/// are not signed (`unsigned`).
fn overrides_of(entries: &[ConfigEntry], asked: Asked) -> Vec<(String, String)> {
    let mut overrides: Vec<(String, String)> = Vec::new();
    if asked == Asked::Unasked {
        overrides.push(("core.hookspath".into(), NO_HOOKS.into()));
    }
    for entry in entries.iter().filter(|entry| entry.local) {
        let key = entry.key.as_str();
        if key == "include.path"
            || key.starts_with("includeif.")
            // Clicked, the hooks run as the repository says; unasked, none does.
            || key == "core.hookspath"
            // Data, as the keys are: whether to sign, not with what.
            || key == "commit.gpgsign"
            || overrides.iter().any(|(seen, _)| seen == key)
        {
            continue;
        }
        if is_user_program(key) {
            if asked == Asked::Clicked {
                continue;
            }
            if is_credential_helper(key) {
                // The list emptied, then the user's own helpers, in their order.
                overrides.push((key.to_string(), String::new()));
                overrides.extend(
                    entries
                        .iter()
                        .filter(|other| !other.local && other.key == key)
                        .filter_map(|other| Some((key.to_string(), other.value.clone()?))),
                );
                continue;
            }
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
    if asked == Asked::Unasked && signing_here_only(entries) {
        overrides.push(("commit.gpgsign".into(), "false".into()));
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
    let output = command(path, Asked::Unasked)
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
        let out = command_with(dir, Asked::Unasked, env)
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

    /// An older git takes none of the overrides, which it would read as nothing: dummyPlane runs no git with it.
    #[test]
    fn runs_no_git_older_than_the_one_that_takes_the_overrides() {
        assert_eq!(recent_enough("git version 2.54.0.windows.1\n"), Ok(()));
        assert_eq!(recent_enough("git version 2.31.0"), Ok(()));
        let old = recent_enough("git version 2.30.9.windows.1").unwrap_err();
        assert!(old.contains("2.30") && old.contains("2.31"), "{old}");
        assert!(recent_enough("git version 1.9.5.msysgit.0").is_err());
        assert!(recent_enough("not git").is_err());
    }

    /// Unasked, the repository's signing programs, SSH command and credential helpers give way to the user's
    /// own, or to none, and with no signing program of the user's its commits go unsigned; clicked, git reads them as
    /// it does.
    #[test]
    fn overrides_the_repository_s_signing_ssh_and_credentials_unasked() {
        let entry = |local: bool, key: &str, value: &str| ConfigEntry {
            local,
            origin: None,
            key: key.into(),
            value: Some(value.into()),
        };
        let entries = [
            entry(false, "credential.helper", "manager"),
            entry(false, "gpg.program", "C:/gpg/gpg.exe"),
            entry(true, "commit.gpgsign", "true"),
            entry(true, "gpg.program", "evil"),
            entry(true, "gpg.ssh.program", "evil-ssh-keygen"),
            entry(true, "core.sshcommand", "evil-ssh"),
            entry(true, "credential.helper", "evil-helper"),
        ];
        assert_eq!(overrides_of(&entries, Asked::Clicked), Vec::new());
        let expected = [
            ("core.hookspath", NO_HOOKS),
            ("gpg.program", "C:/gpg/gpg.exe"),
            ("gpg.ssh.program", ""),
            ("core.sshcommand", ""),
            ("credential.helper", ""),
            ("credential.helper", "manager"),
            ("commit.gpgsign", "false"),
        ]
        .map(|(key, value)| (key.to_string(), value.to_string()));
        assert_eq!(overrides_of(&entries, Asked::Unasked), expected);
        assert!(signing_here_only(&entries));
        // The user's own `gpg.ssh.program` too: nothing of the repository's is left to sign with.
        let mut users = entries.to_vec();
        users.push(entry(false, "gpg.ssh.program", "C:/ssh/ssh-keygen.exe"));
        assert!(!signing_here_only(&users));
    }

    #[test]
    fn reads_a_config_boolean_as_git_does() {
        for yes in [
            None,
            Some("true"),
            Some("Yes"),
            Some("on"),
            Some("1"),
            Some("2"),
        ] {
            assert!(config_true(yes), "{yes:?}");
        }
        for no in [Some("false"), Some("no"), Some("off"), Some("0"), Some("")] {
            assert!(!config_true(no), "{no:?}");
        }
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
        let owned = |pairs: &[(&str, &str)]| {
            pairs
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect::<Vec<_>>()
        };
        // Replaced by the repository: the user's own value comes back.
        let drivers = [
            ("filter.lfs.clean", "git-lfs clean -- %f"),
            ("filter.x=y.smudge", ""),
            ("filter.x=y.required", "false"),
            ("merge.z.driver", ""),
        ];
        // Clicked: the hooks run as the repository says.
        assert_eq!(overrides_of(&entries, Asked::Clicked), owned(&drivers));
        // Unasked: none runs, from any folder.
        let mut unasked = vec![("core.hookspath", NO_HOOKS)];
        unasked.extend(drivers);
        assert_eq!(overrides_of(&entries, Asked::Unasked), owned(&unasked));
    }

    /// A submodule has a config of its own, which an archive brings too: reading the repository around it (the
    /// status, the review panel's changes) runs none of its filters.
    #[test]
    fn reading_a_repository_runs_no_filter_of_its_submodules() {
        let Some(dir) = test_repos::with_local_filter() else {
            return;
        };
        let parent = tempfile::tempdir().unwrap();
        let sub = parent.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        test_repos::git(&sub, &["init", "-q", "-b", "main"]);
        for (key, value) in [
            ("user.name", "t"),
            ("user.email", "t@t"),
            ("commit.gpgsign", "false"),
        ] {
            test_repos::git(&sub, &["config", key, value]);
        }
        std::fs::write(sub.join("s.txt"), "s\n").unwrap();
        test_repos::git(&sub, &["add", "s.txt"]);
        test_repos::git(&sub, &["commit", "-q", "-m", "sub"]);
        let root = dir.path();
        test_repos::git(root, &["config", "--unset", "filter.x.clean"]);
        test_repos::git(
            root,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                "-q",
                &sub.to_string_lossy(),
                "sub",
            ],
        );
        test_repos::git(root, &["commit", "-q", "-m", "sub"]);
        let inner = root.join("sub");
        test_repos::git(
            &inner,
            &[
                "config",
                "filter.y.clean",
                &format!("sh -c 'echo ran > {}; cat'", test_repos::FILTER_RAN),
            ],
        );
        std::fs::write(inner.join(".gitattributes"), "* filter=y\n").unwrap();
        test_repos::stale(&inner.join("s.txt"));
        status(root).unwrap();
        crate::review::changes(root, None).unwrap();
        assert!(
            !inner.join(test_repos::FILTER_RAN).exists(),
            "reading the repository ran a filter its submodule's own config defines"
        );
    }

    /// What git reads of `key` on a call `asked` for, as dummyPlane runs it.
    fn read_as(dir: &Path, asked: Asked, key: &str) -> Option<String> {
        let out = command(dir, asked)
            .unwrap()
            .args(["config", "--get", key])
            .output()
            .unwrap();
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    /// What git reads of every `key` on a call `asked` for, with `env` (a test's own global config).
    fn read_all_as(dir: &Path, asked: Asked, env: &[(&str, &OsStr)], key: &str) -> Vec<String> {
        let out = command_with(dir, asked, env)
            .unwrap()
            .args(["config", "--get-all", key])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(str::to_string)
            .collect()
    }

    /// Unasked, git connects, if ever, with the user's own SSH command and credential helpers, never those the
    /// repository names; clicked (Push), with the repository's, as the user's terminal would.
    #[test]
    fn an_unasked_call_takes_the_user_s_ssh_and_credentials_and_a_clicked_one_the_repository_s() {
        let Some(dir) = test_repos::with_local_filter() else {
            return;
        };
        let root = dir.path();
        let global = root.join("global.gitconfig");
        std::fs::write(
            &global,
            "[core]\n\tsshCommand = ssh -i mine\n[credential]\n\thelper = manager\n",
        )
        .unwrap();
        let env = [("GIT_CONFIG_GLOBAL", global.as_os_str())];
        test_repos::git(root, &["config", "core.sshCommand", "evil-ssh"]);
        test_repos::git(root, &["config", "credential.helper", "evil-helper"]);
        assert_eq!(
            read_all_as(root, Asked::Unasked, &env, "core.sshCommand")
                .last()
                .map(String::as_str),
            Some("ssh -i mine")
        );
        assert_eq!(
            read_all_as(root, Asked::Clicked, &env, "core.sshCommand")
                .last()
                .map(String::as_str),
            Some("evil-ssh")
        );
        // An empty helper empties git's list: what follows the last one is what git asks.
        let helpers = read_all_as(root, Asked::Unasked, &env, "credential.helper");
        let asked = helpers
            .rsplit(|helper| helper.is_empty())
            .next()
            .unwrap()
            .to_vec();
        // The user's own, system and global (this test's), as listed before the repository's.
        let users: Vec<String> = helpers
            .iter()
            .take_while(|helper| *helper != "evil-helper")
            .cloned()
            .collect();
        assert!(users.contains(&"manager".to_string()), "{helpers:?}");
        assert_eq!(asked, users, "{helpers:?}");
        let helpers = read_all_as(root, Asked::Clicked, &env, "credential.helper");
        assert_eq!(helpers.last().map(String::as_str), Some("evil-helper"));
        // Nothing of the user's: nothing to run.
        assert_eq!(
            read_all_as(root, Asked::Unasked, &[], "core.sshCommand")
                .last()
                .map(String::as_str),
            Some("")
        );
    }

    /// Unasked, git finds no hook to run, from `.git/hooks` or from a folder the repository names; clicked, it
    /// finds the repository's own folder, as the user's terminal would.
    #[test]
    fn an_unasked_call_has_no_hooks_folder_and_a_clicked_one_the_repository_s() {
        let Some(dir) = test_repos::with_local_filter() else {
            return;
        };
        let root = dir.path();
        assert_eq!(
            read_as(root, Asked::Unasked, "core.hooksPath").as_deref(),
            Some(NO_HOOKS)
        );
        test_repos::git(root, &["config", "core.hooksPath", ".husky"]);
        assert_eq!(
            read_as(root, Asked::Unasked, "core.hooksPath").as_deref(),
            Some(NO_HOOKS)
        );
        assert_eq!(
            read_as(root, Asked::Clicked, "core.hooksPath").as_deref(),
            Some(".husky")
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
