//! The tests of the guard on `git` in a mission's agent: a command that changes the user's own checkout
//! is asked about (refused under `dontAsk`), reading it and working in the agent's own worktree go on.
//! Only command strings are judged here: nothing is ever run.

use std::path::PathBuf;

use super::*;

/// A mission's agent: its worktree is a folder of `<project>.worktrees`, beside the user's checkout.
const SCOPE: &str = "D:/Projects/workflows.worktrees/web-foundation-thor";
const CHECKOUT: &str = "D:/Projects/workflows";
const HOME: &str = "C:/Users/ahmed";

fn guard(unattended: bool, mission: bool) -> Guard {
    let mut guard = Guard::new(
        Some(SCOPE),
        Some(SCOPE),
        Some(HOME),
        &["C:/Users/ahmed/AppData/Local/Temp"],
        true,
    );
    guard.unattended = unattended;
    guard.checkout = mission.then(|| CHECKOUT.to_string());
    guard
}

fn here(_: &str) -> Option<bool> {
    Some(true)
}

fn judged(shell: Shell, command: &str) -> Option<Verdict> {
    guard(false, true).check(shell, command, &here)
}

#[track_caller]
fn asks(shell: Shell, command: &str) -> String {
    let asked = judged(shell, command).unwrap_or_else(|| panic!("{command}: not asked"));
    assert!(!asked.deny, "{command}: {}", asked.reason);
    assert!(
        asked.reason.starts_with(
            "dummyPlane asks before a git command that changes the user's own checkout"
        ),
        "{command}: {}",
        asked.reason
    );
    assert!(
        asked
            .reason
            .contains("run the same git command in your own worktree"),
        "{}",
        asked.reason
    );
    // Where nobody can answer, the same command is refused, and the agent told where to work.
    let refused = guard(true, true)
        .check(shell, command, &here)
        .unwrap_or_else(|| panic!("{command}: not refused"));
    assert!(refused.deny, "{command}: {}", refused.reason);
    assert!(
        refused
            .reason
            .contains("run the same git command in your own worktree"),
        "{}",
        refused.reason
    );
    assert!(refused.reason.contains(SCOPE), "{}", refused.reason);
    asked.reason
}

#[track_caller]
fn passes(shell: Shell, command: &str) {
    for (unattended, mission) in [(false, true), (true, true)] {
        assert_eq!(
            guard(unattended, mission).check(shell, command, &here),
            None,
            "{command} (unattended: {unattended})"
        );
    }
}

#[test]
fn a_git_command_that_changes_the_users_checkout_asks_in_bash() {
    for command in [
        "git -C D:/Projects/workflows checkout main",
        "git -C /d/Projects/workflows switch -c x",
        "git -C \"D:\\Projects\\workflows\" merge x",
        "git -C D:/Projects/workflows rebase main",
        "git -C D:/Projects/workflows reset --hard origin/main",
        "git -C D:/Projects/workflows stash",
        "git -C D:/Projects/workflows stash pop",
        "git -C D:/Projects/workflows commit -am x",
        "git -C D:/Projects/workflows pull",
        "git -C D:/Projects/workflows branch -D dummyplane/web-foundation",
        "git -C D:/Projects/workflows branch newname",
        "git -C D:/Projects/workflows worktree remove ../x",
        "git -C D:/Projects/workflows clean -fdx",
        "git -C D:/Projects/workflows restore .",
        "git -C D:/Projects/workflows cherry-pick abc",
        "git -C D:/Projects/workflows add -A",
        "git -C D:/Projects/workflows tag -d v1",
        "git -C D:/Projects/workflows/src commit -am x",
        "git -C ../../workflows reset --hard",
        "git -C ../.. -C workflows checkout main",
        "git -C /d/Projects -C workflows checkout main",
        "git -c user.name=x -C D:/Projects/workflows commit -m x",
        "git --no-pager -C D:/Projects/workflows checkout main",
        "git --git-dir=D:/Projects/workflows/.git checkout x",
        "git --git-dir D:/Projects/workflows/.git reset --hard",
        "git --work-tree=D:/Projects/workflows reset --hard",
        "git --work-tree /d/Projects/workflows checkout .",
        "GIT_DIR=/d/Projects/workflows/.git git reset --hard",
        "GIT_WORK_TREE=/d/Projects/workflows git checkout .",
        "\"C:/Program Files/Git/cmd/git.exe\" -C /d/Projects/workflows checkout x",
        "/usr/bin/git -C /d/Projects/workflows checkout x",
        "cd /d/Projects/workflows && git checkout main",
        "cd D:/Projects/workflows; git pull",
        "cd \"D:\\Projects\\workflows\" && git reset --hard",
        "pushd /d/Projects/workflows && git stash",
        "cd ../../workflows && git merge x",
        "cd /d/Projects/workflows/src && git commit -am x",
        "cd /d/Projects/workflows\ngit checkout main",
        "bash -c 'git -C /d/Projects/workflows checkout main'",
        "sh -c \"cd /d/Projects/workflows && git merge x\"",
        "eval 'git -C /d/Projects/workflows reset --hard'",
        "r=/d/Projects/workflows; git -C \"$r\" checkout main",
        "export R=D:/Projects/workflows; git -C $R checkout main",
        "git -C /d/Projects/workflows status && git -C /d/Projects/workflows checkout main",
        "sudo git -C /d/Projects/workflows checkout x",
        "timeout 5 git -C /d/Projects/workflows checkout x",
    ] {
        let reason = asks(Shell::Bash, command);
        assert!(reason.contains(CHECKOUT), "{command}: {reason}");
    }
}

