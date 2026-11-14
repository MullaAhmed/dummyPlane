//! Worktrees and branches of a mission.
//! dummyPlane works beside the user's folder, never in their branch: no push,
//! no force.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};

/// A worktree dummyPlane made, on a branch of its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub slug: String,
    pub branch: String,
    pub path: String,
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

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleanup {
    pub removed: Vec<String>,
    pub kept: Vec<String>,
}

const MAX_SLUG: usize = 40;

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
    add_worktree(&root, &dir, &slug(name), "HEAD")
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
        Some("dummyPlane: an agent's work, from its base"),
    )?;
    if let Err(err) = squash_git(mission, &["cherry-pick", "--no-commit", &step], None) {
        let files: Vec<String> = git(mission, &["diff", "--name-only", "--diff-filter=U"])
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect();
        undo_squash(mission);
        if files.is_empty() {
            return Err(format!("Merging {branch} failed and was cancelled: {err}"));
        }
        return Ok(report(Merge::Conflict { files }));
    }
    // Everything it brings is in already.
    if git(mission, &["diff", "--cached", "--quiet"]).is_ok() {
        undo_squash(mission);
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
        undo_squash(mission);
        return Err(format!("Merging {branch} failed and was cancelled: {err}"));
    }
    Ok(MergeReport {
        unsigned,
        ..report(Merge::Merged)
    })
}

/// Takes a squash back: the index and the files it changed as they were, a conflict's included, other local changes kept.
fn undo_squash(mission: &Path) {
    let _ = squash_git(mission, &["reset", "--merge"], None);
}

/// Never forced: a worktree with uncommitted changes stays.
fn remove_worktree(root: &Path, name: String, path: &Path, done: &mut Cleanup) {
    match git(root, &["worktree", "remove", &path.to_string_lossy()]) {
        Ok(_) => done.removed.push(name),
        Err(err) => done.kept.push(kept_worktree(&name, &err)),
    }
}

