//! The tests of the forms the delete guard reads beyond a plain `rm`: `find`, `xargs`, `cmd /c`,
//! PowerShell's `Remove-Item`, and the variables that hold a target.
//!
//! Every form is judged the same five ways (`every_form_is_judged_in_all_five_ways`): inside the
//! agent's own folder it goes on, outside it asks, unresolved it asks, a drive's root or the home
//! folder is denied, and where nobody can answer the asks are refusals. Only command strings are
//! judged here: nothing is ever deleted.

use std::time::Instant;

use super::*;

const SCOPE: &str = "D:/Projects/dummyPlane/.claude/worktrees/f3";
const HOME: &str = "C:/Users/ahmed";
const TEMP: &str = "C:/Users/AHMED~1/AppData/Local/Temp";
/// What an agent is told to do when a delete is refused.
const INSTEAD: &str = "delete the specific files you made, by name, or ask the user";

fn guard() -> Guard {
    let mut guard = Guard::new(
        Some(SCOPE),
        Some(SCOPE),
        Some(HOME),
        &[TEMP, "C:/Users/ahmed/AppData/Local/Temp"],
        true,
    );
    guard
        .env
        .insert("LOCALAPPDATA".into(), "C:/Users/ahmed/AppData/Local".into());
    guard
}

fn night() -> Guard {
    let mut guard = guard();
    guard.unattended = true;
    guard
}

fn here(_: &str) -> Option<bool> {
    Some(true)
}

fn judged(guard: &Guard, shell: Shell, command: &str) -> Option<Verdict> {
    guard.check(shell, command, &here)
}

#[track_caller]
fn passes(shell: Shell, command: &str) {
    assert_eq!(judged(&guard(), shell, command), None, "{command}");
}

#[track_caller]
fn asks(shell: Shell, command: &str) -> String {
    let verdict =
        judged(&guard(), shell, command).unwrap_or_else(|| panic!("{command}: not asked"));
    assert!(!verdict.deny, "{command}: {}", verdict.reason);
    verdict.reason
}

#[track_caller]
fn denies(shell: Shell, command: &str) -> String {
    let verdict =
        judged(&guard(), shell, command).unwrap_or_else(|| panic!("{command}: not denied"));
    assert!(verdict.deny, "{command}: {}", verdict.reason);
    verdict.reason
}

/// One form of delete, with a command for each of the five ways it is judged.
struct Form {
    shell: Shell,
    inside: &'static [&'static str],
    outside: &'static [&'static str],
    unresolved: &'static [&'static str],
    root: &'static [&'static str],
    home: &'static [&'static str],
}