#[test]
fn the_same_in_powershell_and_cmd() {
    for command in [
        "git -C D:\\Projects\\workflows checkout main",
        "git -C 'D:\\Projects\\workflows' reset --hard",
        "git -C D:/Projects/workflows merge x",
        "git.exe -C D:/Projects/workflows commit -am x",
        "Set-Location D:\\Projects\\workflows; git reset --hard",
        "Set-Location -Path 'D:\\Projects\\workflows'\ngit checkout main",
        "cd D:/Projects/workflows; git pull",
        "sl D:\\Projects\\workflows; git stash",
        "Push-Location D:\\Projects\\workflows; git clean -fd",
        "$r = 'D:\\Projects\\workflows'; git -C $r checkout main",
        "$env:GIT_DIR = 'D:\\Projects\\workflows\\.git'; git -C D:\\Projects\\workflows reset --hard",
        "git --work-tree=D:\\Projects\\workflows checkout .",
        "powershell -Command \"git -C D:\\Projects\\workflows checkout main\"",
        "Set-Location D:\\Projects\\workflows && git checkout main",
    ] {
        asks(Shell::PowerShell, command);
    }
    asks(
        Shell::Cmd,
        "cd /d D:\\Projects\\workflows && git checkout main",
    );
    asks(Shell::Cmd, "git -C D:\\Projects\\workflows reset --hard");
    asks(
        Shell::Bash,
        "cmd /c \"cd /d D:\\Projects\\workflows && git checkout main\"",
    );
}

/// A place nothing tells is not read as the user's checkout: an agent often writes `cd "$(git rev-parse
/// --show-toplevel)"` in its own worktree, and the rule is for the commands that name the checkout.
#[test]
fn a_git_command_whose_folder_nothing_tells_goes_on() {
    for command in [
        "git -C $UNSET checkout main",
        "git -C \"$REPO/sub\" commit -am x",
        "cd \"$(git rev-parse --show-toplevel)\" && git commit -am x",
        "git -C \"$(git rev-parse --show-toplevel)\" add -A",
        "git -C \"$(git rev-parse --show-superproject-working-tree)\" checkout main",
        "cd $DIR && git commit -am x",
        "git --git-dir=$G reset --hard",
        "for d in $(ls); do git -C \"$d\" checkout main; done",
        "git -C \"$PWD/$x\" commit -am x",
    ] {
        passes(Shell::Bash, command);
    }
    passes(Shell::PowerShell, "git -C $env:UNSET checkout main");
    passes(
        Shell::PowerShell,
        "Set-Location (git rev-parse --show-toplevel); git commit -am x",
    );
    // A folder only partly told, but below the checkout, is one of its.
    for command in [
        "git -C \"D:/Projects/workflows/$x\" commit -am x",
        "git -C D:/Projects/workflows/$x/ reset --hard",
    ] {
        asks(Shell::Bash, command);
    }
}

