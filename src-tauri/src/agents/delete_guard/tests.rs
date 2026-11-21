//! The tests of the delete guard: what it lets through, asks and denies, and what it reads.

use super::*;

const SCOPE: &str = "D:/Projects/dummyPlane/.claude/worktrees/k";
const HOME: &str = "C:/Users/ahmed";

fn win() -> Guard {
    Guard::new(
        Some(SCOPE),
        Some(SCOPE),
        Some(HOME),
        // As the variable gives it, and as Windows spells it in full.
        &[
            "C:/Users/AHMED~1/AppData/Local/Temp",
            "C:/Users/ahmed/AppData/Local/Temp",
        ],
        true,
    )
}

fn unix() -> Guard {
    Guard::new(
        Some("/home/u/proj"),
        Some("/home/u/proj"),
        Some("/home/u"),
        &["/tmp"],
        false,
    )
}

fn here(_: &str) -> Option<bool> {
    Some(true)
}

fn verdict(guard: &Guard, shell: Shell, command: &str) -> Option<Verdict> {
    guard.check(shell, command, &here)
}

fn bash(command: &str) -> Option<Verdict> {
    verdict(&win(), Shell::Bash, command)
}

fn power(command: &str) -> Option<Verdict> {
    verdict(&win(), Shell::PowerShell, command)
}

#[track_caller]
fn passes(command: &str) {
    assert_eq!(bash(command), None, "{command}");
}

#[track_caller]
fn asks(command: &str) -> String {
    let verdict = bash(command).unwrap_or_else(|| panic!("{command}: not asked"));
    assert!(!verdict.deny, "{command}: {}", verdict.reason);
    verdict.reason
}

#[track_caller]
fn denies(command: &str) -> String {
    let verdict = bash(command).unwrap_or_else(|| panic!("{command}: not denied"));
    assert!(verdict.deny, "{command}: {}", verdict.reason);
    verdict.reason
}

/// Deletes inside the agent's own folder are what it does all day.
#[test]
fn a_delete_inside_the_agent_s_folder_goes_on() {
    for command in [
        "rm -rf node_modules",
        "rm -rf dist build target/debug",
        "rm -rf ./src-tauri/target",
        "rm -rf *",
        "rm -rf ./*",
        "rm -rf packages/*/dist",
        "rm -rf D:/Projects/dummyPlane/.claude/worktrees/k/out",
        "rm -rf /d/Projects/dummyPlane/.claude/worktrees/k/out",
        "rm -rf d:/projects/dummyplane/.claude/worktrees/K/out",
        "rm -rf \"D:\\Projects\\dummyPlane\\.claude\\worktrees\\k\\out\"",
        "cd src && rm -rf ../dist",
        "cd packages/a; rm -rf dist; cd ..; rm -rf build",
        "rm -rf dist && ls /d/temp",
        "rm -rf C:/Users/ahmed/AppData/Local/Temp/claude/abc/scratchpad/out",
        "rm -f /d/temp/log.txt",
        "rm /d/temp/x/y",
        "ls /d/temp; echo hi > /d/d/out.txt; cat /d/x",
    ] {
        passes(command);
    }
}

