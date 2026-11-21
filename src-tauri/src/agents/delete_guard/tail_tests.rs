//! The tests of a value that fills the whole of what follows the agent's own folder or its `.git`
//! (`rm -rf ./$x`): where it is empty the target is that folder itself, so it is asked about like a
//! path that cannot be checked. What only ends a name (`dist/$pkg`, `build-$n`) is not.

use super::*;

const SCOPE: &str = "D:/Projects/dummyPlane/.claude/worktrees/f5b";
const HOME: &str = "C:/Users/ahmed";
const TEMP: &str = "C:/Users/AHMED~1/AppData/Local/Temp";
const INSTEAD: &str = "delete the specific files you made, by name, or ask the user";

fn guard(unattended: bool) -> Guard {
    let mut guard = Guard::new(
        Some(SCOPE),
        Some(SCOPE),
        Some(HOME),
        &[TEMP, "C:/Users/ahmed/AppData/Local/Temp"],
        true,
    );
    guard.unattended = unattended;
    guard
}

fn here(_: &str) -> Option<bool> {
    Some(true)
}

fn judged(shell: Shell, command: &str, unattended: bool) -> Option<Verdict> {
    guard(unattended).check(shell, command, &here)
}

/// Asked, and the reason says what the target is when its value is empty.
#[track_caller]
fn asks_about(shell: Shell, command: &str, empty: &str) {
    let asked = judged(shell, command, false).unwrap_or_else(|| panic!("{command}: not asked"));
    assert!(!asked.deny, "{command}: {}", asked.reason);
    assert!(
        asked.reason.contains(&format!("(empty, it is {empty})")),
        "{command}: {}",
        asked.reason
    );
    assert!(asked.reason.contains("only known when the command runs"));
    assert!(asked.reason.contains("write the path out in full"));
    // Under `dontAsk` the same command is refused, told what to do instead.
    let refused = judged(shell, command, true).unwrap_or_else(|| panic!("{command}: not refused"));
    assert!(refused.deny, "{command}: {}", refused.reason);
    assert!(refused.reason.contains(INSTEAD), "{}", refused.reason);
}

#[track_caller]
fn goes_on(shell: Shell, command: &str) {
    for unattended in [false, true] {
        assert_eq!(
            judged(shell, command, unattended),
            None,
            "{command} (unattended: {unattended})"
        );
    }
}

/// The folder an agent stands in is gone with an empty value: `rm -rf ./$x` is `rm -rf ./`.
#[test]
fn a_value_that_fills_the_whole_tail_after_the_worktree_root_asks() {
    for command in [
        "rm -rf ./$x",
        "rm -rf ./${x}",
        "rm -rf \"./$x\"",
        "rm -rf \"$PWD/$x\"",
        "rm -rf $PWD/$x",
        "rm -rf \"${PWD}/${x}\"",
        "rm -rf ./$x$y",
        "rm -rf ./$x/",
        "rm -rf ./$x//",
        "rm -rf ./$x/$y",
        "rm -rf ./$(basename \"$f\")",
        "rm -rf ./`echo $x`",
        "rm -rf -- ./$x",
        "rm -r -f ./$x",
        "rm -Rf ./$x",
        "rm -rf D:/Projects/dummyPlane/.claude/worktrees/f5b/$x",
        "rm -rf /d/Projects/dummyPlane/.claude/worktrees/f5b/$x",
        "cd . && rm -rf ./$x",
        "bash -c 'rm -rf ./$x'",
        "x=$(cat name.txt); rm -rf ./$x",
        "for d in $(ls); do rm -rf ./$d; done",
    ] {
        asks_about(Shell::Bash, command, "its whole folder");
    }
}

/// `.git/$x` is `.git/` where the value is empty: the agent's whole history.
#[test]
fn a_value_that_fills_the_whole_tail_after_dot_git_asks() {
    for command in [
        "rm -rf .git/$x",
        "rm -rf ./.git/$x",
        "rm -rf .git/${x}",
        "rm -rf \"$PWD/.git/$x\"",
        "rm -rf .git/$x$y",
        "rm -rf .git/$x/",
        "rm -rf D:/Projects/dummyPlane/.claude/worktrees/f5b/.git/$x",
    ] {
        asks_about(Shell::Bash, command, "its git history");
    }
}

#[test]
fn the_same_in_powershell_and_cmd_with_their_own_variables() {
    for command in [
        "Remove-Item -Recurse ./$x",
        "Remove-Item -Recurse -Force \"$PWD\\$x\"",
        "Remove-Item -Recurse -Force .\\$x",
        "Remove-Item -Recurse ./$env:X",
        "Remove-Item -Recurse -Force \".\\${x}\"",
        "Remove-Item -Recurse $PWD/$env:X",
        "Remove-Item -Path ./$x -Recurse",
        "ri -r -fo ./$x",
        "rm -r ./$x",
        "rd /s /q .\\$x",
        "$d = Get-Location; Remove-Item -Recurse $d/$x",
        "powershell -Command \"Remove-Item -Recurse ./$env:X\"",
    ] {
        asks_about(Shell::PowerShell, command, "its whole folder");
    }
    for command in [
        "Remove-Item -Recurse .git\\$x",
        "Remove-Item -Recurse -Force .git/$env:X",
        "Remove-Item -Recurse \"$PWD\\.git\\$x\"",
        "ri -r .git\\${x}",
    ] {
        asks_about(Shell::PowerShell, command, "its git history");
    }
    for command in [
        "cmd /c \"rd /s /q .\\%X%\"",
        "cmd /c \"rd /s /q %CD%\\%X%\"",
        "cmd /c \"rmdir /s /q .\\%X%%Y%\"",
        "cmd /c \"rd /s /q .git\\%X%\"",
    ] {
        let asked =
            judged(Shell::Bash, command, false).unwrap_or_else(|| panic!("{command}: not asked"));
        assert!(!asked.deny, "{command}: {}", asked.reason);
        assert!(
            asked.reason.contains("(empty, it is its"),
            "{command}: {}",
            asked.reason
        );
        assert!(
            judged(Shell::Bash, command, true).unwrap().deny,
            "{command}"
        );
    }
    asks_about(Shell::Cmd, "rd /s /q .\\%X%", "its whole folder");
    asks_about(Shell::Cmd, "rd /s /q .git\\%X%", "its git history");
}