/// A subshell, a group, `|| exit` and the call operator of PowerShell are read as the commands they hold.
#[test]
fn a_git_command_inside_a_group_a_subshell_or_a_call_operator_asks() {
    for command in [
        "(cd D:/Projects/workflows && git checkout main)",
        "{ cd /d/Projects/workflows; git reset --hard; }",
        "cd /d/Projects/workflows || exit 1; git pull",
        "cd /d/Projects/workflows || exit 1\ngit pull",
        "if true; then git -C /d/Projects/workflows checkout main; fi",
        "( git -C D:/Projects/workflows reset --hard )",
        "true && git -C D:/Projects/workflows reset --hard || echo failed",
        "echo done | git -C D:/Projects/workflows commit -F -",
    ] {
        asks(Shell::Bash, command);
    }
    for command in [
        "& git -C D:\\Projects\\workflows checkout main",
        "& 'C:\\Program Files\\Git\\cmd\\git.exe' -C D:\\Projects\\workflows checkout main",
        "& \"C:\\Program Files\\Git\\cmd\\git.exe\" -C D:\\Projects\\workflows checkout main",
        "& git.exe --work-tree=D:\\Projects\\workflows reset --hard",
        "(& git -C D:\\Projects\\workflows checkout main)",
        "if ($true) { git -C D:\\Projects\\workflows checkout main }",
        "try { git -C D:\\Projects\\workflows reset --hard } catch { }",
    ] {
        asks(Shell::PowerShell, command);
    }
}

/// A run of `-C` costs as much as the commands it is: past what is read, it asks as a command too tangled to read.
#[test]
fn a_git_command_with_hundreds_of_dash_c_is_asked_about_not_read_to_the_end() {
    let many = "-C . ".repeat(50_000);
    let command = format!("git {many}checkout main");
    let started = std::time::Instant::now();
    let asked = judged(Shell::Bash, &command).expect("asked");
    assert!(started.elapsed() < READ_BUDGET + Duration::from_millis(500));
    assert!(!asked.deny);
    assert!(
        asked.reason.contains("could not read to its end"),
        "{}",
        asked.reason
    );
    let refused = guard(true, true)
        .check(Shell::Bash, &command, &here)
        .expect("refused");
    assert!(refused.deny);
}

#[test]
fn reading_the_users_checkout_goes_on() {
    for command in [
        "git -C D:/Projects/workflows status",
        "git -C D:/Projects/workflows status --porcelain",
        "git -C /d/Projects/workflows log --oneline -5",
        "git -C D:/Projects/workflows diff HEAD~1",
        "git -C D:/Projects/workflows show HEAD",
        "git -C D:/Projects/workflows rev-parse --show-toplevel",
        "git -C D:/Projects/workflows rev-list --count main..x",
        "git -C D:/Projects/workflows branch",
        "git -C D:/Projects/workflows branch --list",
        "git -C D:/Projects/workflows branch --list 'dummyplane/*'",
        "git -C D:/Projects/workflows branch -a",
        "git -C D:/Projects/workflows branch --contains abc",
        "git -C D:/Projects/workflows branch --show-current",
        "git -C D:/Projects/workflows tag --list",
        "git -C D:/Projects/workflows stash list",
        "git -C D:/Projects/workflows worktree list",
        "git -C D:/Projects/workflows ls-files",
        "git -C D:/Projects/workflows cat-file -p HEAD",
        "git -C D:/Projects/workflows for-each-ref refs/heads",
        "git -C D:/Projects/workflows merge-base main x",
        "git -C D:/Projects/workflows fetch",
        "git -C $UNSET status",
        "cd /d/Projects/workflows && git status",
        "cd /d/Projects/workflows && git log --oneline | head",
        "cd /d/Projects/workflows; git diff --stat",
        "GIT_DIR=/d/Projects/workflows/.git git log",
        "git --git-dir=D:/Projects/workflows/.git log -1",
        "git --version",
        "git",
        "git help commit",
    ] {
        passes(Shell::Bash, command);
    }
    for command in [
        "git -C D:\\Projects\\workflows status",
        "Set-Location D:\\Projects\\workflows; git log --oneline",
        "git -C D:\\Projects\\workflows branch --list",
        "git -C D:\\Projects\\workflows diff",
    ] {
        passes(Shell::PowerShell, command);
    }
}

