//! Worktrees and branches of a mission.
//! dummyPlane works beside the user's folder, never in their branch but for a landing the user clicks (`land`): no push,
//! no force.

use std::fs::File;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::{Deserialize, Serialize};

/// A worktree dummyPlane made, on a branch of its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub slug: String,
    pub branch: String,
    pub path: String,
    /// The user's branch the mission was cut from (`prepare` only): the one `land` brings its work onto, even if their
    /// checkout is on another branch by then. None on a detached HEAD, and for an agent's worktree.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Merge {
    Merged,
    /// The agent's branch has no commit the mission's lacks.
    Empty,
    /// The merge was undone; these files conflicted.
    Conflict {
        files: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    pub merge: Merge,
    /// The agent left changes uncommitted in its worktree: they are not merged.
    pub uncommitted: bool,
    /// The merge's commit went unsigned where the user signs: the signing program is set in this repository only,
    /// and dummyPlane's own git runs none it names (`git::unsigned`).
    pub unsigned: bool,
    /// The agent's branch head the merge looked at: what its squash took in, kept by the mission so that the next
    /// merge takes only what came after it, and so that the cleanups know the branch is in.
    pub head: String,
}

/// An agent of the mission as the cleanups name it, with the head of its branch its last merge took in (`squashed`):
/// a squashed branch is no ancestor of the mission's, so git alone cannot tell it is in.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBranch {
    pub name: String,
    #[serde(default)]
    pub squashed: Option<String>,
}

/// An agent's worktree and branch, for `probe_agents`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeAgent {
    pub path: String,
    pub branch: String,
}

/// What a merge reads first of an agent (`merge_agent`): whether its worktree holds uncommitted changes, and the head
/// of its branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub uncommitted: bool,
    pub head: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleanup {
    pub removed: Vec<String>,
    pub kept: Vec<String>,
    /// The mission's cleanup only: the uncommitted work it committed before removing a worktree, as "<branch>
    /// (<short sha>)", on the branch that keeps it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub saved: Vec<String>,
    /// The mission's cleanup and the leftovers' only: the files of a removed worktree that nothing makes again (ignored
    /// ones, and `.env*`, which no commit takes), moved beside the worktrees before it went.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub moved: Vec<Moved>,
}

/// The files a cleanup moved out of a worktree before removing it, into `folder`: `<project>.worktrees\.kept\<worktree>`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moved {
    pub worktree: String,
    pub folder: String,
    /// The first of them (`MOVED_NAMED`), as git names them: a folder moved whole ends in `/`.
    pub files: Vec<String>,
    pub count: usize,
}

/// How many moved files a cleanup names: the others are counted.
const MOVED_NAMED: usize = 5;

/// The folder beside the worktrees where a cleanup moves what it keeps of a worktree it removes, one folder per worktree.
pub const KEPT_FOLDER: &str = ".kept";

/// The folder beside the worktrees where a removed worktree waits to be deleted: its work saved, its kept files moved.
/// Whatever an app quit mid-deletion leaves there goes with the next clean-up of leftovers.
const TRASH_FOLDER: &str = ".trash";

/// A terminal the mission's cleanup leaves open (at work, held by a dialog, the user at it): the worktree its folder
/// is in stays, with `why`, and so does its branch. `path` is the terminal's folder.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeldOpen {
    pub path: String,
    pub why: String,
}

/// The subject of the commit the mission's cleanup makes of a worktree's uncommitted work, on its own branch.
pub const WIP_MESSAGE: &str = "WIP saved at clean-up";

const MAX_SLUG: usize = 40;

/// The subject of the temporary commit a squash cherry-picks. Never kept, but git names a file against a directory
/// after it (`x~<sha> (an agent's work)`): nothing in it may be a character a Windows path cannot hold (`:` was one).
const SQUASH_SUBJECT: &str = "an agent's work";

/// Latin letters with accents or macrons, as plain ASCII: "Zoë" → "zoe", "Fūjin" → "fujin".
fn fold(c: char) -> Option<&'static str> {
    Some(match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => "a",
        'ç' => "c",
        'è' | 'é' | 'ê' | 'ë' | 'ē' => "e",
        'ì' | 'í' | 'î' | 'ï' | 'ī' => "i",
        'ñ' => "n",
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ō' => "o",
        'ù' | 'ú' | 'û' | 'ü' | 'ū' => "u",
        'ý' | 'ÿ' => "y",
        'œ' => "oe",
        'æ' => "ae",
        _ => return None,
    })
}