/// Evidence: `D:\temp` through Bash left a drive-relative `D:tempT11-pytest.log` and
/// `tempT11-*` dirs in the worktree (e0c01ab0, 2026-11-13T04:40).
#[test]
fn a_drive_relative_path_is_denied_for_any_rm_as_what_bash_made_of_a_windows_path() {
    let evidence = "rm -rf tempT11-bt tempT11-bt-red tempT11-bt2 tempT11-full && rm -f D:tempT11-pytest.log && find . -maxdepth 1 -name 'D*' -o -maxdepth 1 -name '*T11*' | head; git status --short";
    let reason = denies(evidence);
    assert!(reason.contains("D:tempT11-pytest.log"), "{reason}");
    assert!(reason.contains("forward slashes"), "{reason}");
    // The same without the drive-relative file: the worktree's own dirs go.
    passes("rm -rf tempT11-bt tempT11-bt-red tempT11-bt2 tempT11-full");
    // Typed with backslashes and unquoted, `D:\temp\x` is `D:tempx` once Bash has read it.
    denies("rm -rf D:\\temp\\x");
    denies("rm -f D:\\temp\\x.log");
    denies("rm -rf D:");
    denies("cd src && rm -rf C:Users");
    // Doubled, or quoted, the backslashes reach rm: a whole path, outside the folder.
    asks("rm -rf D:\\\\temp\\\\x");
    asks("rm -rf 'D:\\temp\\x'");
    asks("rm -rf \"D:\\temp\\x\"");
    // Only rm is read: other commands name D:tempx as they like.
    passes("ls D:tempx; cat D:tempx");
    // PowerShell does not read backslashes: the path was written so.
    let verdict = power("Remove-Item -Force D:tempx.log").unwrap();
    assert!(verdict.deny && verdict.reason.contains("current folder of its drive"));
}

/// Evidence: `rm -rf /d/d`, a stray folder of a mangled path, asked three times: after `cp -r ... &&`
/// and after `;` (53690500, ada5963e).
#[test]
fn a_delete_outside_the_agent_s_folder_asks_the_user_and_says_what_it_removes() {
    let reason = asks("cp -r /d/d/temp/V4-probe/skills /d/temp/V4-probe/ && rm -rf /d/d");
    assert!(
        reason.contains("removes D:/d, which exists, outside its folder"),
        "{reason}"
    );
    assert!(reason.contains(SCOPE), "{reason}");
    let reason = asks(
        "ls /d/d/temp 2>/dev/null; rm -rf /d/d; python /d/temp/split_scan.py . D:/temp/split_out > D:/temp/split_scan_v1.log 2>&1; ls D:/temp/split_out",
    );
    assert!(reason.contains("D:/d"), "{reason}");
    // The cleanup agent of 71a81297: venvs of D:\temp, none of its own.
    let reason = asks("rm -rf /d/temp/venv-ctx /d/temp/venv-verify");
    assert!(reason.contains("D:/temp/venv-ctx") || reason.contains("D:/temp/venv-verify"));
    let missing = |_: &str| Some(false);
    let verdict = verdict_with(&missing, "rm -rf /d/temp/gone");
    assert!(
        verdict.reason.contains("which does not exist yet"),
        "{}",
        verdict.reason
    );
    let unchecked = |_: &str| None;
    let verdict = verdict_with(&unchecked, "rm -rf /d/temp/gone");
    assert!(
        verdict.reason.contains("which was not checked"),
        "{}",
        verdict.reason
    );
    let reason = asks("rm -rf /d/temp/venv-*");
    assert!(reason.contains("D:/temp/*"), "{reason}");
    assert!(reason.contains("what matches under it"), "{reason}");
    for command in [
        "rm -rf ..",
        "rm -rf ../other",
        "rm -rf /d/Projects/dummyPlane",
        "rm -rf ../../../..",
        "cd /d/temp && rm -rf venv-ctx",
        "cd /d/temp; rm -rf venv-ctx",
        "cd src && rm -rf ../../../../x",
        "rm -rf $HOME/.cache",
        "rm -rf ~/.cache",
        "rm -rf ${HOME}/x",
        "rm -rf //server/share/x",
        "rm -rf \"D:/Projects/dummyPlane\"",
    ] {
        asks(command);
    }
    // The folder next to it by name is not it: components, not prefixes.
    asks("rm -rf D:/Projects/dummyPlane/.claude/worktrees/k-old");
    asks("rm -rf D:/Projects/dummyPlane/.claude/worktrees/ka/out");
}

fn verdict_with(exists: &dyn Fn(&str) -> Option<bool>, command: &str) -> Verdict {
    win().check(Shell::Bash, command, exists).unwrap()
}