#[test]
fn git_in_the_agents_own_worktree_or_anywhere_else_goes_on() {
    for command in [
        "git checkout -b x",
        "git commit -am x",
        "git reset --hard",
        "git stash && git stash pop",
        "git merge main",
        "git branch -D old",
        "git worktree add ../x",
        "git -C . commit -am x",
        "git -C D:/Projects/workflows.worktrees/web-foundation-thor commit -am x",
        "git -C /d/Projects/workflows.worktrees/web-foundation-thor reset --hard",
        "git -C ../web-foundation-thor merge x",
        // The mission's own worktree, beside the agent's.
        "git -C D:/Projects/workflows.worktrees/web-foundation merge x",
        "git -C ../web-foundation checkout main",
        "git -C \"$PWD\" checkout x",
        "git -C \"$PWD/$x\" commit -am x",
        "cd src && git commit -am x",
        "cd . && git checkout x",
        "cd /d/Projects/workflows.worktrees/web-foundation && git merge x",
        "git -C D:/Projects/other checkout main",
        "git -C /tmp/x commit -am x",
        "cd /tmp && git init && git commit --allow-empty -m x",
        "git --work-tree=D:/Projects/workflows.worktrees/web-foundation-thor checkout .",
        "GIT_DIR=/d/Projects/workflows.worktrees/web-foundation-thor/.git git reset --hard",
        // The user's folder in the name of something else is not their checkout.
        "git -C D:/Projects/workflows-old checkout main",
        "git -C D:/Projects/workflows2 reset --hard",
        "git -C D:/Projects/workflows.worktrees checkout main",
        "echo git -C D:/Projects/workflows checkout main",
        "grep 'git -C D:/Projects/workflows checkout' notes.md",
    ] {
        passes(Shell::Bash, command);
    }
    for command in [
        "git checkout -b x",
        "git -C . reset --hard",
        "git -C D:\\Projects\\workflows.worktrees\\web-foundation-thor commit -am x",
        "Set-Location ..\\web-foundation; git merge x",
        "git -C D:\\Projects\\other checkout main",
    ] {
        passes(Shell::PowerShell, command);
    }
}

/// An agent that is no mission's (the user's own, or one started in another folder) is not stopped.
#[test]
fn an_agent_that_is_not_a_missions_is_unaffected() {
    for unattended in [false, true] {
        for command in [
            "git -C D:/Projects/workflows checkout main",
            "cd /d/Projects/workflows && git reset --hard",
            "GIT_DIR=/d/Projects/workflows/.git git reset --hard",
            "git -C $UNSET commit -am x",
        ] {
            assert_eq!(
                guard(unattended, false).check(Shell::Bash, command, &here),
                None,
                "{command}"
            );
        }
    }
}

/// What a mission's agent is told is one text for the prompt and the refusal, naming both folders.
#[test]
fn the_reason_names_the_folder_it_stops_and_the_one_to_work_in() {
    let asked = judged(
        Shell::Bash,
        "git -C D:/Projects/workflows/src checkout main",
    )
    .unwrap();
    assert!(!asked.deny);
    assert!(asked.reason.contains("`git checkout`"));
    assert!(asked.reason.contains("D:/Projects/workflows/src"));
    assert!(asked.reason.contains(CHECKOUT));
    assert!(asked.reason.contains(SCOPE));
    assert!(asked.reason.contains("Land button"));
    assert!(!asked.reason.starts_with(GUARD_MARKER));
}

/// A list of commands each asks once: the reasons are not repeated, and a long script is read in the hook's time.
#[test]
fn a_long_script_of_git_commands_is_read_in_the_hook_s_time() {
    let many = (0..20_000)
        .map(|n| format!("git -C D:/Projects/workflows checkout b{n}"))
        .collect::<Vec<_>>()
        .join("; ");
    let started = std::time::Instant::now();
    let asked = judged(Shell::Bash, &many);
    assert!(started.elapsed() < READ_BUDGET + Duration::from_millis(500));
    assert!(asked.is_some_and(|verdict| !verdict.deny));
    let reads = (0..20_000)
        .map(|n| format!("git -C D:/Projects/workflows log -{n}"))
        .collect::<Vec<_>>()
        .join("; ");
    let started = std::time::Instant::now();
    let read = judged(Shell::Bash, &reads);
    assert!(started.elapsed() < READ_BUDGET + Duration::from_millis(500));
    // Read to the end, or asked about for being too long: never refused for what only reads.
    assert!(read.is_none_or(|verdict| !verdict.deny));
}