/// A name made safe for a branch and a folder: lowercase ASCII and dashes.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        if let Some(plain) = fold(c) {
            out.push_str(plain);
        } else if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let mut cut: String = out.chars().take(MAX_SLUG).collect();
    while cut.ends_with('-') {
        cut.pop();
    }
    if cut.is_empty() {
        "mission".into()
    } else {
        cut
    }
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    // A merge reads the worktrees' status and runs merge drivers: never a program the repository names (`git::command`).
    let output = crate::git::command(dir, crate::git::Asked::Unasked)?
        .args(args)
        .output()
        .map_err(|err| format!("git not found: {err}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// `git` for the squash of an agent's work, as `git`: dummyPlane's own, unasked (`git::command`), so no hook of the
/// repository runs on it, neither from `.git/hooks` nor from a folder its config names, nor a filter, merge driver
/// or signing program only it names. `input`, when given, is what git reads on its standard input: a commit's
/// message is never an argument, nor a shell's.
fn squash_git(dir: &Path, args: &[&str], input: Option<&str>) -> Result<String, String> {
    let mut command = crate::git::command(dir, crate::git::Asked::Unasked)?;
    command
        .args(args)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|err| format!("git not found: {err}"))?;
    if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin
            .write_all(input.as_bytes())
            .map_err(|err| format!("git did not take its input: {err}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|err| format!("git did not answer: {err}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// How many worktrees are read at once: each read is a git process that scans a worktree, so more than a few only
/// crowd the disk (on Windows, the status of a worktree with its dependencies takes about a second).
const READ_WORKERS: usize = 6;

/// `work` on each of `items`, up to `READ_WORKERS` at a time, the answers in the order of the items. Only for work on
/// worktrees that do not depend on each other: reads, and a cleanup's work on each worktree, which writes only in its
/// own and on its own branch. What writes in the mission's worktree goes one at a time.
fn in_parallel<T: Sync, R: Send>(items: &[T], work: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let next = AtomicUsize::new(0);
    let slots: Vec<Mutex<Option<R>>> = items.iter().map(|_| Mutex::new(None)).collect();
    std::thread::scope(|scope| {
        for _ in 0..READ_WORKERS.min(items.len()) {
            scope.spawn(|| {
                loop {
                    let at = next.fetch_add(1, Ordering::Relaxed);
                    let Some(item) = items.get(at) else { break };
                    let answer = work(item);
                    *slots[at]
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(answer);
                }
            });
        }
    });
    slots
        .into_iter()
        .map(|slot| {
            slot.into_inner()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .expect("a worker took every item")
        })
        .collect()
}

/// The repository's root, and the folder of its worktrees: `<parent>/<folder>.worktrees`.
fn locate(project: &Path) -> Result<(PathBuf, PathBuf), String> {
    // The folder is named: a workspace may work in another one than the project's.
    let root = git(project, &["rev-parse", "--show-toplevel"])
        .map_err(|_| format!("The folder {} is not a git repository.", project.display()))?;
    // git answers with forward slashes, even on Windows.
    let root = PathBuf::from(if cfg!(windows) {
        root.replace('/', "\\")
    } else {
        root
    });
    let name = root
        .file_name()
        .ok_or_else(|| "The repository has no folder name.".to_string())?
        .to_string_lossy()
        .into_owned();
    let parent = root
        .parent()
        .ok_or_else(|| "The repository has no parent folder.".to_string())?;
    let dir = parent.join(format!("{name}.worktrees"));
    Ok((root, dir))
}

fn add_worktree(root: &Path, dir: &Path, slug: &str, from: &str) -> Result<Worktree, String> {
    let branch = format!("dummyplane/{slug}");
    if git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    )
    .is_ok()
    {
        return Err(format!("The branch {branch} already exists."));
    }
    let path = dir.join(slug);
    if path.exists() {
        let shown = path.display();
        return Err(format!("The folder {shown} already exists."));
    }
    let shown = path.to_string_lossy().into_owned();
    git(root, &["worktree", "add", "-b", &branch, &shown, from])?;
    Ok(Worktree {
        slug: slug.into(),
        branch,
        path: shown,
        base: None,
    })
}

fn no_commit() -> String {
    "The repository has no commit yet: make a first commit, then launch the mission again."
        .to_string()
}

/// The mission's branch, from the project's current commit, and its worktree (where merges happen).
pub fn prepare(project: &Path, name: &str) -> Result<Worktree, String> {
    let (root, dir) = locate(project)?;
    crate::git::writable(&root)?;
    // Without a commit, git only says « invalid reference: HEAD » (final review H2).
    if git(&root, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_err() {
        return Err(no_commit());
    }
    let base = current_branch(&root);
    Ok(Worktree {
        base,
        ..add_worktree(&root, &dir, &slug(name), "HEAD")?
    })
}

/// The branch checked out in `dir`, None on a detached HEAD.
fn current_branch(dir: &Path) -> Option<String> {
    git(dir, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .filter(|branch| !branch.is_empty())
}

/// An agent's branch, from the mission's, and its worktree. `mission` is the mission's slug.
pub fn add_agent(project: &Path, mission: &str, agent: &str) -> Result<Worktree, String> {
    let (root, dir) = locate(project)?;
    crate::git::writable(&root)?;
    let name = format!("{mission}-{}", slug(agent));
    add_worktree(&root, &dir, &name, &format!("dummyplane/{mission}"))
}

/// Squashes an agent's branch into the mission's, in the mission's worktree: one commit, whose message is `message`
/// (the sub-task, then what the agent reported; never a branch's name), with the user's git identity and signing and
/// no hook of the repository (`squash_git`). `since` is the head its last merge took in: only what came after it is
/// taken, with it as the merge's base, as a squashed branch is no ancestor of the mission's. A conflict, or a commit
/// git refuses, is undone: the mission's worktree is left as it was.
pub fn merge_agent(
    mission: &Path,
    agent: &Path,
    branch: &str,
    message: &str,
    since: Option<&str>,
) -> Result<MergeReport, String> {
    crate::git::writable(mission)?;
    let uncommitted = !git(agent, &["status", "--porcelain"])
        .unwrap_or_default()
        .is_empty();
    let head = git(
        mission,
        &["rev-parse", "--verify", &format!("{branch}^{{commit}}")],
    )?;
    let report = |merge| MergeReport {
        merge,
        uncommitted,
        unsigned: false,
        head: head.clone(),
    };
    let base = match since {
        Some(since) if since == head => return Ok(report(Merge::Empty)),
        // Its history rewritten since (a reset, a rebase): what came after its last merge cannot be told.
        Some(since) if git(mission, &["merge-base", "--is-ancestor", since, &head]).is_err() => {
            return Err(format!(
                "The branch {branch} was rewritten since its last merge: dummyPlane takes in only the commits added on top of it."
            ));
        }
        Some(since) => since.to_string(),
        None => git(mission, &["merge-base", "HEAD", &head])?,
    };
    let tree = |commit: &str| git(mission, &["rev-parse", &format!("{commit}^{{tree}}")]);
    if tree(&base)? == tree(&head)? {
        return Ok(report(Merge::Empty));
    }
    // Staged there, a change is not the squash's: its commit would take it in, and the undo of a squash that fails
    // (`reset --merge`) would take it out of the folder. Refused before anything is written.
    let staged = git(mission, &["diff", "--cached", "--name-only"])?;
    if !staged.is_empty() {
        let names: Vec<&str> = staged.lines().take(3).collect();
        return Err(format!(
            "The mission's worktree has changes staged ({}): commit or unstage them there, then merge again.",
            names.join(", ")
        ));
    }
    // Whether its commit goes unsigned where the user signs, read before anything is written: an error here leaves
    // the mission as it was, never a commit made and said to have failed.
    let unsigned = crate::git::unsigned(mission)?;
    // One commit from `base` to the agent's work: cherry-pick takes `base`, its parent, as the merge's base. Never
    // kept, never signed.
    let step = squash_git(
        mission,
        &[
            "commit-tree",
            "--no-gpg-sign",
            "-p",
            &base,
            &format!("{head}^{{tree}}"),
        ],
        Some(SQUASH_SUBJECT),
    )?;
    if let Err(err) = squash_git(mission, &["cherry-pick", "--no-commit", &step], None) {
        let files: Vec<String> = git(mission, &["diff", "--name-only", "--diff-filter=U"])
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect();
        let undone = undo_squash(mission);
        if files.is_empty() {
            return Err(cancelled(branch, &err, undone));
        }
        if let Err(left) = undone {
            return Err(format!(
                "Merging {branch} conflicted in {}, and the squash could not be taken back: {left}",
                files.join(", ")
            ));
        }
        return Ok(report(Merge::Conflict { files }));
    }
    // Everything it brings is in already.
    if git(mission, &["diff", "--cached", "--quiet"]).is_ok() {
        if let Err(left) = undo_squash(mission) {
            return Err(format!(
                "Merging {branch} brought nothing new, but the squash could not be taken back: {left}"
            ));
        }
        return Ok(report(Merge::Empty));
    }
    // Signed as the user's own commits are, unless the signing program is the repository's alone (`git::unsigned`).
    // `--no-verify` as well as no hooks folder: the checks stay skipped whatever the hooks' folder.
    let commit = [
        "commit",
        "-q",
        "--no-verify",
        "--cleanup=whitespace",
        "-F",
        "-",
    ];
    if let Err(err) = squash_git(mission, &commit, Some(message)) {
        // A commit refused (a signing that failed) leaves the squash staged: the next merges would take it in.
        return Err(cancelled(branch, &err, undo_squash(mission)));
    }
    Ok(MergeReport {
        unsigned,
        ..report(Merge::Merged)
    })
}

/// What `merge_agent` reads first, for each of `agents` at once: a merge of the agents that were in already, with
/// nothing new on their branches, would take their statuses one after another, a second each on a worktree with its
/// dependencies. Reads only (`status`, `rev-parse`), so they run side by side; a merge that writes goes one at a time,
/// as before. An agent whose branch cannot be read is none: its own merge says why.
pub fn probe_agents(mission: &Path, agents: &[ProbeAgent]) -> Result<Vec<Option<Probe>>, String> {
    // As `merge_agent` starts: a repository that refuses merges refuses them all.
    crate::git::writable(mission)?;
    Ok(in_parallel(agents, |agent| {
        let uncommitted = !git(Path::new(&agent.path), &["status", "--porcelain"])
            .unwrap_or_default()
            .is_empty();
        let head = git(
            mission,
            &[
                "rev-parse",
                "--verify",
                &format!("{}^{{commit}}", agent.branch),
            ],
        )
        .ok()?;
        Some(Probe { uncommitted, head })
    }))
}

/// What a merge that failed says: that it was cancelled, or that it could not be, and what may be left of it.
fn cancelled(branch: &str, err: &str, undone: Result<(), String>) -> String {
    match undone {
        Ok(()) => format!("Merging {branch} failed and was cancelled: {err}"),
        Err(left) => format!("Merging {branch} failed: {err}\nIt could not be taken back: {left}"),
    }
}

/// Takes a squash back: the index and the files it changed as they were, a conflict's included, other local changes kept.
///
/// An error when git could not: it names what the squash may have left staged or unmerged in the mission's worktree
/// (at most three, then how many more), as the refusal of a worktree with staged changes does.
fn undo_squash(mission: &Path) -> Result<(), String> {
    let Err(err) = squash_git(mission, &["reset", "--merge"], None) else {
        return Ok(());
    };
    let cause = err.lines().next().unwrap_or_default().trim().to_string();
    let left = git(mission, &["diff", "--cached", "--name-only"]).unwrap_or_default();
    let names: Vec<&str> = left.lines().collect();
    if names.is_empty() {
        return Err(cause);
    }
    let more = names.len().saturating_sub(3);
    let shown = names[..names.len() - more].join(", ");
    let more = if more > 0 {
        format!(", +{more} more")
    } else {
        String::new()
    };
    Err(format!(
        "the mission's worktree may hold leftovers ({shown}{more}): {cause}"
    ))
}

/// Folders whose contents a build or a tool makes again: an ignored entry under one of them, at any depth, is no loss.
/// Only names no one gives a folder of their own work: a cache, a build's output, an install.
const DISPOSABLE_FOLDERS: [&str; 30] = [
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".output",
    ".svelte-kit",
    ".turbo",
    ".swc",
    ".vite",
    ".parcel-cache",
    ".angular",
    ".astro",
    ".docusaurus",
    ".expo",
    ".pnpm-store",
    ".cache",
    "coverage",
    ".nyc_output",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    "venv",
    ".gradle",
    "obj",
];

/// Whether an ignored entry git printed (a wholly ignored folder ends in `/`) is one a build or a tool makes again, or
/// the system's litter: a segment of its path is one of `DISPOSABLE_FOLDERS`, or it is one of a few files, whatever the
/// case (`next-env.d.ts`, which Next.js writes at each start). Not `bin`, `vendor`, `.idea`, `.vscode`, a log or an
/// `.env`: those can hold what nothing makes again.
fn disposable_path(entry: &str) -> bool {
    let lower = entry.trim_end_matches('/').to_ascii_lowercase();
    if lower
        .split('/')
        .any(|part| DISPOSABLE_FOLDERS.contains(&part))
    {
        return true;
    }
    let name = lower.rsplit('/').next().unwrap_or_default();
    matches!(
        name,
        ".ds_store"
            | "thumbs.db"
            | "desktop.ini"
            | ".eslintcache"
            | ".stylelintcache"
            | "next-env.d.ts"
    ) || name.ends_with(".pyc")
        || name.ends_with(".tsbuildinfo")
}

/// Whether two files hold the same bytes.
fn same_bytes(a: &Path, b: &Path) -> bool {
    let (Ok(meta_a), Ok(meta_b)) = (std::fs::metadata(a), std::fs::metadata(b)) else {
        return false;
    };
    if !meta_a.is_file() || !meta_b.is_file() || meta_a.len() != meta_b.len() {
        return false;
    }
    let (Ok(file_a), Ok(file_b)) = (File::open(a), File::open(b)) else {
        return false;
    };
    let (mut a, mut b) = (BufReader::new(file_a), BufReader::new(file_b));
    let (mut left, mut right) = ([0u8; 64 * 1024], [0u8; 64 * 1024]);
    // Read to the end of each buffer, or of its file: a read may stop short.
    fn fill(from: &mut impl Read, into: &mut [u8]) -> Option<usize> {
        let mut filled = 0;
        while filled < into.len() {
            match from.read(&mut into[filled..]) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(_) => return None,
            }
        }
        Some(filled)
    }
    loop {
        let (Some(n), Some(m)) = (fill(&mut a, &mut left), fill(&mut b, &mut right)) else {
            return false;
        };
        if n != m || left[..n] != right[..m] {
            return false;
        }
        if n == 0 {
            return true;
        }
    }
}

/// Whether the worktree at `path` stands on a commit no branch, remote branch or tag holds: its HEAD left its branch
/// (`git checkout --detach`, a rebase's) and went on. `git worktree remove` takes the folder, with the only HEAD that
/// holds those commits: they would be held by nothing (git does not ask). An error is read as a worktree to keep.
fn on_no_branch(path: &Path) -> Result<bool, String> {
    let holders = git(
        path,
        &[
            "for-each-ref",
            "--contains",
            "HEAD",
            "--count=1",
            "--format=%(refname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;
    Ok(holders.is_empty())
}

/// Whether the cleanup committed uncommitted work on `branch` (its `saved` entries start with the branch's name).
fn wip_saved(done: &Cleanup, branch: &str) -> bool {
    done.saved
        .iter()
        .any(|saved| saved.split(" (").next() == Some(branch))
}

/// The worktree at `path` (a folder of `dir`, `<project>.worktrees`), on its own branch `branch`, cleared alone by the
/// mission cleanup's rules (`clear_worktree`), read the fast way (`status_of`: an ignored folder is one entry, a
/// `node_modules` costs nothing to read): its uncommitted work committed on its branch first (never an `.env*`), what
/// nothing makes again of its ignored files, and its `.env*`, moved to the kept folder, its status read again, then
/// its folder taken away and deleted. Whether it is gone; what saved it, moved or kept it goes into `done`. It stays,
/// named with why, when it is not a folder of `dir`, a cleanup holds it, it is locked, its HEAD stands on commits no
/// branch holds, a merge or a rebase is under way there, or a program holds a file in it. The caller has stopped the
/// agent that worked there: no terminal is left open in it (`open` is empty).
fn clear_alone(root: &Path, dir: &Path, path: &Path, branch: &str, done: &mut Cleanup) -> bool {
    let named = path.file_name().map(|n| n.to_string_lossy().into_owned());
    let in_dir = path
        .parent()
        .is_some_and(|parent| same_folder(&parent.to_string_lossy(), dir));
    let Some(name) = named.filter(|_| in_dir) else {
        done.kept.push(format!(
            "{} (not a worktree dummyPlane made: it is outside {})",
            path.display(),
            dir.display()
        ));
        return false;
    };
    let Some(_held) = claim(&[path.to_path_buf()]) else {
        done.kept
            .push(format!("{name} (a clean-up is already under way there)"));
        return false;
    };
    // Its folder went meanwhile: nothing left to clear.
    let Some(read) = read_worktree(path) else {
        return true;
    };
    let mut cleared = Cleanup::default();
    let trash = clear_worktrees(
        root,
        dir,
        &[(name, branch.to_string(), read)],
        &[],
        &mut cleared,
    );
    delete_trash(&trash);
    let stays = !cleared.kept.is_empty();
    done.kept.extend(cleared.kept);
    done.saved.extend(cleared.saved);
    done.moved.extend(cleared.moved);
    !stays
}

/// Undoes a launch that failed (final review H2): its fresh worktrees and branches go, newest first, so the plan can
/// be launched again. Never forced, and never losing work: each worktree goes by the mission cleanup's rules
/// (`clear_alone`: what an agent left uncommitted is committed on its branch, its ignored files nothing makes again
/// and its `.env*` are moved to the kept folder), a branch with commits stays (`git branch -d`).
pub fn discard(project: &Path, trees: &[Worktree]) -> Result<Cleanup, String> {
    let (root, dir) = locate(project)?;
    let mut done = Cleanup::default();
    for tree in trees.iter().rev() {
        let path = Path::new(&tree.path);
        if path.exists() && !clear_alone(&root, &dir, path, &tree.branch, &mut done) {
            continue;
        }
        match git(&root, &["branch", "-d", &tree.branch]) {
            Ok(_) => done.removed.push(tree.slug.clone()),
            Err(_) => {
                let branch = &tree.branch;
                let why = if wip_saved(&done, branch) {
                    WIP_MESSAGE
                } else {
                    "branch not merged"
                };
                done.kept.push(format!("{branch} ({why})"));
            }
        }
    }
    Ok(done)
}

/// The branches merged into the mission's, one per line: what `cleanup` removes the worktrees of.
fn merged_branches(root: &Path, mission: &str) -> Result<String, String> {
    git(
        root,
        &[
            "branch",
            "--format=%(refname:short)",
            "--merged",
            &format!("dummyplane/{mission}"),
        ],
    )
}

/// Whether an agent's branch is in the mission's: one of `merged` (merged the old way, an ancestor of it), at the head
/// its own squash took in (`own`) or on the same files (an empty commit since), or an ancestor of a head any squash
/// took in (`squashed`): a branch handed over gets in through its successor's.
fn branch_in(
    root: &Path,
    branch: &str,
    own: Option<&str>,
    merged: &[&str],
    squashed: &[&str],
) -> bool {
    if merged.contains(&branch) {
        return true;
    }
    let Ok(head) = git(
        root,
        &["rev-parse", "--verify", &format!("{branch}^{{commit}}")],
    ) else {
        return false;
    };
    if own.is_some_and(|own| same_work(root, own, &head)) {
        return true;
    }
    squashed
        .iter()
        .any(|squash| git(root, &["merge-base", "--is-ancestor", &head, squash]).is_ok())
}

/// Two commits that hold the same work: the same, or the same files (a commit with no change on top of the other).
fn same_work(root: &Path, a: &str, b: &str) -> bool {
    let tree = |commit: &str| git(root, &["rev-parse", &format!("{commit}^{{tree}}")]).ok();
    a == b || tree(a).is_some_and(|tree_a| tree(b) == Some(tree_a))
}

/// Deletes `branch` only while it still holds `oid`, what was checked, so that a commit landing after the check, and
/// before the delete, keeps it (`git branch -D` takes whatever it holds then). Never one a worktree has checked out:
/// `update-ref` would leave that worktree's HEAD on a branch that is gone, where `branch -D` refuses.
fn delete_branch_at(root: &Path, branch: &str, oid: &str) -> Result<(), String> {
    let worktrees = git(root, &["worktree", "list", "--porcelain"])?;
    let mut at = "";
    for line in worktrees.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            at = path;
        } else if line.strip_prefix("branch refs/heads/") == Some(branch) {
            return Err(format!("checked out at {at}"));
        }
    }
    git(
        root,
        &["update-ref", "-d", &format!("refs/heads/{branch}"), oid],
    )
    .map(|_| ())
}

/// An agent cleans up after itself once its work is squashed into the mission's: its worktree goes by the mission
/// cleanup's rules (`clear_alone`, never losing work: what it left uncommitted is committed on its branch first, its
/// ignored files nothing makes again and its `.env*` moved to the kept folder; a folder a process still holds, commits
/// no branch holds, a merge under way keep it), then its branch, only while its head is still the one its squash took
/// in (`agent.squashed`) or holds the same files: a commit made after the merge, a WIP commit included, keeps it. A
/// squashed branch is no ancestor of the mission's, so git would call it unmerged: it is deleted on that check
/// instead. What is kept is named with why.
pub fn remove_agent(project: &Path, mission: &str, agent: &AgentBranch) -> Result<Cleanup, String> {
    let (root, dir) = locate(project)?;
    let name = format!("{mission}-{}", slug(&agent.name));
    let path = dir.join(&name);
    let branch = format!("dummyplane/{name}");
    let mut done = Cleanup::default();
    if path.exists() {
        // Its branch is checked out there while the worktree stays.
        if !clear_alone(&root, &dir, &path, &branch, &mut done) {
            return Ok(done);
        }
        done.removed.push(name);
    }
    let wip = wip_saved(&done, &branch);
    let Ok(head) = git(
        &root,
        &["rev-parse", "--verify", &format!("{branch}^{{commit}}")],
    ) else {
        return Ok(done);
    };
    match agent.squashed.as_deref() {
        Some(squashed) if same_work(&root, squashed, &head) => {
            match delete_branch_at(&root, &branch, &head) {
                Ok(()) => done.removed.push(branch),
                Err(err) => {
                    // A commit landed since it was read: that, not git's lock error, is why it stays.
                    let moved = git(
                        &root,
                        &["rev-parse", "--verify", &format!("{branch}^{{commit}}")],
                    )
                    .is_ok_and(|now| now != head);
                    let cause = if moved {
                        "commits after its merge".to_string()
                    } else {
                        err.lines().next().unwrap_or_default().trim().to_string()
                    };
                    done.kept.push(format!("{branch} ({cause})"));
                }
            }
        }
        _ => {
            let why = if wip {
                WIP_MESSAGE
            } else {
                "commits after its merge"
            };
            done.kept.push(format!("{branch} ({why})"));
        }
    }
    Ok(done)
}

/// The first line of what git said, trimmed: a reason stays one line.
fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or_default().trim().to_string()
}

/// Whether the folder `cwd` is the worktree at `path` or inside it, whatever the slashes and the case (Windows): a
/// case read apart elsewhere only keeps one more worktree.
fn inside(cwd: &str, path: &Path) -> bool {
    let plain = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    let (cwd, path) = (plain(cwd), plain(&path.to_string_lossy()));
    !path.is_empty() && (cwd == path || cwd.starts_with(&format!("{path}/")))
}

/// Whether the folder `a` (as git or a terminal writes it) is the folder `b`, whatever the slashes and the case.
fn same_folder(a: &str, b: &Path) -> bool {
    let plain = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    plain(a) == plain(&b.to_string_lossy())
}

/// A merge, a rebase, a cherry-pick or a revert under way in the worktree at `path` (an agent that stopped in the
/// middle of resolving a conflict): `git add -A` would stage its conflicts, markers and all, as resolved, and removing
/// the worktree would drop what is under way. One git asked for every name; an error is read as one under way.
fn operation_under_way(path: &Path) -> bool {
    const UNDER_WAY: [&str; 5] = [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
    ];
    let mut args = vec!["rev-parse"];
    for name in UNDER_WAY {
        args.extend(["--git-path", name]);
    }
    match git(path, &args) {
        // git names each from the worktree's folder (relative there in a main checkout), one per line.
        Ok(found) => {
            let lines: Vec<&str> = found.lines().map(str::trim).collect();
            lines.len() != UNDER_WAY.len() || lines.iter().any(|line| path.join(line).exists())
        }
        Err(_) => true,
    }
}

/// `git`, its answer as git wrote it: a status's first entry starts with a space that a trim would take.
fn git_raw(dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = crate::git::command(dir, crate::git::Asked::Unasked)?
        .args(args)
        .output()
        .map_err(|err| format!("git not found: {err}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// What a cleanup reads of a worktree's files, once: every change, untracked files one by one (an `.env*` is told
/// apart wherever it is), and the ignored ones as they match a pattern, an ignored folder as one entry that git does
/// not walk into: a `node_modules` costs nothing to read (`--ignored` alone walks it, seconds on Windows).
fn status_of(path: &Path) -> Result<String, String> {
    git_raw(
        path,
        &[
            "status",
            "--porcelain",
            "-z",
            "--ignored=matching",
            "--untracked-files=all",
        ],
    )
}

/// The entries of a `status --porcelain -z`: their two letters and their path, a rename's or a copy's former path
/// (the field after it) left out.
fn status_entries(status: &str) -> Vec<(&str, &str)> {
    let mut entries = Vec::new();
    let mut fields = status.split('\0');
    while let Some(field) = fields.next() {
        let (Some(xy), Some(path)) = (field.get(..2), field.get(3..)) else {
            continue;
        };
        if xy.contains('R') || xy.contains('C') {
            fields.next();
        }
        entries.push((xy, path));
    }
    entries
}

/// The pathspec that leaves every `.env*` out of what a WIP commit stages, at any depth, whatever its case: a secret is
/// never committed, even one `.gitignore` does not name. The cleanup moves them to the kept folder instead.
const NO_ENV: &str = ":(exclude,glob,icase)**/.env*";

/// Whether `path` (as git names it) is an `.env*` file: `.env`, `.env.local`, `.env.example`, `.envrc`.
fn env_file(path: &str) -> bool {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .starts_with(".env")
}

/// What is kept under the ignored folder `dir` (relative to the worktree, ending in `/`): each entry that is not what a
/// build makes again (`disposable_path`) nor a copy of the user's own (the same bytes in their checkout `root`); the
/// folder itself when nothing in it goes. A link (a symbolic link, a junction) is kept as a link, never followed; a
/// folder that cannot be read is kept whole.
fn keepers_under(worktree: &Path, root: &Path, dir: &str) -> Vec<String> {
    let whole = || vec![dir.to_string()];
    let Ok(entries) = std::fs::read_dir(worktree.join(dir)) else {
        return whole();
    };
    let mut kept = Vec::new();
    let mut all = true;
    for entry in entries {
        let Ok(entry) = entry else {
            return whole();
        };
        let child = format!("{dir}{}", entry.file_name().to_string_lossy());
        if disposable_path(&child) {
            all = false;
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            return whole();
        };
        // A junction is a link here, not a folder (std reads reparse points as links on Windows).
        if kind.is_dir() {
            let inner = keepers_under(worktree, root, &format!("{child}/"));
            if inner.len() != 1 || inner[0] != format!("{child}/") {
                all = false;
            }
            kept.extend(inner);
        } else if kind.is_file() && same_bytes(&entry.path(), &root.join(&child)) {
            all = false;
        } else {
            kept.push(child);
        }
    }
    if all { whole() } else { kept }
}

/// What a cleanup does with a worktree, from its status (`status_of`).
#[derive(Debug, Default)]
struct Inventory {
    /// A change a WIP commit takes: any but an `.env*`'s, or a repository of its own inside it.
    wip: bool,
    /// The first such change: what keeps the worktree when one is still there after its WIP commit.
    left: Option<String>,
    /// The `.env*` files already staged: the WIP commit backs them out of the index first.
    staged_env: Vec<String>,
    /// What goes to the kept folder, relative (a folder moved whole ends in `/`): the ignored files nothing makes
    /// again and no copy of the user's own, the `.env*` no commit takes, a repository of its own nested inside.
    keep: Vec<String>,
    /// What of `keep` git does not ignore: the WIP commit leaves it out.
    unignored: Vec<String>,
}

fn inventory(status: &str, root: &Path, path: &Path) -> Inventory {
    let mut found = Inventory::default();
    for (xy, entry) in status_entries(status) {
        if xy == "!!" {
            if disposable_path(entry) {
                continue;
            }
            // A link (a symbolic link, a junction) is kept as a link, never walked: what it points to is not the
            // worktree's, and a rename moves the link alone.
            let link = std::fs::symlink_metadata(path.join(entry.trim_end_matches('/')))
                .is_ok_and(|meta| meta.file_type().is_symlink());
            if link {
                found.keep.push(entry.to_string());
            } else if entry.ends_with('/') {
                found.keep.extend(keepers_under(path, root, entry));
            } else if !same_bytes(&path.join(entry), &root.join(entry)) {
                found.keep.push(entry.to_string());
            }
            continue;
        }
        // Untracked files come one by one: a folder is a repository of its own, which a commit would only point to.
        let nested = xy == "??" && entry.ends_with('/');
        if env_file(entry) || nested {
            if !matches!(xy.as_bytes()[0], b' ' | b'?') {
                found.staged_env.push(entry.to_string());
            }
            // One deleted is in its branch's history.
            if std::fs::symlink_metadata(path.join(entry.trim_end_matches('/'))).is_ok() {
                found.keep.push(entry.to_string());
                found.unignored.push(entry.to_string());
            }
            continue;
        }
        found.wip = true;
        found.left.get_or_insert_with(|| entry.to_string());
    }
    found
}

/// Commits the uncommitted work of the worktree at `path` on its own branch `branch`, as `WIP_MESSAGE`: untracked
/// files included, ignored ones left out (`git add -A`), and never an `.env*` (`NO_ENV`; one the agent staged is backed
/// out of the index first) nor what `found` keeps aside; with the user's identity, no hook of the repository, no
/// signing (nobody is there to answer a prompt) and no `gc` started. Its short sha, none when nothing but what is kept
/// aside had changed; or why not, its files as they were. Never on a branch dummyPlane did not make for it, a detached
/// HEAD or a merge under way.
fn save_wip(path: &Path, branch: &str, found: &Inventory) -> Result<Option<String>, String> {
    if current_branch(path).as_deref() != Some(branch) {
        return Err(format!("its worktree is not on {branch}"));
    }
    if operation_under_way(path) {
        return Err("a merge or a rebase is under way there".to_string());
    }
    crate::git::writable(path)?;
    let undo = || {
        // Staged by the add only: the files stay as they are, and the worktree with them.
        let _ = squash_git(path, &["reset", "-q"], None);
    };
    if !found.staged_env.is_empty() {
        let mut unstage = vec!["reset", "-q", "--"];
        unstage.extend(found.staged_env.iter().map(String::as_str));
        squash_git(path, &unstage, None).map_err(|err| first_line(&err))?;
    }
    let aside: Vec<String> = found
        .unignored
        .iter()
        .map(|entry| format!(":(exclude,literal){entry}"))
        .collect();
    let mut add = vec!["add", "-A", "--", ".", NO_ENV];
    add.extend(aside.iter().map(String::as_str));
    let staged = squash_git(path, &add, None)
        .and_then(|_| squash_git(path, &["diff", "--cached", "--name-only", "-z"], None));
    let staged = match staged {
        Ok(staged) => staged,
        Err(err) => {
            undo();
            return Err(first_line(&err));
        }
    };
    let names: Vec<&str> = staged.split('\0').filter(|n| !n.is_empty()).collect();
    // Checked on what git staged, not on what was asked of it.
    if names.iter().any(|name| env_file(name)) {
        undo();
        return Err("an .env file would have gone into its commit".to_string());
    }
    if names.is_empty() {
        return Ok(None);
    }
    let commit = [
        "-c",
        "gc.auto=0",
        "commit",
        "-q",
        "--no-verify",
        "--no-gpg-sign",
        "--cleanup=whitespace",
        "-F",
        "-",
    ];
    if let Err(err) = squash_git(path, &commit, Some(WIP_MESSAGE)) {
        undo();
        return Err(first_line(&err));
    }
    git(path, &["rev-parse", "--short", "HEAD"]).map(Some)
}

/// The folder where the worktree `name` keeps `keep`: `.kept\<name>` beside the worktrees, or `.kept\<name>-2`… when
/// one of them is there already (a cleanup an app quit stopped is taken up where it was, into the same folder): nothing
/// kept is ever overwritten.
fn kept_folder(dir: &Path, name: &str, keep: &[String]) -> PathBuf {
    let base = dir.join(KEPT_FOLDER);
    (1..)
        .map(|n| {
            if n == 1 {
                base.join(name)
            } else {
                base.join(format!("{name}-{n}"))
            }
        })
        .find(|folder| {
            keep.iter().all(|rel| {
                std::fs::symlink_metadata(folder.join(rel.trim_end_matches('/'))).is_err()
            })
        })
        .expect("a folder no kept file is in")
}

/// Moves `keep` out of the worktree at `path` into `folder`, each at its place there: a rename, on the same disk,
/// nothing copied and nothing left halfway. What was moved; and, when one could not be, why, the others staying where
/// they are. Then checks that each one moved is in `folder` and no longer in the worktree.
fn move_keepers(path: &Path, folder: &Path, keep: &[String]) -> (Vec<String>, Option<String>) {
    let mut moved = Vec::new();
    for entry in keep {
        let rel = entry.trim_end_matches('/');
        let (from, to) = (path.join(rel), folder.join(rel));
        let made = to.parent().map_or(Ok(()), std::fs::create_dir_all);
        if let Err(err) = made.and_then(|()| std::fs::rename(&from, &to)) {
            let shown = folder.display();
            return (
                moved,
                Some(format!("{entry} could not be moved to {shown}: {err}")),
            );
        }
        moved.push(entry.clone());
    }
    let astray = moved.iter().find(|entry| {
        let rel = entry.trim_end_matches('/');
        let there = std::fs::symlink_metadata(folder.join(rel)).is_ok();
        let still = std::fs::symlink_metadata(path.join(rel)).is_ok();
        !there || still
    });
    let failed = astray.map(|entry| format!("{entry} is not where it was moved"));
    (moved, failed)
}

/// Takes the worktree `name` at `path` away for deletion: its folder renamed whole into `.trash` beside the worktrees
/// (at once: a process that holds a file in it refuses the rename, and the worktree stays as it was, never half
/// deleted). Where it went, to delete once git's record of it is dropped (`forget`).
fn take_away(dir: &Path, name: &str, path: &Path) -> Result<PathBuf, String> {
    let trash = dir.join(TRASH_FOLDER);
    std::fs::create_dir_all(&trash).map_err(|err| format!("no {TRASH_FOLDER} folder: {err}"))?;
    let to = (1..)
        .map(|n| {
            if n == 1 {
                trash.join(name)
            } else {
                trash.join(format!("{name}-{n}"))
            }
        })
        .find(|to| std::fs::symlink_metadata(to).is_err())
        .expect("a free name in the trash");
    std::fs::rename(path, &to).map_err(|err| {
        format!("its folder could not be moved away, a program may hold a file in it: {err}")
    })?;
    Ok(to)
}

/// Drops git's record of the worktree whose folder was at `path`, now gone: `worktree remove` of a folder that is gone
/// drops that one alone, where a `prune` would drop every other one too. One at a time: two at once race in git's list.
/// Once more after a failure. Listed still, its branch reads as checked out and stays; the clean-up of leftovers drops it.
fn forget(root: &Path, path: &Path) -> Result<(), String> {
    let shown = path.to_string_lossy();
    git(root, &["worktree", "remove", &shown])
        .or_else(|_| git(root, &["worktree", "remove", &shown]))
        .map(|_| ())
}

/// Deletes the worktree folders `trash` took away, all at once (`in_parallel`): what takes long, a `node_modules`'s
/// thousands of files. A link (pnpm's junctions) goes as a link, never followed (std's `remove_dir_all`), and a path
/// past Windows' 260 characters is reached all the same (std's long paths). What a process still holds stays in
/// `.trash`, its work saved already: the clean-up of leftovers deletes it.
fn delete_trash(trash: &[PathBuf]) {
    for (folder, deleted) in trash
        .iter()
        .zip(in_parallel(trash, |folder| std::fs::remove_dir_all(folder)))
    {
        if let Err(err) = deleted {
            log::warn!("mission: {} not deleted yet: {err}", folder.display());
        }
    }
}

/// The worktrees a cleanup works on now, by folder: a second cleanup of the same ones (a second call while the first
/// runs, the leftovers' while a mission's runs) never starts on them.
static CLEANING: std::sync::LazyLock<Mutex<std::collections::HashSet<String>>> =
    std::sync::LazyLock::new(Default::default);

/// What a cleanup already under way answers.
pub const CLEANUP_UNDER_WAY: &str =
    "A clean-up of these worktrees is already under way: its result comes when it ends.";

/// Worktree folders held by a cleanup until it is dropped.
struct Claim(Vec<String>);

impl Drop for Claim {
    fn drop(&mut self) {
        let mut held = crate::sync::lock(&CLEANING);
        for key in &self.0 {
            held.remove(key);
        }
    }
}

/// Holds every one of `paths`, or none when one is held already.
fn claim(paths: &[PathBuf]) -> Option<Claim> {
    let keys: Vec<String> = paths
        .iter()
        .map(|path| {
            path.to_string_lossy()
                .replace('\\', "/")
                .trim_end_matches('/')
                .to_lowercase()
        })
        .collect();
    let mut held = crate::sync::lock(&CLEANING);
    if keys.iter().any(|key| held.contains(key)) {
        return None;
    }
    held.extend(keys.iter().cloned());
    Some(Claim(keys))
}

/// A worktree as `git worktree list --porcelain` lists it.
struct Listed {
    path: String,
    /// Its branch's short name; none on a detached HEAD.
    branch: Option<String>,
    locked: bool,
    /// Its folder is gone.
    prunable: bool,
}

fn listed_worktrees(root: &Path) -> Result<Vec<Listed>, String> {
    let list = git(root, &["worktree", "list", "--porcelain"])?;
    let mut listed: Vec<Listed> = Vec::new();
    for line in list.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            listed.push(Listed {
                path: path.to_string(),
                branch: None,
                locked: false,
                prunable: false,
            });
        } else if let Some(last) = listed.last_mut() {
            if let Some(branch) = line.strip_prefix("branch refs/heads/") {
                last.branch = Some(branch.to_string());
            } else if line == "locked" || line.starts_with("locked ") {
                last.locked = true;
            } else if line == "prunable" || line.starts_with("prunable ") {
                last.prunable = true;
            }
        }
    }
    Ok(listed)
}

/// What the cleanup reads of a worktree before it writes anything: whether its HEAD stands on commits no branch holds,
/// whether a merge or a rebase is under way there, and its status (`status_of`), or why it could not be read. A read
/// touches only its own worktree: every one is read at once (`in_parallel`).
struct WorktreeRead {
    on_no_branch: bool,
    under_way: bool,
    status: Result<String, String>,
}

fn read_worktree(path: &Path) -> Option<WorktreeRead> {
    if !path.exists() {
        return None;
    }
    Some(WorktreeRead {
        on_no_branch: on_no_branch(path).unwrap_or(true),
        under_way: operation_under_way(path),
        status: status_of(path),
    })
}

/// Why the worktree at `path` stays as it is, before anything is written: a terminal left open has its folder in it
/// (`open`), `git worktree lock` locked it (`locked`), its HEAD stands on commits no branch holds, a merge or a rebase
/// is under way there, or its status could not be read. None when it may go.
fn why_kept(
    path: &Path,
    read: &WorktreeRead,
    open: &[HeldOpen],
    locked: &[String],
) -> Option<String> {
    if let Some(held) = open.iter().find(|held| inside(&held.path, path)) {
        return Some(held.why.clone());
    }
    if locked.iter().any(|folder| same_folder(folder, path)) {
        return Some("locked by git worktree lock".to_string());
    }
    if read.on_no_branch {
        return Some("commits on no branch".to_string());
    }
    if read.under_way {
        return Some("a merge or a rebase is under way there".to_string());
    }
    read.status.as_ref().err().map(|err| first_line(err))
}

/// What became of one worktree at a cleanup.
#[derive(Debug, Default)]
struct Cleared {
    removed: bool,
    kept: Option<String>,
    saved: Option<String>,
    moved: Option<Moved>,
    /// Its folder, taken away (`take_away`), to delete.
    trash: Option<PathBuf>,
}

/// One worktree at a cleanup, on its own branch `branch`, as `read` found it, never losing work. It stays as it is,
/// named with why, for what `why_kept` names. Else: (1) its uncommitted work is committed on its branch (`save_wip`,
/// never an `.env*`; one it cannot save keeps it); (2) what nothing makes again of its ignored files, and its `.env*`,
/// move to the kept folder beside the worktrees (`move_keepers`); (3) its status is read again: a change or a file to
/// keep found then (a process at work there) keeps it; (4) only then it is taken away (`take_away`), to delete.
fn clear_worktree(
    root: &Path,
    dir: &Path,
    name: &str,
    branch: &str,
    read: &WorktreeRead,
    open: &[HeldOpen],
    locked: &[String],
) -> Cleared {
    let path = dir.join(name);
    let mut done = Cleared::default();
    let kept = |done: &mut Cleared, why: String| done.kept = Some(format!("{name} ({why})"));
    if let Some(why) = why_kept(&path, read, open, locked) {
        kept(&mut done, why);
        return done;
    }
    let status = read.status.as_deref().unwrap_or_default();
    let found = inventory(status, root, &path);
    if found.wip {
        match save_wip(&path, branch, &found) {
            Ok(sha) => done.saved = sha.map(|sha| format!("{branch} ({sha})")),
            Err(why) => {
                kept(&mut done, format!("uncommitted changes, not saved: {why}"));
                return done;
            }
        }
    }
    if !found.keep.is_empty() {
        let folder = kept_folder(dir, name, &found.keep);
        let (moved, failed) = move_keepers(&path, &folder, &found.keep);
        if !moved.is_empty() {
            done.moved = Some(Moved {
                worktree: name.to_string(),
                folder: folder.to_string_lossy().into_owned(),
                files: moved.iter().take(MOVED_NAMED).cloned().collect(),
                count: moved.len(),
            });
        }
        if let Some(why) = failed {
            kept(&mut done, why);
            return done;
        }
    }
    match status_of(&path).map(|status| inventory(&status, root, &path)) {
        Ok(after) if !after.wip && after.keep.is_empty() => {}
        Ok(after) => {
            let what = after.left.or_else(|| after.keep.first().cloned());
            kept(
                &mut done,
                format!("changed during the clean-up: {}", what.unwrap_or_default()),
            );
            return done;
        }
        Err(err) => {
            kept(&mut done, first_line(&err));
            return done;
        }
    }
    match take_away(dir, name, &path) {
        Ok(trash) => {
            done.removed = true;
            done.trash = Some(trash);
        }
        Err(why) => kept(&mut done, why),
    }
    done
}

/// Every worktree in `jobs` (its name, its branch, what was read of it) cleared at once (`clear_worktree`: each writes
/// only in its own worktree and on its own branch), told in `done` in their order; then the folders taken away deleted.
fn clear_worktrees(
    root: &Path,
    dir: &Path,
    jobs: &[(String, String, WorktreeRead)],
    open: &[HeldOpen],
    done: &mut Cleanup,
) -> Vec<PathBuf> {
    let locked: Vec<String> = listed_worktrees(root)
        .map(|listed| {
            listed
                .into_iter()
                .filter(|l| l.locked)
                .map(|l| l.path)
                .collect()
        })
        .unwrap_or_default();
    let cleared = in_parallel(jobs, |(name, branch, read)| {
        clear_worktree(root, dir, name, branch, read, open, &locked)
    });
    let mut trash = Vec::new();
    for ((name, _, _), cleared) in jobs.iter().zip(cleared) {
        if cleared.removed {
            if let Err(err) = forget(root, &dir.join(name)) {
                log::warn!("mission: git's record of {name} stays: {err}");
            }
            done.removed.push(name.clone());
        }
        done.kept.extend(cleared.kept);
        done.saved.extend(cleared.saved);
        done.moved.extend(cleared.moved);
        trash.extend(cleared.trash);
    }
    trash
}

/// A branch of the mission once judged: deleted when `why` is none (only while it still holds `head`), else kept,
/// named with why.
fn settle_branch(root: &Path, branch: String, head: &str, why: Option<String>, done: &mut Cleanup) {
    match why {
        Some(why) => done.kept.push(format!("{branch} ({why})")),
        None => match delete_branch_at(root, &branch, head) {
            Ok(()) => done.removed.push(branch),
            Err(err) => done.kept.push(format!("{branch} ({})", first_line(&err))),
        },
    }
}

/// The mission's branches at its cleanup, read once its worktrees went (a WIP commit keeps a branch): each whose work
/// is all on the user's branch (`base`, else the one their checkout is on) is deleted, the others kept and named with
/// why. An agent's branch is on it when it is an ancestor of it, or when its work is in the mission's branch
/// (`branch_in`, from the heads its squashes took in: a squash is no ancestor) and the mission's branch is an
/// ancestor of the user's (`land` fast-forwards it). Only the branches dummyPlane made for this mission, by their
/// names (`trees`, the agents' worktree and branch names), never the user's branch, never one a worktree has checked
/// out (`delete_branch_at`). Each branch is judged on its own, all at once (`in_parallel`); the deletes go one at a time.
fn clear_branches(
    root: &Path,
    dir: &Path,
    mission: &str,
    agents: &[(&AgentBranch, String, String)],
    base: Option<&str>,
    done: &mut Cleanup,
) {
    let mission_branch = format!("dummyplane/{mission}");
    let target = land_target(root, base).ok();
    let target_head = target.as_deref().and_then(|t| branch_head(root, t).ok());
    let commit_of = |branch: &str| {
        git(
            root,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/{branch}^{{commit}}"),
            ],
        )
        .ok()
    };
    let on_target = |head: &str| {
        target_head
            .as_deref()
            .is_some_and(|t| is_ancestor(root, head, t))
    };
    let mission_head = commit_of(&mission_branch);
    let landed = mission_head.as_deref().is_some_and(on_target);
    let merged = if mission_head.is_some() {
        merged_branches(root, mission).unwrap_or_default()
    } else {
        String::new()
    };
    let merged: Vec<&str> = merged.lines().map(str::trim).collect();
    let squashed: Vec<&str> = agents
        .iter()
        .filter_map(|(agent, _, _)| agent.squashed.as_deref())
        .collect();
    let wip: Vec<String> = done
        .saved
        .iter()
        .filter_map(|s| s.split(" (").next().map(str::to_string))
        .collect();
    let not_on = |what: &str| match target.as_deref() {
        Some(target) => format!("{what} not on {target}"),
        None => "the branch the mission started from is unknown (a detached HEAD)".to_string(),
    };
    // Its head, whether it is on the user's branch, whether its work is in the mission's: reads only.
    let judged = in_parallel(agents, |(agent, _, branch)| {
        if Some(branch.as_str()) == target.as_deref() {
            return None;
        }
        let head = commit_of(branch)?;
        let on_user = on_target(&head);
        let into_mission = branch_in(root, branch, agent.squashed.as_deref(), &merged, &squashed);
        Some((head, on_user, into_mission))
    });
    for ((_, name, branch), judged) in agents.iter().zip(judged) {
        let Some((head, on_user, into_mission)) = judged else {
            continue;
        };
        let why = if dir.join(name).exists() {
            Some(format!("its worktree {name} stays"))
        } else if on_user || (landed && into_mission) {
            None
        } else if wip.contains(branch) {
            Some(WIP_MESSAGE.to_string())
        } else if !into_mission {
            Some("not merged into the mission's branch".to_string())
        } else {
            Some(not_on("in the mission's branch,"))
        };
        settle_branch(root, branch.clone(), &head, why, done);
    }
    let Some(head) = mission_head else {
        return;
    };
    if Some(mission_branch.as_str()) == target.as_deref() {
        return;
    }
    let why = if dir.join(mission).exists() {
        Some(format!("its worktree {mission} stays"))
    } else if landed {
        None
    } else if wip.contains(&mission_branch) {
        Some(WIP_MESSAGE.to_string())
    } else {
        let count = target
            .as_deref()
            .and_then(|t| {
                git(
                    root,
                    &["rev-list", "--count", &format!("refs/heads/{t}..{head}")],
                )
                .ok()
            })
            .and_then(|count| count.parse::<usize>().ok())
            .unwrap_or(0);
        Some(not_on(&match count {
            1 => "1 commit".to_string(),
            n => format!("{n} commits"),
        }))
    };
    settle_branch(root, mission_branch, &head, why, done);
}

/// "Clean up the mission", which never loses work. Each worktree of the mission, its agents' (`agents`) then its own,
/// goes (`clear_worktree`): its uncommitted work committed first on its own branch (never an `.env*`), what nothing
/// makes again of its ignored files moved to `<project>.worktrees\.kept\<worktree>`, its status read again, then its
/// folder taken away and deleted; unless a terminal left open is in it (`open`), it is locked, its HEAD stands on
/// commits no branch holds or a merge or a rebase is under way there: then it stays, named with why. Then each of the
/// mission's branches whose work is all on the user's branch is deleted, the others kept and named with why
/// (`clear_branches`): once the mission is landed, the user's folder is left with their own branches. Every worktree is
/// read, then cleared, at once (each writes only in its own); the branches are judged after every WIP commit. A second
/// cleanup of the same worktrees while this one runs is refused (`CLEANUP_UNDER_WAY`).
pub fn cleanup(
    project: &Path,
    mission: &str,
    agents: &[AgentBranch],
    base: Option<&str>,
    open: &[HeldOpen],
) -> Result<Cleanup, String> {
    let (root, dir) = locate(project)?;
    let mut done = Cleanup::default();
    // Each agent's worktree and branch, once: two agents may name the same (a hand-over keeps the first's).
    let mut seen = std::collections::HashSet::new();
    let trees: Vec<(&AgentBranch, String, String)> = agents
        .iter()
        .filter_map(|agent| {
            let name = format!("{mission}-{}", slug(&agent.name));
            let branch = format!("dummyplane/{name}");
            seen.insert(name.clone()).then_some((agent, name, branch))
        })
        .collect();
    let mut worktrees: Vec<(String, String)> = trees
        .iter()
        .map(|(_, name, branch)| (name.clone(), branch.clone()))
        .collect();
    worktrees.push((mission.to_string(), format!("dummyplane/{mission}")));
    let paths: Vec<PathBuf> = worktrees.iter().map(|(name, _)| dir.join(name)).collect();
    let _held = claim(&paths).ok_or_else(|| CLEANUP_UNDER_WAY.to_string())?;
    let reads = in_parallel(&worktrees, |(name, _)| read_worktree(&dir.join(name)));
    let jobs: Vec<(String, String, WorktreeRead)> = worktrees
        .into_iter()
        .zip(reads)
        .filter_map(|((name, branch), read)| read.map(|read| (name, branch, read)))
        .collect();
    let trash = clear_worktrees(&root, &dir, &jobs, open, &mut done);
    clear_branches(&root, &dir, mission, &trees, base, &mut done);
    delete_trash(&trash);
    Ok(done)
}

/// A worktree of a past mission, as the clean-up of leftovers finds it, and what the user's click would do with it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeftoverWorktree {
    pub name: String,
    pub branch: String,
    /// Why it stays as it is; none when it goes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kept: Option<String>,
    /// Its uncommitted work goes into a WIP commit on its branch first.
    pub wip: bool,
    /// What moves to the kept folder before it goes (`MOVED_NAMED` named), and how many in all.
    pub moves: Vec<String>,
    pub move_count: usize,
    /// git lists it, but its folder is gone: only git's record of it goes.
    pub gone: bool,
}

/// A `dummyplane/*` branch of a past mission, as the clean-up of leftovers finds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeftoverBranch {
    pub name: String,
    /// Its head when it was read: the click deletes it only while it is still there.
    pub head: String,
    /// Why it stays; none when it is deleted, its work being on the user's branch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kept: Option<String>,
}

/// What the clean-up of leftovers would do in a project, read without writing anything: the user sees it before
/// their click.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Leftovers {
    /// The user's branch, the one their checkout is on: a branch whose work is on it is deleted. None on a detached
    /// HEAD: every branch stays.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// `<project>.worktrees\.kept`.
    pub kept_folder: String,
    pub worktrees: Vec<LeftoverWorktree>,
    pub branches: Vec<LeftoverBranch>,
    /// Folders a clean-up took away and could not finish deleting (`.trash`): their work was saved, they go.
    pub trash: Vec<String>,
    /// Folders beside the worktrees that git does not list: left as they are, named.
    pub strays: Vec<String>,
}