fn forms() -> Vec<(&'static str, Form)> {
    use Shell::{Bash, PowerShell};
    vec![
        (
            "find -delete",
            Form {
                shell: Bash,
                inside: &[
                    "find . -name '*.pyc' -delete",
                    "find src -type f -name '*.tmp' -delete",
                    "find build -delete",
                    "find . -maxdepth 2 -name node_modules -prune -exec rm -rf {} +",
                    "find -name '*.o' -delete",
                    "find . ! -newer stamp -delete",
                ],
                outside: &[
                    "find /d/x -name '*.pyc' -delete",
                    "find /d/x -delete",
                    "find -L /d/x -mindepth 1 -delete",
                    "find ../other -delete",
                    "find . /d/x -name '*.pyc' -delete",
                    // find reads left to right: a test after `-delete` does not hold it back.
                    "find /d/x -delete -name '*.pyc'",
                ],
                unresolved: &[
                    "find $DIR -name '*.pyc' -delete",
                    "find \"$(git rev-parse --show-toplevel)\" -delete",
                    "find ${DIR:-/d/x} -type f -delete",
                ],
                root: &[
                    "find /d -delete",
                    "find / -delete",
                    "find D:/ -maxdepth 1 -delete",
                ],
                home: &[
                    "find ~ -delete",
                    "find $HOME -mindepth 1 -delete",
                    "find C:/Users -delete",
                ],
            },
        ),
        (
            "find -exec rm",
            Form {
                shell: Bash,
                inside: &[
                    "find . -name node_modules -type d -exec rm -rf {} +",
                    "find . -name '*.log' -exec rm {} \\;",
                    "find dist -execdir rm -rf {} +",
                    "find . -type f -exec echo {} \\;",
                ],
                outside: &[
                    "find /d/x -name node_modules -exec rm -rf {} +",
                    "find /d/x -name '*.log' -exec rm {} \\;",
                    "find /d/x -exec rm -rf {} +",
                    "find /d/x -name y -ok rm -rf {} \\;",
                ],
                unresolved: &[
                    "find $DIR -exec rm -rf {} +",
                    "find . -exec rm -rf $TARGET {} +",
                ],
                root: &["find /d -exec rm -rf {} +", "find D:/ -exec rm {} \\;"],
                home: &["find ~ -exec rm -rf {} +"],
            },
        ),
        (
            "xargs rm",
            Form {
                shell: Bash,
                inside: &[
                    "find . -name '*.log' | xargs rm -rf",
                    "find . -name node_modules -type d -print0 | xargs -0 rm -rf",
                    "find build -type f | xargs -I {} rm -rf {}",
                    "find build -type f | xargs -I{} rm -rf {}",
                    "find . -name '*.o' | xargs rm",
                    "find . -name '*.o' | sudo xargs rm -rf",
                ],
                outside: &[
                    "find /d/x -name '*.log' | xargs rm -rf",
                    "find /d/x -type f | xargs rm",
                    "find /d/x -print0 | xargs -0 -n 50 rm -rf",
                    "echo /d/x | xargs rm -rf /d/y",
                ],
                unresolved: &[
                    "git ls-files --others | xargs rm -rf",
                    "cat list.txt | xargs rm -rf",
                    "xargs rm -rf < list.txt",
                    "ls | xargs -I{} rm -rf {}",
                ],
                root: &[
                    "find / | xargs rm -rf",
                    "find D:/ -maxdepth 1 | xargs rm -rf",
                ],
                home: &["find ~ | xargs rm -rf"],
            },
        ),
        (
            "cmd /c from Bash",
            Form {
                shell: Bash,
                inside: &[
                    "cmd /c 'rd /s /q build'",
                    "cmd.exe /c 'rmdir /s /q dist'",
                    "cmd //c 'del /s /q *.tmp'",
                    "cmd /c 'if exist build rd /s /q build'",
                    "cmd /c 'set X=out&& rd /s /q %X%'",
                    "cmd /c 'rd /s /q %CD%\\build'",
                ],
                outside: &[
                    "cmd /c 'rd /s /q D:\\x'",
                    "cmd /c 'rmdir /s /q D:\\x\\y'",
                    "cmd.exe /c 'del /s /q D:\\x\\*'",
                    "cmd /c 'cd /d D:\\x && rd /s /q sub'",
                    "cmd /c 'set X=D:\\x& rd /s /q %X%'",
                    "cmd /c 'rd /s/q %LOCALAPPDATA%\\x'",
                    "cmd /k \"rd /s /q D:\\x\"",
                ],
                unresolved: &[
                    "cmd /c 'rd /s /q %UNSET%\\x'",
                    "cmd /c 'rd /s /q %1'",
                    "cmd /c 'for /d %f in (*) do rd /s /q %f'",
                    "cmd /c 'set X=%UNSET%& rd /s /q %X%'",
                ],
                root: &["cmd /c 'rd /s /q D:\\'", "cmd /c 'rd /s /q C:/'"],
                home: &[
                    "cmd /c 'rd /s /q %USERPROFILE%'",
                    "cmd /c 'rmdir /s /q C:\\Users'",
                ],
            },
        ),
        (
            "Remove-Item and its aliases",
            Form {
                shell: PowerShell,
                inside: &[
                    "Remove-Item -Recurse -Force node_modules",
                    "$d = Join-Path $PWD 'dist'; Remove-Item -Recurse -Force $d",
                    "Remove-Item (Join-Path $env:TEMP 'x') -Recurse",
                    "$t = $env:TEMP + '\\build'; Remove-Item -Recurse $t",
                    "Get-ChildItem . -Recurse -Filter node_modules | Remove-Item -Recurse -Force",
                    "$p = 'build'; ri -r $p",
                    "$p = \"$PWD\\out\"; rm -Recurse $p",
                    "Remove-Item -Path:build -Recurse",
                    "[System.IO.Directory]::Delete('build', $true)",
                    "[IO.Directory]::Delete('D:\\x')",
                    "cmd /c rd /s /q build",
                    "$p = Join-Path (Get-Location) 'out'; Remove-Item -Recurse $p",
                    "gci -ErrorAction SilentlyContinue build | ri -r",
                    "dir -Force -Recurse .\\obj | Remove-Item -Recurse",
                    "Get-ChildItem -Path:build -Filter *.o | Remove-Item -Force -Recurse",
                ],
                outside: &[
                    "$d = 'D:\\x'; Remove-Item -Recurse $d",
                    "Remove-Item (Join-Path 'D:\\x' 'y') -Recurse",
                    "Get-ChildItem D:\\x | Remove-Item -Recurse -Force",
                    "[System.IO.Directory]::Delete('D:\\x', $true)",
                    "ri -r D:\\x",
                    "rm -Recurse D:\\x",
                    "rmdir -r D:\\x",
                    "del -Recurse D:\\x",
                    "erase -Recurse D:\\x",
                    "rd -Recurse D:\\x",
                    "cmd /c rd /s /q D:\\x",
                    "cmd /c del /s /q D:\\x\\*",
                    "powershell -Command \"Remove-Item -Recurse D:\\x\"",
                    "$env:X = 'D:\\x'; Remove-Item -Recurse $env:X",
                    "Remove-Item -Path:D:\\x -Recurse",
                    "iex 'Remove-Item -Recurse D:\\x'",
                    "$x = $env:LOCALAPPDATA; Remove-Item -Recurse \"$x\\y\"",
                    // A flag's value is no folder, and a list is every folder in it.
                    "Get-ChildItem -ErrorAction SilentlyContinue D:\\x | Remove-Item -Recurse",
                    "gci -ea 0 D:\\x | ri -r",
                    "gci build, D:\\x | ri -r",
                    "gci -Path:D:\\x | ri -r",
                    "gci -LiteralPath D:\\x -Force | Remove-Item -Recurse",
                ],
                unresolved: &[
                    "Remove-Item -Recurse $unset",
                    "Remove-Item (Get-Item x) -Recurse",
                    "Get-ChildItem $unset | Remove-Item -Recurse",
                    "Get-ChildItem . | ForEach-Object { Remove-Item -Recurse $_.FullName }",
                    "Remove-Item -Recurse $env:NOPE\\x",
                    "Remove-Item -Recurse -Path (Resolve-Path x)",
                    "$x = Get-Item y; Remove-Item -Recurse $x",
                    "[IO.Directory]::Delete($p, $true)",
                    "$d = 'D:\\x'; $d += '\\y'; Remove-Item -Recurse $d",
                    // A flag it does not know could take a value: it is not guessed.
                    "gci -Bogus x | ri -r",
                ],
                root: &[
                    "$d = 'D:\\'; Remove-Item -Recurse $d",
                    "rd /s /q D:\\",
                    "Remove-Item -Recurse C:\\",
                    "cmd /c rd /s /q D:\\",
                    "[System.IO.Directory]::Delete('D:\\', $true)",
                ],
                home: &[
                    "Remove-Item -Recurse $HOME",
                    "Remove-Item -Recurse $env:USERPROFILE",
                    "Remove-Item -Recurse -Force $env:USERPROFILE\\*",
                    "ri -r %USERPROFILE%",
                    "cmd /c rd /s /q %USERPROFILE%",
                ],
            },
        ),
        (
            "variables in Bash",
            Form {
                shell: Bash,
                inside: &[
                    "d=build; rm -rf $d",
                    "export OUT=dist && rm -rf \"$OUT\"",
                    "rm -rf \"$PWD/build\"",
                    "rm -rf $TMPDIR/x",
                    "t=$(mktemp -d); rm -rf \"$t\"",
                    "t=$(mktemp -d)\nrm -rf \"$t/sub\"",
                    "for d in build dist; do rm -rf \"$d\"; done",
                    "for d in packages/*; do rm -rf \"$d/dist\"; done",
                    "for d in */; do rm -rf \"${d}build\"; done",
                    "rm -rf dist/$pkg",
                    "rm -rf packages/$p/dist",
                    "rm -rf build-$n",
                    "rm -rf $(find . -name node_modules -type d)",
                    "rm -rf `find build -name x`",
                    "cd src && b=../dist && rm -rf $b",
                ],
                outside: &[
                    "d=/d/x; rm -rf $d",
                    "d=/d/x; rm -rf \"${d}/sub\"",
                    "export D=/d/x; rm -rf $D",
                    "a=/d; b=$a/x; rm -rf $b",
                    "rm -rf $HOME/.cache",
                    "rm -rf $(find /d/x -name y)",
                    "for d in /d/x /d/y; do rm -rf $d; done",
                    "rm -rf ../$x",
                    "rm -rf /d/$x",
                    "HOME=/d/x; rm -rf $HOME",
                    "d=/d/x; bash -c 'rm -rf $d'",
                ],
                unresolved: &[
                    "rm -rf $UNSET",
                    "rm -rf \"$UNSET/x\"",
                    "rm -rf \"$(git rev-parse --show-toplevel)/dist\"",
                    "X=/d/x rm -rf $X",
                    "rm -rf ${UNSET:-/d/x}",
                    "cd $DIR && rm -rf build",
                    "for d in $(ls); do rm -rf \"$d\"; done",
                    "while read f; do rm -rf \"$f\"; done",
                    "rm -rf $1",
                    "d=$(cat where.txt); rm -rf $d",
                    "d=/d/x; d=$(cat y); rm -rf $d",
                    "a=$a$a; rm -rf $a",
                    "cd - && rm -rf build",
                    // A value that is all of what follows the worktree root or `.git`: empty, it is that folder.
                    "rm -rf ./$x",
                    "rm -rf \"$PWD/$x\"",
                    "rm -rf .git/$x",
                ],
                root: &["d=/; rm -rf $d", "d=D:/; rm -rf \"$d\"", "a=/d; rm -rf $a/"],
                home: &[
                    "rm -rf \"$HOME/..\"",
                    "rm -rf $HOME",
                    "rm -rf \"$HOME\"/*",
                    "h=~; rm -rf $h",
                    "rm -rf ${HOME}",
                    "export X=$HOME; rm -rf $X",
                ],
            },
        ),
    ]
}