/// A mission's worktree on disk: `<project>.worktrees/<name>` with the `.git` link of a linked worktree of `<project>`.
fn mission_layout(link_to: Option<&str>) -> (tempfile::TempDir, PathBuf, PathBuf) {
    let parent = tempfile::tempdir().unwrap();
    let project = parent.path().join("proj");
    let worktree = parent.path().join("proj.worktrees").join("auth-thor");
    std::fs::create_dir_all(project.join(".git").join("worktrees").join("auth-thor")).unwrap();
    std::fs::create_dir_all(&worktree).unwrap();
    let target = match link_to {
        Some(other) => other.to_string(),
        None => project
            .join(".git")
            .join("worktrees")
            .join("auth-thor")
            .to_string_lossy()
            .replace('\\', "/"),
    };
    std::fs::write(worktree.join(".git"), format!("gitdir: {target}\n")).unwrap();
    (parent, project, worktree)
}

fn started_in(folder: &Path) -> Guard {
    let text = folder.to_string_lossy();
    Guard::new(Some(&text), Some(&text), Some(HOME), &[], cfg!(windows))
}

fn forward(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[test]
fn a_missions_agent_is_told_from_its_folder_and_its_git_link() {
    let (_parent, project, worktree) = mission_layout(None);
    assert_eq!(
        started_in(&worktree).mission_checkout(),
        Some(started_in(&project).scope.clone().unwrap())
    );
    // The user's own checkout, a folder that is not a worktrees' one, a `.git` that is a folder: no mission.
    assert_eq!(started_in(&project).mission_checkout(), None);
    let (_other, _p, plain) = mission_layout(None);
    let renamed = plain.parent().unwrap().parent().unwrap().join("elsewhere");
    std::fs::create_dir_all(&renamed).unwrap();
    std::fs::copy(plain.join(".git"), renamed.join(".git")).unwrap();
    assert_eq!(started_in(&renamed).mission_checkout(), None);
    std::fs::remove_file(worktree.join(".git")).unwrap();
    std::fs::create_dir(worktree.join(".git")).unwrap();
    assert_eq!(started_in(&worktree).mission_checkout(), None);
    // A link to another repository than the project beside the folder is not the project's mission.
    let (_third, _p, elsewhere) = mission_layout(Some("D:/else/where/.git/worktrees/auth-thor"));
    assert_eq!(started_in(&elsewhere).mission_checkout(), None);
    // Not a link at all.
    let (_fourth, _p, garbled) = mission_layout(None);
    std::fs::write(garbled.join(".git"), "not a link\n").unwrap();
    assert_eq!(started_in(&garbled).mission_checkout(), None);
}

/// A repository with one commit, as `git init` and `git commit` make it, in a temporary folder.
fn repository() -> Option<(tempfile::TempDir, PathBuf)> {
    let run = |dir: &Path, args: &[&str]| {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .ok()?;
        out.status.success().then_some(())
    };
    let parent = tempfile::tempdir().ok()?;
    let project = parent.path().join("proj");
    std::fs::create_dir(&project).ok()?;
    run(&project, &["init", "-q", "-b", "main"])?;
    for (key, value) in [
        ("user.name", "t"),
        ("user.email", "t@t"),
        ("commit.gpgsign", "false"),
        ("core.autocrlf", "false"),
    ] {
        run(&project, &["config", key, value])?;
    }
    std::fs::write(project.join("a.txt"), "a\n").ok()?;
    run(&project, &["add", "a.txt"])?;
    run(&project, &["commit", "-q", "-m", "init"])?;
    Some((parent, project))
}

/// The worktrees dummyPlane itself makes for a mission and for an agent of it, not ones this test writes: the guard
/// must know them, or the rule stops nothing and every test above still passes.
#[test]
fn the_worktrees_a_mission_really_makes_are_known_as_a_missions() {
    let Some((_parent, project)) = repository() else {
        return;
    };
    let mission = crate::mission::prepare(&project, "auth").unwrap();
    let thor = crate::mission::add_agent(&project, &mission.slug, "Thor").unwrap();
    let checkout = started_in(&project).scope.clone().unwrap();
    for tree in [&thor, &mission] {
        let at = Path::new(&tree.path);
        assert_eq!(
            started_in(at).mission_checkout().as_deref(),
            Some(checkout.as_str()),
            "{}",
            tree.path
        );
        // The hook asks for a change of the user's checkout from there, and leaves its own worktree alone.
        let url = with_scope("http://127.0.0.1:1/hook/claude/n1?t=tok", at);
        let call = |command: String, mode: &str| {
            json!({
                "hook_event_name": "PreToolUse",
                "tool_name": "Bash",
                "tool_input": { "command": command },
                "cwd": forward(at),
                "permission_mode": mode,
            })
        };
        for command in [
            format!("git -C {} checkout main", forward(&project)),
            format!("cd {} && git reset --hard", forward(&project)),
            "git -C ../../proj stash".to_string(),
        ] {
            let asked = decide(&call(command.clone(), "default"), &url, cfg!(windows))
                .unwrap_or_else(|| panic!("{command}: not asked from {}", tree.path));
            assert_eq!(
                asked["hookSpecificOutput"]["permissionDecision"], "ask",
                "{command}"
            );
            let refused = decide(&call(command.clone(), "dontAsk"), &url, cfg!(windows)).unwrap();
            assert_eq!(
                refused["hookSpecificOutput"]["permissionDecision"], "deny",
                "{command}"
            );
        }
        for command in [
            "git commit -am x".to_string(),
            format!("git -C {} commit -am x", forward(at)),
            format!("git -C {} status", forward(&project)),
            "cd \"$(git rev-parse --show-toplevel)\" && git commit -am x".to_string(),
        ] {
            assert_eq!(
                decide(&call(command.clone(), "dontAsk"), &url, cfg!(windows)),
                None,
                "{command}"
            );
        }
    }
    // The user's own checkout is no mission's.
    assert_eq!(started_in(&project).mission_checkout(), None);
}

/// The hook: a mission's agent, and the same words from a session started in the user's own checkout.
#[test]
fn the_hook_asks_a_missions_agent_and_leaves_the_users_own_session_alone() {
    let (_parent, project, worktree) = mission_layout(None);
    let command = format!("git -C {} checkout main", forward(&project));
    let own = format!("git -C {} checkout main", forward(&worktree));
    let url = |folder: &Path| with_scope("http://127.0.0.1:1/hook/claude/n1?t=tok", folder);
    let call = |cwd: &Path, mode: &str, command: &str| {
        json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": { "command": command },
            "cwd": forward(cwd),
            "permission_mode": mode,
        })
    };
    let asked = decide(
        &call(&worktree, "default", &command),
        &url(&worktree),
        cfg!(windows),
    )
    .unwrap();
    let output = &asked["hookSpecificOutput"];
    assert_eq!(output["permissionDecision"], "ask");
    let reason = output["permissionDecisionReason"].as_str().unwrap();
    assert!(reason.starts_with(GUARD_MARKER), "{reason}");
    assert!(
        reason.contains("changes the user's own checkout"),
        "{reason}"
    );
    let refused = decide(
        &call(&worktree, "dontAsk", &command),
        &url(&worktree),
        cfg!(windows),
    )
    .unwrap();
    let output = &refused["hookSpecificOutput"];
    assert_eq!(output["permissionDecision"], "deny");
    assert!(
        !output["permissionDecisionReason"]
            .as_str()
            .unwrap()
            .starts_with(GUARD_MARKER)
    );
    // In its own worktree it goes on; reading the user's checkout goes on; so does the user's own session.
    for (cwd, command) in [
        (&worktree, own.clone()),
        (&worktree, format!("git -C {} status", forward(&project))),
        (&project, command.clone()),
    ] {
        assert_eq!(
            decide(&call(cwd, "default", &command), &url(cwd), cfg!(windows)),
            None,
            "{command}"
        );
    }
}