#[test]
fn the_whole_folder_and_its_git_history_ask_too() {
    for command in [
        "rm -rf .",
        "rm -rf ./",
        "rm -rf ../k",
        "rm -rf /d/Projects/dummyPlane/.claude/worktrees/k",
    ] {
        assert!(asks(command).contains("its whole folder"), "{command}");
    }
    for command in ["rm -rf .git", "cd src && rm -rf ../.git"] {
        assert!(asks(command).contains("its git history"), "{command}");
    }
    passes("rm -rf .github .gitlab");
}

#[test]
fn a_drive_a_home_and_what_is_above_it_are_denied() {
    for command in [
        "rm -rf /",
        "rm -rf /*",
        "rm -rf D:/",
        "rm -rf D:/*",
        "rm -rf /d",
        "rm -rf /d/",
        "rm -rf /d/*",
        "rm -rf ~",
        "rm -rf ~/",
        "rm -rf ~/*",
        "rm -rf $HOME",
        "rm -rf \"$HOME\"/*",
        "rm -rf C:/Users",
        "rm -rf C:/Users/ahmed",
        "rm -rf C:/",
        "rm -rf ../../../../../../..",
        "sudo rm -rf --no-preserve-root /",
    ] {
        let reason = denies(command);
        assert!(
            reason.contains("root of a drive") || reason.contains("home folder"),
            "{command}: {reason}"
        );
    }
    // What is below the home folder is outside the agent's, so asked.
    asks("rm -rf ~/.cache");
    asks("rm -rf C:/Users/ahmed/Downloads");
}

#[test]
fn a_delete_is_read_through_what_runs_it() {
    for command in [
        "sudo rm -rf /d/x",
        "sudo -n rm -rf /d/x",
        "FOO=1 BAR=2 rm -rf /d/x",
        "env -i rm -rf /d/x",
        "command rm -rf /d/x",
        "nohup rm -rf /d/x &",
        "time rm -rf /d/x",
        "\\rm -rf /d/x",
        "/bin/rm -rf /d/x",
        "rm.exe -rf /d/x",
        "echo hi && rm -rf /d/x",
        "false || rm -rf /d/x",
        "ls | rm -rf /d/x",
        "if true; then rm -rf /d/x; fi",
        "for f in a b; do rm -rf /d/$f; done; rm -rf /d/x",
        "(rm -rf /d/x)",
        "{ rm -rf /d/x; }",
        "echo $(rm -rf /d/x)",
        "bash -c 'rm -rf /d/x'",
        "bash -lc \"cd /d && rm -rf x\"",
        "sh -c \"echo ok; rm -rf /d/x\"",
        "eval \"rm -rf /d/x\"",
        "rm -rf /d/x > /dev/null 2>&1",
        "rm -rf /d/x 2>&1 | tail -1",
        "rm -rf /d/x &> /dev/null",
        "rm -rfv /d/x",
        "rm -fr /d/x",
        "rm -Rf /d/x",
        "rm -r -f /d/x",
        "rm --recursive --force /d/x",
        "rm -rf -- /d/x",
        "rm -rf -- -weird /d/x",
        "rm -rf \\\n /d/x",
        "rm -rf /d/x # tidy",
        "pwsh -NoProfile -Command \"Remove-Item -Recurse -Force D:/x\"",
        "powershell -c 'rd /s /q D:\\x'",
    ] {
        asks(command);
    }
    for command in [
        "ls /d/x",
        "echo rm -rf /d/x",
        "echo 'rm -rf /d/x'",
        "git rm -r --cached /d/x",
        "rm /d/x",
        "rm -f /d/x /d/y",
        // The folder the agent is in is known: so is a target made from it.
        "rm -rf \"$(pwd)/x\"",
        "rm -rf `pwd`/x",
        "cat x > /d/x",
        "cat x >> /d/x",
        "grep -r foo /d/x",
        "# rm -rf /d/x",
        "rmdir /d/x",
        "",
    ] {
        passes(command);
    }
    // A target after a `cd` into a variable is not known: it asks (`forms_tests`: what an unknown target does).
    asks("cd $DIR && rm -rf build");
    asks("cd - && rm -rf build");
    // `cd -` goes back to where the last `cd` left.
    passes("cd src && cd .. && cd - && rm -rf build");
    passes("pushd src && popd && rm -rf build");
    // A `cd` into the folder again.
    passes("cd /d/temp && cd /d/Projects/dummyPlane/.claude/worktrees/k && rm -rf build");
    asks("cd && rm -rf .cache");
    asks("cd ~ && rm -rf work");
    // Both kinds in one command: the denial wins.
    denies("rm -rf /d/x && rm -f D:y.log");
}