#[test]
fn every_form_is_judged_in_all_five_ways() {
    for (name, form) in forms() {
        let shell = form.shell;
        for command in form.inside {
            assert_eq!(
                judged(&guard(), shell, command),
                None,
                "{name} inside: {command}"
            );
            assert_eq!(
                judged(&night(), shell, command),
                None,
                "{name} inside, unattended: {command}"
            );
        }
        for command in form.outside {
            let asked = judged(&guard(), shell, command)
                .unwrap_or_else(|| panic!("{name} outside, not asked: {command}"));
            assert!(!asked.deny, "{name} outside: {command}: {}", asked.reason);
            assert!(
                asked
                    .reason
                    .starts_with("dummyPlane asks before a recursive delete"),
                "{name}: {}",
                asked.reason
            );
        }
        for command in form.unresolved {
            let asked = judged(&guard(), shell, command)
                .unwrap_or_else(|| panic!("{name} unresolved, not asked: {command}"));
            assert!(
                !asked.deny,
                "{name} unresolved: {command}: {}",
                asked.reason
            );
            assert!(
                asked.reason.contains("only known when the command runs"),
                "{name} unresolved: {command}: {}",
                asked.reason
            );
            assert!(
                asked.reason.contains("write the path out in full"),
                "{}",
                asked.reason
            );
        }
        for command in form.root {
            let denied = judged(&guard(), shell, command)
                .unwrap_or_else(|| panic!("{name} root, not denied: {command}"));
            assert!(denied.deny, "{name} root: {command}: {}", denied.reason);
            assert!(
                denied.reason.contains("root of a drive"),
                "{command}: {}",
                denied.reason
            );
        }
        for command in form.home {
            let denied = judged(&guard(), shell, command)
                .unwrap_or_else(|| panic!("{name} home, not denied: {command}"));
            assert!(denied.deny, "{name} home: {command}: {}", denied.reason);
            assert!(
                denied.reason.contains("home folder"),
                "{command}: {}",
                denied.reason
            );
        }
        // Under `dontAsk` each ask is a refusal that says what to do instead; a denial stays one.
        for command in form.outside.iter().chain(form.unresolved) {
            let refused = judged(&night(), shell, command)
                .unwrap_or_else(|| panic!("{name} unattended, not refused: {command}"));
            assert!(
                refused.deny,
                "{name} unattended: {command}: {}",
                refused.reason
            );
            assert!(
                refused.reason.contains(INSTEAD),
                "{command}: {}",
                refused.reason
            );
        }
        for command in form.root.iter().chain(form.home) {
            assert!(judged(&night(), shell, command).unwrap().deny, "{command}");
        }
    }
}