/// What the user's click on the clean-up of leftovers covers: what the prompt showed them, by name; a branch only at the
/// head it showed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeftoversChosen {
    #[serde(default)]
    pub worktrees: Vec<String>,
    #[serde(default)]
    pub branches: Vec<LeftoverBranch>,
    #[serde(default)]
    pub trash: Vec<String>,
}

/// Whether the worktree or branch name `name` (a branch without its `dummyplane/`) is a live mission's (`live`, their
/// slugs): its own, or one of its agents' (`<slug>-…`). A past mission whose name only starts like a live one's is left
/// too: never a live mission's worktree.
fn live_name(name: &str, live: &[String]) -> bool {
    live.iter()
        .filter(|slug| !slug.is_empty())
        .any(|slug| name == slug || name.starts_with(&format!("{slug}-")))
}

/// A worktree of a past mission found by `survey`, with what was read of it.
struct Found {
    entry: LeftoverWorktree,
    read: Option<WorktreeRead>,
}

/// The leftovers of past missions in the project at `root`, read only: every worktree git lists in `dir`
/// (`<project>.worktrees`) on a `dummyplane/*` branch, every `dummyplane/*` branch, and what each would become, by the
/// mission cleanup's own reads and rules. Never the user's checkout, a worktree outside `dir`, a branch that is not
/// `dummyplane/*`, nor anything of a live mission (`live`). A terminal open in a worktree (`open`) keeps it.
fn survey(
    root: &Path,
    dir: &Path,
    live: &[String],
    open: &[HeldOpen],
) -> Result<(Leftovers, Vec<Found>), String> {
    let listed = listed_worktrees(root)?;
    let locked: Vec<String> = listed
        .iter()
        .filter(|l| l.locked)
        .map(|l| l.path.clone())
        .collect();
    let mine: Vec<(&Listed, String, String)> = listed
        .iter()
        .filter_map(|l| {
            let path = PathBuf::from(&l.path);
            let parent = path.parent()?;
            if !same_folder(&parent.to_string_lossy(), dir) {
                return None;
            }
            let name = path.file_name()?.to_string_lossy().into_owned();
            let branch = l.branch.as_deref()?.strip_prefix("dummyplane/")?;
            if live_name(&name, live) || live_name(branch, live) {
                return None;
            }
            Some((l, name, format!("dummyplane/{branch}")))
        })
        .collect();
    let reads = in_parallel(&mine, |(l, name, _)| {
        if l.prunable {
            None
        } else {
            read_worktree(&dir.join(name))
        }
    });
    let found: Vec<Found> = mine
        .iter()
        .zip(reads)
        .map(|((l, name, branch), read)| {
            let path = dir.join(name);
            let mut entry = LeftoverWorktree {
                name: name.clone(),
                branch: branch.clone(),
                kept: None,
                wip: false,
                moves: Vec::new(),
                move_count: 0,
                gone: read.is_none(),
            };
            if let Some(read) = &read {
                entry.kept = why_kept(&path, read, open, &locked);
                if entry.kept.is_none() {
                    let status = read.status.as_deref().unwrap_or_default();
                    let inv = inventory(status, root, &path);
                    entry.wip = inv.wip;
                    entry.move_count = inv.keep.len();
                    entry.moves = inv.keep.into_iter().take(MOVED_NAMED).collect();
                }
            } else if l.locked {
                entry.kept = Some("locked by git worktree lock".to_string());
            }
            Found { entry, read }
        })
        .collect();
    let target = current_branch(root);
    let target_head = target.as_deref().and_then(|t| branch_head(root, t).ok());
    let refs = git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname:short) %(objectname)",
            "refs/heads/dummyplane/",
        ],
    )?;
    let named: Vec<(String, String)> = refs
        .lines()
        .filter_map(|line| line.split_once(' '))
        .filter(|(name, _)| {
            name.strip_prefix("dummyplane/")
                .is_some_and(|short| !live_name(short, live))
        })
        .map(|(name, head)| (name.to_string(), head.to_string()))
        .collect();
    let on_user = in_parallel(&named, |(_, head)| {
        target_head
            .as_deref()
            .is_some_and(|t| is_ancestor(root, head, t))
    });
    let branches = named
        .into_iter()
        .zip(on_user)
        .map(|((name, head), on_user)| {
            let worktree = found.iter().find(|f| f.entry.branch == name);
            let elsewhere = listed
                .iter()
                .find(|l| l.branch.as_deref() == Some(name.as_str()) && worktree.is_none());
            let kept = if let Some(l) = elsewhere {
                Some(format!("checked out at {}", shown_path(&l.path)))
            } else if let Some(w) = worktree.filter(|w| w.entry.kept.is_some()) {
                Some(format!("its worktree {} stays", w.entry.name))
            } else if worktree.is_some_and(|w| w.entry.wip) {
                Some(format!(
                    "unlanded: its uncommitted work is saved on it first ({WIP_MESSAGE})"
                ))
            } else if on_user {
                None
            } else if let Some(target) = target.as_deref() {
                let count = git(
                    root,
                    &[
                        "rev-list",
                        "--count",
                        &format!("refs/heads/{target}..{head}"),
                    ],
                )
                .ok()
                .and_then(|count| count.parse::<usize>().ok())
                .unwrap_or(0);
                let commits = if count == 1 {
                    "1 commit".to_string()
                } else {
                    format!("{count} commits")
                };
                Some(format!("unlanded: {commits} not on {target}"))
            } else {
                Some(
                    "the user's checkout is on no branch: nothing tells its work is landed"
                        .to_string(),
                )
            };
            LeftoverBranch { name, head, kept }
        })
        .collect();
    let folders = |at: &Path| -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(at) else {
            return Vec::new();
        };
        let mut names: Vec<String> = entries
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    };
    let trash = folders(&dir.join(TRASH_FOLDER));
    let strays = folders(dir)
        .into_iter()
        .filter(|name| !name.starts_with('.') && !live_name(name, live))
        .filter(|name| {
            let path = dir.join(name);
            !listed.iter().any(|l| same_folder(&l.path, &path))
        })
        .collect();
    let leftovers = Leftovers {
        target,
        kept_folder: dir.join(KEPT_FOLDER).to_string_lossy().into_owned(),
        worktrees: found.iter().map(|f| f.entry.clone()).collect(),
        branches,
        trash,
        strays,
    };
    Ok((leftovers, found))
}

/// What "Clean up leftovers" would do in the project, read only: the prompt the user answers shows it. `live`, the slugs
/// of the missions some Fleet still holds; `open`, every terminal's folder.
pub fn leftovers(project: &Path, live: &[String], open: &[HeldOpen]) -> Result<Leftovers, String> {
    let (root, dir) = locate(project)?;
    survey(&root, &dir, live, open).map(|(leftovers, _)| leftovers)
}

/// The user's "Clean up" on the leftovers: what `chosen` names of what the prompt showed, read again now and done by
/// the mission cleanup's own rules, never losing work. Each worktree that may go goes (`clear_worktree`: WIP commit on
/// its own branch, `.env*` and ignored files nothing makes again moved to the kept folder, its status read again, then
/// deleted); a worktree whose folder is gone leaves git's list; what a clean-up left in `.trash` is deleted. Then each
/// branch whose work is on the user's branch is deleted, while it is still at the head shown and no worktree has it.
/// What stays is named with why; anything a live mission (`live`) holds, or another clean-up under way, is left.
pub fn clean_leftovers(
    project: &Path,
    live: &[String],
    open: &[HeldOpen],
    chosen: &LeftoversChosen,
) -> Result<Cleanup, String> {
    let (root, dir) = locate(project)?;
    let (now, found) = survey(&root, &dir, live, open)?;
    let mut done = Cleanup::default();
    let mut claims = Vec::new();
    let mut jobs = Vec::new();
    for Found { entry, read } in found {
        if !chosen.worktrees.contains(&entry.name) {
            continue;
        }
        if let Some(why) = &entry.kept {
            done.kept.push(format!("{} ({why})", entry.name));
            continue;
        }
        let Some(held) = claim(&[dir.join(&entry.name)]) else {
            done.kept.push(format!(
                "{} (a clean-up is already under way there)",
                entry.name
            ));
            continue;
        };
        claims.push(held);
        match read {
            Some(read) => jobs.push((entry.name, entry.branch, read)),
            None => match forget(&root, &dir.join(&entry.name)) {
                Ok(()) => done.removed.push(entry.name),
                Err(err) => done
                    .kept
                    .push(format!("{} ({})", entry.name, first_line(&err))),
            },
        }
    }
    let mut trash = clear_worktrees(&root, &dir, &jobs, open, &mut done);
    for name in now.trash.iter().filter(|name| chosen.trash.contains(name)) {
        done.removed.push(format!("{TRASH_FOLDER}/{name}"));
        trash.push(dir.join(TRASH_FOLDER).join(name));
    }
    for shown in &chosen.branches {
        let Some(branch) = now.branches.iter().find(|b| b.name == shown.name) else {
            continue;
        };
        // Read again after the worktrees went: a WIP commit, or anyone's commit meanwhile, keeps it.
        let current = branch_head(&root, &branch.name).ok();
        let moved = branch.head != shown.head || current.as_deref() != Some(shown.head.as_str());
        let why = branch
            .kept
            .clone()
            .or_else(|| moved.then(|| "it moved since it was shown".to_string()));
        settle_branch(&root, branch.name.clone(), &shown.head, why, &mut done);
    }
    delete_trash(&trash);
    drop(claims);
    Ok(done)
}

/// How many of the commits to land the question names: the others are counted.
const LANDING_SHOWN: usize = 10;

/// What landing a mission brings onto the user's branch, read without touching anything: what the user is asked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Landing {
    /// The user's branch.
    pub target: String,
    /// The mission's branch.
    pub branch: String,
    /// The mission's head: what a Land click brings, never a commit merged after the question.
    pub tip: String,
    /// The newest `LANDING_SHOWN` commits it brings, each "<short sha> <subject>"; `count` counts them all.
    pub commits: Vec<String>,
    pub count: usize,
    /// The user's branch has not moved since: a Land click fast-forwards it.
    pub fast_forward: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LandOutcome {
    /// The user's branch went from `from` to `to`, a fast-forward.
    Landed {
        target: String,
        from: String,
        to: String,
    },
    /// The user's branch has every commit already.
    UpToDate,
    /// The user's checkout of the branch has uncommitted changes in tracked `files`: nothing was touched.
    Dirty {
        checkout: String,
        files: Vec<String>,
    },
    /// The user's branch moved: it is merged into the mission's, in the mission's worktree (`commit`), for the checks to
    /// run there again before the user is asked again.
    Merged { commit: String },
    /// That merge conflicted in `files` and was undone: the mission's worktree is as it was.
    Conflict { files: Vec<String> },
}

/// The user's branch to land on: the one the mission was cut from, else the one their checkout is on.
fn land_target(root: &Path, base: Option<&str>) -> Result<String, String> {
    match base {
        Some(base) if !base.is_empty() => Ok(base.to_string()),
        _ => current_branch(root).ok_or_else(|| {
            "The project's checkout is on no branch (a detached HEAD): there is no branch to land the mission on."
                .to_string()
        }),
    }
}

fn branch_head(root: &Path, branch: &str) -> Result<String, String> {
    git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}^{{commit}}"),
        ],
    )
    .map_err(|_| format!("The branch {branch} no longer exists."))
}

fn is_ancestor(dir: &Path, ancestor: &str, of: &str) -> bool {
    git(dir, &["merge-base", "--is-ancestor", ancestor, of]).is_ok()
}

/// A path as git printed it (forward slashes), as the user reads it on their system.
fn shown_path(path: &str) -> String {
    if cfg!(windows) {
        path.replace('/', "\\")
    } else {
        path.to_string()
    }
}

/// The worktree that has `branch` checked out, if any: the user's checkout of it.
fn checkout_of(root: &Path, branch: &str) -> Result<Option<String>, String> {
    let worktrees = git(root, &["worktree", "list", "--porcelain"])?;
    let mut at = "";
    for line in worktrees.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            at = path;
        } else if line.strip_prefix("branch refs/heads/") == Some(branch) {
            return Ok(Some(at.to_string()));
        }
    }
    Ok(None)
}

/// The tracked files of `dir` that differ from its HEAD, staged or not. Untracked files are not counted: a
/// fast-forward leaves them where they are, and git itself refuses one that would overwrite one.
fn tracked_changes(dir: &Path) -> Result<Vec<String>, String> {
    Ok(git(dir, &["diff", "--name-only", "HEAD"])?
        .lines()
        .map(str::to_string)
        .collect())
}

/// What `land` would bring onto the user's branch (`base`, else the branch their checkout is on): the head of the
/// mission's worktree `mission`, and the commits the user's branch lacks. Read-only: this is what the user is asked.
pub fn landing(project: &Path, mission: &Path, base: Option<&str>) -> Result<Landing, String> {
    let (root, _) = locate(project)?;
    let target = land_target(&root, base)?;
    let from = branch_head(&root, &target)?;
    let tip = git(mission, &["rev-parse", "--verify", "HEAD^{commit}"])?;
    let branch = current_branch(mission).unwrap_or_else(|| tip.clone());
    let range = format!("{from}..{tip}");
    let count = git(mission, &["rev-list", "--count", &range])?
        .parse::<usize>()
        .unwrap_or(0);
    let commits = git(
        mission,
        &[
            "log",
            &format!("--max-count={LANDING_SHOWN}"),
            "--format=%h %s",
            &range,
        ],
    )?
    .lines()
    .map(str::to_string)
    .collect();
    Ok(Landing {
        fast_forward: is_ancestor(mission, &from, &tip),
        target,
        branch,
        tip,
        commits,
        count,
    })
}

/// Lands a mission, on the user's own click in dummyPlane, never an agent's call: `tip`, the mission's head the user was
/// shown, comes onto `target`, their branch, as a fast-forward. Where `target` is checked out (their checkout), only
/// with no uncommitted change in a tracked file: nothing here stashes, resets or otherwise touches their work, it is
/// refused instead. Checked out nowhere, the branch alone moves, from the head read here only. When `target` moved and
/// holds commits `tip` lacks, nothing lands: `target` is merged into the mission's branch, in its worktree `mission`,
/// for its checks to run there again before the user is asked again. Never a push, never a remote.
pub fn land(
    project: &Path,
    mission: &Path,
    target: &str,
    tip: &str,
) -> Result<LandOutcome, String> {
    let (root, _) = locate(project)?;
    let from = branch_head(&root, target)?;
    let tip = git(
        &root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{tip}^{{commit}}"),
        ],
    )
    .map_err(|_| format!("The commit {tip} the user was shown no longer exists: ask again."))?;
    if is_ancestor(&root, &tip, &from) {
        return Ok(LandOutcome::UpToDate);
    }
    if !is_ancestor(&root, &from, &tip) {
        return merge_target(mission, target, &from);
    }
    let landed = |from: String| LandOutcome::Landed {
        target: target.to_string(),
        from,
        to: tip.clone(),
    };
    let Some(checkout) = checkout_of(&root, target)? else {
        let reference = format!("refs/heads/{target}");
        let reason = format!("dummyPlane: land {tip}");
        git(
            &root,
            &["update-ref", "-m", &reason, &reference, &tip, &from],
        )?;
        return Ok(landed(from));
    };
    let dir = Path::new(&checkout);
    crate::git::writable(dir)?;
    let files = tracked_changes(dir)?;
    if !files.is_empty() {
        return Ok(LandOutcome::Dirty {
            checkout: shown_path(&checkout),
            files,
        });
    }
    // git takes an ignored file as expendable and overwrites it unasked: a user's `.env` is not.
    git(
        dir,
        &[
            "merge",
            "--ff-only",
            "--no-overwrite-ignore",
            "--quiet",
            &tip,
        ],
    )?;
    Ok(landed(from))
}