/// A script written through a heredoc is text, whatever it says: the commands around it are read.
#[test]
fn a_heredoc_body_is_not_a_command_but_what_follows_it_is() {
    passes("cat > run.sh <<'EOF'\nrm -rf /d/x\nEOF\nls");
    passes("cat > run.sh << \"EOF\"\nrm -rf /d/x\nEOF\n");
    passes("cat <<-EOF > f\n\trm -rf /d/x\n\tEOF\n");
    passes("git commit -m \"$(cat <<'EOF'\nrm -rf /d/x\nEOF\n)\"");
    passes("cat <<EOF\r\nrm -rf /d/x\r\nEOF\r\n");
    asks("cat <<EOF > f\nhi\nEOF\nrm -rf /d/x");
    asks("cat > f <<EOF; rm -rf /d/x\nhi\nEOF");
    // A here-string and a shift are no heredoc; a body never ended hides the rest, as Bash reads it.
    asks("cat <<< \"x\"\nrm -rf /d/x");
    asks("echo $((1<<2))\nrm -rf /d/x");
    passes("cat <<EOF\nrm -rf /d/x");
}

#[test]
fn powershell_deletes_are_read_too() {
    let asked = |command: &str| {
        let verdict = power(command).unwrap_or_else(|| panic!("{command}: not asked"));
        assert!(!verdict.deny, "{command}: {}", verdict.reason);
        verdict.reason
    };
    for command in [
        "Remove-Item -Recurse -Force D:\\temp\\venv-ctx",
        "Remove-Item -Path D:\\temp\\venv-ctx -Recurse -Force",
        "Remove-Item -LiteralPath 'D:\\temp\\venv ctx' -Recurse",
        "Remove-Item D:\\temp\\* -r -fo",
        "remove-item -recurse D:/temp/x",
        "ri -Recurse D:\\temp\\x",
        "rm -r -fo D:\\temp\\x",
        "rd /s /q D:\\x",
        "rmdir /s D:\\x",
        "del /s /q D:\\x\\*",
        "cd D:\\temp; Remove-Item -Recurse -Force venv",
        "Set-Location D:/temp; rm -Recurse venv",
        "Remove-Item -Recurse -Force D:\\temp\\a, D:\\temp\\b",
        "Write-Host hi; & Remove-Item -Recurse D:\\x",
        "Remove-Item `\n -Recurse D:\\x",
        "Remove-Item -Recurse \"D:\\temp\\x\"",
        "Remove-Item -Recurse 'D:\\it''s'",
    ] {
        asked(command);
    }
    for command in [
        "Remove-Item -Recurse -Force node_modules",
        "Remove-Item -Recurse -Force .\\dist",
        "rm -r -fo .\\dist, .\\build",
        "Remove-Item -Recurse -Force -Filter *.log -Path .\\logs",
        "Remove-Item -Recurse -Include *.tmp -Path .\\out",
        "Remove-Item D:\\x\\file.txt",
        "Remove-Item -Force D:\\x\\file.txt",
        "Remove-Item -Recurse $env:TEMP\\x",
        "Get-ChildItem D:\\x -Recurse",
        "Write-Host 'Remove-Item -Recurse D:\\x'",
        "Remove-Item -Recurse -Force D:\\Projects\\dummyPlane\\.claude\\worktrees\\k\\out",
        "Remove-Item -Recurse -Force C:\\Users\\ahmed\\AppData\\Local\\Temp\\claude\\a\\scratchpad",
    ] {
        assert_eq!(power(command), None, "{command}");
    }
    let verdict = power("Remove-Item -Recurse -Force C:\\Users\\ahmed").unwrap();
    assert!(verdict.deny, "{}", verdict.reason);
    let verdict = power("rd /s /q D:\\").unwrap();
    assert!(verdict.deny, "{}", verdict.reason);
}

