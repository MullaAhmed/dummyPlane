//! The arguments of the commands that delete, as the guard reads them: `rm`, PowerShell's
//! `Remove-Item` and cmd's `rd`, `find`'s starting folders, what `xargs` runs, and the script
//! a `cmd /c` or a `powershell -EncodedCommand` carries.

/// `rm`'s arguments: whether it recurses, and what it removes.
pub(super) fn rm_targets(args: &[String]) -> (bool, Vec<String>) {
    let mut recursive = false;
    let mut targets = Vec::new();
    let mut flags = true;
    for arg in args {
        if flags && arg == "--" {
            flags = false;
        } else if flags && arg.starts_with("--") {
            recursive |= arg == "--recursive";
        } else if flags && arg.starts_with('-') && arg.len() > 1 {
            recursive |= arg.contains(['r', 'R']);
        } else {
            targets.push(arg.clone());
        }
    }
    (recursive, targets)
}

/// `Remove-Item`'s arguments, and those of `rd`, `rmdir`, `del` and `erase` as `cmd` takes them.
pub(super) fn remove_item_targets(name: &str, args: &[String]) -> (bool, Vec<String>) {
    let cmd_style = matches!(name, "rd" | "rmdir" | "del" | "erase");
    let mut recursive = false;
    let mut targets = Vec::new();
    let mut at = 0;
    while at < args.len() {
        let arg = &args[at];
        let lower = arg.to_ascii_lowercase();
        at += 1;
        if lower.len() > 1 && lower.starts_with('-') {
            // `-Path:D:\x` carries its value; `-Path D:\x` is followed by it.
            let (flag, attached) = match lower[1..].split_once(':') {
                Some((flag, _)) => (flag, Some(arg[1 + flag.len() + 1..].to_string())),
                None => (&lower[1..], None),
            };
            let is = |full: &str, least: usize| flag.len() >= least && full.starts_with(flag);
            if is("recurse", 1) {
                recursive = true;
            } else if is("path", 1) || is("literalpath", 2) || flag == "lp" {
                match attached {
                    Some(path) => targets.extend(list(&path)),
                    None => {
                        if let Some(path) = args.get(at) {
                            targets.extend(list(path));
                        }
                        at += 1;
                    }
                }
            } else if attached.is_none()
                && (is("filter", 2)
                    || is("include", 1)
                    || is("exclude", 1)
                    || is("stream", 2)
                    || is("credential", 2)
                    || is("erroraction", 3)
                    || flag == "ea")
            {
                // These take a value that is no path.
                at += 1;
            }
        } else if let Some(recurses) = cmd_style.then(|| cmd_switches(&lower)).flatten() {
            recursive |= recurses;
        } else {
            targets.extend(list(arg));
        }
    }
    (recursive, targets)
}

/// A word made of cmd's switches (`/s`, `/q`, `/s/q`, `/a:h`): whether `/s` is among them.
fn cmd_switches(word: &str) -> Option<bool> {
    let pieces = word.strip_prefix('/')?;
    let mut recursive = false;
    for piece in pieces.split('/') {
        let switch = piece.split(':').next().unwrap_or_default();
        if !matches!(switch, "s" | "q" | "f" | "p" | "a" | "?") {
            return None;
        }
        recursive |= switch == "s";
    }
    Some(recursive)
}

/// PowerShell's `a, b` is a list of paths.
pub(super) fn list(arg: &str) -> impl Iterator<Item = String> + '_ {
    arg.split(',')
        .filter(|path| !path.trim().is_empty())
        .map(str::to_string)
}

/// The script of `bash -c '…'` (also `-lc`, `-ic`).
pub(super) fn shell_c_script(args: &[String]) -> Option<String> {
    let at = args
        .iter()
        .position(|a| a.starts_with('-') && !a.starts_with("--") && a.contains('c'))?;
    args.get(at + 1).cloned()
}

/// The script of `cmd /c …` (also `/k`, and `//c` as Git Bash needs it written).
pub(super) fn cmd_c_script(args: &[String]) -> Option<String> {
    let at = args.iter().position(|a| {
        matches!(
            a.to_ascii_lowercase().as_str(),
            "/c" | "//c" | "/k" | "//k" | "/r" | "//r"
        )
    })?;
    let script = args[at + 1..].join(" ");
    let script = script.trim();
    Some(
        script
            .strip_prefix('"')
            .and_then(|s| s.strip_suffix('"'))
            .unwrap_or(script)
            .to_string(),
    )
}

/// The script of `powershell -Command …`, or of its `-EncodedCommand`.
pub(super) fn powershell_script(args: &[String]) -> Option<String> {
    for (at, arg) in args.iter().enumerate() {
        let flag = arg.to_ascii_lowercase();
        let named = |full: &str, least: usize| {
            flag.len() >= least && flag.starts_with('-') && full.starts_with(&flag)
        };
        if named("-command", 2) {
            return Some(args[at + 1..].join(" "));
        }
        if named("-encodedcommand", 2) || flag == "-e" || flag == "-ec" {
            return args.get(at + 1).and_then(|text| decode_powershell(text));
        }
    }
    None
}

/// What `find` was given: where it starts, whether it picks what it removes, and what it runs.
/// `find` reads its expression from left to right: what picks files (`-name`) after an action
/// (`-delete`) does not hold it back.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Find {
    pub starts: Vec<String>,
    /// Nothing picks what is under the starting folders but their depth: what it lists is all of it.
    pub whole: bool,
    pub delete: bool,
    /// A `-delete` came before any test: it is `rm -rf` of the starting folders.
    pub delete_whole: bool,
    pub execs: Vec<Exec>,
}