/// `target` moved since the mission's branch was cut from it: merged into the mission's, in its worktree, by a merge
/// commit that keeps both histories, so that the next land is a fast-forward. A conflict is undone and named, for an
/// agent to make that merge again there and resolve it.
fn merge_target(mission: &Path, target: &str, head: &str) -> Result<LandOutcome, String> {
    crate::git::writable(mission)?;
    let changed = tracked_changes(mission)?;
    if !changed.is_empty() {
        let names: Vec<&str> = changed.iter().take(3).map(String::as_str).collect();
        return Err(format!(
            "{target} moved since the mission started, and the mission's worktree has uncommitted changes ({}): commit them there, then land again.",
            names.join(", ")
        ));
    }
    let branch = current_branch(mission).unwrap_or_else(|| "the mission's branch".to_string());
    let message = format!("Merge {target} into {branch}");
    let Err(err) = git(
        mission,
        &["merge", "--no-ff", "--no-edit", "-m", &message, head],
    ) else {
        let commit = git(mission, &["rev-parse", "--short", "HEAD"])?;
        return Ok(LandOutcome::Merged { commit });
    };
    let files: Vec<String> = git(mission, &["diff", "--name-only", "--diff-filter=U"])
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect();
    // A merge that stopped before it began (an untracked file in the way) has nothing to abort.
    // git names it from the worktree's folder (relative there in a main checkout).
    let merging = mission
        .join(git(mission, &["rev-parse", "--git-path", "MERGE_HEAD"])?)
        .exists();
    let undone = if merging || !files.is_empty() {
        git(mission, &["merge", "--abort"]).map(|_| ())
    } else {
        Ok(())
    };
    match (files.is_empty(), undone) {
        (false, Ok(())) => Ok(LandOutcome::Conflict { files }),
        (false, Err(left)) => Err(format!(
            "Merging {target} into {branch} conflicted in {}, and could not be undone: {left}",
            files.join(", ")
        )),
        (true, Ok(())) => Err(format!("Merging {target} into {branch} failed: {err}")),
        (true, Err(left)) => Err(format!(
            "Merging {target} into {branch} failed: {err}\nIt could not be undone: {left}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    fn run(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn commit(dir: &Path, file: &str, content: &str, message: &str) {
        std::fs::write(dir.join(file), content).unwrap();
        run(dir, &["add", file]);
        run(dir, &["commit", "-q", "-m", message]);
    }

    /// A repository `proj` with one commit on `main`, inside a temporary parent folder.
    fn project() -> Option<(tempfile::TempDir, PathBuf)> {
        if Command::new("git").arg("--version").output().is_err() {
            return None; // git is not installed on this machine
        }
        let parent = tempfile::tempdir().unwrap();
        let proj = parent.path().join("proj");
        std::fs::create_dir(&proj).unwrap();
        run(&proj, &["init", "-q", "-b", "main"]);
        for (key, value) in [
            ("user.name", "t"),
            ("user.email", "t@t"),
            ("commit.gpgsign", "false"),
            ("core.autocrlf", "false"),
        ] {
            run(&proj, &["config", key, value]);
        }
        commit(&proj, "a.txt", "a\n", "init");
        Some((parent, proj))
    }

    /// `project()` before its first commit.
    fn repo_without_commit() -> Option<(tempfile::TempDir, PathBuf)> {
        if Command::new("git").arg("--version").output().is_err() {
            return None;
        }
        let parent = tempfile::tempdir().unwrap();
        let proj = parent.path().join("proj");
        std::fs::create_dir(&proj).unwrap();
        run(&proj, &["init", "-q", "-b", "main"]);
        Some((parent, proj))
    }

    #[test]
    fn a_repository_without_a_commit_is_told_so() {
        let Some((_parent, proj)) = repo_without_commit() else {
            return;
        };
        assert_eq!(
            prepare(&proj, "auth").unwrap_err(),
            "The repository has no commit yet: make a first commit, then launch the mission again."
        );
    }

    fn same(a: impl AsRef<Path>, b: impl AsRef<Path>) -> bool {
        std::fs::canonicalize(a).unwrap() == std::fs::canonicalize(b).unwrap()
    }

    #[test]
    fn slugs_are_safe_for_branches_and_folders() {
        assert_eq!(
            slug("Ajoute l'Authentification !"),
            "ajoute-l-authentification"
        );
        assert_eq!(slug("Zoë 2"), "zoe-2");
        assert_eq!(slug("Œuvre complète"), "oeuvre-complete");
        assert_eq!(slug("Ōkuninushi"), "okuninushi");
        assert_eq!(slug("  --  "), "mission");
        let long = slug(&"a b ".repeat(30));
        assert!(long.len() <= 40 && !long.ends_with('-'), "{long}");
    }

    #[test]
    fn prepares_the_mission_branch_and_worktree_beside_the_project() {
        let Some((parent, proj)) = project() else {
            return;
        };
        let tree = prepare(&proj, "Ajoute l'Authentification").unwrap();
        assert_eq!(tree.slug, "ajoute-l-authentification");
        assert_eq!(tree.branch, "dummyplane/ajoute-l-authentification");
        assert!(same(
            &tree.path,
            parent
                .path()
                .join("proj.worktrees")
                .join("ajoute-l-authentification")
        ));
        assert!(Path::new(&tree.path).join("a.txt").exists());
        assert_eq!(
            run(Path::new(&tree.path), &["branch", "--show-current"]),
            tree.branch
        );
        // The user's folder is untouched: same branch, nothing to commit.
        assert_eq!(run(&proj, &["branch", "--show-current"]), "main");
        assert_eq!(run(&proj, &["status", "--porcelain"]), "");
    }

    #[test]
    fn refuses_a_mission_that_exists_or_a_folder_outside_git() {
        let Some((parent, proj)) = project() else {
            return;
        };
        prepare(&proj, "auth").unwrap();
        assert!(
            prepare(&proj, "auth")
                .unwrap_err()
                .contains("already exists")
        );
        let plain = parent.path().join("plain");
        std::fs::create_dir(&plain).unwrap();
        assert_eq!(
            prepare(&plain, "auth").unwrap_err(),
            format!("The folder {} is not a git repository.", plain.display())
        );
    }

    #[test]
    fn gives_each_agent_a_branch_from_the_missions() {
        let Some((parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        commit(Path::new(&mission.path), "m.txt", "m\n", "mission base");
        let agent = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        assert_eq!(agent.slug, "auth-hulk");
        assert_eq!(agent.branch, "dummyplane/auth-hulk");
        assert!(same(
            &agent.path,
            parent.path().join("proj.worktrees").join("auth-hulk")
        ));
        assert!(Path::new(&agent.path).join("m.txt").exists());
    }

    /// A mission checks its worktrees out and merges them: in a repository whose own config defines a filter, which
    /// dummyPlane's git does not run, it would write what the filter would have changed (git-crypt's cipher, LFS
    /// pointers). It does not start.
    #[test]
    fn refuses_a_mission_in_a_repository_with_a_filter_of_its_own() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        run(
            &proj,
            &["config", "filter.crypt.clean", "sed s/plain/CIPHER/"],
        );
        let err = prepare(&proj, "auth").unwrap_err();
        assert!(err.contains("crypt"), "{err}");
        assert_eq!(run(&proj, &["branch", "--list", "dummyplane/*"]), "");
    }

    /// A Manager merges its agents' work through the night: a merge driver the repository's own config defines,
    /// given to a file by `.gitattributes`, never runs (the file is left as a conflict instead).
    #[test]
    fn merging_runs_no_merge_driver_the_repository_defines() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        commit(Path::new(&hulk.path), "a.txt", "a\nhulk\n", "hulk");
        let m = Path::new(&mission.path);
        commit(m, "a.txt", "mission\na\n", "mission");
        run(
            &proj,
            &[
                "config",
                "merge.z.driver",
                "sh -c 'echo ran > merge-ran; exit 0'",
            ],
        );
        std::fs::write(m.join(".gitattributes"), "a.txt merge=z\n").unwrap();
        let _ = merge_agent(
            m,
            Path::new(&hulk.path),
            &hulk.branch,
            "Hulk's sub-task",
            None,
        );
        assert!(
            !m.join("merge-ran").exists(),
            "the merge ran the driver the repository's own config defines"
        );
    }

    /// A mission's worktrees share the repository's config: a program it names for git to run as it reads a status
    /// (`core.fsmonitor`) never runs when a Manager merges an agent's work.
    #[test]
    fn merging_runs_no_program_the_repository_names() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        run(
            &proj,
            &["config", "core.fsmonitor", "echo ran > fsmonitor-ran"],
        );
        std::fs::write(Path::new(&hulk.path).join("draft.txt"), "x").unwrap();
        squash(Path::new(&mission.path), &hulk);
        for tree in [&mission.path, &hulk.path] {
            assert!(
                !Path::new(tree).join("fsmonitor-ran").exists(),
                "git ran the program the repository's core.fsmonitor names, in {tree}"
            );
        }
    }

    /// An agent's work squashed into the mission, under a message of its own.
    fn squash(m: &Path, agent: &Worktree) -> MergeReport {
        merge_agent(
            m,
            Path::new(&agent.path),
            &agent.branch,
            "An agent's sub-task",
            None,
        )
        .unwrap()
    }

    fn agent(name: &str, squashed: Option<&str>) -> AgentBranch {
        AgentBranch {
            name: name.into(),
            squashed: squashed.map(str::to_string),
        }
    }

    fn read(dir: &Path, file: &str) -> String {
        std::fs::read_to_string(dir.join(file)).unwrap()
    }

    #[test]
    fn squashes_an_agents_work_into_one_commit_named_after_its_sub_task() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let wolverine = add_agent(&proj, &mission.slug, "Wolverine").unwrap();
        let h = Path::new(&hulk.path);
        commit(h, "login.txt", "login\n", "login form");
        commit(h, "login.txt", "login\nsubmit\n", "submit button");
        std::fs::write(Path::new(&wolverine.path).join("draft.txt"), "x").unwrap();
        let m = Path::new(&mission.path);
        let before = run(m, &["rev-parse", "HEAD"]);
        // A report's Markdown heading is part of the message, not a comment git drops.
        let message = "Login form\n\n# What was done\nThe form and its submit button.";
        assert_eq!(
            merge_agent(m, h, &hulk.branch, message, None).unwrap(),
            MergeReport {
                merge: Merge::Merged,
                uncommitted: false,
                unsigned: false,
                head: run(h, &["rev-parse", "HEAD"]),
            }
        );
        // One commit on the mission's, of one parent: the agent's own commits stay out of its history.
        assert_eq!(
            run(m, &["rev-list", "--count", &format!("{before}..HEAD")]),
            "1"
        );
        assert_eq!(run(m, &["rev-parse", "HEAD^"]), before);
        assert!(git(m, &["merge-base", "--is-ancestor", &hulk.branch, "HEAD"]).is_err());
        assert_eq!(run(m, &["log", "-1", "--format=%B"]), message);
        assert_eq!(run(m, &["log", "-1", "--format=%an <%ae>"]), "t <t@t>");
        assert_eq!(read(m, "login.txt"), "login\nsubmit\n");
        assert_eq!(run(m, &["status", "--porcelain"]), "");
        // Nothing committed: nothing to take in, its uncommitted file said.
        let empty = merge_agent(
            m,
            Path::new(&wolverine.path),
            &wolverine.branch,
            "API",
            None,
        )
        .unwrap();
        assert_eq!((empty.merge, empty.uncommitted), (Merge::Empty, true));
    }

    #[test]
    fn a_merge_again_takes_only_what_came_after_the_last_one() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let h = Path::new(&hulk.path);
        let m = Path::new(&mission.path);
        commit(h, "a.txt", "b\n", "first pass");
        let first = squash(m, &hulk);
        // The agent changes its own line again: from its fork, the line would conflict with its own squash.
        commit(h, "a.txt", "c\n", "second pass");
        let fresh = merge_agent(m, h, &hulk.branch, "Login", None).unwrap();
        assert!(matches!(fresh.merge, Merge::Conflict { .. }));
        assert_eq!(run(m, &["status", "--porcelain"]), "");
        let again = merge_agent(m, h, &hulk.branch, "Login, again", Some(&first.head)).unwrap();
        assert_eq!(again.merge, Merge::Merged);
        assert_eq!(read(m, "a.txt"), "c\n");
        // Nothing new since: nothing is taken, even past a change of the mission's on the same line.
        commit(m, "a.txt", "mission\n", "mission side");
        let head = run(m, &["rev-parse", "HEAD"]);
        let none = merge_agent(m, h, &hulk.branch, "Login", Some(&again.head)).unwrap();
        assert_eq!(none.merge, Merge::Empty);
        assert_eq!(run(m, &["rev-parse", "HEAD"]), head);
        assert_eq!(read(m, "a.txt"), "mission\n");
    }

    #[test]
    fn a_branch_rewritten_since_its_merge_is_refused() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let h = Path::new(&hulk.path);
        let m = Path::new(&mission.path);
        commit(h, "login.txt", "login\n", "login");
        let first = squash(m, &hulk);
        run(h, &["reset", "-q", "--hard", "HEAD~1"]);
        commit(h, "other.txt", "other\n", "another history");
        let head = run(m, &["rev-parse", "HEAD"]);
        let err = merge_agent(m, h, &hulk.branch, "Login", Some(&first.head)).unwrap_err();
        assert!(err.contains("rewritten"), "{err}");
        assert_eq!(run(m, &["rev-parse", "HEAD"]), head);
    }

    /// A Manager merges unasked, through the night: no hook of the repository runs on a squash, neither from
    /// `.git/hooks` nor from a folder its config names, not even those `--no-verify` leaves, though the user's own
    /// commits run them.
    #[test]
    fn a_squash_runs_no_hook_of_the_repository() {
        let Some((parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        // The agents' work is committed first: the hooks refuse, the test's own commits included.
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        let thor = add_agent(&proj, &mission.slug, "Thor").unwrap();
        commit(Path::new(&thor.path), "api.txt", "api\n", "api");
        // Each hook would leave a mark, and refuse: those a squash's commit would run, and a merge's, should the squash
        // ever become one. Worktrees share the repository's hooks: those of its own folder (`.git/hooks`), then those
        // of a folder its config names.
        let marks = parent.path().join("marks");
        std::fs::create_dir(&marks).unwrap();
        let at = marks.to_string_lossy().replace('\\', "/");
        let names = [
            "pre-commit",
            "prepare-commit-msg",
            "commit-msg",
            "post-commit",
            "pre-merge-commit",
            "post-merge",
            "reference-transaction",
            "post-rewrite",
        ];
        let plant = |folder: &Path| {
            std::fs::create_dir_all(folder).unwrap();
            for name in names {
                let hook = folder.join(name);
                std::fs::write(
                    &hook,
                    format!("#!/bin/sh\necho ran > '{at}/ran-{name}'\nexit 1\n"),
                )
                .unwrap();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    // Git runs a hook only when it is executable.
                    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755))
                        .unwrap();
                }
            }
        };
        let m = Path::new(&mission.path);
        plant(&proj.join(".git").join("hooks"));
        assert_eq!(squash(m, &hulk).merge, Merge::Merged);
        let named = parent.path().join("hooks");
        plant(&named);
        run(
            &proj,
            &["config", "core.hooksPath", &named.to_string_lossy()],
        );
        assert_eq!(squash(m, &thor).merge, Merge::Merged);
        for name in names {
            assert!(
                !marks.join(format!("ran-{name}")).exists(),
                "the {name} hook ran"
            );
        }
        assert_eq!(read(m, "login.txt"), "login\n");
        assert_eq!(read(m, "api.txt"), "api\n");
    }

    /// A signing program that leaves `gpg-ran` in the folder git runs it in, then fails: what a repository may name.
    fn signer(dir: &Path) -> String {
        let script = dir.join("sign.sh");
        std::fs::write(&script, "#!/bin/sh\necho ran > gpg-ran\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::Permissions::from_mode(0o755);
            std::fs::set_permissions(&script, mode).unwrap();
        }
        script.to_string_lossy().replace('\\', "/")
    }

    /// A mission's squash commit is signed with the user's own signing program, never one the repository alone names:
    /// then it goes unsigned, and its report says so for the Manager.
    #[test]
    fn a_merge_is_not_signed_by_a_program_the_repository_alone_names() {
        let Some((parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        run(&proj, &["config", "commit.gpgsign", "true"]);
        // `gpg.program` is OpenPGP's, whatever the developer's own config picks.
        run(&proj, &["config", "gpg.format", "openpgp"]);
        run(&proj, &["config", "gpg.program", &signer(parent.path())]);
        let m = Path::new(&mission.path);
        let report = squash(m, &hulk);
        assert_eq!(report.merge, Merge::Merged);
        assert!(
            report.unsigned,
            "the report does not say the merge went unsigned"
        );
        assert!(
            !m.join("gpg-ran").exists(),
            "the repository's signing program ran on a mission's merge"
        );
        assert!(!run(m, &["cat-file", "-p", "HEAD"]).contains("gpgsig"));
        assert_eq!(run(m, &["log", "-1", "--format=%s"]), "An agent's sub-task");
    }

    /// A squash whose commit fails once it is staged (here, signed with a key nobody has, by the user's own signing
    /// program) leaves nothing half done: no commit, nothing staged, no file of the agent's, and the next merge works.
    #[test]
    fn a_merge_whose_commit_fails_is_undone() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        run(&proj, &["config", "commit.gpgsign", "true"]);
        run(
            &proj,
            &["config", "user.signingkey", "dummyplane-test-no-such-key"],
        );
        let m = Path::new(&mission.path);
        let head = run(m, &["rev-parse", "HEAD"]);
        let err = merge_agent(m, Path::new(&hulk.path), &hulk.branch, "Login", None).unwrap_err();
        assert!(err.contains("was cancelled"), "{err}");
        assert_eq!(run(m, &["status", "--porcelain"]), "");
        assert_eq!(run(m, &["rev-parse", "HEAD"]), head);
        assert!(!m.join("login.txt").exists());
        for state in ["MERGE_HEAD", "CHERRY_PICK_HEAD"] {
            assert!(
                git(m, &["rev-parse", "-q", "--verify", state]).is_err(),
                "{state} was left behind"
            );
        }
        run(&proj, &["config", "commit.gpgsign", "false"]);
        assert_eq!(squash(m, &hulk).merge, Merge::Merged);
        assert_eq!(read(m, "login.txt"), "login\n");
    }

    /// What somebody staged in the mission's worktree (the user in a terminal, or what an interrupted merge left)
    /// is theirs: the squash's commit would take it in under an agent's sub-task, and the undo of a squash that fails
    /// would take it out of the folder. A merge refuses it, writing nothing, and goes on once it is committed or unstaged.
    #[test]
    fn a_squash_refuses_a_mission_worktree_with_staged_changes_and_writes_nothing() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let thor = add_agent(&proj, &mission.slug, "Thor").unwrap();
        let m = Path::new(&mission.path);
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        commit(Path::new(&thor.path), "a.txt", "thor\n", "thor edits a.txt");
        commit(m, "a.txt", "mission\n", "mission edits a.txt");
        std::fs::write(m.join("mine.txt"), "staged by somebody\n").unwrap();
        run(m, &["add", "mine.txt"]);
        let head = run(m, &["rev-parse", "HEAD"]);
        // A squash that would go through, and one that would conflict: neither takes the file in, nor out.
        for agent in [&hulk, &thor] {
            let err =
                merge_agent(m, Path::new(&agent.path), &agent.branch, "Task", None).unwrap_err();
            assert!(err.contains("staged") && err.contains("mine.txt"), "{err}");
            assert_eq!(run(m, &["rev-parse", "HEAD"]), head);
            assert_eq!(run(m, &["status", "--porcelain"]), "A  mine.txt");
            assert_eq!(read(m, "mine.txt"), "staged by somebody\n");
            assert!(!m.join("login.txt").exists());
        }
        // Unstaged, the file is its owner's still, and the merge goes through without it.
        run(m, &["reset", "-q"]);
        assert_eq!(squash(m, &hulk).merge, Merge::Merged);
        let files = run(m, &["show", "--name-only", "--format=", "HEAD"]);
        assert_eq!(files, "login.txt");
        assert_eq!(read(m, "mine.txt"), "staged by somebody\n");
    }

    #[test]
    fn a_squash_goes_on_past_changes_that_are_not_staged() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let m = Path::new(&mission.path);
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        // An edit of a tracked file the squash does not touch, and a file not tracked: not the squash's, and kept.
        std::fs::write(m.join("a.txt"), "edited by somebody\n").unwrap();
        std::fs::write(m.join("notes.txt"), "notes\n").unwrap();
        assert_eq!(squash(m, &hulk).merge, Merge::Merged);
        assert_eq!(
            run(m, &["show", "--name-only", "--format=", "HEAD"]),
            "login.txt"
        );
        assert_eq!(read(m, "a.txt"), "edited by somebody\n");
        assert_eq!(read(m, "notes.txt"), "notes\n");
    }

    #[test]
    fn a_conflict_is_undone_and_its_files_named() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let m = Path::new(&mission.path);
        commit(m, "a.txt", "mission\n", "mission side");
        let h = Path::new(&hulk.path);
        commit(h, "a.txt", "hulk\n", "agent side");
        // A new file comes with the conflict: it goes with the squash, staged and on disk.
        commit(h, "new.txt", "new\n", "a new file");
        let report = squash(m, &hulk);
        assert_eq!(
            report.merge,
            Merge::Conflict {
                files: vec!["a.txt".into()]
            }
        );
        assert_eq!(run(m, &["status", "--porcelain"]), "");
        assert!(!m.join("new.txt").exists());
        assert_eq!(read(m, "a.txt").trim_end(), "mission");
    }

    #[test]
    fn cleanup_knows_squashed_and_handed_over_branches_are_in_and_skips_removed_ones() {
        let Some((parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let wolverine = add_agent(&proj, &mission.slug, "Wolverine").unwrap();
        let thor = add_agent(&proj, &mission.slug, "Thor").unwrap();
        // Hulk hands its task over: Wolverine takes its branch in, then finishes; Hulk's gets in through its squash.
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        let w = Path::new(&wolverine.path);
        run(w, &["merge", "-q", "--no-edit", &hulk.branch]);
        commit(w, "api.txt", "api\n", "api");
        let wolverine_in = squash(m, &wolverine);
        // A commit with no change since its squash: its work is still in.
        run(w, &["commit", "-q", "--allow-empty", "-m", "nothing more"]);
        // Thor's worktree went with its own cleanup already.
        commit(Path::new(&thor.path), "docs.txt", "docs\n", "docs");
        let thor_in = squash(m, &thor);
        run(&proj, &["worktree", "remove", &thor.path]);
        let agents = vec![
            agent("Hulk", None),
            agent("Wolverine", Some(&wolverine_in.head)),
            agent("Thor", Some(&thor_in.head)),
        ];
        let done = cleanup(&proj, &mission.slug, &agents, Some("main"), &[]).unwrap();
        assert_eq!(
            done.removed,
            vec![
                "auth-hulk".to_string(),
                "auth-wolverine".to_string(),
                "auth".to_string()
            ]
        );
        // Not landed: every branch stays, said to be in the mission's branch, which main lacks.
        assert_eq!(
            done.kept,
            vec![
                "dummyplane/auth-hulk (in the mission's branch, not on main)".to_string(),
                "dummyplane/auth-wolverine (in the mission's branch, not on main)".to_string(),
                "dummyplane/auth-thor (in the mission's branch, not on main)".to_string(),
                "dummyplane/auth (2 commits not on main)".to_string(),
            ]
        );
        assert!(done.saved.is_empty());
        assert!(!parent.path().join("proj.worktrees").join("auth").exists());
        // Landed by fast-forward, as `land` does: the squashed branches are no ancestors of main, but the mission's
        // records (the heads its squashes took in) and the mission's branch on main say their work is there.
        run(&proj, &["merge", "-q", "--ff-only", "dummyplane/auth"]);
        let done = cleanup(&proj, &mission.slug, &agents, Some("main"), &[]).unwrap();
        assert_eq!(
            done.removed,
            vec![
                "dummyplane/auth-hulk".to_string(),
                "dummyplane/auth-wolverine".to_string(),
                "dummyplane/auth-thor".to_string(),
                "dummyplane/auth".to_string(),
            ]
        );
        assert!(done.kept.is_empty(), "{done:?}");
        assert_eq!(run(&proj, &["branch", "--format=%(refname:short)"]), "main");
    }

    #[test]
    fn discard_undoes_a_failed_launch_and_never_drops_work() {
        let Some((parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let wolverine = add_agent(&proj, &mission.slug, "Wolverine").unwrap();
        commit(Path::new(&wolverine.path), "api.txt", "api\n", "api");
        let done = discard(&proj, &[mission.clone(), hulk, wolverine]).unwrap();
        assert_eq!(
            done.removed,
            vec!["auth-hulk".to_string(), "auth".to_string()]
        );
        assert_eq!(
            done.kept,
            vec!["dummyplane/auth-wolverine (branch not merged)".to_string()]
        );
        assert!(!parent.path().join("proj.worktrees").join("auth").exists());
        assert_eq!(
            run(&proj, &["branch", "--list", "dummyplane/*"]),
            "dummyplane/auth-wolverine"
        );
        // The same plan can be launched again.
        prepare(&proj, "auth").unwrap();
    }

    #[test]
    fn cleanup_removes_every_worktree_and_keeps_each_branch_not_on_the_users_with_why() {
        let Some((parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let wolverine = add_agent(&proj, &mission.slug, "Wolverine").unwrap();
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        commit(Path::new(&wolverine.path), "api.txt", "api\n", "api");
        let m = Path::new(&mission.path);
        let hulk_in = squash(m, &hulk);
        // Wolverine's branch was never merged: its worktree goes all the same, its commits stay on its branch.
        let names = vec![agent("Hulk", Some(&hulk_in.head)), agent("Wolverine", None)];
        run(&proj, &["merge", "-q", "--ff-only", "dummyplane/auth"]);
        let done = cleanup(&proj, &mission.slug, &names, Some("main"), &[]).unwrap();
        assert_eq!(
            done.removed,
            vec![
                "auth-hulk".to_string(),
                "auth-wolverine".to_string(),
                "auth".to_string(),
                "dummyplane/auth-hulk".to_string(),
                "dummyplane/auth".to_string(),
            ]
        );
        assert_eq!(
            done.kept,
            vec!["dummyplane/auth-wolverine (not merged into the mission's branch)".to_string()]
        );
        assert!(!parent.path().join("proj.worktrees").join("auth").exists());
        let branches = run(&proj, &["branch", "--format=%(refname:short)"]);
        assert_eq!(
            branches.lines().collect::<Vec<_>>(),
            vec!["dummyplane/auth-wolverine", "main"]
        );
        assert_eq!(read(&proj, "login.txt"), "login\n");
    }

    /// A WIP commit as the cleanup makes it: its subject alone, and the user's identity.
    fn wip_commit(proj: &Path, branch: &str) -> (String, String) {
        (
            run(proj, &["log", "-1", "--format=%B", branch]),
            run(proj, &["log", "-1", "--format=%an <%ae>", branch]),
        )
    }

    #[test]
    fn cleanup_saves_uncommitted_work_on_the_agents_own_branch_before_its_worktree_goes() {
        let Some((_parent, proj, mission, _hulk, squashed)) = ignoring() else {
            return;
        };
        let thor = add_agent(&proj, &mission.slug, "Thor").unwrap();
        let t = Path::new(&thor.path);
        // Thor died with a change, a new file and what a build makes again; a hook that fails would stop any commit.
        commit(t, "draft.txt", "first\n", "draft");
        std::fs::write(t.join("draft.txt"), "second\n").unwrap();
        write_in(t, "new/idea.txt", "idea\n");
        write_in(t, "node_modules/pkg/index.js", "made again\n");
        let hooks = proj.join(".git").join("hooks");
        std::fs::create_dir_all(&hooks).unwrap();
        for hook in ["pre-commit", "commit-msg"] {
            let hook = hooks.join(hook);
            std::fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                // Git runs a hook only when it is executable.
                std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
        // The hooks are live: a commit of the user's own git, there, is refused.
        let refused = Command::new("git")
            .arg("-C")
            .arg(t)
            .args(["commit", "-q", "--allow-empty", "-m", "x"])
            .output()
            .unwrap();
        assert!(!refused.status.success());
        let agents = vec![agent("Hulk", Some(&squashed.head)), agent("Thor", None)];
        let done = cleanup(&proj, &mission.slug, &agents, Some("main"), &[]).unwrap();
        assert_eq!(
            done.removed,
            vec![
                "auth-hulk".to_string(),
                "auth-thor".to_string(),
                "auth".to_string()
            ]
        );
        let sha = run(&proj, &["rev-parse", "--short", "dummyplane/auth-thor"]);
        assert_eq!(done.saved, vec![format!("dummyplane/auth-thor ({sha})")]);
        assert!(
            done.kept
                .contains(&"dummyplane/auth-thor (WIP saved at clean-up)".to_string())
        );
        assert!(!t.exists());
        // On its branch: the change and the new file, never what .gitignore leaves out; no trailer; the user's name.
        assert_eq!(
            wip_commit(&proj, "dummyplane/auth-thor"),
            ("WIP saved at clean-up".to_string(), "t <t@t>".to_string())
        );
        assert_eq!(
            run(&proj, &["show", "dummyplane/auth-thor:draft.txt"]),
            "second"
        );
        assert_eq!(
            run(&proj, &["show", "dummyplane/auth-thor:new/idea.txt"]),
            "idea"
        );
        assert_eq!(
            run(
                &proj,
                &["ls-tree", "-r", "--name-only", "dummyplane/auth-thor"]
            ),
            ".gitignore\na.txt\ndraft.txt\nlogin.txt\nnew/idea.txt"
        );
    }

    #[test]
    fn cleanup_saves_the_missions_own_uncommitted_work_on_its_branch_and_keeps_it() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        std::fs::write(m.join("scratch.txt"), "x\n").unwrap();
        let done = cleanup(&proj, &mission.slug, &[], Some("main"), &[]).unwrap();
        assert_eq!(done.removed, vec!["auth".to_string()]);
        assert_eq!(done.saved.len(), 1);
        assert_eq!(
            done.kept,
            vec!["dummyplane/auth (WIP saved at clean-up)".to_string()]
        );
        assert_eq!(run(&proj, &["show", "dummyplane/auth:scratch.txt"]), "x");
    }

    #[test]
    fn a_worktree_left_mid_merge_is_kept_with_its_conflict_never_committed() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let h = Path::new(&hulk.path);
        commit(m, "a.txt", "mission\n", "mission's");
        commit(h, "a.txt", "hulk\n", "hulk's");
        // Hulk stopped while it merged the mission's branch into its own to fix a conflict.
        let out = Command::new("git")
            .arg("-C")
            .arg(h)
            .args(["merge", "-q", "dummyplane/auth"])
            .output()
            .unwrap();
        assert!(!out.status.success());
        let before = run(&proj, &["rev-parse", "dummyplane/auth-hulk"]);
        let done = cleanup(
            &proj,
            &mission.slug,
            &[agent("Hulk", None)],
            Some("main"),
            &[],
        )
        .unwrap();
        assert!(
            done.kept
                .contains(&"auth-hulk (a merge or a rebase is under way there)".to_string()),
            "{done:?}"
        );
        assert!(
            done.kept
                .contains(&"dummyplane/auth-hulk (its worktree auth-hulk stays)".to_string())
        );
        assert!(h.exists() && done.saved.is_empty());
        assert_eq!(run(&proj, &["rev-parse", "dummyplane/auth-hulk"]), before);
        assert!(read(h, "a.txt").contains("<<<<<<<"));
    }

    #[test]
    fn a_worktree_a_terminal_left_open_is_in_stays_with_its_branch_and_says_why() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let h = Path::new(&hulk.path);
        std::fs::write(h.join("draft.txt"), "draft\n").unwrap();
        // Its sub-agent, at work in a folder of its worktree, written as the canvas may: other slashes, other case.
        let open = vec![HeldOpen {
            path: format!("{}/SRC/", hulk.path.to_uppercase().replace('\\', "/")),
            why: "Loki is at work there".into(),
        }];
        let done = cleanup(
            &proj,
            &mission.slug,
            &[agent("Hulk", None)],
            Some("main"),
            &open,
        )
        .unwrap();
        assert!(h.join("draft.txt").exists(), "nothing committed under it");
        assert!(done.saved.is_empty());
        assert_eq!(
            done.kept,
            vec![
                "auth-hulk (Loki is at work there)".to_string(),
                "dummyplane/auth-hulk (its worktree auth-hulk stays)".to_string(),
            ]
        );
        // The mission's own worktree, which nobody holds, goes; its branch holds nothing main lacks.
        assert_eq!(
            done.removed,
            vec!["auth".to_string(), "dummyplane/auth".to_string()]
        );
        // A path that only starts the same is another folder.
        assert!(!inside(&format!("{}-2", hulk.path), h));
    }

    #[test]
    fn the_users_branch_and_branches_dummyplane_did_not_make_are_never_deleted() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        // Another mission's branch whose name starts the same, and one of the user's own: both on main already, as
        // the mission's is (it holds no commit).
        run(&proj, &["branch", "dummyplane/auth-v2"]);
        run(&proj, &["branch", "feature"]);
        let done = cleanup(
            &proj,
            &mission.slug,
            &[agent("Hulk", None)],
            Some("main"),
            &[],
        )
        .unwrap();
        assert_eq!(
            done.removed,
            vec!["auth".to_string(), "dummyplane/auth".to_string()]
        );
        assert_eq!(
            run(&proj, &["branch", "--format=%(refname:short)"]),
            "dummyplane/auth-v2
feature
main"
        );
        // A mission started from a branch named as dummyPlane names its own: that branch is the user's, it stays.
        let mission = prepare(&proj, "docs").unwrap();
        let done = cleanup(&proj, &mission.slug, &[], Some("dummyplane/docs"), &[]).unwrap();
        assert_eq!(done.removed, vec!["docs".to_string()]);
        assert!(done.kept.is_empty(), "{done:?}");
        assert!(branch_exists(&proj, "dummyplane/docs"));
    }

    /// A mission with `count` agents (Agent 0, 1…), each with a commit of its own, all squashed in: what a roster looks
    /// like when `merge` is called again. The heads their merges took in, in the agents' order.
    fn merged_roster(proj: &Path, count: usize) -> (Worktree, Vec<Worktree>, Vec<String>) {
        let mission = prepare(proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        let mut agents = Vec::new();
        let mut heads = Vec::new();
        for i in 0..count {
            let agent = add_agent(proj, &mission.slug, &format!("Agent {i}")).unwrap();
            commit(
                Path::new(&agent.path),
                &format!("f{i}.txt"),
                "x\n",
                &format!("work {i}"),
            );
            heads.push(squash(m, &agent).head);
            agents.push(agent);
        }
        (mission, agents, heads)
    }

    fn probe_of(agent: &Worktree) -> ProbeAgent {
        ProbeAgent {
            path: agent.path.clone(),
            branch: agent.branch.clone(),
        }
    }

    #[test]
    fn probing_reads_each_agent_as_a_merge_does_and_answers_in_their_order() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let (mission, agents, heads) = merged_roster(&proj, 8);
        // Agent 3 left a file uncommitted, Agent 5 committed again since its merge.
        std::fs::write(Path::new(&agents[3].path).join("draft.txt"), "d\n").unwrap();
        commit(Path::new(&agents[5].path), "more.txt", "m\n", "more");
        let m = Path::new(&mission.path);
        let asked: Vec<ProbeAgent> = agents.iter().map(probe_of).collect();
        let probes = probe_agents(m, &asked).unwrap();
        assert_eq!(probes.len(), 8);
        for (i, probe) in probes.iter().enumerate() {
            let probe = probe.as_ref().unwrap();
            let moved = i == 5;
            assert_eq!(probe.uncommitted, i == 3, "agent {i}");
            assert_eq!(
                probe.head,
                git(
                    m,
                    &["rev-parse", &format!("{}^{{commit}}", agents[i].branch)]
                )
                .unwrap()
            );
            // The head a merge took in is the head of the branch, unless it moved since: then the merge goes on.
            assert_eq!(probe.head == heads[i], !moved, "agent {i}");
            // And a merge reads the same of it.
            let report = merge_agent(
                m,
                Path::new(&agents[i].path),
                &agents[i].branch,
                "m",
                Some(&heads[i]),
            )
            .unwrap();
            assert_eq!(report.uncommitted, probe.uncommitted, "agent {i}");
            if !moved {
                assert_eq!(report.merge, Merge::Empty);
                assert_eq!(report.head, probe.head);
            }
        }
    }

    #[test]
    fn an_agent_whose_branch_is_gone_is_no_probe_and_a_filter_refuses_every_probe() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let (mission, agents, _) = merged_roster(&proj, 2);
        let m = Path::new(&mission.path);
        let gone = ProbeAgent {
            path: agents[0].path.clone(),
            branch: "dummyplane/never-was".to_string(),
        };
        let probes = probe_agents(m, &[gone, probe_of(&agents[1])]).unwrap();
        assert!(probes[0].is_none() && probes[1].is_some());
        assert!(probe_agents(m, &[]).unwrap().is_empty());
        // As `merge_agent` is refused where the repository's own config defines a filter.
        run(&proj, &["config", "filter.crypt.clean", "cat"]);
        let refused = probe_agents(m, &[probe_of(&agents[1])]).unwrap_err();
        assert!(refused.contains("filter"), "{refused}");
    }

    #[test]
    fn reads_run_side_by_side_and_answer_in_the_order_of_what_was_asked() {
        use std::sync::atomic::AtomicUsize;
        let items: Vec<u64> = (0..12).collect();
        let (now, most) = (AtomicUsize::new(0), AtomicUsize::new(0));
        let answers = in_parallel(&items, |item| {
            let at = now.fetch_add(1, Ordering::SeqCst) + 1;
            most.fetch_max(at, Ordering::SeqCst);
            std::thread::sleep(std::time::Duration::from_millis(60));
            now.fetch_sub(1, Ordering::SeqCst);
            item * 10
        });
        assert_eq!(answers, (0..12).map(|i| i * 10).collect::<Vec<u64>>());
        // Several at once, never more than the workers (the wall clock is no test: a loaded machine slows any run).
        assert!(most.load(Ordering::SeqCst) > 1);
        assert!(most.load(Ordering::SeqCst) <= READ_WORKERS);
        assert!(in_parallel(&Vec::<u8>::new(), |_| 0).is_empty());
    }

    #[test]
    fn a_status_tells_what_a_wip_commit_takes_from_what_waits_aside() {
        assert_eq!(
            status_entries(" M a.txt\0R  new.txt\0old.txt\0?? b.txt\0!! node_modules/\0"),
            vec![
                (" M", "a.txt"),
                ("R ", "new.txt"),
                ("??", "b.txt"),
                ("!!", "node_modules/")
            ]
        );
        let nowhere = Path::new("/nowhere/at/all");
        let found = inventory(
            "!! node_modules/\0!! .swc/\0!! next-env.d.ts\0!! .next/\0",
            nowhere,
            nowhere,
        );
        assert!(!found.wip && found.keep.is_empty(), "{found:?}");
        let found = inventory(" M a.txt\0!! node_modules/\0", nowhere, nowhere);
        assert!(found.wip && found.left.as_deref() == Some("a.txt"));
        // An .env* is no change a commit takes; one staged is backed out of the index first.
        let found = inventory(
            "?? .env\0A  config/.env.production\0 M .ENV.example\0",
            nowhere,
            nowhere,
        );
        assert!(!found.wip, "{found:?}");
        assert_eq!(found.staged_env, vec!["config/.env.production".to_string()]);
    }

    /// Read at once, the worktrees answer as they would one after another: a reason per worktree, in the order of the
    /// agents; the WIP commits, the removals and the branches judged after them, one at a time.
    #[test]
    fn cleanup_reads_many_worktrees_at_once_and_answers_in_the_agents_order() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        std::fs::write(proj.join(".gitignore"), ".env\n").unwrap();
        run(&proj, &["add", ".gitignore"]);
        run(&proj, &["commit", "-q", "-m", "ignore"]);
        let (mission, agents, heads) = merged_roster(&proj, 7);
        // 1: a draft; 2: an ignored .env nothing makes again; 4: both; 5: commits after its merge (its branch is not in).
        std::fs::write(Path::new(&agents[1].path).join("draft.txt"), "d\n").unwrap();
        std::fs::write(Path::new(&agents[2].path).join(".env"), "SECRET=1\n").unwrap();
        std::fs::write(Path::new(&agents[4].path).join("draft.txt"), "d\n").unwrap();
        std::fs::write(Path::new(&agents[4].path).join(".env"), "SECRET=2\n").unwrap();
        commit(Path::new(&agents[5].path), "more.txt", "m\n", "more");
        let names: Vec<AgentBranch> = (0..7)
            .map(|i| agent(&format!("Agent {i}"), Some(&heads[i])))
            .collect();
        let done = cleanup(&proj, &mission.slug, &names, Some("main"), &[]).unwrap();
        let worktrees = |list: &[String]| -> Vec<String> {
            list.iter()
                .filter(|what| !what.starts_with("dummyplane/"))
                .cloned()
                .collect()
        };
        // The drafts are saved on their branches; .env stays out of a commit, and waits in the kept folder.
        assert_eq!(
            done.saved
                .iter()
                .map(|s| s.split(' ').next().unwrap())
                .collect::<Vec<_>>(),
            vec!["dummyplane/auth-agent-1", "dummyplane/auth-agent-4"]
        );
        assert_eq!(
            done.moved
                .iter()
                .map(|moved| (moved.worktree.as_str(), moved.files.clone()))
                .collect::<Vec<_>>(),
            vec![
                ("auth-agent-2", vec![".env".to_string()]),
                ("auth-agent-4", vec![".env".to_string()]),
            ]
        );
        assert!(worktrees(&done.kept).is_empty(), "{done:?}");
        assert_eq!(
            worktrees(&done.removed),
            vec![
                "auth-agent-0".to_string(),
                "auth-agent-1".to_string(),
                "auth-agent-2".to_string(),
                "auth-agent-3".to_string(),
                "auth-agent-4".to_string(),
                "auth-agent-5".to_string(),
                "auth-agent-6".to_string(),
                "auth".to_string(),
            ]
        );
        // Not landed: every branch stays, each with why, in the agents' order, the mission's last.
        assert_eq!(
            done.kept,
            [
                "dummyplane/auth-agent-0 (in the mission's branch, not on main)".to_string(),
                "dummyplane/auth-agent-1 (WIP saved at clean-up)".to_string(),
                "dummyplane/auth-agent-2 (in the mission's branch, not on main)".to_string(),
                "dummyplane/auth-agent-3 (in the mission's branch, not on main)".to_string(),
                "dummyplane/auth-agent-4 (WIP saved at clean-up)".to_string(),
                "dummyplane/auth-agent-5 (not merged into the mission's branch)".to_string(),
                "dummyplane/auth-agent-6 (in the mission's branch, not on main)".to_string(),
                "dummyplane/auth (7 commits not on main)".to_string(),
            ]
        );
    }

    /// A worktree two agents name (a hand-over) is removed once, and the second is not said to have failed.
    #[test]
    fn a_worktree_two_agents_name_is_removed_once() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let (mission, _agents, heads) = merged_roster(&proj, 1);
        let names = vec![
            agent("Agent 0", Some(&heads[0])),
            agent("Agent 0", Some(&heads[0])),
        ];
        let done = cleanup(&proj, &mission.slug, &names, Some("main"), &[]).unwrap();
        // The agent's worktree once, then the mission's own; its branch judged once too.
        assert_eq!(
            done.removed,
            vec!["auth-agent-0".to_string(), "auth".to_string()]
        );
        assert_eq!(
            done.kept,
            vec![
                "dummyplane/auth-agent-0 (in the mission's branch, not on main)".to_string(),
                "dummyplane/auth (1 commit not on main)".to_string(),
            ]
        );
    }

    /// Not run with the others (`cargo test -- --ignored --nocapture`): the time a merge of a roster already in takes
    /// read one worktree after another (what `merge` did), and read at once (`probe_agents`). A fresh temporary
    /// repository holds little: on a worktree with its dependencies each status takes about a second, not milliseconds.
    #[test]
    #[ignore]
    fn bench_reading_a_roster_one_after_another_and_at_once() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let (mission, agents, _heads) = merged_roster(&proj, 12);
        // Something for each status to scan, as a worktree with a few thousand files has.
        for agent in &agents {
            let dir = Path::new(&agent.path).join("deps");
            std::fs::create_dir(&dir).unwrap();
            for i in 0..1500 {
                std::fs::write(dir.join(format!("{i}.txt")), "x\n").unwrap();
            }
            run(Path::new(&agent.path), &["add", "deps"]);
            run(Path::new(&agent.path), &["commit", "-q", "-m", "deps"]);
        }
        let m = Path::new(&mission.path);
        let started = std::time::Instant::now();
        for agent in &agents {
            // `since` is the head of its branch: reading is all a merge of it does then.
            let current = git(m, &["rev-parse", &format!("{}^{{commit}}", agent.branch)]).unwrap();
            let _ = merge_agent(
                m,
                Path::new(&agent.path),
                &agent.branch,
                "m",
                Some(&current),
            );
        }
        let serial = started.elapsed();
        let asked: Vec<ProbeAgent> = agents.iter().map(probe_of).collect();
        let started = std::time::Instant::now();
        probe_agents(m, &asked).unwrap();
        let parallel = started.elapsed();
        println!("12 agents already in: one after another {serial:?}, at once {parallel:?}");
    }

    fn branch_exists(proj: &Path, branch: &str) -> bool {
        git(
            proj,
            &["rev-parse", "--verify", &format!("refs/heads/{branch}")],
        )
        .is_ok()
    }

    #[test]
    fn an_agent_squashed_cleans_up_its_worktree_and_branch_while_they_hold_only_what_was_squashed()
    {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let thor = add_agent(&proj, &mission.slug, "Thor").unwrap();
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        commit(Path::new(&thor.path), "api.txt", "api\n", "api");
        let hulk_in = squash(m, &hulk);
        let thor_in = squash(m, &thor);
        // A commit with no change since its squash holds nothing more: it goes too.
        run(
            Path::new(&thor.path),
            &["commit", "-q", "--allow-empty", "-m", "nothing more"],
        );
        for (who, squashed, tree) in [("Hulk", &hulk_in, &hulk), ("Thor", &thor_in, &thor)] {
            let done =
                remove_agent(&proj, &mission.slug, &agent(who, Some(&squashed.head))).unwrap();
            assert_eq!(
                done.removed,
                vec![tree.slug.clone(), tree.branch.clone()],
                "{who}"
            );
            assert!(done.kept.is_empty(), "{who}: {:?}", done.kept);
            assert!(!Path::new(&tree.path).exists());
            assert!(!branch_exists(&proj, &tree.branch));
        }
        // Gone already: nothing to do, nothing said.
        assert_eq!(
            remove_agent(&proj, &mission.slug, &agent("Hulk", Some(&hulk_in.head))).unwrap(),
            Cleanup::default()
        );
    }

    #[test]
    fn an_agent_cleaning_up_keeps_what_git_would_lose_and_says_why() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let thor = add_agent(&proj, &mission.slug, "Thor").unwrap();
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        commit(Path::new(&thor.path), "api.txt", "api\n", "api");
        let hulk_in = squash(m, &hulk);
        let thor_in = squash(m, &thor);
        // Hulk committed after its merge: its worktree goes, its branch holds that commit and stays.
        commit(
            Path::new(&hulk.path),
            "late.txt",
            "late\n",
            "after the merge",
        );
        let done = remove_agent(&proj, &mission.slug, &agent("Hulk", Some(&hulk_in.head))).unwrap();
        assert_eq!(done.removed, vec![hulk.slug.clone()]);
        assert_eq!(
            done.kept,
            vec![format!("{} (commits after its merge)", hulk.branch)]
        );
        assert!(branch_exists(&proj, &hulk.branch));
        // Thor left a file uncommitted: it is committed on its own branch ("WIP saved at clean-up"), its worktree
        // goes, its branch stays with that work.
        std::fs::write(Path::new(&thor.path).join("draft.txt"), "draft\n").unwrap();
        let done = remove_agent(&proj, &mission.slug, &agent("Thor", Some(&thor_in.head))).unwrap();
        assert_eq!(done.removed, vec![thor.slug.clone()], "{done:?}");
        assert_eq!(done.kept, vec![format!("{} ({WIP_MESSAGE})", thor.branch)]);
        assert_eq!(done.saved.len(), 1, "{done:?}");
        assert!(done.saved[0].starts_with(&format!("{} (", thor.branch)));
        assert!(!Path::new(&thor.path).exists());
        assert_eq!(
            wip_commit(&proj, &thor.branch),
            ("WIP saved at clean-up".to_string(), "t <t@t>".to_string())
        );
        assert_eq!(
            run(&proj, &["show", &format!("{}:draft.txt", thor.branch)]),
            "draft"
        );
    }

    /// Whether a branch, a remote branch or a tag holds `commit`.
    fn held(proj: &Path, commit: &str) -> bool {
        !run(
            proj,
            &[
                "for-each-ref",
                "--contains",
                commit,
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
        )
        .is_empty()
    }

    /// An agent squashed in, whose HEAD then left its branch (`git checkout --detach`) and committed there: the
    /// branch holds only what was squashed, and the commit is held by nothing but the worktree's own HEAD.
    fn detached_after_its_merge() -> (
        tempfile::TempDir,
        PathBuf,
        Worktree,
        Worktree,
        MergeReport,
        String,
    ) {
        let (parent, proj) = project().expect("git");
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let h = Path::new(&hulk.path);
        commit(h, "login.txt", "login\n", "login");
        let hulk_in = squash(Path::new(&mission.path), &hulk);
        run(h, &["checkout", "-q", "--detach"]);
        commit(h, "late.txt", "late\n", "after the merge, on no branch");
        let late = run(h, &["rev-parse", "HEAD"]);
        (parent, proj, mission, hulk, hulk_in, late)
    }

    #[test]
    fn an_agent_cleaning_up_keeps_a_worktree_standing_on_commits_no_branch_holds() {
        if project().is_none() {
            return;
        }
        let (_parent, proj, mission, hulk, hulk_in, late) = detached_after_its_merge();
        assert!(!held(&proj, &late));
        let done = remove_agent(&proj, &mission.slug, &agent("Hulk", Some(&hulk_in.head))).unwrap();
        // Removed, the worktree would take its only HEAD with it: the commit would be held by nothing.
        assert!(done.removed.is_empty(), "{done:?}");
        assert_eq!(
            done.kept,
            vec![format!("{} (commits on no branch)", hulk.slug)]
        );
        assert!(Path::new(&hulk.path).exists());
        assert!(branch_exists(&proj, &hulk.branch));
        // Put on a branch, its commits are held: it goes as it would have, its branch with them kept.
        let h = Path::new(&hulk.path);
        run(h, &["checkout", "-q", "-b", "side"]);
        let done = remove_agent(&proj, &mission.slug, &agent("Hulk", Some(&hulk_in.head))).unwrap();
        assert_eq!(done.removed, vec![hulk.slug.clone(), hulk.branch.clone()]);
        assert!(held(&proj, &late));
    }

    #[test]
    fn a_worktree_detached_inside_its_branch_or_on_another_one_goes_as_before() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let thor = add_agent(&proj, &mission.slug, "Thor").unwrap();
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        commit(Path::new(&thor.path), "api.txt", "api\n", "api");
        let hulk_in = squash(m, &hulk);
        let thor_in = squash(m, &thor);
        // Hulk looks at an older commit of its own branch (detached, nothing new); Thor works on a branch of its own.
        run(
            Path::new(&hulk.path),
            &["checkout", "-q", "--detach", "HEAD~1"],
        );
        run(Path::new(&thor.path), &["checkout", "-q", "-b", "side"]);
        commit(
            Path::new(&thor.path),
            "late.txt",
            "late\n",
            "after the merge",
        );
        let late = run(Path::new(&thor.path), &["rev-parse", "HEAD"]);
        for (who, squashed, tree) in [("Hulk", &hulk_in, &hulk), ("Thor", &thor_in, &thor)] {
            let done =
                remove_agent(&proj, &mission.slug, &agent(who, Some(&squashed.head))).unwrap();
            assert_eq!(done.removed.first(), Some(&tree.slug), "{who}: {done:?}");
            assert!(!Path::new(&tree.path).exists(), "{who}");
        }
        assert!(held(&proj, &late));
    }

    #[test]
    fn the_mission_cleanup_keeps_a_worktree_on_commits_no_branch_holds_and_says_so_before() {
        if project().is_none() {
            return;
        }
        let (parent, proj, mission, hulk, hulk_in, late) = detached_after_its_merge();
        let agents = vec![agent("Hulk", Some(&hulk_in.head))];
        let done = cleanup(&proj, &mission.slug, &agents, Some("main"), &[]).unwrap();
        // Its worktree, the only holder of the commit, stays with its branch; the mission's own goes.
        assert_eq!(done.removed, vec![mission.slug.clone()], "{done:?}");
        assert_eq!(
            done.kept,
            vec![
                format!("{} (commits on no branch)", hulk.slug),
                format!("{} (its worktree {} stays)", hulk.branch, hulk.slug),
                "dummyplane/auth (1 commit not on main)".to_string(),
            ]
        );
        assert!(Path::new(&hulk.path).exists());
        assert!(!parent.path().join("proj.worktrees").join("auth").exists());
        assert!(!held(&proj, &late));
    }

    /// A branch is deleted only while it is where it was checked: what lands on it after, and before the delete, keeps it.
    #[test]
    fn a_branch_is_deleted_only_while_it_is_where_it_was_checked_and_never_while_a_worktree_has_it()
    {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        let squashed = squash(m, &hulk).head;
        // A worktree has it checked out: left alone, whatever oid is given.
        assert!(delete_branch_at(&proj, &hulk.branch, &squashed).is_err());
        assert!(branch_exists(&proj, &hulk.branch));
        run(&proj, &["worktree", "remove", &hulk.path]);
        // A commit lands after the check (the branch moves on to the mission's head): the delete finds it so and stays.
        let moved = run(m, &["rev-parse", "HEAD"]);
        run(
            &proj,
            &["update-ref", &format!("refs/heads/{}", hulk.branch), &moved],
        );
        assert!(delete_branch_at(&proj, &hulk.branch, &squashed).is_err());
        assert_eq!(run(&proj, &["rev-parse", &hulk.branch]), moved);
        // Where it was checked, it goes.
        delete_branch_at(&proj, &hulk.branch, &moved).unwrap();
        assert!(!branch_exists(&proj, &hulk.branch));
    }

    /// A squash that conflicts, of whatever kind, is undone: the mission's worktree and branch are as they were.
    fn conflict_leaves_the_mission_as_it_was(
        label: &str,
        on_the_mission: impl Fn(&Path),
        on_the_agent: impl Fn(&Path),
    ) {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let h = Path::new(&hulk.path);
        on_the_agent(h);
        on_the_mission(m);
        let head = run(m, &["rev-parse", "HEAD"]);
        // A conflict, or a refusal git words its own way (a path Windows cannot name): never a half-done squash.
        let report = merge_agent(m, h, &hulk.branch, "Hulk", None);
        assert_eq!(
            run(m, &["status", "--porcelain"]),
            "",
            "{label}: {report:?}"
        );
        assert_eq!(run(m, &["rev-parse", "HEAD"]), head, "{label}");
    }

    #[test]
    fn a_conflict_of_any_kind_leaves_the_missions_worktree_as_it_was() {
        conflict_leaves_the_mission_as_it_was(
            "modify/delete",
            |m| {
                run(m, &["rm", "-q", "a.txt"]);
                run(m, &["commit", "-q", "-m", "mission deletes a.txt"]);
            },
            |h| commit(h, "a.txt", "changed by the agent\n", "agent edits a.txt"),
        );
        conflict_leaves_the_mission_as_it_was(
            "rename/rename",
            |m| {
                run(m, &["mv", "a.txt", "renamed.txt"]);
                run(m, &["commit", "-q", "-m", "mission renames a.txt"]);
            },
            |h| {
                run(h, &["mv", "a.txt", "other.txt"]);
                run(h, &["commit", "-q", "-m", "agent renames a.txt elsewhere"]);
            },
        );
        conflict_leaves_the_mission_as_it_was(
            "file/directory",
            |m| commit(m, "x", "a file\n", "mission: x is a file"),
            |h| {
                std::fs::create_dir(h.join("x")).unwrap();
                commit(h, "x/inner.txt", "inner\n", "agent: x is a directory");
            },
        );
        conflict_leaves_the_mission_as_it_was(
            "directory/file",
            |m| {
                std::fs::create_dir(m.join("x")).unwrap();
                commit(m, "x/inner.txt", "inner\n", "mission: x is a directory");
            },
            |h| commit(h, "x", "a file\n", "agent: x is a file"),
        );
    }

    #[test]
    fn an_untracked_file_in_the_way_stops_the_squash_and_stays() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let h = Path::new(&hulk.path);
        commit(h, "new.txt", "agent\n", "agent adds new.txt");
        std::fs::write(m.join("new.txt"), "somebody's own file\n").unwrap();
        let head = run(m, &["rev-parse", "HEAD"]);
        let err = merge_agent(m, h, &hulk.branch, "Hulk", None).unwrap_err();
        assert!(err.contains("was cancelled"), "{err}");
        assert_eq!(read(m, "new.txt"), "somebody's own file\n");
        assert_eq!(run(m, &["rev-parse", "HEAD"]), head);
        assert_eq!(run(m, &["status", "--porcelain"]), "?? new.txt");
    }

    /// An agent merged twice, with another agent's squash landing between and touching the same file elsewhere: the
    /// second takes exactly what came after the first (its new file, its rewritten line), neither again nor less.
    #[test]
    fn a_second_merge_takes_exactly_what_came_after_when_the_mission_moved_in_between() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let thor = add_agent(&proj, &mission.slug, "Thor").unwrap();
        let (h, t) = (Path::new(&hulk.path), Path::new(&thor.path));
        commit(h, "a.txt", "a\nh1\n", "hulk 1");
        let first = squash(m, &hulk);
        commit(t, "a.txt", "t0\na\n", "thor edits the top of a.txt");
        commit(t, "t.txt", "t\n", "thor adds t.txt");
        let thor_in = squash(m, &thor);
        commit(h, "a.txt", "a\nh2\n", "hulk 2 rewrites its line");
        commit(h, "b.txt", "b\n", "hulk 2 adds b.txt");
        let before: usize = run(m, &["rev-list", "--count", "HEAD"]).parse().unwrap();
        let again = merge_agent(m, h, &hulk.branch, "Hulk again", Some(&first.head)).unwrap();
        assert_eq!(again.merge, Merge::Merged);
        assert_eq!(
            run(m, &["rev-list", "--count", "HEAD"]),
            (before + 1).to_string()
        );
        assert_eq!(read(m, "a.txt"), "t0\na\nh2\n");
        assert_eq!(read(m, "t.txt"), "t\n");
        assert_eq!(read(m, "b.txt"), "b\n");
        // Nothing new for either since: nothing taken.
        let head = run(m, &["rev-parse", "HEAD"]);
        for (who, tree, since) in [(&hulk, h, &again.head), (&thor, t, &thor_in.head)] {
            let none = merge_agent(m, tree, &who.branch, "Again", Some(since)).unwrap();
            assert_eq!(none.merge, Merge::Empty);
        }
        assert_eq!(run(m, &["rev-parse", "HEAD"]), head);
        assert_eq!(run(m, &["status", "--porcelain"]), "");
    }

    /// Git names the leftover of a file against a directory after the commit it cherry-picks (`x~<sha> (<subject>`): a
    /// subject with a character Windows cannot have in a path makes that conflict a failure, not a conflict list.
    #[test]
    fn the_subject_of_the_temporary_commit_has_no_character_a_windows_path_cannot_hold() {
        for forbidden in ['<', '>', ':', '"', '/', '\\', '|', '?', '*'] {
            assert!(
                !SQUASH_SUBJECT.contains(forbidden),
                "{SQUASH_SUBJECT:?} holds {forbidden:?}"
            );
        }
    }

    #[test]
    fn a_file_against_a_directory_comes_back_as_a_conflict_list_both_ways_and_is_undone() {
        /// What a case does to a worktree before the merge.
        type Setup = fn(&Path);
        let cases: [(&str, Setup, Setup); 2] = [
            (
                "file/directory",
                |m| {
                    commit(
                        m,
                        "x",
                        "a file
",
                        "mission: x is a file",
                    )
                },
                |h| {
                    std::fs::create_dir(h.join("x")).unwrap();
                    commit(
                        h,
                        "x/inner.txt",
                        "inner
",
                        "agent: x is a directory",
                    );
                },
            ),
            (
                "directory/file",
                |m| {
                    std::fs::create_dir(m.join("x")).unwrap();
                    commit(
                        m,
                        "x/inner.txt",
                        "inner
",
                        "mission: x is a directory",
                    );
                },
                |h| {
                    commit(
                        h,
                        "x",
                        "a file
",
                        "agent: x is a file",
                    )
                },
            ),
        ];
        for (label, on_the_mission, on_the_agent) in cases {
            let Some((_parent, proj)) = project() else {
                return;
            };
            let mission = prepare(&proj, "auth").unwrap();
            let m = Path::new(&mission.path);
            let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
            let h = Path::new(&hulk.path);
            on_the_agent(h);
            on_the_mission(m);
            let head = run(m, &["rev-parse", "HEAD"]);
            let report = merge_agent(m, h, &hulk.branch, "Hulk", None);
            let Ok(MergeReport {
                merge: Merge::Conflict { files },
                ..
            }) = &report
            else {
                panic!("{label}: not a conflict list: {report:?}");
            };
            assert!(
                files.iter().any(|file| file.starts_with('x')),
                "{label}: {files:?}"
            );
            assert_eq!(run(m, &["status", "--porcelain"]), "", "{label}");
            assert_eq!(run(m, &["rev-parse", "HEAD"]), head, "{label}");
        }
    }

    /// A lock on the mission worktree's index (a git of the user's running there): neither the squash nor its undo can write.
    fn lock_index(m: &Path) -> PathBuf {
        let lock = Path::new(&run(m, &["rev-parse", "--absolute-git-dir"])).join("index.lock");
        std::fs::write(&lock, "").unwrap();
        lock
    }

    #[test]
    fn a_squash_that_cannot_be_taken_back_says_so_instead_of_that_it_was_cancelled() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        let lock = lock_index(m);
        let err = merge_agent(m, Path::new(&hulk.path), &hulk.branch, "Login", None).unwrap_err();
        assert!(err.contains("could not be taken back"), "{err}");
        assert!(!err.contains("was cancelled"), "{err}");
        // Once the lock is gone, nothing was left behind: the merge goes through.
        std::fs::remove_file(lock).unwrap();
        assert_eq!(squash(m, &hulk).merge, Merge::Merged);
    }

    #[test]
    fn an_undo_that_fails_names_what_may_be_left_in_the_mission_worktree() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        for name in ["one.txt", "two.txt", "three.txt", "four.txt"] {
            std::fs::write(m.join(name), "x\n").unwrap();
            run(m, &["add", name]);
        }
        let lock = lock_index(m);
        let left = undo_squash(m).unwrap_err();
        for name in ["four.txt", "one.txt", "three.txt"] {
            assert!(left.contains(name), "{left}");
        }
        assert!(
            left.contains("leftovers") && left.contains("+1 more"),
            "{left}"
        );
        std::fs::remove_file(lock).unwrap();
        assert!(undo_squash(m).is_ok());
        assert_eq!(run(m, &["status", "--porcelain"]), "");
    }

    // ---- ignored files: a worktree holding any a build does not make again is kept, and says which ----

    /// A project whose .gitignore names what the tests below put in an agent's worktree, a mission and a squashed Hulk.
    fn ignoring() -> Option<(tempfile::TempDir, PathBuf, Worktree, Worktree, MergeReport)> {
        let (parent, proj) = project()?;
        commit(
            &proj,
            ".gitignore",
            "node_modules/\ntarget/\n.DS_Store\nThumbs.db\n*.pyc\n*.tsbuildinfo\n.eslintcache\n.env\nnotes.md\nkeep-*.txt\nbin/\n*.log\n",
            "ignore what is not source",
        );
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        let squashed = squash(Path::new(&mission.path), &hulk);
        Some((parent, proj, mission, hulk, squashed))
    }

    fn write_in(dir: &Path, file: &str, content: &str) {
        let path = dir.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn what_a_build_or_a_tool_makes_again_is_told_from_what_is_not() {
        for gone in [
            "node_modules/",
            "a/b/c/node_modules/pkg/index.js",
            "NODE_MODULES/",
            "web/Dist/app.js",
            "target/debug/app.exe",
            ".venv/",
            "src/__pycache__/",
            ".next/cache/x",
            ".DS_Store",
            "docs/thumbs.db",
            "Desktop.ini",
            "src/x.pyc",
            "tsconfig.tsbuildinfo",
            ".eslintcache",
            "coverage/lcov.info",
            "pkg/obj/Debug/x.dll",
        ] {
            assert!(disposable_path(gone), "{gone}");
        }
        for kept in [
            ".env",
            ".env.local",
            "notes.md",
            "bin/",
            "vendor/",
            ".idea/",
            ".vscode/settings.json",
            "run.log",
            "deep/dir/secrets.txt",
            "nodemodules/",
            "mytarget/",
        ] {
            assert!(!disposable_path(kept), "{kept}");
        }
    }

    #[test]
    fn a_worktree_holding_only_what_a_build_makes_again_goes_with_its_branch() {
        let Some((_parent, proj, mission, hulk, squashed)) = ignoring() else {
            return;
        };
        let h = Path::new(&hulk.path);
        for file in [
            "node_modules/pkg/index.js",
            "a/b/c/node_modules/pkg/index.js",
            "target/debug/app",
            ".DS_Store",
            "Thumbs.db",
            "x.pyc",
            "tsconfig.tsbuildinfo",
            ".eslintcache",
        ] {
            write_in(h, file, "made again\n");
        }
        let done =
            remove_agent(&proj, &mission.slug, &agent("Hulk", Some(&squashed.head))).unwrap();
        assert_eq!(
            done.removed,
            vec![hulk.slug.clone(), hulk.branch.clone()],
            "{done:?}"
        );
        assert!(done.kept.is_empty());
        assert!(!h.exists());
    }

    #[test]
    fn an_agent_with_an_ignored_notes_file_or_a_changed_env_has_them_moved_aside_before_its_worktree_goes()
     {
        let Some((parent, proj, mission, hulk, squashed)) = ignoring() else {
            return;
        };
        let h = Path::new(&hulk.path);
        write_in(h, "node_modules/pkg/index.js", "made again\n");
        write_in(h, "notes.md", "my notes\n");
        // The user's own checkout holds another .env: this one is the agent's.
        write_in(h, ".env", "TOKEN=agent\n");
        write_in(&proj, ".env", "TOKEN=mine\n");
        let done =
            remove_agent(&proj, &mission.slug, &agent("Hulk", Some(&squashed.head))).unwrap();
        // Ignored files are in no commit: its branch holds only what was squashed, and goes.
        assert_eq!(
            done.removed,
            vec![hulk.slug.clone(), hulk.branch.clone()],
            "{done:?}"
        );
        assert!(done.kept.is_empty() && done.saved.is_empty(), "{done:?}");
        let kept = kept_dir(parent.path(), &hulk.slug);
        assert_eq!(
            done.moved,
            vec![Moved {
                worktree: hulk.slug.clone(),
                folder: kept.to_string_lossy().into_owned(),
                files: vec![".env".to_string(), "notes.md".to_string()],
                count: 2,
            }]
        );
        assert_eq!(read(&kept, ".env"), "TOKEN=agent\n");
        assert_eq!(read(&kept, "notes.md"), "my notes\n");
        assert!(!kept.join("node_modules").exists());
        assert!(!h.exists() && !branch_exists(&proj, &hulk.branch));
        // The user's own file is untouched.
        assert_eq!(read(&proj, ".env"), "TOKEN=mine\n");
    }

    /// An `.env` the agent never ignored is untracked: a WIP commit never takes it, it is moved aside with the rest.
    #[test]
    fn an_agent_cleaning_up_never_commits_an_env_file_and_keeps_it_in_the_kept_folder() {
        let Some((parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let h = Path::new(&hulk.path);
        commit(h, "login.txt", "login\n", "login");
        let squashed = squash(Path::new(&mission.path), &hulk);
        write_in(h, ".env.local", "TOKEN=agent\n");
        write_in(h, "src/draft.txt", "draft\n");
        let done =
            remove_agent(&proj, &mission.slug, &agent("Hulk", Some(&squashed.head))).unwrap();
        assert_eq!(done.removed, vec![hulk.slug.clone()], "{done:?}");
        assert_eq!(done.kept, vec![format!("{} ({WIP_MESSAGE})", hulk.branch)]);
        let kept = kept_dir(parent.path(), &hulk.slug);
        assert_eq!(read(&kept, ".env.local"), "TOKEN=agent\n");
        // The draft is in the commit, the .env* is not.
        assert_eq!(
            run(&proj, &["show", &format!("{}:src/draft.txt", hulk.branch)]),
            "draft"
        );
        assert!(
            git(
                &proj,
                &["cat-file", "-e", &format!("{}:.env.local", hulk.branch)]
            )
            .is_err()
        );
        assert!(!h.exists());
    }

    #[test]
    fn an_ignored_file_that_is_a_copy_of_the_users_own_does_not_keep_a_worktree() {
        let Some((_parent, proj, mission, hulk, squashed)) = ignoring() else {
            return;
        };
        let h = Path::new(&hulk.path);
        write_in(&proj, ".env", "TOKEN=mine\n");
        write_in(h, ".env", "TOKEN=mine\n");
        let done =
            remove_agent(&proj, &mission.slug, &agent("Hulk", Some(&squashed.head))).unwrap();
        assert_eq!(
            done.removed,
            vec![hulk.slug.clone(), hulk.branch.clone()],
            "{done:?}"
        );
        assert!(!h.exists());
    }

    #[test]
    fn bin_logs_and_the_rest_are_not_taken_for_what_a_build_makes_again_and_at_most_five_are_named()
    {
        let Some((parent, proj, mission, hulk, squashed)) = ignoring() else {
            return;
        };
        let h = Path::new(&hulk.path);
        write_in(h, "bin/tool.exe", "x");
        write_in(h, "run.log", "x");
        for n in 1..=5 {
            write_in(h, &format!("keep-{n}.txt"), "x");
        }
        let done =
            remove_agent(&proj, &mission.slug, &agent("Hulk", Some(&squashed.head))).unwrap();
        assert!(done.kept.is_empty(), "{done:?}");
        let kept = kept_dir(parent.path(), &hulk.slug);
        assert_eq!(done.moved.len(), 1, "{done:?}");
        assert_eq!(done.moved[0].count, 7, "{done:?}");
        assert_eq!(done.moved[0].files.len(), MOVED_NAMED, "{done:?}");
        for file in ["bin/tool.exe", "run.log", "keep-5.txt"] {
            assert_eq!(read(&kept, file), "x", "{file}");
        }
        assert!(!h.exists());
    }

    #[test]
    fn the_mission_cleanup_moves_ignored_files_nothing_makes_again_to_the_kept_folder_first() {
        let Some((parent, proj, mission, hulk, squashed)) = ignoring() else {
            return;
        };
        let h = Path::new(&hulk.path);
        let agents = vec![agent("Hulk", Some(&squashed.head))];
        write_in(h, "node_modules/pkg/index.js", "made again\n");
        write_in(h, "notes.md", "my notes\n");
        write_in(h, "deep/node_modules/pkg/index.js", "made again\n");
        write_in(h, "deep/sub/keep-1.txt", "mine\n");
        let done = cleanup(&proj, &mission.slug, &agents, Some("main"), &[]).unwrap();
        // A WIP commit leaves ignored files out: what nothing makes again waits beside the worktrees, named.
        assert_eq!(
            done.removed,
            vec![hulk.slug.clone(), mission.slug.clone()],
            "{done:?}"
        );
        let kept = kept_dir(parent.path(), &hulk.slug);
        assert_eq!(
            done.moved,
            vec![Moved {
                worktree: hulk.slug.clone(),
                folder: kept.to_string_lossy().into_owned(),
                // git names the file under a folder no pattern names, and a folder a pattern names as a whole.
                files: vec!["deep/sub/keep-1.txt".to_string(), "notes.md".to_string()],
                count: 2,
            }]
        );
        assert_eq!(read(&kept, "notes.md"), "my notes\n");
        assert_eq!(read(&kept, "deep/sub/keep-1.txt"), "mine\n");
        assert!(!kept.join("deep/node_modules").exists() && !kept.join("node_modules").exists());
        assert!(!h.exists() && done.saved.is_empty());
    }

    /// A cleanup an app quit stopped after some files moved is taken up where it was: the rest goes to the same
    /// folder, and a file already there is never overwritten (a folder of its own then).
    #[test]
    fn kept_files_never_overwrite_what_an_earlier_cleanup_kept() {
        let Some((parent, proj, mission, hulk, squashed)) = ignoring() else {
            return;
        };
        let (h, m) = (Path::new(&hulk.path), Path::new(&mission.path));
        let kept = kept_dir(parent.path(), &hulk.slug);
        // Moved by the cleanup that stopped: notes.md; still in the worktree: keep-1.txt.
        write_in(&kept, "notes.md", "moved before\n");
        write_in(h, "keep-1.txt", "one\n");
        // The mission's worktree holds a notes.md of the same name as one kept before.
        let kept_mission = kept_dir(parent.path(), &mission.slug);
        write_in(&kept_mission, "notes.md", "kept before\n");
        write_in(m, "notes.md", "the mission's\n");
        let agents = vec![agent("Hulk", Some(&squashed.head))];
        let done = cleanup(&proj, &mission.slug, &agents, Some("main"), &[]).unwrap();
        assert!(!h.exists() && !m.exists(), "{done:?}");
        assert_eq!(read(&kept, "keep-1.txt"), "one\n");
        assert_eq!(read(&kept, "notes.md"), "moved before\n");
        assert_eq!(read(&kept_mission, "notes.md"), "kept before\n");
        let second = kept_dir(parent.path(), &format!("{}-2", mission.slug));
        assert_eq!(read(&second, "notes.md"), "the mission's\n");
        assert_eq!(done.moved[1].folder, second.to_string_lossy());
    }

    #[test]
    fn a_second_cleanup_of_the_same_worktrees_while_one_runs_is_refused_and_touches_nothing() {
        let Some((parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "web").unwrap();
        let m = Path::new(&mission.path);
        write_in(m, "draft.txt", "draft\n");
        // The first cleanup holds the mission's worktree.
        let first = claim(&[parent.path().join("proj.worktrees").join("web")]).unwrap();
        assert_eq!(
            cleanup(&proj, "web", &[], Some("main"), &[]).unwrap_err(),
            CLEANUP_UNDER_WAY
        );
        assert!(m.join("draft.txt").exists());
        assert_eq!(
            run(&proj, &["rev-parse", "dummyplane/web"]),
            run(&proj, &["rev-parse", "main"])
        );
        // Once it ended, a cleanup runs.
        drop(first);
        let done = cleanup(&proj, "web", &[], Some("main"), &[]).unwrap();
        assert_eq!(done.removed, vec!["web".to_string()]);
    }

    #[test]
    fn a_launch_taken_back_moves_the_ignored_file_of_a_worktree_aside_and_goes_back() {
        let Some((parent, proj)) = project() else {
            return;
        };
        commit(&proj, ".gitignore", "notes.md\n", "ignore notes");
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        write_in(Path::new(&hulk.path), "notes.md", "my notes\n");
        let done = discard(&proj, &[mission.clone(), hulk.clone()]).unwrap();
        assert!(done.kept.is_empty(), "{done:?}");
        assert_eq!(
            done.removed,
            vec![hulk.slug.clone(), mission.slug.clone()],
            "{done:?}"
        );
        let kept = kept_dir(parent.path(), &hulk.slug);
        assert_eq!(read(&kept, "notes.md"), "my notes\n");
        assert_eq!(done.moved.len(), 1, "{done:?}");
        assert!(!Path::new(&hulk.path).exists());
        assert!(!branch_exists(&proj, &hulk.branch));
        // The same plan can be launched again.
        prepare(&proj, "auth").unwrap();
    }

    /// A launch taken back with work an agent already did: committed on its own branch (never an `.env*`), which stays.
    #[test]
    fn a_launch_taken_back_saves_uncommitted_work_on_its_branch_and_keeps_that_branch() {
        let Some((parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let h = Path::new(&hulk.path);
        write_in(h, "login.txt", "login\n");
        write_in(h, ".env", "TOKEN=agent\n");
        let done = discard(&proj, &[mission.clone(), hulk.clone()]).unwrap();
        assert_eq!(done.removed, vec![mission.slug.clone()], "{done:?}");
        assert_eq!(done.kept, vec![format!("{} ({WIP_MESSAGE})", hulk.branch)]);
        assert_eq!(done.saved.len(), 1, "{done:?}");
        assert_eq!(
            run(&proj, &["show", &format!("{}:login.txt", hulk.branch)]),
            "login"
        );
        assert_eq!(
            read(&kept_dir(parent.path(), &hulk.slug), ".env"),
            "TOKEN=agent\n"
        );
        assert!(!h.exists());
    }

    /// An agent's worktree a clean-up holds is left alone by the agent's own, and by a launch taken back.
    #[test]
    fn a_worktree_another_cleanup_holds_is_left_alone_by_an_agents_cleanup_and_by_a_discard() {
        let Some((parent, proj, mission, hulk, squashed)) = ignoring() else {
            return;
        };
        let h = Path::new(&hulk.path);
        write_in(h, "notes.md", "my notes\n");
        let held = claim(&[parent.path().join("proj.worktrees").join(&hulk.slug)]).unwrap();
        let done =
            remove_agent(&proj, &mission.slug, &agent("Hulk", Some(&squashed.head))).unwrap();
        assert!(done.removed.is_empty(), "{done:?}");
        assert_eq!(
            done.kept,
            vec![format!(
                "{} (a clean-up is already under way there)",
                hulk.slug
            )]
        );
        let done = discard(&proj, std::slice::from_ref(&hulk)).unwrap();
        assert_eq!(
            done.kept,
            vec![format!(
                "{} (a clean-up is already under way there)",
                hulk.slug
            )]
        );
        assert!(h.join("notes.md").exists() && branch_exists(&proj, &hulk.branch));
        drop(held);
        let done =
            remove_agent(&proj, &mission.slug, &agent("Hulk", Some(&squashed.head))).unwrap();
        assert_eq!(done.removed.len(), 2, "{done:?}");
    }

    /// A worktree discard is given that is not one of `<project>.worktrees` is never touched.
    #[test]
    fn a_discard_never_touches_a_folder_outside_the_worktrees_folder() {
        let Some((parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let stray = parent.path().join("elsewhere");
        run(
            &proj,
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "dummyplane/stray",
                &stray.to_string_lossy(),
            ],
        );
        write_in(&stray, "mine.txt", "mine\n");
        let tree = Worktree {
            slug: "stray".into(),
            branch: "dummyplane/stray".into(),
            path: stray.to_string_lossy().into_owned(),
            base: None,
        };
        let done = discard(&proj, &[mission.clone(), tree]).unwrap();
        assert_eq!(done.removed, vec![mission.slug.clone()], "{done:?}");
        assert_eq!(done.kept.len(), 1, "{done:?}");
        assert!(done.kept[0].contains("not a worktree dummyPlane made"));
        assert_eq!(read(&stray, "mine.txt"), "mine\n");
        assert!(branch_exists(&proj, "dummyplane/stray"));
    }

    /// Git prints a folder holding nothing but ignored files as one entry: one file among build output is not lost in it.
    #[test]
    fn a_folder_that_hides_one_ignored_file_among_build_output_has_that_file_moved_unless_it_is_a_copy()
     {
        let Some((parent, proj, mission, hulk, squashed)) = ignoring() else {
            return;
        };
        let h = Path::new(&hulk.path);
        write_in(h, "deep/node_modules/pkg/index.js", "made again\n");
        write_in(h, "deep/sub/notes.md", "my notes\n");
        // The same file in the user's own checkout: the agent's is a copy, nothing is moved.
        write_in(&proj, "deep/sub/notes.md", "my notes\n");
        let gone = agent("Hulk", Some(&squashed.head));
        let done = remove_agent(&proj, &mission.slug, &gone).unwrap();
        assert_eq!(
            done.removed,
            vec![hulk.slug.clone(), hulk.branch.clone()],
            "{done:?}"
        );
        assert!(done.moved.is_empty() && !h.exists(), "{done:?}");
        // A second agent, whose file is no copy: it is moved, whole path under the kept folder.
        let thor = add_agent(&proj, &mission.slug, "Thor").unwrap();
        commit(Path::new(&thor.path), "api.txt", "api\n", "api");
        let thor_in = squash(Path::new(&mission.path), &thor);
        write_in(
            Path::new(&thor.path),
            "deep/node_modules/pkg/index.js",
            "made again\n",
        );
        write_in(Path::new(&thor.path), "deep/sub/notes.md", "their notes\n");
        let done = remove_agent(&proj, &mission.slug, &agent("Thor", Some(&thor_in.head))).unwrap();
        assert_eq!(
            done.removed,
            vec![thor.slug.clone(), thor.branch.clone()],
            "{done:?}"
        );
        let kept = kept_dir(parent.path(), &thor.slug);
        assert_eq!(read(&kept, "deep/sub/notes.md"), "their notes\n");
        assert!(!kept.join("deep/node_modules").exists());
    }

    /// Not run with the others (`cargo test --lib reading_a_big_node_modules -- --ignored --nocapture`): what an agent's
    /// cleanup reads of a worktree whose `node_modules` holds 20 000 files, the read it made before (`--ignored` walks
    /// the folder) against the one it makes now (`--ignored=matching`: the folder is one entry), and the cleanup itself.
    #[test]
    #[ignore]
    fn reading_a_big_node_modules_costs_nothing_to_an_agents_cleanup() {
        let Some((_parent, proj, mission, hulk, squashed)) = ignoring() else {
            return;
        };
        let h = Path::new(&hulk.path);
        for pkg in 0..200 {
            for file in 0..100 {
                write_in(h, &format!("node_modules/p{pkg}/lib/f{file}.js"), "x");
            }
        }
        let timed = |what: &str, read: &dyn Fn() -> String| {
            let started = std::time::Instant::now();
            let status = read();
            println!("{what}: {:?}, {} bytes", started.elapsed(), status.len());
        };
        timed("status --porcelain -z --ignored (before)", &|| {
            git_raw(h, &["status", "--porcelain", "-z", "--ignored"]).unwrap()
        });
        timed("status_of (now)", &|| status_of(h).unwrap());
        let started = std::time::Instant::now();
        let done =
            remove_agent(&proj, &mission.slug, &agent("Hulk", Some(&squashed.head))).unwrap();
        println!("remove_agent: {:?}", started.elapsed());
        assert_eq!(done.removed.len(), 2, "{done:?}");
    }

    /// A mission cut from `main` with two commits of its own in its worktree.
    fn mission_with_work(proj: &Path) -> Worktree {
        let mission = prepare(proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        commit(m, "login.txt", "login\n", "Login");
        commit(m, "api.txt", "api\n", "API");
        mission
    }

    fn head(dir: &Path) -> String {
        run(dir, &["rev-parse", "HEAD"])
    }

    #[test]
    fn the_mission_remembers_the_user_s_branch_and_lands_on_it_by_fast_forward() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = mission_with_work(&proj);
        assert_eq!(mission.base.as_deref(), Some("main"));
        let m = Path::new(&mission.path);
        let asked = landing(&proj, m, mission.base.as_deref()).unwrap();
        assert_eq!(asked.target, "main");
        assert_eq!(asked.branch, "dummyplane/auth");
        assert_eq!(asked.tip, head(m));
        assert_eq!(asked.count, 2);
        assert!(asked.fast_forward);
        assert!(asked.commits[0].ends_with(" API") && asked.commits[1].ends_with(" Login"));
        // An untracked file of the user's is no uncommitted change: it stays as it is.
        std::fs::write(proj.join("scratch.txt"), "mine\n").unwrap();
        let before = head(&proj);
        assert_eq!(
            land(&proj, m, "main", &asked.tip).unwrap(),
            LandOutcome::Landed {
                target: "main".into(),
                from: before,
                to: asked.tip.clone()
            }
        );
        assert_eq!(head(&proj), asked.tip);
        assert_eq!(run(&proj, &["status", "--porcelain"]), "?? scratch.txt");
        assert!(proj.join("api.txt").exists());
        assert_eq!(
            land(&proj, m, "main", &asked.tip).unwrap(),
            LandOutcome::UpToDate
        );
        assert_eq!(
            landing(&proj, m, Some("main")).unwrap().count,
            0,
            "nothing left to land"
        );
        // Landed, the mission cleans up: its worktree removed, and its branch, all on main now, deleted.
        let done = cleanup(&proj, &mission.slug, &[], mission.base.as_deref(), &[]).unwrap();
        assert_eq!(
            done.removed,
            vec![mission.slug.clone(), mission.branch.clone()],
            "{done:?}"
        );
        assert!(done.kept.is_empty());
        assert!(!m.exists());
        assert_eq!(run(&proj, &["branch", "--format=%(refname:short)"]), "main");
    }

    #[test]
    fn a_landing_never_overwrites_an_ignored_file_of_the_user_s() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        commit(&proj, ".gitignore", "local.env\n", "Ignore local.env");
        std::fs::write(proj.join("local.env"), "the user's secret\n").unwrap();
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        std::fs::write(m.join("local.env"), "the mission's\n").unwrap();
        run(m, &["add", "-f", "local.env"]);
        run(m, &["commit", "-q", "-m", "Track local.env"]);
        let before = head(&proj);
        assert!(land(&proj, m, "main", &head(m)).is_err());
        assert_eq!(
            std::fs::read_to_string(proj.join("local.env")).unwrap(),
            "the user's secret\n"
        );
        assert_eq!(head(&proj), before);
    }

    #[test]
    fn a_checkout_with_uncommitted_changes_is_refused_and_left_untouched() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = mission_with_work(&proj);
        let m = Path::new(&mission.path);
        let tip = head(m);
        let before = head(&proj);
        std::fs::write(proj.join("a.txt"), "the user's edit\n").unwrap();
        std::fs::write(proj.join("b.txt"), "staged\n").unwrap();
        run(&proj, &["add", "b.txt"]);
        let status = run(&proj, &["status", "--porcelain"]);
        let refused = land(&proj, m, "main", &tip).unwrap();
        let LandOutcome::Dirty { checkout, files } = refused else {
            panic!("{refused:?}");
        };
        assert!(same(&checkout, &proj));
        assert_eq!(files, vec!["a.txt".to_string(), "b.txt".to_string()]);
        // Nothing stashed, reset or moved: the user's work and branch are as they were.
        assert_eq!(head(&proj), before);
        assert_eq!(run(&proj, &["status", "--porcelain"]), status);
        assert_eq!(
            std::fs::read_to_string(proj.join("a.txt")).unwrap(),
            "the user's edit\n"
        );
        assert_eq!(run(&proj, &["stash", "list"]), "");
    }

    #[test]
    fn a_branch_that_moved_is_merged_into_the_mission_s_worktree_never_the_user_s_checkout() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = mission_with_work(&proj);
        let m = Path::new(&mission.path);
        commit(&proj, "readme.txt", "readme\n", "The user's own commit");
        let moved = head(&proj);
        let asked = landing(&proj, m, Some("main")).unwrap();
        assert!(!asked.fast_forward);
        let LandOutcome::Merged { commit } = land(&proj, m, "main", &asked.tip).unwrap() else {
            panic!("not merged");
        };
        // The user's checkout did not move; the mission's branch holds both histories now.
        assert_eq!(head(&proj), moved);
        assert_eq!(run(&proj, &["status", "--porcelain"]), "");
        assert_eq!(run(m, &["rev-parse", "--short", "HEAD"]), commit);
        assert_eq!(
            run(m, &["rev-list", "--parents", "-n", "1", "HEAD"])
                .split(' ')
                .count(),
            3
        );
        assert!(m.join("readme.txt").exists());
        // Asked again, the next click fast-forwards.
        let again = landing(&proj, m, Some("main")).unwrap();
        assert!(again.fast_forward);
        assert!(matches!(
            land(&proj, m, "main", &again.tip).unwrap(),
            LandOutcome::Landed { .. }
        ));
        assert_eq!(head(&proj), again.tip);
        // Landed after a merge commit of the user's branch: ancestry holds, the branch goes.
        assert_eq!(
            cleanup(&proj, &mission.slug, &[], Some("main"), &[])
                .unwrap()
                .removed,
            vec![mission.slug.clone(), mission.branch.clone()]
        );
    }

    #[test]
    fn a_conflict_with_the_moved_branch_is_undone_in_the_mission_s_worktree() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let m = Path::new(&mission.path);
        commit(m, "a.txt", "the mission's\n", "Mission edit");
        commit(&proj, "a.txt", "the user's\n", "User edit");
        let (user, ours) = (head(&proj), head(m));
        assert_eq!(
            land(&proj, m, "main", &ours).unwrap(),
            LandOutcome::Conflict {
                files: vec!["a.txt".into()]
            }
        );
        assert_eq!(head(m), ours);
        assert_eq!(run(m, &["status", "--porcelain"]), "");
        assert_eq!(head(&proj), user);
        assert_eq!(run(&proj, &["status", "--porcelain"]), "");
    }

    #[test]
    fn a_branch_checked_out_nowhere_moves_alone() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = mission_with_work(&proj);
        let m = Path::new(&mission.path);
        run(&proj, &["switch", "-q", "-c", "other"]);
        let tip = head(m);
        assert!(matches!(
            land(&proj, m, "main", &tip).unwrap(),
            LandOutcome::Landed { .. }
        ));
        assert_eq!(run(&proj, &["rev-parse", "main"]), tip);
        assert_eq!(run(&proj, &["branch", "--show-current"]), "other");
        assert!(!proj.join("api.txt").exists());
    }

    #[test]
    fn a_detached_checkout_has_no_branch_to_land_on() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        run(&proj, &["switch", "-q", "--detach"]);
        let mission = prepare(&proj, "auth").unwrap();
        assert_eq!(mission.base, None);
        assert!(
            landing(&proj, Path::new(&mission.path), None)
                .unwrap_err()
                .contains("no branch")
        );
    }

    /// The `.gitignore` of a Next.js app like the one whose clean-up kept every worktree.
    const NEXT_IGNORES: &str =
        "node_modules/\n.next/\n.swc/\nnext-env.d.ts\n*.local\npublic/fonts/\n*.tsbuildinfo\n";

    /// A `node_modules` deeper than Windows' 260 characters, as pnpm makes them: its file's path.
    fn deep_node_modules(dir: &Path) -> PathBuf {
        let mut deep = dir.join("node_modules").join(".pnpm");
        while deep.as_os_str().len() < 300 {
            deep = deep.join("a-package-with-a-rather-long-name");
        }
        let file = deep.join("node_modules").join("index.js");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "made again\n").unwrap();
        file
    }

    /// What a Next.js worktree holds once an agent installed, built and ran it: what the install and the build make
    /// again, the fonts a script copies, an `.env.local`, the files a plugin writes under `.well-known` with a
    /// `.gitignore` of its own, and a deep `node_modules`.
    fn next_leftovers(dir: &Path) {
        write_in(dir, "next-env.d.ts", "/// <reference types=\"next\" />\n");
        write_in(dir, ".swc/plugins/v7/plugin.wasm", "swc\n");
        write_in(dir, ".next/cache/webpack/client.pack", "pack\n");
        write_in(dir, "tsconfig.tsbuildinfo", "{}\n");
        write_in(dir, ".env.local", "TOKEN=agent\n");
        write_in(dir, "public/fonts/Assistant/Assistant-Bold.woff2", "bold\n");
        write_in(dir, "public/fonts/Cascadia/CascadiaCode.woff2", "code\n");
        write_in(dir, "src/app/.well-known/workflow/v1/.gitignore", "*\n");
        write_in(dir, "src/app/.well-known/workflow/v1/config.json", "{}\n");
        deep_node_modules(dir);
    }

    fn worktree_paths(proj: &Path) -> Vec<String> {
        run(proj, &["worktree", "list", "--porcelain"])
            .lines()
            .filter_map(|line| line.strip_prefix("worktree "))
            .map(str::to_string)
            .collect()
    }

    /// The folder a worktree's kept files wait in, beside the worktrees.
    fn kept_dir(parent: &Path, worktree: &str) -> PathBuf {
        parent.join("proj.worktrees").join(".kept").join(worktree)
    }

    #[test]
    fn a_next_worktree_goes_and_what_nothing_makes_again_waits_in_the_kept_folder() {
        let Some((parent, proj)) = project() else {
            return;
        };
        commit(
            &proj,
            ".gitignore",
            NEXT_IGNORES,
            "ignore what is not source",
        );
        let mission = prepare(&proj, "web").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let (m, h) = (Path::new(&mission.path), Path::new(&hulk.path));
        commit(h, "page.tsx", "page\n", "page");
        next_leftovers(h);
        next_leftovers(m);
        let done = cleanup(&proj, "web", &[agent("Hulk", None)], Some("main"), &[]).unwrap();
        assert!(!h.exists() && !m.exists(), "{done:?}");
        assert_eq!(worktree_paths(&proj).len(), 1, "{done:?}");
        assert!(done.removed.contains(&"web-hulk".to_string()), "{done:?}");
        assert!(done.removed.contains(&"web".to_string()), "{done:?}");
        for worktree in ["web-hulk", "web"] {
            let kept = kept_dir(parent.path(), worktree);
            assert_eq!(read(&kept, ".env.local"), "TOKEN=agent\n");
            assert_eq!(
                read(&kept, "public/fonts/Assistant/Assistant-Bold.woff2"),
                "bold\n"
            );
            assert_eq!(
                read(&kept, "public/fonts/Cascadia/CascadiaCode.woff2"),
                "code\n"
            );
            assert_eq!(
                read(&kept, "src/app/.well-known/workflow/v1/config.json"),
                "{}\n"
            );
            // What the install and the build make again is not kept.
            for gone in [
                "next-env.d.ts",
                ".swc",
                ".next",
                "node_modules",
                "tsconfig.tsbuildinfo",
            ] {
                assert!(!kept.join(gone).exists(), "{worktree}: {gone}");
            }
        }
        // Hulk's commit is on no branch of the user's: its branch stays.
        assert!(branch_exists(&proj, "dummyplane/web-hulk"));
        assert_eq!(
            run(&proj, &["show", "dummyplane/web-hulk:page.tsx"]),
            "page"
        );
    }

    #[test]
    fn an_env_file_git_does_not_ignore_never_goes_into_the_wip_commit_and_is_kept() {
        let Some((parent, proj)) = project() else {
            return;
        };
        commit(
            &proj,
            ".gitignore",
            "node_modules/\n",
            "ignore node_modules",
        );
        let mission = prepare(&proj, "web").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let h = Path::new(&hulk.path);
        commit(h, ".env.example", "TOKEN=\n", "example");
        // Hulk stopped with a note, an .env git does not ignore, one it staged itself, and its example filled in.
        write_in(h, "notes.txt", "note\n");
        write_in(h, ".env", "SECRET=1\n");
        write_in(h, "config/.env.production", "SECRET=2\n");
        run(h, &["add", "config/.env.production"]);
        write_in(h, ".env.example", "TOKEN=filled\n");
        let done = cleanup(&proj, "web", &[agent("Hulk", None)], Some("main"), &[]).unwrap();
        assert_eq!(done.saved.len(), 1, "{done:?}");
        let tree = run(
            &proj,
            &["ls-tree", "-r", "--name-only", "dummyplane/web-hulk"],
        );
        assert_eq!(
            tree.lines().collect::<Vec<_>>(),
            vec![".env.example", ".gitignore", "a.txt", "notes.txt"],
            "{done:?}"
        );
        assert_eq!(
            run(&proj, &["show", "dummyplane/web-hulk:.env.example"]),
            "TOKEN="
        );
        assert!(!h.exists(), "{done:?}");
        let kept = kept_dir(parent.path(), "web-hulk");
        assert_eq!(read(&kept, ".env"), "SECRET=1\n");
        assert_eq!(read(&kept, "config/.env.production"), "SECRET=2\n");
        assert_eq!(read(&kept, ".env.example"), "TOKEN=filled\n");
    }

    #[test]
    fn a_mission_on_a_branch_the_user_never_moved_loses_its_worktrees_and_keeps_every_branch() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        commit(
            &proj,
            ".gitignore",
            NEXT_IGNORES,
            "ignore what is not source",
        );
        let main_before = run(&proj, &["rev-parse", "main"]);
        let mission = prepare(&proj, "web").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let thor = add_agent(&proj, &mission.slug, "Thor").unwrap();
        let (m, h, t) = (
            Path::new(&mission.path),
            Path::new(&hulk.path),
            Path::new(&thor.path),
        );
        commit(h, "login.txt", "login\n", "login");
        let squashed = squash(m, &hulk);
        commit(t, "api.txt", "api\n", "api");
        write_in(t, "api.txt", "api, unfinished\n");
        for dir in [m, h, t] {
            next_leftovers(dir);
        }
        let agents = vec![agent("Hulk", Some(&squashed.head)), agent("Thor", None)];
        let done = cleanup(&proj, "web", &agents, Some("main"), &[]).unwrap();
        assert!(!m.exists() && !h.exists() && !t.exists(), "{done:?}");
        assert_eq!(
            done.removed,
            vec![
                "web-hulk".to_string(),
                "web-thor".to_string(),
                "web".to_string()
            ]
        );
        for branch in [
            "dummyplane/web",
            "dummyplane/web-hulk",
            "dummyplane/web-thor",
        ] {
            assert!(branch_exists(&proj, branch), "{branch}: {done:?}");
        }
        assert_eq!(run(&proj, &["rev-parse", "main"]), main_before);
        assert_eq!(
            run(&proj, &["show", "dummyplane/web-thor:api.txt"]),
            "api, unfinished"
        );
    }

    /// pnpm's `node_modules` is made of junctions into its store: removing a worktree removes the links, never what
    /// they point to.
    #[cfg(windows)]
    #[test]
    fn a_junction_in_node_modules_goes_as_a_link_and_what_it_points_to_stays() {
        let Some((parent, proj)) = project() else {
            return;
        };
        commit(
            &proj,
            ".gitignore",
            "node_modules/\n",
            "ignore node_modules",
        );
        let mission = prepare(&proj, "web").unwrap();
        let m = Path::new(&mission.path);
        let store = parent.path().join("store").join("pkg");
        write_in(&store, "index.js", "the store's\n");
        std::fs::create_dir_all(m.join("node_modules")).unwrap();
        let link = m.join("node_modules").join("pkg");
        let made = Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(&store)
            .output()
            .unwrap();
        assert!(made.status.success(), "{made:?}");
        assert!(link.join("index.js").exists());
        let done = cleanup(&proj, "web", &[], Some("main"), &[]).unwrap();
        assert!(!m.exists(), "{done:?}");
        assert_eq!(read(&store, "index.js"), "the store's\n");
    }

    /// An ignored folder that is itself a junction: kept as the link it is, never walked, so nothing of what it points
    /// to (outside the worktree) is moved or deleted.
    #[cfg(windows)]
    #[test]
    fn an_ignored_junction_is_kept_as_a_link_and_what_it_points_to_is_untouched() {
        let Some((parent, proj)) = project() else {
            return;
        };
        commit(&proj, ".gitignore", "shared/\n", "ignore shared");
        let mission = prepare(&proj, "web").unwrap();
        let m = Path::new(&mission.path);
        let target = parent.path().join("elsewhere");
        write_in(&target, "a.txt", "theirs\n");
        write_in(&target, "Thumbs.db", "litter\n");
        let made = Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(m.join("shared"))
            .arg(&target)
            .output()
            .unwrap();
        assert!(made.status.success(), "{made:?}");
        let done = cleanup(&proj, "web", &[], Some("main"), &[]).unwrap();
        assert!(!m.exists(), "{done:?}");
        assert_eq!(read(&target, "a.txt"), "theirs\n");
        assert_eq!(read(&target, "Thumbs.db"), "litter\n");
        // The link itself waits in the kept folder, still pointing there.
        let kept = kept_dir(parent.path(), "web").join("shared");
        assert!(
            std::fs::symlink_metadata(&kept)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(read(&kept, "a.txt"), "theirs\n");
    }

    /// A repository an agent cloned inside its worktree: a commit would only point to it, so it moves whole, its own
    /// `.git` with it, and the WIP commit leaves it out.
    #[test]
    fn a_repository_nested_in_a_worktree_moves_whole_and_no_commit_points_to_it() {
        let Some((parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "web").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let h = Path::new(&hulk.path);
        let sub = h.join("vendor-lib");
        std::fs::create_dir_all(&sub).unwrap();
        run(&sub, &["init", "-q", "-b", "main"]);
        run(&sub, &["config", "user.name", "t"]);
        run(&sub, &["config", "user.email", "t@t"]);
        commit(&sub, "lib.txt", "lib\n", "lib");
        write_in(h, "draft.txt", "draft\n");
        let done = cleanup(&proj, "web", &[agent("Hulk", None)], Some("main"), &[]).unwrap();
        assert!(!h.exists(), "{done:?}");
        assert_eq!(
            run(
                &proj,
                &["ls-tree", "-r", "--name-only", "dummyplane/web-hulk"]
            ),
            "a.txt\ndraft.txt"
        );
        let kept = kept_dir(parent.path(), "web-hulk").join("vendor-lib");
        assert_eq!(read(&kept, "lib.txt"), "lib\n");
        assert_eq!(run(&kept, &["log", "-1", "--format=%s"]), "lib");
    }

    /// A read-only file (some packages ship them) does not stop the deletion halfway.
    #[test]
    fn a_read_only_file_in_node_modules_does_not_keep_the_folder() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        commit(
            &proj,
            ".gitignore",
            "node_modules/\n",
            "ignore node_modules",
        );
        let mission = prepare(&proj, "web").unwrap();
        let m = Path::new(&mission.path);
        write_in(m, "node_modules/pkg/index.js", "made again\n");
        let file = m.join("node_modules/pkg/index.js");
        let mut perms = std::fs::metadata(&file).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&file, perms).unwrap();
        let done = cleanup(&proj, "web", &[], Some("main"), &[]).unwrap();
        assert!(!m.exists(), "{done:?}");
        let trash = proj.parent().unwrap().join("proj.worktrees").join(".trash");
        assert_eq!(std::fs::read_dir(&trash).unwrap().count(), 0);
    }

    /// A project with the leftovers of two past missions and one live mission (gamma). alpha: Hulk's commit unlanded,
    /// Thor stopped with a change and an `.env` git does not ignore, Storm's worktree has a terminal open in it. beta:
    /// landed on main. Plus a `dummyplane/*` worktree outside the worktrees' folder, a branch of the user's, and a
    /// folder beside the worktrees that git does not list.
    fn leftover_project() -> Option<(tempfile::TempDir, PathBuf)> {
        let (parent, proj) = project()?;
        commit(
            &proj,
            ".gitignore",
            NEXT_IGNORES,
            "ignore what is not source",
        );
        let alpha = prepare(&proj, "alpha").unwrap();
        let hulk = add_agent(&proj, "alpha", "Hulk").unwrap();
        let thor = add_agent(&proj, "alpha", "Thor").unwrap();
        let storm = add_agent(&proj, "alpha", "Storm").unwrap();
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        commit(Path::new(&thor.path), "api.txt", "api\n", "api");
        write_in(Path::new(&thor.path), "api.txt", "api, unfinished\n");
        write_in(Path::new(&thor.path), ".env", "SECRET=thor\n");
        let beta = prepare(&proj, "beta").unwrap();
        let rogue = add_agent(&proj, "beta", "Rogue").unwrap();
        commit(Path::new(&rogue.path), "ui.txt", "ui\n", "ui");
        run(
            Path::new(&beta.path),
            &["merge", "-q", "--ff-only", "dummyplane/beta-rogue"],
        );
        run(&proj, &["merge", "-q", "--ff-only", "dummyplane/beta"]);
        let gamma = prepare(&proj, "gamma").unwrap();
        let flash = add_agent(&proj, "gamma", "Flash").unwrap();
        write_in(Path::new(&flash.path), "live.txt", "live\n");
        for tree in [&alpha, &hulk, &thor, &storm, &beta, &rogue, &gamma, &flash] {
            next_leftovers(Path::new(&tree.path));
        }
        let outside = parent.path().join("outside").join("omega");
        run(
            &proj,
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "dummyplane/omega",
                &outside.to_string_lossy(),
                "main",
            ],
        );
        run(&proj, &["branch", "feature"]);
        write_in(
            &parent.path().join("proj.worktrees").join("old-copy"),
            "file.txt",
            "mine\n",
        );
        Some((parent, proj))
    }

    fn storm_open(parent: &Path) -> Vec<HeldOpen> {
        vec![HeldOpen {
            path: parent
                .join("proj.worktrees")
                .join("alpha-storm")
                .to_string_lossy()
                .into_owned(),
            why: "Storm is open there".into(),
        }]
    }

    #[test]
    fn leftovers_list_past_missions_with_what_becomes_of_each_and_leave_the_live_one_out() {
        let Some((parent, proj)) = leftover_project() else {
            return;
        };
        let live = vec!["gamma".to_string()];
        let found = leftovers(&proj, &live, &storm_open(parent.path())).unwrap();
        let mut names: Vec<&str> = found.worktrees.iter().map(|w| w.name.as_str()).collect();
        names.sort_unstable();
        assert_eq!(
            names,
            vec![
                "alpha",
                "alpha-hulk",
                "alpha-storm",
                "alpha-thor",
                "beta",
                "beta-rogue"
            ]
        );
        let worktree = |name: &str| found.worktrees.iter().find(|w| w.name == name).unwrap();
        assert_eq!(
            worktree("alpha-storm").kept.as_deref(),
            Some("Storm is open there")
        );
        let thor = worktree("alpha-thor");
        assert!(thor.kept.is_none() && thor.wip, "{thor:?}");
        assert!(thor.moves.contains(&".env".to_string()), "{thor:?}");
        assert!(thor.moves.contains(&".env.local".to_string()), "{thor:?}");
        assert!(
            thor.moves.contains(&"public/fonts/".to_string()),
            "{thor:?}"
        );
        assert!(!worktree("alpha-hulk").wip && worktree("alpha-hulk").kept.is_none());
        let branch = |name: &str| {
            found
                .branches
                .iter()
                .find(|b| b.name == name)
                .unwrap_or_else(|| panic!("{name}: {found:?}"))
                .kept
                .clone()
        };
        assert_eq!(branch("dummyplane/beta"), None);
        assert_eq!(branch("dummyplane/beta-rogue"), None);
        // alpha's own branch holds no commit main lacks.
        assert_eq!(branch("dummyplane/alpha"), None);
        assert_eq!(
            branch("dummyplane/alpha-hulk").as_deref(),
            Some("unlanded: 1 commit not on main")
        );
        assert_eq!(
            branch("dummyplane/alpha-thor").as_deref(),
            Some("unlanded: its uncommitted work is saved on it first (WIP saved at clean-up)")
        );
        assert_eq!(
            branch("dummyplane/alpha-storm").as_deref(),
            Some("its worktree alpha-storm stays")
        );
        assert!(
            branch("dummyplane/omega")
                .unwrap()
                .starts_with("checked out at ")
        );
        assert!(
            found
                .branches
                .iter()
                .all(|b| !b.name.starts_with("dummyplane/gamma"))
        );
        assert!(
            found
                .branches
                .iter()
                .all(|b| b.name.starts_with("dummyplane/"))
        );
        assert_eq!(found.target.as_deref(), Some("main"));
        assert_eq!(found.strays, vec!["old-copy".to_string()]);
        assert!(found.trash.is_empty());
        // Read only: nothing moved.
        assert!(
            parent
                .path()
                .join("proj.worktrees")
                .join("alpha-thor")
                .join(".env")
                .exists()
        );
        assert!(!parent.path().join("proj.worktrees").join(".kept").exists());
    }

    #[test]
    fn the_click_on_leftovers_does_what_was_shown_and_never_touches_a_live_mission_or_the_user_s_own()
     {
        let Some((parent, proj)) = leftover_project() else {
            return;
        };
        let dir = parent.path().join("proj.worktrees");
        let live = vec!["gamma".to_string()];
        let open = storm_open(parent.path());
        let shown = leftovers(&proj, &live, &open).unwrap();
        let chosen = LeftoversChosen {
            worktrees: shown.worktrees.iter().map(|w| w.name.clone()).collect(),
            branches: shown.branches.clone(),
            trash: shown.trash.clone(),
        };
        let main_before = run(&proj, &["rev-parse", "main"]);
        let done = clean_leftovers(&proj, &live, &open, &chosen).unwrap();
        for gone in ["alpha", "alpha-hulk", "alpha-thor", "beta", "beta-rogue"] {
            assert!(!dir.join(gone).exists(), "{gone}: {done:?}");
            assert!(done.removed.contains(&gone.to_string()), "{gone}: {done:?}");
            assert_eq!(
                read(&dir.join(".kept").join(gone), ".env.local"),
                "TOKEN=agent\n"
            );
        }
        // What was kept, and the live mission's, the user's own and the worktree outside, as they were.
        assert!(dir.join("alpha-storm").join(".env.local").exists());
        assert!(
            done.kept
                .contains(&"alpha-storm (Storm is open there)".to_string()),
            "{done:?}"
        );
        assert_eq!(read(&dir.join("gamma-flash"), "live.txt"), "live\n");
        assert!(dir.join("gamma").join("public/fonts").exists());
        assert!(parent.path().join("outside").join("omega").exists());
        assert_eq!(read(&dir.join("old-copy"), "file.txt"), "mine\n");
        assert_eq!(run(&proj, &["rev-parse", "main"]), main_before);
        let branches = run(&proj, &["branch", "--format=%(refname:short)"]);
        assert_eq!(
            branches.lines().collect::<Vec<_>>(),
            vec![
                "dummyplane/alpha-hulk",
                "dummyplane/alpha-storm",
                "dummyplane/alpha-thor",
                "dummyplane/gamma",
                "dummyplane/gamma-flash",
                "dummyplane/omega",
                "feature",
                "main",
            ],
            "{done:?}"
        );
        // Thor's work is on its branch, never its .env, which waits in the kept folder.
        assert_eq!(
            run(&proj, &["show", "dummyplane/alpha-thor:api.txt"]),
            "api, unfinished"
        );
        assert!(
            !run(
                &proj,
                &["ls-tree", "-r", "--name-only", "dummyplane/alpha-thor"]
            )
            .lines()
            .any(|f| f.contains(".env"))
        );
        assert_eq!(
            read(&dir.join(".kept").join("alpha-thor"), ".env"),
            "SECRET=thor\n"
        );
        assert!(
            done.saved
                .iter()
                .any(|s| s.starts_with("dummyplane/alpha-thor ("))
        );
        assert!(
            done.kept
                .contains(&"dummyplane/alpha-hulk (unlanded: 1 commit not on main)".to_string())
        );
        // git lists the user's checkout, the kept worktree, the live mission's and the one outside.
        assert_eq!(worktree_paths(&proj).len(), 5, "{done:?}");
    }

    #[test]
    fn what_a_cleanup_an_app_quit_left_half_done_is_finished_by_the_leftovers() {
        let Some((parent, proj)) = project() else {
            return;
        };
        let dir = parent.path().join("proj.worktrees");
        let mission = prepare(&proj, "alpha").unwrap();
        write_in(
            Path::new(&mission.path),
            "node_modules/pkg/index.js",
            "made again\n",
        );
        // The app quit once the folder was taken away, before git's record of it went and the folder was deleted.
        std::fs::create_dir_all(dir.join(".trash")).unwrap();
        std::fs::rename(&mission.path, dir.join(".trash").join("alpha")).unwrap();
        let shown = leftovers(&proj, &[], &[]).unwrap();
        assert!(
            shown.worktrees[0].gone && shown.worktrees[0].kept.is_none(),
            "{shown:?}"
        );
        assert_eq!(shown.trash, vec!["alpha".to_string()]);
        let chosen = LeftoversChosen {
            worktrees: vec!["alpha".to_string()],
            branches: shown.branches.clone(),
            trash: shown.trash.clone(),
        };
        let done = clean_leftovers(&proj, &[], &[], &chosen).unwrap();
        assert_eq!(
            done.removed,
            vec![
                "alpha".to_string(),
                ".trash/alpha".to_string(),
                "dummyplane/alpha".to_string()
            ]
        );
        assert!(!dir.join(".trash").join("alpha").exists());
        assert_eq!(worktree_paths(&proj).len(), 1);
    }

    #[test]
    fn a_branch_that_moved_since_the_prompt_is_judged_again_and_stays() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        commit(&proj, "b.txt", "b\n", "second");
        let mission = prepare(&proj, "alpha").unwrap();
        let m = Path::new(&mission.path);
        let shown = leftovers(&proj, &[], &[]).unwrap();
        assert_eq!(shown.branches[0].kept, None);
        let chosen = LeftoversChosen {
            worktrees: Vec::new(),
            branches: shown.branches.clone(),
            trash: Vec::new(),
        };
        // A commit since: unlanded now.
        commit(m, "late.txt", "late\n", "late");
        let done = clean_leftovers(&proj, &[], &[], &chosen).unwrap();
        assert_eq!(
            done.kept,
            vec!["dummyplane/alpha (unlanded: 1 commit not on main)".to_string()]
        );
        // Moved back onto main's history: landed still, but not what the user was shown.
        run(m, &["reset", "-q", "--hard", "main~1"]);
        let done = clean_leftovers(&proj, &[], &[], &chosen).unwrap();
        assert_eq!(
            done.kept,
            vec!["dummyplane/alpha (it moved since it was shown)".to_string()]
        );
        assert!(branch_exists(&proj, "dummyplane/alpha"));
    }

    #[test]
    fn a_live_slug_covers_its_agents_and_nothing_else() {
        let live = vec!["web".to_string()];
        assert!(live_name("web", &live) && live_name("web-hulk", &live));
        assert!(!live_name("website", &live) && !live_name("api-web", &live));
        assert!(!live_name("web", &[String::new()]));
    }

    /// The repository an end-to-end run works on: only a throwaway one under `D:\temp\cu`, never the user's.
    fn e2e_repo() -> Option<PathBuf> {
        let repo = std::env::var("DUMMYPLANE_E2E_REPO").ok()?;
        let plain = repo.replace('/', "\\").to_ascii_lowercase();
        assert!(
            plain.starts_with(r"d:\temp\cu\"),
            "{repo} is not a throwaway repository under D:\\temp\\cu"
        );
        Some(PathBuf::from(repo))
    }

    /// End to end on a real install (unit CU's D:\temp\cu\e2e): `DUMMYPLANE_E2E_MISSION` and its agents
    /// (`DUMMYPLANE_E2E_AGENTS`, comma-separated) cleaned up, timed.
    #[test]
    #[ignore = "end to end: DUMMYPLANE_E2E_REPO names a throwaway repository under D:\\temp\\cu"]
    fn e2e_mission_cleanup_of_a_real_install() {
        let Some(repo) = e2e_repo() else {
            return;
        };
        let mission = std::env::var("DUMMYPLANE_E2E_MISSION").unwrap();
        let agents: Vec<AgentBranch> = std::env::var("DUMMYPLANE_E2E_AGENTS")
            .unwrap_or_default()
            .split(',')
            .filter(|name| !name.is_empty())
            .map(|name| agent(name, None))
            .collect();
        let started = std::time::Instant::now();
        let done = cleanup(&repo, &mission, &agents, Some("main"), &[]);
        eprintln!(
            "E2E cleanup of {mission}: {} ms\n{done:#?}",
            started.elapsed().as_millis()
        );
    }

    /// End to end: the time a worktree with a real install takes to go, `git worktree remove` (as before) against
    /// `take_away` and `delete_trash` (now), on the two worktrees `DUMMYPLANE_E2E_BENCH` names (comma-separated folder
    /// names under `<repo>.worktrees`, the same install in each).
    #[test]
    #[ignore = "end to end: DUMMYPLANE_E2E_REPO names a throwaway repository under D:\\temp\\cu"]
    fn e2e_deleting_a_worktree_with_its_install() {
        let Some(repo) = e2e_repo() else {
            return;
        };
        let (root, dir) = locate(&repo).unwrap();
        let names = std::env::var("DUMMYPLANE_E2E_BENCH").unwrap();
        let (by_git, by_rename) = names.split_once(',').unwrap();
        let started = std::time::Instant::now();
        let removed = git(
            &root,
            &[
                "-c",
                "core.longpaths=true",
                "worktree",
                "remove",
                &dir.join(by_git).to_string_lossy(),
            ],
        );
        let git_ms = started.elapsed().as_millis();
        let started = std::time::Instant::now();
        let path = dir.join(by_rename);
        let trash = take_away(&dir, by_rename, &path).unwrap();
        forget(&root, &path).unwrap();
        delete_trash(std::slice::from_ref(&trash));
        let new_ms = started.elapsed().as_millis();
        eprintln!(
            "E2E delete: git worktree remove {git_ms} ms ({removed:?}, folder left: {}); rename + remove_dir_all {new_ms} ms (folder left: {})",
            dir.join(by_git).exists(),
            trash.exists() || path.exists()
        );
    }

    /// End to end: the leftovers of past missions in `DUMMYPLANE_E2E_REPO`, the live missions' slugs in
    /// `DUMMYPLANE_E2E_LIVE` (comma-separated) skipped; what the prompt shows, then the click, timed.
    #[test]
    #[ignore = "end to end: DUMMYPLANE_E2E_REPO names a throwaway repository under D:\\temp\\cu"]
    fn e2e_leftovers_of_a_real_install() {
        let Some(repo) = e2e_repo() else {
            return;
        };
        let live: Vec<String> = std::env::var("DUMMYPLANE_E2E_LIVE")
            .unwrap_or_default()
            .split(',')
            .filter(|slug| !slug.is_empty())
            .map(str::to_string)
            .collect();
        let started = std::time::Instant::now();
        let shown = leftovers(&repo, &live, &[]).unwrap();
        eprintln!(
            "E2E leftovers read: {} ms\n{shown:#?}",
            started.elapsed().as_millis()
        );
        let chosen = LeftoversChosen {
            worktrees: shown.worktrees.iter().map(|w| w.name.clone()).collect(),
            branches: shown.branches.clone(),
            trash: shown.trash.clone(),
        };
        let started = std::time::Instant::now();
        let done = clean_leftovers(&repo, &live, &[], &chosen);
        eprintln!(
            "E2E leftovers cleaned: {} ms\n{done:#?}",
            started.elapsed().as_millis()
        );
    }
}