/// Why `git worktree remove` left a worktree: its changes, or something else
/// (a folder locked by a process) that git's own message then names.
fn kept_worktree(name: &str, git_error: &str) -> String {
    if git_error.contains("modified or untracked files") {
        return format!("{name} (uncommitted changes)");
    }
    let cause = git_error.lines().next().unwrap_or_default().trim();
    format!("{name} ({cause})")
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

/// Undoes a launch that failed (final review H2): its fresh worktrees and
/// branches go, newest first, so the plan can be launched again. Never
/// forced: a worktree with changes or a branch with commits stays.
pub fn discard(project: &Path, trees: &[Worktree]) -> Result<Cleanup, String> {
    let (root, _) = locate(project)?;
    let mut done = Cleanup::default();
    for tree in trees.iter().rev() {
        if Path::new(&tree.path).exists()
            && let Err(err) = git(&root, &["worktree", "remove", &tree.path])
        {
            done.kept.push(kept_worktree(&tree.slug, &err));
            continue;
        }
        match git(&root, &["branch", "-d", &tree.branch]) {
            Ok(_) => done.removed.push(tree.slug.clone()),
            Err(_) => {
                let branch = &tree.branch;
                done.kept.push(format!("{branch} (branch not merged)"));
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

/// An agent cleans up after itself once its work is squashed into the mission's: its worktree goes, never forced
/// (uncommitted changes, or a folder a process still holds, keep it), then its branch, only while its head is still
/// the one its squash took in (`agent.squashed`) or holds the same files: a commit made after the merge keeps it. A
/// squashed branch is no ancestor of the mission's, so git would call it unmerged: it is deleted on that check
/// instead. What is kept is named with why.
pub fn remove_agent(project: &Path, mission: &str, agent: &AgentBranch) -> Result<Cleanup, String> {
    let (root, dir) = locate(project)?;
    let name = format!("{mission}-{}", slug(&agent.name));
    let path = dir.join(&name);
    let mut done = Cleanup::default();
    if path.exists() {
        if !git(&path, &["status", "--porcelain"])?.is_empty() {
            done.kept.push(format!("{name} (uncommitted changes)"));
            return Ok(done);
        }
        if on_no_branch(&path)? {
            done.kept.push(format!("{name} (commits on no branch)"));
            return Ok(done);
        }
        remove_worktree(&root, name.clone(), &path, &mut done);
        // Its branch is checked out there while the worktree stays.
        if !done.kept.is_empty() {
            return Ok(done);
        }
    }
    let branch = format!("dummyplane/{name}");
    let Ok(head) = git(
        &root,
        &["rev-parse", "--verify", &format!("{branch}^{{commit}}")],
    ) else {
        return Ok(done);
    };
    match agent.squashed.as_deref() {
        Some(squashed) if same_work(&root, squashed, &head) => {
            match git(&root, &["branch", "-D", &branch]) {
                Ok(_) => done.removed.push(branch),
                Err(err) => {
                    let cause = err.lines().next().unwrap_or_default().trim().to_string();
                    done.kept.push(format!("{branch} ({cause})"));
                }
            }
        }
        _ => done
            .kept
            .push(format!("{branch} (commits after its merge)")),
    }
    Ok(done)
}

/// Removes the worktrees whose branch is in the mission's (`branch_in`), then the
/// mission's own when none is left; the branches stay for the user.
pub fn cleanup(project: &Path, mission: &str, agents: &[AgentBranch]) -> Result<Cleanup, String> {
    let (root, dir) = locate(project)?;
    let merged = merged_branches(&root, mission)?;
    let merged: Vec<&str> = merged.lines().map(str::trim).collect();
    let squashed: Vec<&str> = agents
        .iter()
        .filter_map(|a| a.squashed.as_deref())
        .collect();
    let mut done = Cleanup::default();
    for agent in agents {
        let name = format!("{mission}-{}", slug(&agent.name));
        let path = dir.join(&name);
        if !path.exists() {
            continue;
        }
        let branch = format!("dummyplane/{name}");
        if branch_in(
            &root,
            &branch,
            agent.squashed.as_deref(),
            &merged,
            &squashed,
        ) {
            if on_no_branch(&path).unwrap_or(true) {
                done.kept.push(format!("{name} (commits on no branch)"));
                continue;
            }
            remove_worktree(&root, name, &path, &mut done);
        } else {
            done.kept.push(format!("{name} (branch not merged)"));
        }
    }
    let path = dir.join(mission);
    if path.exists() && done.kept.is_empty() {
        remove_worktree(&root, mission.to_string(), &path, &mut done);
    }
    Ok(done)
}

/// What `cleanup` would leave where it is, found without touching anything (read-only): an agent's worktree
/// whose branch is not merged into the mission's, or that holds uncommitted changes, and the mission's own
/// worktree if it holds changes while nothing else is left. It asks git what `cleanup` asks, so the two agree.
pub fn cleanup_unsaved(
    project: &Path,
    mission: &str,
    agents: &[AgentBranch],
) -> Result<Vec<String>, String> {
    let (root, dir) = locate(project)?;
    let merged = merged_branches(&root, mission)?;
    let merged: Vec<&str> = merged.lines().map(str::trim).collect();
    let squashed: Vec<&str> = agents
        .iter()
        .filter_map(|a| a.squashed.as_deref())
        .collect();
    let mut unsaved = Vec::new();
    for agent in agents {
        let name = format!("{mission}-{}", slug(&agent.name));
        let path = dir.join(&name);
        if !path.exists() {
            continue;
        }
        let mut reasons = Vec::new();
        let branch = format!("dummyplane/{name}");
        if !branch_in(
            &root,
            &branch,
            agent.squashed.as_deref(),
            &merged,
            &squashed,
        ) {
            reasons.push("branch not merged");
        }
        if !git(&path, &["status", "--porcelain"])?.is_empty() {
            reasons.push("uncommitted changes");
        }
        if on_no_branch(&path).unwrap_or(true) {
            reasons.push("commits on no branch");
        }
        if !reasons.is_empty() {
            unsaved.push(format!("{name} ({})", reasons.join(", ")));
        }
    }
    let path = dir.join(mission);
    if unsaved.is_empty() && path.exists() && !git(&path, &["status", "--porcelain"])?.is_empty() {
        unsaved.push(format!("{mission} (uncommitted changes)"));
    }
    Ok(unsaved)
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    #[test]
    fn a_worktree_kept_for_another_reason_than_changes_says_so() {
        let changes = "fatal: 'x' contains modified or untracked files, use --force to delete it";
        assert_eq!(
            super::kept_worktree("batman", changes),
            "batman (uncommitted changes)"
        );
        let locked = "error: failed to delete 'C:/w/batman': Permission denied\nmore";
        assert_eq!(
            super::kept_worktree("batman", locked),
            "batman (error: failed to delete 'C:/w/batman': Permission denied)"
        );
    }

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
        assert_eq!(
            cleanup_unsaved(&proj, &mission.slug, &agents).unwrap(),
            Vec::<String>::new()
        );
        let done = cleanup(&proj, &mission.slug, &agents).unwrap();
        assert_eq!(
            done.removed,
            vec![
                "auth-hulk".to_string(),
                "auth-wolverine".to_string(),
                "auth".to_string()
            ]
        );
        assert!(done.kept.is_empty());
        assert!(!parent.path().join("proj.worktrees").join("auth").exists());
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
    fn cleanup_removes_merged_worktrees_and_keeps_the_branches() {
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
        let names = vec![agent("Hulk", Some(&hulk_in.head)), agent("Wolverine", None)];
        let first = cleanup(&proj, &mission.slug, &names).unwrap();
        assert_eq!(first.removed, vec!["auth-hulk".to_string()]);
        assert_eq!(
            first.kept,
            vec!["auth-wolverine (branch not merged)".to_string()]
        );
        assert!(m.exists());
        let wolverine_in = squash(m, &wolverine);
        let names = vec![
            agent("Hulk", Some(&hulk_in.head)),
            agent("Wolverine", Some(&wolverine_in.head)),
        ];
        let second = cleanup(&proj, &mission.slug, &names).unwrap();
        assert_eq!(
            second.removed,
            vec!["auth-wolverine".to_string(), "auth".to_string()]
        );
        assert!(!parent.path().join("proj.worktrees").join("auth").exists());
        let branches = run(&proj, &["branch", "--list", "dummyplane/*"]);
        assert!(
            branches.contains("dummyplane/auth-wolverine") && branches.contains("dummyplane/auth")
        );
    }

    #[test]
    fn cleanup_unsaved_names_what_cleanup_would_keep_and_touches_nothing() {
        let Some((_parent, proj)) = project() else {
            return;
        };
        let mission = prepare(&proj, "auth").unwrap();
        let hulk = add_agent(&proj, &mission.slug, "Hulk").unwrap();
        let wolverine = add_agent(&proj, &mission.slug, "Wolverine").unwrap();
        let thor = add_agent(&proj, &mission.slug, "Thor").unwrap();
        commit(Path::new(&hulk.path), "login.txt", "login\n", "login");
        commit(Path::new(&wolverine.path), "api.txt", "api\n", "api");
        let m = Path::new(&mission.path);
        let hulk_in = squash(m, &hulk);
        // Thor never committed but left a file; Hulk is merged and clean; Wolverine's branch is not merged.
        std::fs::write(Path::new(&thor.path).join("draft.txt"), "draft\n").unwrap();
        let names = vec![
            agent("Hulk", Some(&hulk_in.head)),
            agent("Wolverine", None),
            agent("Thor", None),
        ];
        let unsaved = cleanup_unsaved(&proj, &mission.slug, &names).unwrap();
        assert_eq!(
            unsaved,
            vec![
                "auth-wolverine (branch not merged)".to_string(),
                "auth-thor (uncommitted changes)".to_string()
            ]
        );
        // Read-only, and the same answer as the real cleanup's `kept`.
        assert!(Path::new(&hulk.path).exists() && Path::new(&thor.path).exists());
        let done = cleanup(&proj, &mission.slug, &names).unwrap();
        assert_eq!(done.kept, unsaved);
        // Everything saved: nothing unsaved.
        let wolverine_in = squash(m, &wolverine);
        let names = vec![
            agent("Hulk", Some(&hulk_in.head)),
            agent("Wolverine", Some(&wolverine_in.head)),
            agent("Thor", None),
        ];
        std::fs::remove_file(Path::new(&thor.path).join("draft.txt")).unwrap();
        assert_eq!(
            cleanup_unsaved(&proj, &mission.slug, &names).unwrap(),
            Vec::<String>::new()
        );
        // A change left in the mission's own worktree counts too, once the agents are in.
        std::fs::write(m.join("scratch.txt"), "x\n").unwrap();
        assert_eq!(
            cleanup_unsaved(&proj, &mission.slug, &names).unwrap(),
            vec!["auth (uncommitted changes)".to_string()]
        );
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
        // Thor left a file uncommitted: its worktree stays, its branch with it.
        std::fs::write(Path::new(&thor.path).join("draft.txt"), "draft\n").unwrap();
        let done = remove_agent(&proj, &mission.slug, &agent("Thor", Some(&thor_in.head))).unwrap();
        assert!(done.removed.is_empty());
        assert_eq!(
            done.kept,
            vec![format!("{} (uncommitted changes)", thor.slug)]
        );
        assert!(Path::new(&thor.path).join("draft.txt").exists());
        assert!(branch_exists(&proj, &thor.branch));
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
        // What the cleanup would leave, found without touching anything, and what it leaves, agree.
        assert_eq!(
            cleanup_unsaved(&proj, &mission.slug, &agents).unwrap(),
            vec![format!("{} (commits on no branch)", hulk.slug)]
        );
        let done = cleanup(&proj, &mission.slug, &agents).unwrap();
        assert!(done.removed.is_empty(), "{done:?}");
        assert_eq!(
            done.kept,
            vec![format!("{} (commits on no branch)", hulk.slug)]
        );
        assert!(Path::new(&hulk.path).exists());
        assert!(parent.path().join("proj.worktrees").join("auth").exists());
        assert!(!held(&proj, &late));
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
}