#[test]
fn a_session_outside_windows_reads_posix_paths() {
    let unix = unix();
    let run = |command: &str| unix.check(Shell::Bash, command, &here);
    for command in [
        "rm -rf dist",
        "rm -rf /home/u/proj/dist",
        "rm -rf ./*",
        "cd src && rm -rf ../dist",
        "rm -rf /tmp/claude/x/scratchpad",
        "rm -rf /tmp/anything-else /tmp/run-*",
        "rm -f /home/u/x",
    ] {
        assert_eq!(run(command), None, "{command}");
    }
    // The temp folder itself, and the folders around it, are not scratch.
    assert!(!run("rm -rf /tmp").unwrap().deny);
    assert!(!run("rm -rf /tmpx/y").unwrap().deny);
    assert!(!run("rm -rf /var/tmp/x").unwrap().deny);
    for command in [
        "rm -rf /home/u/other",
        "rm -rf /d/x",
        "rm -rf /home/u/proj-old",
        "rm -rf ~/.cache",
    ] {
        assert!(!run(command).unwrap().deny, "{command}");
    }
    // `D:x` and `\` mean nothing there; `/d` is a folder, not a drive.
    assert_eq!(run("rm -f D:x"), None);
    assert!(!run("rm -rf /d").unwrap().deny);
    for command in [
        "rm -rf /",
        "rm -rf /*",
        "rm -rf ~",
        "rm -rf /home",
        "rm -rf ../../..",
    ] {
        assert!(run(command).unwrap().deny, "{command}");
    }
    // Case matters on its filesystems.
    assert!(run("rm -rf /home/u/PROJ/x").is_some());
}

/// The OS temp folder is where scratch lives (Claude's scratchpad, a test run's basetemp): deleting
/// there asks nothing. D:\temp holds the user's other work too (the venvs of 71a81297) and keeps asking.
#[test]
fn what_is_deleted_in_the_os_temp_folder_goes_on_and_d_temp_still_asks() {
    for command in [
        "rm -rf C:/Users/ahmed/AppData/Local/Temp/pytest-of-ahmed",
        "rm -rf C:/Users/AHMED~1/AppData/Local/Temp/pytest-of-ahmed",
        "rm -rf c:/users/ahmed/appdata/local/temp/x/y",
        "rm -rf C:/Users/ahmed/AppData/Local/Temp/claude/abc/scratchpad",
        "rm -rf C:/Users/ahmed/AppData/Local/Temp/tmp-*",
        "rm -rf \"C:\\Users\\ahmed\\AppData\\Local\\Temp\\x\"",
        // Git Bash's /tmp is that folder.
        "rm -rf /tmp/x /tmp/y-*",
        "cd /tmp && rm -rf x",
    ] {
        passes(command);
    }
    for command in [
        // The folder itself, and its neighbours by name.
        "rm -rf C:/Users/ahmed/AppData/Local/Temp",
        "rm -rf C:/Users/ahmed/AppData/Local/Temp/",
        "rm -rf C:/Users/ahmed/AppData/Local/TempX/x",
        "rm -rf C:/Users/ahmed/AppData/Local/x",
        "rm -rf /tmp",
        "rm -rf /tmpx/y",
        "rm -rf D:/temp/venv-ctx",
        "rm -rf D:/Temp/venv-ctx",
        "rm -rf /d/temp/venv-*",
    ] {
        asks(command);
    }
    assert_eq!(
        power("Remove-Item -Recurse C:\\Users\\ahmed\\AppData\\Local\\Temp\\x"),
        None
    );
    assert!(!power("Remove-Item -Recurse D:\\temp\\x").unwrap().deny);
}