/// What the hook answers is the same JSON as before: an ask bears the marker, `dontAsk` refuses.
#[test]
fn the_hook_answers_every_form_in_the_shape_it_always_did() {
    let url = with_scope(
        "http://127.0.0.1:1/hook/claude/n1?t=tok",
        Path::new("D:/Projects/dummyPlane/.claude/worktrees/f3"),
    );
    for (name, form) in forms() {
        let tool = match form.shell {
            Shell::PowerShell => "PowerShell",
            _ => "Bash",
        };
        let answer = |command: &str, mode: &str| {
            let call = json!({
                "hook_event_name": "PreToolUse",
                "tool_name": tool,
                "tool_input": { "command": command },
                "cwd": SCOPE,
                "permission_mode": mode,
            });
            decide(&call, &url, true)
        };
        for command in form.inside {
            assert_eq!(answer(command, "default"), None, "{name}: {command}");
        }
        for command in form.outside.iter().chain(form.unresolved) {
            let asked = answer(command, "default").unwrap()["hookSpecificOutput"].clone();
            assert_eq!(asked["hookEventName"], "PreToolUse");
            assert_eq!(asked["permissionDecision"], "ask", "{name}: {command}");
            assert!(
                asked["permissionDecisionReason"]
                    .as_str()
                    .unwrap()
                    .starts_with("[dummyPlane-guard] dummyPlane asks before"),
                "{name}: {command}"
            );
            let refused = answer(command, "dontAsk").unwrap()["hookSpecificOutput"].clone();
            assert_eq!(refused["permissionDecision"], "deny", "{name}: {command}");
            let reason = refused["permissionDecisionReason"].as_str().unwrap();
            assert!(!reason.starts_with(GUARD_MARKER), "{reason}");
            assert!(reason.contains(INSTEAD), "{reason}");
        }
        for command in form.root.iter().chain(form.home) {
            let denied = answer(command, "default").unwrap()["hookSpecificOutput"].clone();
            assert_eq!(denied["permissionDecision"], "deny", "{name}: {command}");
        }
    }
}

/// A plain `rm` that is not recursive removes files by name: what a variable holds there is not
/// asked about, and a walk that deletes nothing asks nothing.
#[test]
fn what_deletes_no_tree_and_what_deletes_nothing_asks_nothing() {
    for command in [
        "rm -f $UNSET",
        "rm $FILE $OTHER",
        "rm -f \"$(cat list)\"",
        "find $DIR -name '*.pyc'",
        "find /d/x -name y -print",
        "find /d/x -exec echo {} \\;",
        "xargs rm < list.txt",
        "cat list.txt | xargs rm -f",
        "ls | xargs echo",
        "rm -rf",
        "xargs",
        "echo rm -rf $UNSET",
        "git clean -n",
    ] {
        passes(Shell::Bash, command);
    }
    for command in [
        "Remove-Item $unset",
        "Get-ChildItem $unset",
        "Get-ChildItem D:\\x -Recurse | Select-Object -First 1",
        "$x = Get-Item y; Write-Host $x",
        "Remove-Item",
        "Write-Host 'Remove-Item -Recurse $unset'",
    ] {
        passes(Shell::PowerShell, command);
    }
    // The cmd of a `cd`, a `set` and an `echo` is read, and says nothing.
    passes(Shell::Bash, "cmd /c 'echo %UNSET% & cd /d D:\\x'");
}

/// An assignment in the command itself outranks the well-known variable; one made for a single command
/// is not seen by that command (`X=/d/x rm -rf $X` expands the old `X`).
#[test]
fn what_a_command_set_is_what_it_expands_to_and_a_later_assignment_wins() {
    let reason = asks(Shell::Bash, "HOME=/d/x; rm -rf $HOME");
    assert!(reason.contains("removes D:/x"), "{reason}");
    assert!(!reason.contains("only known"), "{reason}");
    passes(Shell::Bash, "d=/d/x; d=build; rm -rf $d");
    asks(Shell::Bash, "d=build; d=/d/x; rm -rf $d");
    asks(Shell::Bash, "d=build; d=$(cat y); rm -rf $d");
    // A nested shell starts from the variables of the one that runs it, and keeps its own.
    asks(Shell::Bash, "d=/d/x; bash -c 'rm -rf $d'");
    passes(Shell::Bash, "d=/d/x; bash -c 'd=build; rm -rf $d'");
    asks(Shell::Bash, "bash -c 'd=/d/x; rm -rf $d'");
    // A value too long to be a path is not kept.
    let long = "a".repeat(MAX_VALUE + 1);
    let reason = asks(Shell::Bash, &format!("d=/d/{long}; rm -rf $d"));
    assert!(
        reason.contains("only known when the command runs"),
        "{reason}"
    );
    // `pushd` and `popd`, `cd -`.
    passes(Shell::Bash, "pushd /d/temp && popd && rm -rf build");
    asks(Shell::Bash, "pushd /d/temp && rm -rf build");
    asks(Shell::Bash, "cd /d/temp && cd - && cd - && rm -rf build");
    // cmd: `%VAR%` is its own, set by `set`, and the temp folder is the OS's.
    passes(Shell::Bash, "cmd /c 'rd /s /q %TEMP%\\x'");
    passes(Shell::Bash, "cmd /c 'rd /s /q \"%TMP%\\x\"'");
    asks(Shell::Bash, "cmd /c 'rd /s /q %TEMP%'");
    asks(
        Shell::Bash,
        "cmd /c 'set X=build& set X=D:\\x& rd /s /q %X%'",
    );
    passes(
        Shell::Bash,
        "cmd /c 'set X=D:\\x& set X=build& rd /s /q %X%'",
    );
}