/// One `-exec`, `-execdir`, `-ok` or `-okdir`: its command, `{}` standing for what find found.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Exec {
    pub command: Vec<String>,
    /// No test came before it.
    pub whole: bool,
}

pub(super) fn find_plan(args: &[String]) -> Find {
    let mut at = 0;
    // The options before the folders: -H -L -P -Olevel, -D debugopts.
    while at < args.len() {
        match args[at].as_str() {
            "-H" | "-L" | "-P" => at += 1,
            "-D" => at += 2,
            a if a.len() > 2
                && a.starts_with("-O")
                && a[2..].chars().all(|c| c.is_ascii_digit()) =>
            {
                at += 1;
            }
            _ => break,
        }
    }
    let mut starts = Vec::new();
    while at < args.len() && !starts_expression(&args[at]) {
        starts.push(args[at].clone());
        at += 1;
    }
    if starts.is_empty() {
        starts.push(".".to_string());
    }
    let mut plan = Find {
        starts,
        whole: true,
        delete: false,
        delete_whole: false,
        execs: Vec::new(),
    };
    while at < args.len() {
        let arg = args[at].as_str();
        at += 1;
        match arg {
            "-delete" => {
                plan.delete = true;
                plan.delete_whole |= plan.whole;
            }
            "-exec" | "-execdir" | "-ok" | "-okdir" => {
                let mut command = Vec::new();
                while at < args.len() {
                    let word = &args[at];
                    at += 1;
                    if word == ";" || word == "+" {
                        break;
                    }
                    command.push(word.clone());
                }
                plan.execs.push(Exec {
                    command,
                    whole: plan.whole,
                });
            }
            // Depth and output change nothing about which files are picked.
            "-maxdepth" | "-mindepth" | "-printf" | "-fprint" | "-fprint0" | "-fls" => at += 1,
            "-fprintf" => at += 2,
            "-depth"
            | "-d"
            | "-xdev"
            | "-mount"
            | "-noleaf"
            | "-print"
            | "-print0"
            | "-ls"
            | "-daystart"
            | "-follow"
            | "-warn"
            | "-nowarn"
            | "-ignore_readdir_race"
            | "-noignore_readdir_race"
            | "-true" => {}
            // -name, -type, -newer, -o, !, ( : a test.
            _ => plan.whole = false,
        }
    }
    plan
}

/// Where find's expression starts: a test, an operator or an action.
fn starts_expression(word: &str) -> bool {
    (word.starts_with('-') && word.len() > 1) || matches!(word, "!" | "(" | ")" | ",")
}

/// What `xargs` runs: its command (empty: `echo`), and the word it puts each input in (`-I`).
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Xargs {
    pub command: Vec<String>,
    pub replace: Option<String>,
}

pub(super) fn xargs_plan(args: &[String]) -> Xargs {
    let mut replace = None;
    let mut at = 0;
    while at < args.len() {
        let arg = args[at].as_str();
        if arg == "--" {
            at += 1;
            break;
        }
        if !arg.starts_with('-') || arg == "-" {
            break;
        }
        at += 1;
        match arg {
            "-I" | "-J" => {
                replace = args.get(at).cloned();
                at += 1;
            }
            "-i" => replace = Some("{}".to_string()),
            "-n" | "-P" | "-d" | "-L" | "-s" | "-E" | "-a" | "-S" | "--max-args"
            | "--max-procs" | "--delimiter" | "--arg-file" | "--max-lines" | "--max-chars"
            | "--eof" => at += 1,
            a if a.starts_with("--replace=") => {
                replace = Some(a["--replace=".len()..].to_string());
            }
            "--replace" => replace = Some("{}".to_string()),
            a if a.starts_with("-I") && a.len() > 2 => replace = Some(a[2..].to_string()),
            a if a.starts_with("-i") && !a.starts_with("--") => {
                replace = Some(a[2..].to_string());
            }
            _ => {}
        }
    }
    // An option that wants a value can be the last word: `at` may be past the end.
    Xargs {
        command: args.get(at..).unwrap_or_default().to_vec(),
        replace,
    }
}

/// A PowerShell `-EncodedCommand`: Base64 of the script in UTF-16 little-endian.
fn decode_powershell(text: &str) -> Option<String> {
    let bytes = base64(text)?;
    let (pairs, rest) = bytes.as_chunks::<2>();
    if !rest.is_empty() {
        return None;
    }
    let units: Vec<u16> = pairs.iter().map(|pair| u16::from_le_bytes(*pair)).collect();
    String::from_utf16(&units).ok()
}

fn base64(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut bits = 0u32;
    let mut have = 0u32;
    for c in text.trim_end_matches('=').chars() {
        let value = match c {
            'A'..='Z' => c as u32 - 'A' as u32,
            'a'..='z' => c as u32 - 'a' as u32 + 26,
            '0'..='9' => c as u32 - '0' as u32 + 52,
            '+' => 62,
            '/' => 63,
            _ => return None,
        };
        bits = (bits << 6) | value;
        have += 6;
        if have >= 8 {
            have -= 8;
            out.push((bits >> have) as u8);
            bits &= (1 << have) - 1;
        }
    }
    Some(out)
}