/// Under `dontAsk` (a night, a mission) an `ask` is a refusal nobody sees a question for: the hook
/// refuses itself, with a reason that sends the agent elsewhere; the prompt's own text says the same.
#[test]
fn under_dontask_what_would_ask_is_refused_saying_what_to_do_instead() {
    let instead = "not retry it: delete the specific files you made, by name, or ask the user (or the agent that gave you the task) to remove the folder";
    let asked = asks("rm -rf /d/d");
    let mut night = win();
    night.unattended = true;
    let refused = night.check(Shell::Bash, "rm -rf /d/d", &here).unwrap();
    assert!(refused.deny);
    assert!(
        refused
            .reason
            .contains("nobody can approve it in this session")
    );
    for reason in [&asked, &refused.reason] {
        assert!(reason.contains("D:/d"), "{reason}");
        assert!(reason.contains(instead), "{reason}");
    }
    assert!(!asked.contains("nobody can approve"));
    // What goes on goes on, and what was denied is denied as before.
    assert_eq!(night.check(Shell::Bash, "rm -rf dist", &here), None);
    let mangled = night.check(Shell::Bash, "rm -f D:tempx", &here).unwrap();
    assert!(mangled.deny && mangled.reason.contains("forward slashes"));

    // The hook reads the mode of its input: refused under dontAsk, asked in every other.
    let url = with_scope(
        "http://127.0.0.1:1/hook/claude/n1?t=tok",
        Path::new("D:/Projects/w"),
    );
    let answer = |mode: &str| {
        let call = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": { "command": "rm -rf /d/d" },
            "cwd": "D:/Projects/w",
            "permission_mode": mode,
        });
        decide(&call, &url, true).unwrap()["hookSpecificOutput"].clone()
    };
    for mode in [
        "default",
        "acceptEdits",
        "plan",
        "auto",
        "bypassPermissions",
    ] {
        assert_eq!(answer(mode)["permissionDecision"], "ask", "{mode}");
    }
    let night = answer("dontAsk");
    assert_eq!(night["permissionDecision"], "deny");
    assert!(
        night["permissionDecisionReason"]
            .as_str()
            .unwrap()
            .contains(instead)
    );
}

#[test]
fn without_a_folder_only_what_is_wrong_anywhere_is_judged() {
    let guard = Guard::new(None, None, Some(HOME), &[], true);
    let run = |command: &str| guard.check(Shell::Bash, command, &here);
    assert_eq!(run("rm -rf /d/x"), None);
    assert_eq!(run("rm -rf build"), None);
    assert!(run("rm -rf /d/x && rm -f D:y").unwrap().deny);
    assert!(run("rm -rf /d/").unwrap().deny);
    assert!(run("rm -rf ~").unwrap().deny);
    // A relative path is known once a `cd` gave it a start.
    assert!(run("cd /d && rm -rf *").unwrap().deny);
}

#[test]
fn a_folder_travels_in_the_url_whatever_it_holds() {
    let url = "http://127.0.0.1:1/hook/claude/n1?t=tok";
    for folder in [
        "D:\\Projects\\dummy Plane\\wt",
        "D:\\Projets\\été & co\\100%\\a=b?c#d",
        "/home/u/my proj",
    ] {
        let tagged = with_scope(url, Path::new(folder));
        assert!(tagged.starts_with(&format!("{url}&scope=")), "{tagged}");
        assert!(!tagged[url.len() + 1..].contains([' ', '\\', '?', '#']));
        assert_eq!(scope_of(&tagged).as_deref(), Some(folder));
    }
    assert_eq!(scope_of(url), None);
    assert_eq!(scope_of("http://x/h?scope=%ZZ"), None);
    assert_eq!(scope_of("http://x/h?scope=%4"), None);
    assert_eq!(
        scope_of("http://x/h?role=manager&scope=a%2Fb&t=1"),
        Some("a/b".into())
    );
    // After a Manager's tag too.
    let both = with_scope("http://x/h?t=1&role=manager", Path::new("D:/w"));
    assert_eq!(scope_of(&both).as_deref(), Some("D:/w"));
}