/// A `$(…)`, a backtick pair and a PowerShell `(…)` are read as the commands they are, whatever holds them.
#[test]
fn a_command_inside_a_substitution_is_read_whatever_holds_it() {
    for command in [
        "echo \"$(rm -rf /d/x)\"",
        "echo `rm -rf /d/x`",
        "echo \"`rm -rf /d/x`\"",
        "echo $(echo $(rm -rf /d/x))",
        "x=$(rm -rf /d/x)",
        "ls $(cd /d/x && rm -rf sub)",
        "bash -c \"echo $(rm -rf /d/x)\"",
        "timeout 5 rm -rf /d/x",
        "timeout -s KILL 5 rm -rf /d/x",
        "nice -n 5 rm -rf /d/x",
        "sudo -u root rm -rf /d/x",
        "busybox rm -rf /d/x",
        "doas rm -rf /d/x",
        "env -u FOO rm -rf /d/x",
        "setsid nohup rm -rf /d/x",
    ] {
        asks(Shell::Bash, command);
    }
    for command in [
        "Write-Host $(Remove-Item -Recurse D:\\x)",
        "Write-Host \"$(Remove-Item -Recurse D:\\x)\"",
        "Write-Host (Remove-Item -Recurse D:\\x)",
        "$x = (Remove-Item -Recurse D:\\x)",
        "Get-Item (Remove-Item -Recurse D:\\x)",
    ] {
        asks(Shell::PowerShell, command);
    }
    // A PowerShell parenthesis is an argument, not the end of a statement.
    passes(
        Shell::PowerShell,
        "Remove-Item -Path (Join-Path $PWD 'dist') -Recurse",
    );
    asks(
        Shell::PowerShell,
        "Remove-Item -Path (Join-Path 'D:\\x' 'dist') -Recurse",
    );
    passes(
        Shell::PowerShell,
        "if (Test-Path build) { Remove-Item -Recurse build }",
    );
    asks(
        Shell::PowerShell,
        "if (Test-Path D:\\x) { Remove-Item -Recurse D:\\x }",
    );
    // The substitution that the shell does not run (single quotes, a heredoc) is text.
    passes(Shell::Bash, "echo '$(rm -rf /d/x)'");
    passes(Shell::Bash, "cat <<'EOF'\n$(rm -rf /d/x)\nEOF");
}

/// `-EncodedCommand` is the command, in UTF-16 and Base64: it is decoded and read.
#[test]
fn an_encoded_powershell_command_is_decoded_and_read() {
    fn encoded(script: &str) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let n = chunk
                .iter()
                .enumerate()
                .fold(0u32, |n, (i, b)| n | (*b as u32) << (16 - 8 * i));
            for i in 0..=chunk.len() {
                out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
            }
            out.extend(std::iter::repeat_n('=', 3 - chunk.len()));
        }
        out
    }
    let outside = encoded("Remove-Item -Recurse -Force D:\\x");
    let reason = asks(
        Shell::Bash,
        &format!("powershell -NoProfile -EncodedCommand {outside}"),
    );
    assert!(reason.contains("D:/x"), "{reason}");
    asks(Shell::PowerShell, &format!("pwsh -enc {outside}"));
    let inside = encoded("Remove-Item -Recurse -Force node_modules");
    passes(Shell::Bash, &format!("powershell -EncodedCommand {inside}"));
    passes(Shell::Bash, "powershell -EncodedCommand !!!");
    let unresolved = encoded("Remove-Item -Recurse $unset");
    asks(Shell::Bash, &format!("powershell -ec {unresolved}"));
}

/// What the guard says it saw: the target in the reason, and what the agent should do about it.
#[test]
fn the_reason_names_the_target_and_says_how_to_make_it_checkable() {
    let reason = asks(Shell::Bash, "rm -rf \"$UNSET/x\"");
    assert!(reason.contains("`$UNSET/x`"), "{reason}");
    assert!(
        reason.contains("The agent was started in D:/Projects/dummyPlane/.claude/worktrees/f3")
    );
    assert!(
        reason.contains("print the variable, then name the folder itself"),
        "{reason}"
    );
    assert!(reason.contains(INSTEAD), "{reason}");
    let reason = asks(Shell::Bash, "rm -rf /d/x/$name");
    assert!(
        reason.contains("something under D:/x that is only known when the command runs"),
        "{reason}"
    );
    // A long target is cut, a long command asks once for what it holds.
    let long = format!("rm -rf $UNSET{}", "x".repeat(400));
    assert!(asks(Shell::Bash, &long).len() < 1500);
    let many: String = (0..50).map(|i| format!("rm -rf $UNSET{i}; ")).collect();
    let reason = asks(Shell::Bash, &many);
    assert!(reason.contains("more deletes like these"), "{reason}");
    assert!(reason.len() < 6 * 1100, "{}", reason.len());
}