/// A literal name before the value (`dist/$pkg`, `build-$n`), or one after it, keeps the delete inside.
#[test]
fn a_literal_name_beside_the_value_keeps_it_going_on() {
    for command in [
        "rm -rf dist/$pkg",
        "rm -rf ./dist/$pkg",
        "rm -rf packages/$p/dist",
        "rm -rf build-$n",
        "rm -rf ./build-$n",
        "rm -rf ./$x.bak",
        "rm -rf ./$x-old",
        "rm -rf ./$x*",
        "rm -rf ./$x/dist",
        "rm -rf ./$x/*",
        "rm -rf ./.git-backup-$x",
        "rm -rf .gitx/$y",
        "rm -rf ./src/$x",
        "rm -rf $PWD/src/$x",
        "rm -rf \"$PWD/dist-$x\"",
        "cd src && rm -rf ./$x",
        "cd src && rm -rf \"$PWD/$x\"",
        "rm -rf .git/hooks/$x",
        "rm -rf $TMPDIR/$x",
        "rm -rf \"$TEMP/$x\"",
        "rm -f ./$x",
        "rm -d ./$x",
        "rm -rf $(find . -name node_modules -type d)",
        "rm -rf `find build -name x`",
        "find . -name node_modules -prune -exec rm -rf {} +",
        "find . -type d -name dist | xargs rm -rf",
        "find . -name '*.tmp' -delete",
    ] {
        goes_on(Shell::Bash, command);
    }
    for command in [
        "Remove-Item -Recurse dist/$pkg",
        "Remove-Item -Recurse ./build-$n",
        "Remove-Item -Recurse -Force ./$x.bak",
        "Remove-Item -Recurse -Force .\\$x\\dist",
        "Remove-Item -Recurse -Force \"$PWD\\src\\$x\"",
        "Get-ChildItem . -Recurse -Filter dist | Remove-Item -Recurse",
        "Remove-Item -Recurse \"$env:TEMP\\$x\"",
        "Remove-Item ./$x",
    ] {
        goes_on(Shell::PowerShell, command);
    }
    goes_on(Shell::Cmd, "rd /s /q dist\\%PKG%");
    goes_on(Shell::Cmd, "rd /s /q .\\%X%.bak");
}

/// What is outside the folder, or cannot be placed at all, was asked about before and still is, in its own words.
#[test]
fn what_was_asked_about_before_is_asked_in_the_same_words() {
    for (command, wording) in [
        ("rm -rf ../$x", "dummyPlane asks before a recursive delete"),
        (
            "rm -rf $x",
            "dummyPlane asks before a recursive delete it cannot check",
        ),
        ("rm -rf /d/$x", "dummyPlane asks before a recursive delete"),
    ] {
        let asked = judged(Shell::Bash, command, false).unwrap();
        assert!(
            !asked.deny && asked.reason.starts_with(wording),
            "{command}"
        );
        assert!(!asked.reason.contains("(empty, it is"), "{command}");
    }
}

/// The hook's answer is the one it always gave: an ask bears the marker, `dontAsk` refuses.
#[test]
fn the_hook_answers_with_the_marker_and_dont_ask_refuses() {
    let url = with_scope("http://127.0.0.1:1/hook/claude/n1?t=tok", Path::new(SCOPE));
    let call = |mode: &str, command: &str| {
        json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": { "command": command },
            "cwd": SCOPE,
            "permission_mode": mode,
        })
    };
    let asked = decide(&call("default", "rm -rf ./$x"), &url, true).unwrap();
    let output = &asked["hookSpecificOutput"];
    assert_eq!(output["permissionDecision"], "ask");
    assert!(
        output["permissionDecisionReason"]
            .as_str()
            .unwrap()
            .starts_with(GUARD_MARKER)
    );
    let refused = decide(&call("dontAsk", "rm -rf ./$x"), &url, true).unwrap();
    assert_eq!(refused["hookSpecificOutput"]["permissionDecision"], "deny");
    assert!(
        !refused["hookSpecificOutput"]["permissionDecisionReason"]
            .as_str()
            .unwrap()
            .starts_with(GUARD_MARKER)
    );
    assert_eq!(
        decide(&call("default", "rm -rf dist/$pkg"), &url, true),
        None
    );
}

/// Linear: a value and a tail thousands of times over is read as far as the budget goes, then asked about.
#[test]
fn a_very_long_tail_of_values_is_read_in_the_hook_s_time() {
    let tail = "$x".repeat(200_000);
    let command = format!("rm -rf ./{tail}");
    let started = std::time::Instant::now();
    let asked = judged(Shell::Bash, &command, false);
    assert!(started.elapsed() < READ_BUDGET + Duration::from_millis(500));
    assert!(asked.is_some_and(|verdict| !verdict.deny));
    let many = (0..20_000)
        .map(|n| format!("rm -rf ./dist/$p{n}"))
        .collect::<Vec<_>>()
        .join("; ");
    let started = std::time::Instant::now();
    assert!(judged(Shell::Bash, &many, false).is_none_or(|verdict| !verdict.deny));
    assert!(started.elapsed() < READ_BUDGET + Duration::from_millis(500));
}