fn call(tool: &str, command: &str, cwd: &str) -> Value {
    json!({
        "hook_event_name": "PreToolUse",
        "tool_name": tool,
        "tool_input": { "command": command },
        "cwd": cwd,
    })
}

#[test]
fn an_ask_starts_with_the_guard_marker_the_interface_reads_and_a_denial_does_not() {
    // The interface keeps a parent agent from approving a prompt that bears it (`src/agents/dialogScreen.ts`
    // pins the same text, read from this file).
    assert_eq!(GUARD_MARKER, "[dummyPlane-guard]");
    assert!(!GUARD_MARKER.contains(' '));
    let url = with_scope(
        "http://127.0.0.1:1/hook/claude/n1?t=tok",
        Path::new("D:/Projects/w"),
    );
    let reason = |command: &str| {
        decide(&call("Bash", command, "D:/Projects/w"), &url, true).unwrap()
                ["hookSpecificOutput"]["permissionDecisionReason"]
                .as_str()
                .unwrap()
                .to_string()
    };
    let asked = reason("rm -rf /d/d");
    assert!(
        asked.starts_with("[dummyPlane-guard] dummyPlane asks before a recursive delete"),
        "{asked}"
    );
    assert!(!reason("rm -rf D:\\temp\\x").contains(GUARD_MARKER));
}

#[test]
fn the_hook_answers_a_decision_for_bash_and_powershell_only() {
    let url = with_scope(
        "http://127.0.0.1:1/hook/claude/n1?t=tok",
        Path::new("D:/Projects/w"),
    );
    let decision = |json: &Value| decide(json, &url, true);
    // A `cd` of the agent's own, taken it to a folder of its worktree: the worktree is still its folder.
    let inside = call("Bash", "rm -rf ../dist", "D:/Projects/w/src");
    assert_eq!(decision(&inside), None);
    let outside = decision(&call("Bash", "rm -rf /d/d", "D:/Projects/w")).unwrap();
    assert_eq!(outside["hookSpecificOutput"]["hookEventName"], "PreToolUse");
    assert_eq!(outside["hookSpecificOutput"]["permissionDecision"], "ask");
    assert!(
        outside["hookSpecificOutput"]["permissionDecisionReason"]
            .as_str()
            .unwrap()
            .contains("D:/d")
    );
    let mangled = decision(&call("Bash", "rm -rf D:\\temp\\x", "D:/Projects/w")).unwrap();
    assert_eq!(mangled["hookSpecificOutput"]["permissionDecision"], "deny");
    let power = decision(&call("PowerShell", "rd /s /q D:\\d", "D:/Projects/w")).unwrap();
    assert_eq!(power["hookSpecificOutput"]["permissionDecision"], "ask");
    // Not a shell, or no command: nothing to say.
    assert_eq!(
        decision(&call("Edit", "rm -rf /d/d", "D:/Projects/w")),
        None
    );
    assert_eq!(
        decision(&json!({ "tool_name": "Bash", "cwd": "D:/Projects/w" })),
        None
    );
    assert_eq!(
        decision(&json!({ "tool_input": { "command": "rm -rf /d/d" } })),
        None
    );
    // Without its folder in the URL, the session's folder stands for it.
    let bare = decide(
        &call("Bash", "rm -rf /d/d", "D:/Projects/w"),
        "http://127.0.0.1:1/hook/claude/n1?t=tok",
        true,
    );
    assert!(bare.is_some());
}