/// The whole folder and its history are asked for the new forms as for `rm -rf`.
#[test]
fn a_find_of_the_whole_folder_asks_and_one_that_picks_files_does_not() {
    assert!(asks(Shell::Bash, "find . -delete").contains("its whole folder"));
    assert!(asks(Shell::Bash, "find . -mindepth 1 -delete").contains("its whole folder"));
    assert!(asks(Shell::Bash, "find .git -delete").contains("its git history"));
    assert!(asks(Shell::Bash, "find . -exec rm -rf {} +").contains("its whole folder"));
    // The action comes before the test that would pick: it empties the folder, as `find . -delete` does.
    assert!(asks(Shell::Bash, "find . -delete -name '*.pyc'").contains("its whole folder"));
    assert!(
        asks(Shell::Bash, "find . -exec rm -rf {} + -name node_modules")
            .contains("its whole folder")
    );
    passes(Shell::Bash, "find . -name '*.pyc' -delete -name x");
    passes(
        Shell::Bash,
        "find . -name node_modules -exec rm -rf {} + -prune",
    );
    assert!(asks(Shell::Bash, "find . | xargs rm -rf").contains("its whole folder"));
    passes(Shell::Bash, "find . -type f -delete");
    passes(Shell::Bash, "find . -maxdepth 1 -name '*.log' -delete");
    // Without a folder, only what is wrong anywhere is judged: a find of a drive's root still is.
    let nowhere = Guard::new(None, None, Some(HOME), &[], true);
    let run = |command: &str| nowhere.check(Shell::Bash, command, &here);
    assert_eq!(run("find $DIR -delete"), None);
    assert_eq!(run("rm -rf $DIR"), None);
    assert_eq!(run("cd $DIR && rm -rf build"), None);
    assert!(run("find / -delete").unwrap().deny);
    assert!(run("find ~ | xargs rm -rf").unwrap().deny);
}

/// What `cmd` gets from Bash is read as Bash gave it: backslashes outside quotes are gone.
#[test]
fn a_cmd_path_bash_made_drive_relative_is_denied_telling_how_to_quote_it() {
    let reason = denies(Shell::Bash, "cmd /c rd /s /q D:\\temp\\x");
    assert!(reason.contains("D:tempx"), "{reason}");
    assert!(
        reason.contains("inside the quotes of the cmd script"),
        "{reason}"
    );
    denies(Shell::Bash, "cmd /c 'rd /s /q D:tempx'");
    denies(Shell::Bash, "find D:x -name y -delete");
    // PowerShell passes backslashes as they are.
    asks(Shell::PowerShell, "cmd /c rd /s /q D:\\temp\\x");
}

/// A script is read in time that grows with its length, and one that is too much is asked about.
#[test]
fn a_command_of_the_largest_size_is_read_within_the_hook_s_time() {
    const SIZE: usize = 256 * 1024;
    fn fill(piece: impl Fn(usize) -> String) -> String {
        let mut text = String::new();
        let mut i = 0;
        while text.len() < SIZE {
            text.push_str(&piece(i));
            i += 1;
        }
        text.truncate(SIZE);
        text
    }
    let a_value = format!("a=/d/{}; ", "x".repeat(400));
    let shapes: Vec<(&str, Shell, String)> = vec![
        (
            "many deletes",
            Shell::Bash,
            fill(|i| format!("rm -rf /d/x{i}; ")),
        ),
        (
            "many unresolved",
            Shell::Bash,
            fill(|i| format!("rm -rf $v{i}; ")),
        ),
        (
            "one huge word",
            Shell::Bash,
            format!("rm -rf /d/{}", "a".repeat(SIZE - 16)),
        ),
        (
            "a value used many times",
            Shell::Bash,
            format!("{a_value}rm -rf {}", "$a ".repeat(SIZE / 3 - 200)),
        ),
        (
            "values that double",
            Shell::Bash,
            format!(
                "a=xx; {}rm -rf $z",
                (0..40)
                    .map(|i| format!("b{i}=$a$a; a=$b{i}; "))
                    .collect::<String>()
            ),
        ),
        (
            "many assignments",
            Shell::Bash,
            fill(|i| format!("v{i}=/d/{i}; ")),
        ),
        (
            "many cds",
            Shell::Bash,
            format!("{}rm -rf x", "cd a; ".repeat(SIZE / 6 - 1)),
        ),
        (
            "many cds up",
            Shell::Bash,
            format!("{}rm -rf x", "cd ..; ".repeat(SIZE / 7 - 1)),
        ),
        (
            "many pushd",
            Shell::Bash,
            format!("{}rm -rf x", "pushd a; ".repeat(SIZE / 9 - 1)),
        ),
        (
            "nested shells",
            Shell::Bash,
            fill(|i| format!("bash -c 'bash -c \"bash -c \\\"rm -rf /d/x{i}\\\"\"'; ")),
        ),
        (
            "deep substitutions",
            Shell::Bash,
            format!(
                "rm -rf {}x{}",
                "$(echo ".repeat(SIZE / 12),
                ")".repeat(SIZE / 12)
            ),
        ),
        (
            "deep unbalanced",
            Shell::Bash,
            format!("rm -rf {}", "$(".repeat(SIZE / 2)),
        ),
        (
            "many substitutions",
            Shell::Bash,
            fill(|_| "rm -rf $(find . -name x)/$(pwd); ".to_string()),
        ),
        (
            "many finds",
            Shell::Bash,
            fill(|i| format!("find /d/x{i} -name y -delete; ")),
        ),
        (
            "a find of many folders",
            Shell::Bash,
            format!(
                "find {} -delete",
                (0..SIZE / 8)
                    .map(|i| format!("d{i}"))
                    .collect::<Vec<_>>()
                    .join(" ")
            ),
        ),
        (
            "a find of many commands",
            Shell::Bash,
            format!("find . {}", "-exec rm -rf {} + ".repeat(SIZE / 20)),
        ),
        (
            "a find with many braces",
            Shell::Bash,
            format!("find . -exec rm {} +", "{} ".repeat(SIZE / 3)),
        ),
        (
            "many pipes",
            Shell::Bash,
            fill(|_| "find . -name x | xargs rm -rf; ".to_string()),
        ),
        (
            "xargs of xargs",
            Shell::Bash,
            fill(|_| "xargs xargs xargs xargs rm -rf; ".to_string()),
        ),
        (
            "a heredoc",
            Shell::Bash,
            format!(
                "cat <<EOF\n{}EOF\nrm -rf /d/x",
                "rm -rf /d/y\n".repeat(SIZE / 12 - 2)
            ),
        ),
        (
            "many groups",
            Shell::PowerShell,
            fill(|_| "Remove-Item -Recurse (Join-Path $a (Join-Path $b 'c')); ".to_string()),
        ),
        (
            "deep groups",
            Shell::PowerShell,
            format!(
                "Remove-Item -Recurse {}x{}",
                "(".repeat(SIZE / 2 - 1),
                ")".repeat(SIZE / 2 - 1)
            ),
        ),
        (
            "unbalanced groups",
            Shell::PowerShell,
            format!("Remove-Item -Recurse {}", "(".repeat(SIZE / 2)),
        ),
        (
            "many assignments in PowerShell",
            Shell::PowerShell,
            fill(|i| format!("$v{i} = 'D:\\{i}'; ")),
        ),
        (
            "a concatenation",
            Shell::PowerShell,
            format!(
                "$a = {}'x'; Remove-Item -Recurse $a",
                "'a' + ".repeat(SIZE / 8)
            ),
        ),
        (
            "a pipeline",
            Shell::PowerShell,
            format!(
                "Get-ChildItem . {}| Remove-Item -Recurse",
                "| Where-Object { $_ } ".repeat(SIZE / 22)
            ),
        ),
        (
            "cmd",
            Shell::Bash,
            format!(
                "cmd /c '{}'",
                "rd /s /q %a%\\x & set a=%a%%a% & ".repeat(SIZE / 36)
            ),
        ),
        (
            "cmd carets",
            Shell::Bash,
            format!("cmd /c 'rd /s /q {}'", "^".repeat(SIZE - 40)),
        ),
        (
            "many quotes",
            Shell::Bash,
            format!("rm -rf {}", "\"'".repeat(SIZE / 2 - 4)),
        ),
    ];
    for (name, shell, command) in &shapes {
        // The shapes are ASCII: cut at the size the hook reads, no more.
        let command = command.get(..SIZE).unwrap_or(command);
        assert!(
            command.len() > SIZE / 2 || *name == "values that double",
            "{name}: {}",
            command.len()
        );
        // No deadline: the work it does is what counts, which does not depend on the machine's load; the
        // time is only a ceiling far above a debug build's (a read that is not linear takes minutes).
        // The slowest shape takes about half a second here; in a release build, a tenth of it.
        let alone = guard();
        let started = Instant::now();
        let _ = judged(&alone, *shell, command);
        let took = started.elapsed();
        assert!(
            alone.work.get() <= WORK_LIMIT + 2 * SIZE,
            "{name}: {} bytes of work",
            alone.work.get()
        );
        assert!(took < Duration::from_secs(8), "{name}: {took:?}");
        // With the budget the hook gives, it stops at it: asking, never going on unread.
        let mut limited = guard();
        limited.deadline = Some(Instant::now() + READ_BUDGET);
        let started = Instant::now();
        let _ = judged(&limited, *shell, command);
        let took = started.elapsed();
        assert!(
            took < READ_BUDGET + Duration::from_secs(5),
            "{name} with its budget: {took:?}"
        );
    }
}

/// A script may hold any character: a name, a path, a `%…%`, a `${…}`, a `$(…)` or a PowerShell group
/// in any language is read, never a panic (which would leave the call unread).
#[test]
fn a_command_in_any_script_is_read_and_never_panics() {
    let words = [
        "numéro",
        "café",
        "名前",
        "日本語/フォルダ",
        "😀",
        "Ünï/çödé",
        "à\u{301}",
        "env:é",
        "ENV:名",
    ];
    let mut commands: Vec<(Shell, String)> = Vec::new();
    for word in words {
        for (shell, command) in [
            (
                Shell::Bash,
                format!("{word}=/d/{word}; rm -rf ${word} \"${{{word}}}\" $(echo {word}) `{word}`"),
            ),
            (
                Shell::Bash,
                format!("for {word} in {word} a; do rm -rf \"${word}/{word}\"; done"),
            ),
            (
                Shell::Bash,
                format!(
                    "find /d/{word} -name '{word}*' -delete; find {word} -exec rm -rf {{}} {word} +"
                ),
            ),
            (
                Shell::Bash,
                format!("ls {word} | xargs -I{word} rm -rf {word}"),
            ),
            (
                Shell::Bash,
                format!("cmd /c 'set {word}=D:\\{word}& rd /s /q %{word}% %{word}"),
            ),
            (
                Shell::PowerShell,
                format!(
                    "${word} = 'D:\\{word}'; Remove-Item -Recurse ${word} $env:{word} ${{env:{word}}} \"$env:{word}\\{word}\""
                ),
            ),
            (
                Shell::PowerShell,
                format!("$env:{word} = Join-Path 'D:\\' '{word}'; ri -r $env:{word}"),
            ),
            (
                Shell::PowerShell,
                format!(
                    "Remove-Item -Recurse ({word} + (Join-Path ${word} '{word}')) @({word}) $({word})"
                ),
            ),
            (
                Shell::PowerShell,
                format!(
                    "Get-ChildItem -{word} {word}, {word} | Remove-Item -Recurse -{word}:{word}"
                ),
            ),
            (
                Shell::PowerShell,
                format!(
                    "[System.IO.Directory]::Delete('{word}', ${word}); [IO.Directory]::Delete(\"{word}\")"
                ),
            ),
            (
                Shell::Cmd,
                format!("set {word}=%{word}%\\{word} & rd /s /q %{word}% & del /s {word}"),
            ),
        ] {
            commands.push((shell, command));
        }
    }
    // Every cut of them, on each character, and the three shells for each: what a model sends is cut anywhere.
    for (_, command) in commands.clone() {
        for (at, _) in command.char_indices() {
            for shell in [Shell::Bash, Shell::PowerShell, Shell::Cmd] {
                let _ = judged(&guard(), shell, &command[..at]);
                let _ = judged(&guard(), shell, &command[at..]);
            }
        }
    }
    for (shell, command) in &commands {
        let _ = judged(&guard(), *shell, command);
        let _ = judged(&night(), *shell, command);
    }
    // They are judged, not just survived: a name with an accent is a name.
    asks(
        Shell::PowerShell,
        "$numéro = 'D:\\x'; Remove-Item -Recurse $numéro",
    );
    passes(
        Shell::PowerShell,
        "$numéro = 'build'; Remove-Item -Recurse $numéro",
    );
    asks(Shell::Bash, "rm -rf /d/名前");
    passes(Shell::Bash, "rm -rf dist/名前-$café");
}

/// A panic in the guard is not a call that runs unread: the command is asked about, refused unattended.
#[test]
fn a_guard_that_fails_asks_about_the_command_and_never_lets_it_run_unread() {
    let call = |tool: &str, mode: &str| {
        json!({
            "hook_event_name": "PreToolUse",
            "tool_name": tool,
            "tool_input": { "command": "rm -rf build" },
            "cwd": SCOPE,
            "permission_mode": mode,
        })
    };
    let panics = || -> Option<Value> { panic!("a guard that fails") };
    let asked = guarded(&call("Bash", "default"), panics).unwrap()["hookSpecificOutput"].clone();
    assert_eq!(asked["permissionDecision"], "ask");
    assert!(
        asked["permissionDecisionReason"]
            .as_str()
            .unwrap()
            .starts_with(
                "[dummyPlane-guard] dummyPlane asks before a command it could not read to its end"
            )
    );
    let refused =
        guarded(&call("PowerShell", "dontAsk"), panics).unwrap()["hookSpecificOutput"].clone();
    assert_eq!(refused["permissionDecision"], "deny");
    assert!(
        !refused["permissionDecisionReason"]
            .as_str()
            .unwrap()
            .starts_with(GUARD_MARKER)
    );
    // Not a shell: nothing to say, as without a failure. An answer given is the answer.
    assert_eq!(guarded(&call("Edit", "default"), panics), None);
    let said = Some(json!({ "said": true }));
    assert_eq!(guarded(&call("Bash", "default"), || said.clone()), said);
}

/// What does not fit the time or the work asks (refuses, unattended); it never goes on unread.
#[test]
fn a_command_that_cannot_be_read_in_time_asks_and_never_goes_on_unread() {
    let late = |night: bool| {
        let mut guard = if night { self::night() } else { self::guard() };
        guard.deadline = Some(Instant::now() - Duration::from_secs(1));
        guard
    };
    let command = "echo hi; rm -rf build";
    let asked = judged(&late(false), Shell::Bash, command).unwrap();
    assert!(!asked.deny, "{}", asked.reason);
    assert!(
        asked.reason.contains("too long or too tangled"),
        "{}",
        asked.reason
    );
    assert!(
        asked.reason.contains("send it as smaller commands"),
        "{}",
        asked.reason
    );
    let refused = judged(&late(true), Shell::Bash, command).unwrap();
    assert!(refused.deny, "{}", refused.reason);
    assert!(
        refused.reason.contains("nobody can approve it"),
        "{}",
        refused.reason
    );
    // A denial found before the time ran out is still the answer.
    let spent = guard();
    spent.work.set(WORK_LIMIT - 20);
    let verdict = judged(
        &spent,
        Shell::Bash,
        "rm -rf /d/; echo a long enough text to spend the rest",
    )
    .unwrap();
    assert!(
        verdict.deny || verdict.reason.contains("too long or too tangled"),
        "{}",
        verdict.reason
    );
    // Too many folders in a find, too many commands in it.
    let starts: Vec<String> = (0..=MAX_STARTS).map(|i| format!("d{i}")).collect();
    let verdict = judged(
        &guard(),
        Shell::Bash,
        &format!("find {} -delete", starts.join(" ")),
    )
    .unwrap();
    assert!(
        verdict.reason.contains("too long or too tangled"),
        "{}",
        verdict.reason
    );
    // The hook has a budget of its own.
    assert!(READ_BUDGET < Duration::from_secs(2));
}

/// Deleting inside the OS temp folder, or the agent's own scratch, goes on whatever holds the name.
#[test]
fn what_is_below_the_temp_folder_or_the_worktree_goes_on_with_a_variable_in_its_name() {
    for command in [
        "rm -rf $TMPDIR/claude/$id",
        "rm -rf /tmp/run-$n",
        "rm -rf C:/Users/ahmed/AppData/Local/Temp/x$n",
        "cd /tmp && rm -rf run-$n",
    ] {
        passes(Shell::Bash, command);
    }
    // A name that is only a variable could be anything, even a path of its own.
    for command in [
        "rm -rf /tmp/$name/..",
        "rm -rf $TMPDIR",
        "rm -rf ${TMPDIR}/",
        "cd /tmp && rm -rf $name",
    ] {
        asks(Shell::Bash, command);
    }
    // Where the temp folder is no longer known, nothing under `$TMPDIR` is.
    let nowhere = Guard::new(Some(SCOPE), Some(SCOPE), Some(HOME), &[], true);
    assert!(
        nowhere
            .check(Shell::Bash, "rm -rf $TMPDIR/x", &here)
            .is_some()
    );
    // The drive a path starts with is not `D:$x`.
    assert!(!asks(Shell::Bash, "rm -rf D:$x").is_empty());
}
