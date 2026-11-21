//! A guard on the deletes of the agents dummyPlane starts: their Bash and PowerShell calls are
//! read in the `PreToolUse` hook (`hooks_server`), before anything runs.
//!
//! Text rules, not a sandbox, like the push block of `claude_settings`: the command is read as
//! written (`rm`, `Remove-Item`, `rd /s`, `find -delete`, `xargs rm`, and the shells run through
//! `-c`, `/c` or `-Command`), with the variables it set itself and the well-known ones
//! (`$HOME`, `$env:TEMP`, `%USERPROFILE%`) filled in.
//!
//! - A path Bash made drive-relative (`D:\temp\x` unquoted reaches `rm` as `D:tempx`, which names
//!   a file of the drive's current folder) is **denied**, for any `rm`: the agent is told to write
//!   it with forward slashes.
//! - A recursive delete of a drive's root, of the home folder or of a folder above it is **denied**.
//! - A recursive delete outside the folder the agent was started in is **asked**: the user answers
//!   in its terminal, told what the target is, where it was started and whether it exists.
//! - A recursive delete whose target cannot be worked out before the command runs (a variable
//!   nothing set, a command's output, a folder lost by a `cd` into one) is **asked** too, and the
//!   agent is told to write the path out. What only fills the end of a path inside the agent's own
//!   folder (`rm -rf dist/$pkg`) goes on: it cannot leave it by itself.
//!
//! A value that fills the whole of what follows the agent's own folder or its `.git` (`rm -rf ./$x`,
//! `"$PWD/$x"`, `.git/$x`) is that folder itself where it is empty: it is **asked** like a target that
//! cannot be worked out, where a value that only ends a name (`dist/$pkg`) goes on.
//!
//! A mission's agent works in a worktree of its own, `<project>.worktrees/<name>`. A `git` command
//! that changes the repository of the user's own checkout (`git -C <checkout> checkout`, `cd <checkout>
//! && git reset`, `--work-tree`, `GIT_DIR`) is **asked**, whatever the shell: the agent is told to run
//! it in its own worktree. Reading (`status`, `log`, `diff`, `show`, `branch --list`) goes on, and so
//! does git in the agent's own worktree. dummyPlane's own landing never goes through an agent's shell.
//!
//! Inside its own folder an agent deletes what it likes (`node_modules`, build output, a worktree).
//! Where nobody can answer (`dontAsk`) an ask is a refusal that says what to do instead.
//!
//! A command is read in linear time: a script too long or too tangled to be read within the
//! hook's budget asks (or, unattended, is refused), never goes on unread.

use std::cell::Cell;
use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

mod forms;
mod git;
mod shell;
mod vars;

#[cfg(test)]
mod forms_tests;
#[cfg(test)]
mod git_tests;
#[cfg(test)]
mod tail_tests;
#[cfg(test)]
mod tests;

use forms::{
    cmd_c_script, find_plan, list, powershell_script, remove_item_targets, rm_targets,
    shell_c_script, xargs_plan,
};
use git::{git_call, mutates};
use shell::{Statement, assignment, command_at, command_name, statements};
use vars::Vars;

/// The tools whose commands are read (`claude_settings` matches them).
pub const GUARDED_TOOLS: [&str; 2] = ["Bash", "PowerShell"];

/// What every "ask" of dummyPlane's guards starts with: Claude Code shows the reason in its permission
/// request, and the interface reads it there (`src/agents/dialogScreen.ts`, `GUARD_MARKER`, the same
/// text): a parent agent may answer only No to such a prompt, its Yes is the user's. A guard added
/// later asks with it too.
pub const GUARD_MARKER: &str = "[dummyPlane-guard]";

/// The query parameter of a session's hook URL that carries the folder it was started in.
const SCOPE_PARAM: &str = "scope";

/// How long the hook reads a command: its own answer is due in 2 s, and what is late is let through.
const READ_BUDGET: Duration = Duration::from_millis(900);
/// The text a command may make the guard go over (words read, values filled in) before it gives up:
/// eight times the largest command it reads.
const WORK_LIMIT: usize = 2 * 1024 * 1024;
/// What a variable holds, at most: a path is never longer, and a long one is not worth repeating.
const MAX_VALUE: usize = 512;
/// How much a path may grow by what is filled into it.
const MAX_GROWTH: usize = 4096;
/// The reasons of a command's asks that are told, and the folders of a `find` that are read.
const MAX_ASKS: usize = 6;
const MAX_STARTS: usize = 16;
/// The paths the guard looks up on disk in one command (each is a system call).
const MAX_STATS: usize = 16;
/// How deep a substitution is read inside another.
const MAX_NEST: u8 = 4;
/// The variable standing for what a tree walk (`find`, `Get-ChildItem`) finds, which nothing sets.
const WALK: &str = "__dummyplane_walk";

/// `url` with `folder` as the session's own folder: relative targets and `cd` start from the
/// hook's `cwd`, but what is "outside" is decided against where the agent was started, however
/// far a `cd` of its own has taken it since.
pub fn with_scope(url: &str, folder: &Path) -> String {
    let joint = if url.contains('?') { '&' } else { '?' };
    format!(
        "{url}{joint}{SCOPE_PARAM}={}",
        encode(&folder.to_string_lossy())
    )
}

/// The folder `with_scope` put in a hook's URL.
fn scope_of(url: &str) -> Option<String> {
    let (_, query) = url.split_once('?')?;
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix("scope="))
        .and_then(decode)
}

/// Everything but the unreserved characters, as `%XX` bytes.
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            out.push(u8::from_str_radix(text.get(at + 1..at + 3)?, 16).ok()?);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// What the `PreToolUse` hook of a Bash or PowerShell call gets back: a decision, or `None` to
/// let the call go on. `url` is the hook's own URL (`with_scope`); without its folder, the
/// session's `cwd` stands for it.
pub fn pre_tool_use(json: &Value, url: &str) -> Option<Value> {
    guarded(json, || decide(json, url, cfg!(windows)))
}

/// `read`, which a panic must not turn into a call that runs unread: the hook server answers a panic
/// with a 500, which Claude Code takes as a hook that failed, and goes on. So the command is asked
/// about (refused, unattended), as one too long to be read is.
fn guarded(json: &Value, read: impl FnOnce() -> Option<Value>) -> Option<Value> {
    catch_unwind(AssertUnwindSafe(read)).unwrap_or_else(|_| {
        log::error!("the delete guard failed on a command: it asks instead of letting it run");
        let shell = matches!(json["tool_name"].as_str(), Some("Bash" | "PowerShell"));
        let unattended = json["permission_mode"].as_str() == Some("dontAsk");
        shell.then(|| verdict_json(&unread(unattended))).flatten()
    })
}

/// `pre_tool_use`, told whether the paths are Windows paths.
fn decide(json: &Value, url: &str, windows: bool) -> Option<Value> {
    let shell = match json["tool_name"].as_str()? {
        "Bash" => Shell::Bash,
        "PowerShell" => Shell::PowerShell,
        _ => return None,
    };
    let command = json["tool_input"]["command"].as_str()?;
    verdict_json(&judge_command(
        shell,
        command,
        json["cwd"].as_str(),
        scope_of(url).as_deref(),
        json["permission_mode"].as_str() == Some("dontAsk"),
        windows,
    )?)
}

/// What a decision of the hook looks like: an ask bears the marker, whichever rule raised it; a
/// denial reaches only the agent.
fn verdict_json(verdict: &Verdict) -> Option<Value> {
    let reason = if verdict.deny {
        verdict.reason.clone()
    } else {
        format!("{GUARD_MARKER} {}", verdict.reason)
    };
    Some(json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": if verdict.deny { "deny" } else { "ask" },
            "permissionDecisionReason": reason,
        }
    }))
}

/// What the guard says of a shell command, which nothing but the tool's own name stands between
/// it and a delete: `cwd` is the session's folder when it ran, `scope` the folder it was started in
/// (`with_scope`; without it, `cwd`), `unattended` that nobody can answer an ask (`dontAsk`).
fn judge_command(
    shell: Shell,
    command: &str,
    cwd: Option<&str>,
    scope: Option<&str>,
    unattended: bool,
    windows: bool,
) -> Option<Verdict> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok();
    // The OS temp folder, as its variable gives it and as Windows spells it in full (`AHMED~1` for `ahmed`):
    // Claude's scratchpad and what a test run leaves are in it.
    let temp = std::env::temp_dir();
    let full = std::fs::canonicalize(&temp).ok();
    let temps: Vec<&str> = [Some(&temp), full.as_ref()]
        .into_iter()
        .flatten()
        .filter_map(|folder| folder.to_str())
        .collect();
    let mut guard = Guard::new(scope.or(cwd), cwd, home.as_deref(), &temps, windows);
    guard.unattended = unattended;
    guard.deadline = Some(Instant::now() + READ_BUDGET);
    guard.checkout = guard.mission_checkout();
    if windows {
        guard.env = process_env();
    }
    guard.check(shell, command, &on_disk)
}

/// The variables of Windows that name a folder, as this process has them.
fn process_env() -> HashMap<String, String> {
    [
        "LOCALAPPDATA",
        "APPDATA",
        "PROGRAMDATA",
        "PROGRAMFILES",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "WINDIR",
        "PUBLIC",
        "ALLUSERSPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
    ]
    .into_iter()
    .filter_map(|name| {
        let value = std::env::var(name).ok()?;
        Some((name.to_string(), value.replace('\\', "/")))
    })
    .collect()
}

/// Whether a drive path exists: a network share is not asked, which could hold the hook up.
fn on_disk(path: &str) -> Option<bool> {
    let drive = path.as_bytes();
    let local = drive.len() >= 2 && drive[0].is_ascii_alphabetic() && drive[1] == b':';
    (local || !cfg!(windows)).then(|| std::fs::symlink_metadata(path).is_ok())
}

// PowerShell is the shell's own name, not the enum's.
#[allow(clippy::enum_variant_names)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shell {
    Bash,
    PowerShell,
    /// `cmd /c`: `%VAR%`, `^` for an escape, `\` is a path separator.
    Cmd,
}

#[derive(Debug, PartialEq, Eq)]
struct Verdict {
    /// Denied, else the user is asked.
    deny: bool,
    reason: String,
}

/// What a target resolves to.
#[derive(Debug, PartialEq, Eq)]
enum Resolved {
    /// An absolute path, lexically normalised: `D:/a/b`, `/a/b`, a drive's root `D:`, the root `` of
    /// a POSIX filesystem. A glob stops it at its parent (`glob`: what is under it goes).
    Path { path: String, glob: bool },
    /// Something below this folder that is not known yet: `dist/$pkg` is below `…/dist`. `bare`: what is not known is
    /// the whole of what follows the folder (`./$x`), so that where it is empty the target is the folder itself.
    Below { folder: String, bare: bool },
    /// `D:name`: relative to the current folder of drive D.
    DriveRelative,
    /// A variable nothing set, a substitution, a relative path with no known folder.
    Unknown,
}

/// What a text is once its variables are filled in.
enum Exp {
    Known(String),
    /// What stands before the first thing that is not known; `bare`: nothing but separators and more things not known
    /// come after it, and what is known ends where a name starts (`./`), so an empty value leaves the folder itself.
    Partial {
        known: String,
        bare: bool,
    },
}

impl Exp {
    /// Nothing is known of the path.
    fn unknown() -> Self {
        Exp::Partial {
            known: String::new(),
            bare: false,
        }
    }
}

/// What a `$…` or a backtick stands for.
enum Sub {
    Value(String),
    /// Whatever is found below this folder (`$(find DIR …)`).
    Walk(String),
    Unknown,
}

/// What a script is read in: where it is, and what it has set.
struct Cx<'p> {
    cwd: Option<String>,
    /// Where `cd -` goes back to.
    oldpwd: Option<String>,
    /// The folders `pushd` left.
    stack: Vec<Option<String>>,
    vars: Vars<'p>,
}

impl Cx<'static> {
    fn root(cwd: Option<String>) -> Self {
        Cx {
            cwd,
            oldpwd: None,
            stack: Vec::new(),
            vars: Vars::default(),
        }
    }
}

impl<'p> Cx<'p> {
    /// What a script run by this one (`bash -c '…'`) starts from.
    fn child<'c>(&'c self) -> Cx<'c> {
        Cx {
            cwd: self.cwd.clone(),
            oldpwd: self.oldpwd.clone(),
            stack: Vec::new(),
            vars: Vars::child(&self.vars),
        }
    }
}

/// What a read of one command gathers.
struct Run<'a> {
    exists: &'a dyn Fn(&str) -> Option<bool>,
    found: Found,
    stats: usize,
    /// The command was too long, or too tangled, to be read to its end.
    over: bool,
}

/// What a command was found to do: the first denial, or the reasons to ask.
#[derive(Default)]
struct Found {
    deny: Option<Verdict>,
    asks: Vec<String>,
    more: usize,
}

impl Found {
    fn add(&mut self, verdict: Verdict) {
        if verdict.deny {
            self.deny.get_or_insert(verdict);
        } else if !self.asks.contains(&verdict.reason) {
            if self.asks.len() < MAX_ASKS {
                self.asks.push(verdict.reason);
            } else {
                self.more += 1;
            }
        }
    }

    fn verdict(self) -> Option<Verdict> {
        if let Some(deny) = self.deny {
            return Some(deny);
        }
        if self.asks.is_empty() {
            return None;
        }
        let mut reason = self.asks.join(" ");
        if self.more > 0 {
            reason.push_str(&format!(
                " The same command has {} more deletes like these.",
                self.more
            ));
        }
        Some(Verdict {
            deny: false,
            reason,
        })
    }
}

/// What a tree walk puts in front of a delete: the folders it starts in.
struct Feed {
    targets: Vec<String>,
    /// It goes down into folders, so a delete of what it finds takes trees.
    tree: bool,
}

struct Guard {
    /// The folder the agent was started in.
    scope: Option<String>,
    /// The session's current folder.
    cwd: Option<String>,
    home: Option<String>,
    /// The OS temp folder, under which an agent's scratch is its own (Claude's scratchpad, a test run's files).
    temps: Vec<String>,
    /// Windows paths: `\` separates, `D:` and `/d/` name a drive, case does not matter.
    windows: bool,
    /// Nobody can answer a question (`dontAsk`): what would ask is refused, saying why.
    unattended: bool,
    /// The folders Windows names in its variables (`LOCALAPPDATA`), by their upper-case names.
    env: HashMap<String, String>,
    /// When the hook has to answer.
    deadline: Option<Instant>,
    /// How much text has been read and filled in, against `WORK_LIMIT`.
    work: Cell<usize>,
    /// How deep a substitution is being read inside another.
    nest: Cell<u8>,
    /// The user's own checkout, when the agent works in a worktree dummyPlane made for a mission of it
    /// (`mission_checkout`): a `git` command that changes it is asked about. None for any other agent.
    checkout: Option<String>,
}

impl Guard {
    fn new(
        scope: Option<&str>,
        cwd: Option<&str>,
        home: Option<&str>,
        temps: &[&str],
        windows: bool,
    ) -> Self {
        let mut guard = Guard {
            scope: None,
            cwd: None,
            home: None,
            temps: Vec::new(),
            windows,
            unattended: false,
            env: HashMap::new(),
            deadline: None,
            work: Cell::new(0),
            nest: Cell::new(0),
            checkout: None,
        };
        let absolute = |guard: &Guard, text: Option<&str>| match guard.resolve(text?, None) {
            Resolved::Path { path, glob: false } => Some(path),
            _ => None,
        };
        guard.scope = absolute(&guard, scope);
        guard.cwd = absolute(&guard, cwd).or_else(|| guard.scope.clone());
        guard.home = absolute(&guard, home);
        guard.temps = temps
            .iter()
            .filter_map(|temp| absolute(&guard, Some(temp)))
            .collect();
        guard
    }

    fn key(&self, path: &str) -> String {
        if self.windows {
            path.to_lowercase()
        } else {
            path.to_string()
        }
    }

    /// Whether `path` is `folder` or under it, by components: `/a/b-old` is not in `/a/b`.
    fn inside(&self, path: &str, folder: &str) -> bool {
        let (path, folder) = (self.key(path), self.key(folder));
        path == folder || path.starts_with(&format!("{folder}/"))
    }

    fn is_root(&self, path: &str) -> bool {
        let bytes = path.as_bytes();
        path.is_empty() || (self.windows && bytes.len() == 2 && bytes[1] == b':')
    }

    /// Adds to what has been read; false once it is too much, or the hook is out of time.
    fn charge(&self, cost: usize) -> bool {
        let spent = self.work.get().saturating_add(cost);
        self.work.set(spent);
        spent <= WORK_LIMIT && self.deadline.is_none_or(|due| Instant::now() < due)
    }

    /// `text` as a path with `/` for separators.
    fn plain(&self, text: &str) -> String {
        if self.windows {
            let text = text.replace('\\', "/");
            match text.strip_prefix("//?/") {
                Some(rest) => rest.to_string(),
                None => text,
            }
        } else {
            text.to_string()
        }
    }

    /// `text` as an absolute path, `base` being what a relative one starts from.
    fn resolve(&self, text: &str, base: Option<&str>) -> Resolved {
        self.resolve_in(text, base, &Vars::default())
    }

    fn resolve_in(&self, text: &str, base: Option<&str>, vars: &Vars) -> Resolved {
        let text = text.trim();
        if text.is_empty() {
            return Resolved::Unknown;
        }
        match self.expand(&self.plain(text), base, vars) {
            Exp::Known(text) => self.resolve_known(&text, base),
            Exp::Partial { known, bare } => self.resolve_partial(&known, bare, base),
        }
    }

    /// A path with nothing left to fill in.
    fn resolve_known(&self, text: &str, base: Option<&str>) -> Resolved {
        // Git Bash's `/tmp` is the temp folder.
        let in_temp = text
            .strip_prefix("/tmp")
            .filter(|rest| rest.is_empty() || rest.starts_with('/'))
            .zip(self.temps.first())
            .filter(|_| self.windows)
            .map(|(rest, temp)| format!("{temp}{rest}"));
        let text = in_temp.unwrap_or_else(|| text.to_string());
        let bytes = text.as_bytes();
        let (root, rest): (String, String) = if self.windows
            && bytes.len() >= 2
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
        {
            if bytes.len() == 2 || bytes[2] != b'/' {
                return Resolved::DriveRelative;
            }
            (
                format!("{}:", (bytes[0] as char).to_ascii_uppercase()),
                text[3..].to_string(),
            )
        } else if self.windows
            && bytes.len() >= 2
            && bytes[0] == b'/'
            && bytes[1].is_ascii_alphabetic()
            && (bytes.len() == 2 || bytes[2] == b'/')
        {
            // Git Bash's `/d/x` is `D:\x`.
            (
                format!("{}:", (bytes[1] as char).to_ascii_uppercase()),
                text.get(3..).unwrap_or_default().to_string(),
            )
        } else if let Some(rest) = text.strip_prefix('/') {
            (String::new(), rest.to_string())
        } else {
            return match base {
                Some(base) => self.resolve_known(&format!("{base}/{text}"), None),
                None => Resolved::Unknown,
            };
        };
        let mut parts: Vec<&str> = Vec::new();
        let mut glob = false;
        for part in rest.split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    parts.pop();
                }
                part if part.contains(['*', '?', '[', '{']) => {
                    glob = true;
                    break;
                }
                part => parts.push(part),
            }
        }
        let path = if parts.is_empty() {
            root
        } else {
            format!("{root}/{}", parts.join("/"))
        };
        Resolved::Path { path, glob }
    }

    /// A path whose end is not known: it is below the folder its known beginning names.
    fn resolve_partial(&self, prefix: &str, bare: bool, base: Option<&str>) -> Resolved {
        if prefix.is_empty() {
            return Resolved::Unknown;
        }
        let folder = match prefix.rfind('/') {
            Some(at) => &prefix[..=at],
            // `D:$x` is not a folder; `dist-$x` is in the current one.
            None if self.windows && prefix.len() == 2 && prefix.ends_with(':') => {
                return Resolved::Unknown;
            }
            None => "./",
        };
        match self.resolve_known(folder, base) {
            Resolved::Path { path, .. } => Resolved::Below {
                folder: path,
                bare: bare && prefix.ends_with('/'),
            },
            Resolved::DriveRelative => Resolved::DriveRelative,
            _ => Resolved::Unknown,
        }
    }

    /// `text` with the variables it names filled in: its own (`vars`), the well-known ones and `~`.
    fn expand(&self, text: &str, cwd: Option<&str>, vars: &Vars) -> Exp {
        if !self.charge(text.len()) {
            return Exp::unknown();
        }
        // PowerShell's `(…)` is an expression, a path only once it is evaluated.
        if text.starts_with('(') || text.starts_with("@(") {
            return match self.group_value(text, cwd, vars) {
                Some(value) => Exp::Known(value),
                None => Exp::unknown(),
            };
        }
        let mut out = String::with_capacity(text.len());
        let mut at = 0;
        let mut grown = 0usize;
        if text == "~" || text.starts_with("~/") {
            let Some(home) = self.home.as_deref() else {
                return Exp::unknown();
            };
            out.push_str(home);
            at = 1;
        }
        while at < text.len() {
            let rest = &text[at..];
            let Some(c) = rest.chars().next() else { break };
            match c {
                '$' | '`' => {
                    let (sub, used) = if c == '$' {
                        self.dollar(rest, cwd, vars)
                    } else {
                        self.backtick(rest, cwd)
                    };
                    match sub {
                        Sub::Value(value) => {
                            grown += value.len();
                            if value.len() > MAX_VALUE
                                || grown > MAX_GROWTH
                                || !self.charge(value.len())
                            {
                                return self.partial(out, &rest[used..], true);
                            }
                            out.push_str(&value);
                        }
                        // What a walk finds is below where it starts, never the folder itself.
                        Sub::Walk(start) => {
                            return match self.expand(&self.plain(&start), cwd, vars) {
                                Exp::Known(start) => {
                                    self.partial(format!("{out}{start}/"), &rest[used..], false)
                                }
                                Exp::Partial { known, .. } => {
                                    self.partial(format!("{out}{known}"), &rest[used..], false)
                                }
                            };
                        }
                        // Nor is what stands in for a tree walk's finds (`xargs`, `-exec`).
                        Sub::Unknown => {
                            let walked = rest[..used].contains(WALK);
                            return self.partial(out, &rest[used..], !walked);
                        }
                    }
                    at += used;
                }
                '%' if self.windows => {
                    let name = rest[1..]
                        .split('%')
                        .next()
                        .filter(|_| rest[1..].contains('%'));
                    match name.filter(|name| {
                        !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_')
                    }) {
                        Some(name) => {
                            let after = &rest[name.len() + 2..];
                            match self.variable(name, cwd, vars) {
                                Sub::Value(value) => {
                                    grown += value.len();
                                    if value.len() > MAX_VALUE
                                        || grown > MAX_GROWTH
                                        || !self.charge(value.len())
                                    {
                                        return self.partial(out, after, true);
                                    }
                                    out.push_str(&value);
                                }
                                _ => return self.partial(out, after, true),
                            }
                            at += name.len() + 2;
                        }
                        // `%f`, `%1`, `%%f`, `%~dp0`: a variable of cmd's `for`, an argument of a script.
                        None if rest[1..].starts_with(|c: char| {
                            c.is_ascii_alphanumeric() || matches!(c, '%' | '~')
                        }) =>
                        {
                            return self.partial(out, &rest[1..], true);
                        }
                        None => {
                            out.push('%');
                            at += 1;
                        }
                    }
                }
                c => {
                    out.push(c);
                    at += c.len_utf8();
                }
            }
        }
        Exp::Known(out)
    }

    /// What is known of a path that has something unknown in it: the text before it, unless what comes after it can
    /// climb out of that folder (`dist/$x/../..`), which leaves nothing known. `fills`: the unknown is a value that
    /// can be empty; it is then the whole tail (`bare`) when what follows holds only separators and more such values.
    fn partial(&self, known: String, after: &str, fills: bool) -> Exp {
        if after.split(['/', '\\']).any(|part| part == "..") {
            return Exp::unknown();
        }
        let bare = fills && known.ends_with('/') && self.only_values(after);
        Exp::Partial { known, bare }
    }

    /// Whether `text` holds nothing but separators and variables or substitutions (`$y`, `${y}`, `$env:Y`, `%Y%`,
    /// `$(…)`, a backtick pair): every one of them may be empty. A letter, a dot, a star or a quote is a name that is
    /// there whatever they hold. One pass over the text.
    fn only_values(&self, text: &str) -> bool {
        let mut rest = text;
        while let Some(c) = rest.chars().next() {
            let used = match c {
                '/' | '\\' => 1,
                '$' => match rest[1..].chars().next() {
                    Some('(') => {
                        let inner = &rest[2..];
                        let end = matching(inner);
                        if end >= inner.len() {
                            return false;
                        }
                        3 + end
                    }
                    Some('{') => match rest[2..].find('}') {
                        Some(end) => 3 + end,
                        None => return false,
                    },
                    // `$env:Y`: the scope and its colon belong to the name.
                    _ => {
                        let name = rest[1..]
                            .find(|c: char| !(c.is_alphanumeric() || matches!(c, '_' | ':')))
                            .unwrap_or(rest.len() - 1);
                        if name == 0 {
                            return false;
                        }
                        1 + name
                    }
                },
                '`' => match rest[1..].find('`') {
                    Some(end) => end + 2,
                    None => return false,
                },
                '%' if self.windows => {
                    match rest[1..].find('%').filter(|end| {
                        *end > 0
                            && rest[1..1 + *end]
                                .chars()
                                .all(|c| c.is_alphanumeric() || c == '_')
                    }) {
                        Some(end) => end + 2,
                        None => return false,
                    }
                }
                _ => return false,
            };
            rest = &rest[used..];
        }
        true
    }

    /// What `$…` at the start of `rest` stands for, and how many bytes it takes.
    fn dollar(&self, rest: &str, cwd: Option<&str>, vars: &Vars) -> (Sub, usize) {
        let after = &rest[1..];
        if let Some(inner) = after.strip_prefix('(') {
            let end = matching(inner);
            let used = 2 + end + usize::from(end < inner.len());
            return (self.substitution(&inner[..end], cwd), used);
        }
        if let Some(inner) = after.strip_prefix('{') {
            let Some(end) = inner.find('}') else {
                return (Sub::Unknown, rest.len());
            };
            let name = &inner[..end];
            let plain = name
                .chars()
                .all(|c| c.is_alphanumeric() || matches!(c, '_' | ':'));
            let sub = if plain {
                self.variable(name, cwd, vars)
            } else {
                Sub::Unknown
            };
            return (sub, 3 + end);
        }
        let mut end = 0;
        for (at, c) in after.char_indices() {
            // PowerShell's `$env:NAME`, `$script:name`: the scope and its colon belong to the name.
            let scoped = c == ':'
                && ["env", "script", "global", "local", "private"]
                    .iter()
                    .any(|scope| after[..at].eq_ignore_ascii_case(scope));
            // A name may be in any script (`$numéro`).
            if c.is_alphanumeric() || c == '_' || scoped {
                end = at + c.len_utf8();
            } else {
                break;
            }
        }
        // `$` alone, `$1`, `$@`, `$?`, `$$`: not a variable this knows.
        if end == 0 {
            return (Sub::Unknown, 1);
        }
        let name = &after[..end];
        (self.variable(name, cwd, vars), 1 + end)
    }

    /// What a backtick pair at the start of `rest` stands for.
    fn backtick(&self, rest: &str, cwd: Option<&str>) -> (Sub, usize) {
        match rest[1..].find('`') {
            Some(end) => (self.substitution(&rest[1..1 + end], cwd), end + 2),
            None => (Sub::Unknown, rest.len()),
        }
    }

    /// The value of a variable: what the script set, else a well-known one.
    fn variable(&self, name: &str, cwd: Option<&str>, vars: &Vars) -> Sub {
        let mut name = name;
        for scope in ["env:", "script:", "global:", "local:", "private:"] {
            if let Some(rest) = strip_scope(name, scope) {
                name = rest;
            }
        }
        if name.is_empty() || name.starts_with(|c: char| c.is_ascii_digit()) {
            return Sub::Unknown;
        }
        match vars.get(&self.key(name)) {
            Some(Some(value)) => Sub::Value(value.clone()),
            Some(None) => Sub::Unknown,
            None => match self.well_known(name, cwd) {
                Some(value) => Sub::Value(value),
                None => Sub::Unknown,
            },
        }
    }

    fn well_known(&self, name: &str, cwd: Option<&str>) -> Option<String> {
        let upper = name.to_ascii_uppercase();
        // Variable names have a case of their own outside Windows.
        if !self.windows && name != upper {
            return None;
        }
        match upper.as_str() {
            "HOME" | "USERPROFILE" => self.home.clone(),
            "TEMP" | "TMP" | "TMPDIR" => self.temps.first().cloned(),
            "PWD" | "CD" => cwd.map(str::to_string),
            _ => self.env.get(&upper).cloned(),
        }
    }

    /// What `$( … )` or a backtick pair holds stands for: the folder it is in, a fresh temp
    /// folder, what `find` finds below a folder.
    fn substitution(&self, script: &str, cwd: Option<&str>) -> Sub {
        if self.nest.get() >= MAX_NEST {
            return Sub::Unknown;
        }
        self.nest.set(self.nest.get() + 1);
        let sub = self.substitution_in(script, cwd);
        self.nest.set(self.nest.get() - 1);
        sub
    }

    fn substitution_in(&self, script: &str, cwd: Option<&str>) -> Sub {
        let found = statements(Shell::Bash, script);
        let [only] = found.as_slice() else {
            return Sub::Unknown;
        };
        let Some(at) = command_at(Shell::Bash, &only.words) else {
            return Sub::Unknown;
        };
        let args = &only.words[at + 1..];
        match command_name(&only.words[at]).as_str() {
            "pwd" => cwd.map_or(Sub::Unknown, |cwd| Sub::Value(cwd.to_string())),
            // A fresh file or folder of the temp folder, unless it is told another.
            "mktemp"
                if args.iter().all(|arg| {
                    !arg.contains(['/', '\\']) && arg != "-p" && !arg.starts_with("--tmpdir")
                }) =>
            {
                match self.temps.first() {
                    Some(temp) => Sub::Value(format!("{temp}/dummyplane-mktemp")),
                    None => Sub::Unknown,
                }
            }
            "find" => {
                let plan = find_plan(args);
                match plan.starts.as_slice() {
                    [start] if !plan.delete && plan.execs.is_empty() => Sub::Walk(start.clone()),
                    _ => Sub::Unknown,
                }
            }
            _ => Sub::Unknown,
        }
    }

    /// What a PowerShell group `(Join-Path $a 'b')` is worth, if the guard can tell.
    fn group_value(&self, text: &str, cwd: Option<&str>, vars: &Vars) -> Option<String> {
        if self.nest.get() >= MAX_NEST {
            return None;
        }
        let inner = text.strip_prefix('@').unwrap_or(text).strip_prefix('(')?;
        let end = matching(inner);
        // The group must be the whole of the text.
        if end + 1 != inner.len() {
            return None;
        }
        self.nest.set(self.nest.get() + 1);
        let found = statements(Shell::PowerShell, &inner[..end]);
        let value = match found.as_slice() {
            [only] => self.ps_value(&only.words, cwd, vars),
            _ => None,
        };
        self.nest.set(self.nest.get() - 1);
        value
    }

    /// The text a PowerShell expression stands for: a string, `a + b`, `Join-Path a b`, the
    /// current folder, the temp folder.
    fn ps_value(&self, words: &[String], cwd: Option<&str>, vars: &Vars) -> Option<String> {
        let first = words.first()?;
        if words.len() >= 3 && words.iter().skip(1).step_by(2).all(|word| word == "+") {
            let mut out = String::new();
            for word in words.iter().step_by(2) {
                out.push_str(&self.ps_value(std::slice::from_ref(word), cwd, vars)?);
                if out.len() > MAX_VALUE {
                    return None;
                }
            }
            return Some(out);
        }
        let lower = first.to_ascii_lowercase();
        match lower.as_str() {
            "join-path" => {
                let mut named: [Option<&String>; 2] = [None, None];
                let mut positional = Vec::new();
                let mut at = 1;
                while at < words.len() {
                    let flag = words[at].to_ascii_lowercase();
                    let slot = match flag.as_str() {
                        "-path" => Some(0),
                        "-childpath" => Some(1),
                        _ => None,
                    };
                    match slot {
                        Some(slot) => {
                            named[slot] = words.get(at + 1);
                            at += 2;
                        }
                        None => {
                            positional.push(&words[at]);
                            at += 1;
                        }
                    }
                }
                let mut positional = positional.into_iter();
                let path = named[0].or_else(|| positional.next())?;
                let child = named[1].or_else(|| positional.next())?;
                let path = self.ps_value(std::slice::from_ref(path), cwd, vars)?;
                let child = self.ps_value(std::slice::from_ref(child), cwd, vars)?;
                let value = format!(
                    "{}/{}",
                    path.trim_end_matches('/'),
                    child.trim_start_matches('/')
                );
                (value.len() <= MAX_VALUE).then_some(value)
            }
            "get-location" | "pwd" | "gl" if words.len() == 1 => cwd.map(str::to_string),
            "new-temporaryfile" if words.len() == 1 => self
                .temps
                .first()
                .map(|temp| format!("{temp}/dummyplane-tmp")),
            _ if words.len() != 1 => None,
            _ if lower.starts_with("[system.io.path]::gettemppath()")
                || lower.starts_with("[io.path]::gettemppath()") =>
            {
                self.temps.first().cloned()
            }
            _ if first.starts_with('(') || first.starts_with("$(") || first.starts_with("@(") => {
                self.group_value(first.trim_start_matches('$'), cwd, vars)
            }
            // A bare word that is a cmdlet or an alias is a command, not a path.
            _ if is_command_like(&lower) => None,
            _ => {
                let plain = self.plain(first);
                match self.expand(&plain, cwd, vars) {
                    Exp::Known(value) if value.len() <= MAX_VALUE => Some(value),
                    _ => None,
                }
            }
        }
    }

    /// What `value` stands for as the text of a variable: its value if known.
    fn assign_value(&self, value: &str, cwd: Option<&str>, vars: &Vars) -> Option<String> {
        match self.expand(&self.plain(value), cwd, vars) {
            Exp::Known(value) if value.len() <= MAX_VALUE => Some(value),
            _ => None,
        }
    }

    fn check(
        &self,
        shell: Shell,
        command: &str,
        exists: &dyn Fn(&str) -> Option<bool>,
    ) -> Option<Verdict> {
        let mut run = Run {
            exists,
            found: Found::default(),
            stats: 0,
            over: false,
        };
        let mut cx = Cx::root(self.cwd.clone());
        self.scan(shell, command, &mut cx, 0, &mut run);
        if run.over {
            run.found.add(unread(self.unattended));
        }
        run.found.verdict()
    }

    fn scan(&self, shell: Shell, command: &str, cx: &mut Cx, depth: u8, run: &mut Run) {
        let mut upstream: Option<Statement> = None;
        for statement in statements(shell, command) {
            let cost = statement.words.iter().map(|word| word.len() + 1).sum();
            if !self.charge(cost) {
                run.over = true;
                return;
            }
            let fed = upstream.as_ref().filter(|_| statement.piped);
            self.command(shell, &statement.words, fed, cx, depth, false, run);
            if run.over {
                return;
            }
            upstream = Some(statement);
        }
    }

    /// One command. `fed` is the one whose output it reads, `reach` that what it removes is
    /// what a tree walk found (`find -exec rm {}`), so even a plain `rm` takes trees.
    #[allow(clippy::too_many_arguments)]
    fn command(
        &self,
        shell: Shell,
        words: &[String],
        fed: Option<&Statement>,
        cx: &mut Cx,
        depth: u8,
        reach: bool,
        run: &mut Run,
    ) {
        if shell == Shell::PowerShell && self.assign_powershell(words, cx) {
            return;
        }
        let Some(at) = command_at(shell, words) else {
            // Only assignments (and their keywords): what the next commands expand from.
            if shell == Shell::Bash {
                for word in words {
                    if let Some((name, value)) = assignment(word) {
                        let plus = word.as_bytes().get(name.len()) == Some(&b'+');
                        let value = if plus {
                            None
                        } else {
                            self.assign_value(value, cx.cwd.as_deref(), &cx.vars)
                        };
                        cx.vars.set(self.key(name), value);
                    }
                }
            }
            return;
        };
        let args = &words[at + 1..];
        let name = command_name(&words[at]);
        if shell == Shell::PowerShell && words[at].starts_with('[') {
            self.dotnet_delete(shell, &words[at], cx, run);
            return;
        }
        match (shell, name.as_str()) {
            (_, "cd" | "chdir" | "pushd")
            | (Shell::PowerShell, "sl" | "set-location" | "push-location") => {
                if matches!(name.as_str(), "pushd" | "push-location") {
                    cx.stack.push(cx.cwd.clone());
                }
                self.change_dir(shell, args, cx);
            }
            (_, "popd") | (Shell::PowerShell, "pop-location") => {
                cx.oldpwd = cx.cwd.clone();
                cx.cwd = cx.stack.pop().flatten();
            }
            (Shell::Bash, "export" | "declare" | "typeset" | "local" | "readonly") => {
                for arg in args {
                    if let Some((name, value)) = assignment(arg) {
                        let plus = arg.as_bytes().get(name.len()) == Some(&b'+');
                        let value = if plus {
                            None
                        } else {
                            self.assign_value(value, cx.cwd.as_deref(), &cx.vars)
                        };
                        cx.vars.set(self.key(name), value);
                    }
                }
            }
            (Shell::Bash, "for") => {
                // `for d in build dist`: `$d` is one of the folders the loop names, in the current one.
                if let Some(variable) = args.first() {
                    let own = args.get(1).is_some_and(|word| word == "in")
                        && args[2..].iter().all(|word| loop_safe(word));
                    let value = cx
                        .cwd
                        .as_ref()
                        .filter(|_| own)
                        .map(|cwd| format!("{cwd}/dummyplane-loop"));
                    cx.vars.set(self.key(variable), value);
                }
            }
            (Shell::Bash, "unset" | "read" | "select" | "mapfile" | "readarray" | "getopts") => {
                // What these name holds what the shell reads or loops over.
                for arg in args.iter().filter(|arg| !arg.starts_with('-')) {
                    cx.vars.set(self.key(arg), None);
                }
            }
            (Shell::Cmd, "set") => self.set_cmd(args, cx),
            (Shell::Bash | Shell::Cmd, "rm") => {
                let (recursive, targets) = rm_targets(args);
                self.judge(shell, recursive || reach, &targets, cx, run);
            }
            (_, "rm" | "ri" | "remove-item" | "rmdir" | "rd" | "del" | "erase")
                if shell != Shell::Bash =>
            {
                let (mut recursive, mut targets) = remove_item_targets(&name, args);
                if targets.is_empty()
                    && let Some(source) = fed
                {
                    // `Get-ChildItem x | Remove-Item`: what it removes is what the first found.
                    match self.feed(shell, Some(source)) {
                        Some(feed) => {
                            recursive |= feed.tree;
                            targets = feed.targets;
                        }
                        None => targets.push(format!("${{{WALK}}}")),
                    }
                }
                self.judge(shell, recursive || reach, &targets, cx, run);
            }
            (Shell::Bash, "find") if depth < 3 => self.find(shell, args, cx, depth, run),
            (Shell::Bash, "xargs") if depth < 3 => {
                let plan = xargs_plan(args);
                if plan.command.is_empty() {
                    return;
                }
                let feed = self.feed(shell, fed);
                let targets = match &feed {
                    Some(feed) => feed.targets.clone(),
                    None => vec![format!("${{{WALK}}}")],
                };
                for target in targets {
                    let mut command = Vec::with_capacity(plan.command.len() + 1);
                    let mut used = false;
                    for word in &plan.command {
                        match &plan.replace {
                            Some(replace) if word.contains(replace.as_str()) => {
                                command.push(word.replace(replace.as_str(), &target));
                                used = true;
                            }
                            _ => command.push(word.clone()),
                        }
                    }
                    if !used {
                        command.push(target);
                    }
                    if !self.charge(command.iter().map(|word| word.len()).sum()) {
                        run.over = true;
                        return;
                    }
                    self.command(shell, &command, None, cx, depth + 1, feed.is_some(), run);
                }
            }
            (_, "bash" | "sh" | "zsh" | "dash" | "ksh") if depth < 3 => {
                if let Some(script) = shell_c_script(args) {
                    self.nested(Shell::Bash, &script, cx, depth, run);
                }
            }
            (_, "eval") if depth < 3 => {
                self.nested(Shell::Bash, &args.join(" "), cx, depth, run);
            }
            (_, "cmd") if depth < 3 => {
                if let Some(script) = cmd_c_script(args) {
                    self.nested(Shell::Cmd, &script, cx, depth, run);
                }
            }
            (_, "powershell" | "pwsh") if depth < 3 => {
                // `-File` and the rest: a script on disk, which this does not read.
                if let Some(script) = powershell_script(args) {
                    self.nested(Shell::PowerShell, &script, cx, depth, run);
                }
            }
            (Shell::PowerShell, "iex" | "invoke-expression") if depth < 3 => {
                self.nested(Shell::PowerShell, &args.join(" "), cx, depth, run);
            }
            (_, "git") => self.git(&words[..at], args, cx, run),
            _ => {}
        }
    }

    /// The user's own checkout, when the agent was started in a worktree dummyPlane made for a mission of it: a
    /// folder of `<project>.worktrees` whose `.git` is the link of a linked worktree of `<project>`. Any other
    /// session (the user's own, an agent in a worktree of another kind) has none: a `git` command is no concern of
    /// the guard's there. One small file is read, and only for an agent started in such a folder.
    fn mission_checkout(&self) -> Option<String> {
        use std::io::Read;
        let scope = self.scope.as_deref()?;
        let (folder, _) = scope.rsplit_once('/')?;
        let (above, worktrees) = folder.rsplit_once('/')?;
        const SUFFIX: &str = ".worktrees";
        let split = worktrees.len().checked_sub(SUFFIX.len())?;
        let project = worktrees.get(..split).filter(|project| {
            !project.is_empty() && worktrees[split..].eq_ignore_ascii_case(SUFFIX)
        })?;
        let checkout = format!("{above}/{project}");
        // A linked worktree's `.git` is a file: `gitdir: <repository>/.git/worktrees/<name>`.
        let mut link = String::new();
        std::fs::File::open(format!("{scope}/.git"))
            .ok()?
            .take(1024)
            .read_to_string(&mut link)
            .ok()?;
        let target = link.lines().next()?.strip_prefix("gitdir:")?.trim();
        let Resolved::Path { path, glob: false } = self.resolve(target, Some(scope)) else {
            return None;
        };
        let lower = if self.windows {
            path.to_ascii_lowercase()
        } else {
            path.clone()
        };
        let root = &path[..lower.rfind("/.git/worktrees/")?];
        (self.key(root) == self.key(&checkout)).then_some(checkout)
    }

    /// A `git` command of a mission's agent that changes the user's own checkout: asked (refused, unattended).
    /// `before` are the words that came before `git` (`GIT_DIR=… git …`). Where the command works is read from
    /// the folder the script is in, each `-C`, `--work-tree` and `--git-dir`; a place that cannot be worked out
    /// is asked about as well, unless it stays in the agent's own folder.
    fn git(&self, before: &[String], args: &[String], cx: &Cx, run: &mut Run) {
        let (Some(checkout), Some(scope)) = (self.checkout.as_deref(), self.scope.as_deref())
        else {
            return;
        };
        let Some(call) = git_call(args) else { return };
        if !mutates(call.sub, call.args) {
            return;
        }
        // A long run of `-C` is read as far as the budget goes, then asked about as a whole.
        if call.dirs.len() > MAX_STARTS {
            run.over = true;
            return;
        }
        // The folder a path names, or the one it is below when its end is not known (`$checkout/$x`).
        let place = |text: &str, base: Option<&str>| match self.resolve_in(text, base, &cx.vars) {
            Resolved::Path { path, glob: false } => Some(path),
            Resolved::Below { folder, .. } => Some(folder),
            _ => None,
        };
        let mut dir = cx.cwd.clone();
        for each in &call.dirs {
            if !self.charge(each.len()) {
                run.over = true;
                return;
            }
            dir = place(each, dir.as_deref());
        }
        let (mut git_dir, mut work_tree) = (call.git_dir, call.work_tree);
        for word in before {
            match assignment(word) {
                Some(("GIT_DIR", value)) if git_dir.is_none() => git_dir = Some(value),
                Some(("GIT_WORK_TREE", value)) if work_tree.is_none() => work_tree = Some(value),
                _ => {}
            }
        }
        // The repository it works on: what it is told, else the folder it is in.
        let named: Vec<&str> = [work_tree, git_dir].into_iter().flatten().collect();
        let places: Vec<Option<String>> = if named.is_empty() {
            vec![dir]
        } else {
            named
                .into_iter()
                .map(|text| place(text, dir.as_deref().or(Some(scope))))
                .collect()
        };
        // A place nothing tells (`git -C "$(…)"`, a `cd` into a variable) is not the user's checkout as far as
        // anyone can read: the rule is for the commands that name it, not a guess at what a value might hold.
        for path in places.into_iter().flatten() {
            if self.inside(&path, checkout) && !self.inside(&path, scope) {
                run.found.add(self.checkout_verdict(&clip(call.sub), &path));
                return;
            }
        }
    }

    /// What a `git` command that changes the user's checkout is told: asked, or refused where nobody can answer.
    fn checkout_verdict(&self, sub: &str, at: &str) -> Verdict {
        let checkout = show(self.checkout.as_deref().unwrap_or_default(), false);
        let scope = show(self.scope.as_deref().unwrap_or_default(), false);
        let works = format!(
            "in {}, which is the user's own checkout ({checkout})",
            show(at, false)
        );
        if self.unattended {
            Verdict {
                deny: true,
                reason: format!(
                    "In dummyPlane, this git command was stopped: `git {sub}` works {works}, and nobody can approve it in this session. You work in your own worktree ({scope}). Do not retry it: {OWN_WORKTREE}"
                ),
            }
        } else {
            Verdict {
                deny: false,
                reason: format!(
                    "dummyPlane asks before a git command that changes the user's own checkout: `git {sub}` works {works}. A mission's agent works in its own worktree ({scope}); its work reaches the user's branch only by the Land button of dummyPlane. The user approves it only if that really is meant to change their checkout. If it is refused or goes unanswered, do not retry it: {OWN_WORKTREE}"
                ),
            }
        }
    }

    /// A script another command runs: it starts where this one is and sees what it set.
    fn nested(&self, shell: Shell, script: &str, cx: &Cx, depth: u8, run: &mut Run) {
        let mut child = cx.child();
        self.scan(shell, script, &mut child, depth + 1, run);
    }

    /// `find DIR … -delete`, `find DIR … -exec rm {} +`: a recursive delete of what is below DIR.
    fn find(&self, shell: Shell, args: &[String], cx: &mut Cx, depth: u8, run: &mut Run) {
        let plan = find_plan(args);
        if plan.starts.len() > MAX_STARTS || plan.execs.len() > MAX_STARTS {
            run.over = true;
            return;
        }
        if plan.delete {
            let targets = find_targets(&plan.starts, plan.delete_whole);
            self.judge(shell, true, &targets, cx, run);
        }
        for exec in &plan.execs {
            if !exec.command.iter().any(|word| word.contains("{}")) {
                self.command(shell, &exec.command, None, cx, depth + 1, true, run);
                continue;
            }
            for target in &find_targets(&plan.starts, exec.whole) {
                let command: Vec<String> = exec
                    .command
                    .iter()
                    .map(|word| word.replace("{}", target))
                    .collect();
                if !self.charge(command.iter().map(|word| word.len()).sum()) {
                    run.over = true;
                    return;
                }
                self.command(shell, &command, None, cx, depth + 1, true, run);
            }
        }
    }

    /// What a command that feeds the next one (`find`, `Get-ChildItem`) lists: the folders it
    /// looks in. `None` for anything else.
    fn feed(&self, shell: Shell, source: Option<&Statement>) -> Option<Feed> {
        let source = source?;
        let at = command_at(shell, &source.words)?;
        let args = &source.words[at + 1..];
        match (shell, command_name(&source.words[at]).as_str()) {
            (Shell::Bash, "find") => {
                let plan = find_plan(args);
                (plan.starts.len() <= MAX_STARTS).then(|| Feed {
                    targets: find_targets(&plan.starts, plan.whole),
                    tree: true,
                })
            }
            (Shell::PowerShell, "get-childitem" | "gci" | "dir" | "ls") => {
                let (mut starts, tree) = get_childitem(args)?;
                if starts.len() > MAX_STARTS {
                    return None;
                }
                if starts.is_empty() {
                    starts.push(".".to_string());
                }
                Some(Feed {
                    targets: find_targets(&starts, false),
                    tree,
                })
            }
            _ => None,
        }
    }

    /// `[System.IO.Directory]::Delete('D:\x', $true)`.
    fn dotnet_delete(&self, shell: Shell, word: &str, cx: &Cx, run: &mut Run) {
        let lower = word.to_ascii_lowercase();
        let Some(at) = lower.find("directory]::delete(") else {
            return;
        };
        let inner = &word[at + "directory]::delete(".len()..];
        let inner = &inner[..matching(inner)];
        let mut arguments = inner.splitn(2, ',').map(|part| {
            part.trim()
                .trim_matches(|c| c == '\'' || c == '"')
                .to_string()
        });
        let Some(target) = arguments.next().filter(|target| !target.is_empty()) else {
            return;
        };
        let recursive = arguments.next().is_some_and(|flag| {
            !matches!(flag.to_ascii_lowercase().as_str(), "$false" | "false" | "0")
        });
        self.judge(shell, recursive, &[target], cx, run);
    }

    fn change_dir(&self, shell: Shell, args: &[String], cx: &mut Cx) {
        let target = args.iter().find(|arg| {
            (!arg.starts_with('-') && !(shell == Shell::Cmd && arg.eq_ignore_ascii_case("/d")))
                || *arg == "-"
        });
        let now = match target {
            None => self.home.clone(),
            // `cd -` goes back to where the last `cd` left.
            Some(target) if target == "-" => cx.oldpwd.clone(),
            Some(target) => match self.resolve_in(target, cx.cwd.as_deref(), &cx.vars) {
                Resolved::Path { path, glob: false } => Some(path),
                _ => None,
            },
        }
        // A folder that deep is not one this keeps building by hand: the guard stops following it.
        .filter(|folder| folder.len() <= MAX_VALUE * 2);
        cx.oldpwd = std::mem::replace(&mut cx.cwd, now);
    }

    /// `$x = 'D:\a'`, `$env:X = …`, `$x = Join-Path $env:TEMP 'a'`: what later words expand from.
    fn assign_powershell(&self, words: &[String], cx: &mut Cx) -> bool {
        let Some(first) = words.first().filter(|word| word.starts_with('$')) else {
            return false;
        };
        let (name, value): (&str, Vec<String>) = match first.split_once('=') {
            Some((name, value)) => (
                name,
                std::iter::once(value.to_string())
                    .chain(words[1..].iter().cloned())
                    .filter(|word| !word.is_empty())
                    .collect(),
            ),
            None if words.get(1).is_some_and(|word| word.ends_with('=')) => {
                (first, words[1..].to_vec())
            }
            None => return false,
        };
        // `+=`, `-=`: the value changes by what is not known.
        let compound = name.ends_with(['+', '-', '*', '/'])
            || value
                .first()
                .is_some_and(|word| word != "=" && word.ends_with('='));
        let name = name
            .trim_start_matches('$')
            .trim_end_matches(['+', '-', '*', '/'])
            .trim_matches(['{', '}']);
        let name = ["env:", "script:", "global:", "local:", "private:"]
            .iter()
            .fold(name, |name, scope| strip_scope(name, scope).unwrap_or(name));
        let value = if compound {
            None
        } else {
            let words = match value.first().map(String::as_str) {
                Some("=") => &value[1..],
                _ => &value[..],
            };
            self.ps_value(words, cx.cwd.as_deref(), &cx.vars)
        };
        cx.vars.set(self.key(name), value);
        true
    }

    /// cmd's `set X=D:\a`.
    fn set_cmd(&self, args: &[String], cx: &mut Cx) {
        let switch = args.first().is_some_and(|arg| arg.starts_with('/'));
        let rest: Vec<&str> = args
            .iter()
            .skip(usize::from(switch))
            .map(String::as_str)
            .collect();
        let joined = rest.join(" ");
        let Some((name, value)) = joined.split_once('=') else {
            return;
        };
        let value = if switch || value.is_empty() {
            None
        } else {
            self.assign_value(value, cx.cwd.as_deref(), &cx.vars)
        };
        cx.vars.set(self.key(name.trim()), value);
    }

    fn judge(&self, shell: Shell, recursive: bool, targets: &[String], cx: &Cx, run: &mut Run) {
        let mut previous: Option<&String> = None;
        for target in targets {
            // The same word twice (`{}` of a `find -exec`) is judged once.
            if previous.replace(target) == Some(target) {
                continue;
            }
            // A command with thousands of targets is read as far as the budget goes, then asked about as a whole.
            if !self.charge(target.len()) {
                run.over = true;
                return;
            }
            let verdict = match self.resolve_in(target, cx.cwd.as_deref(), &cx.vars) {
                Resolved::DriveRelative => Some(drive_relative(shell, target)),
                _ if !recursive => None,
                Resolved::Unknown => self.unresolved(target, None, None),
                Resolved::Below { folder, bare } => self.judge_below(&folder, bare, target),
                Resolved::Path { path, glob } => self.judge_path(&path, glob, run),
            };
            if let Some(verdict) = verdict {
                run.found.add(verdict);
            }
        }
    }

    /// A target that is something below `prefix`, not known which: it stays inside the agent's
    /// own folder, or the temp folder, or the agent is asked.
    ///
    /// A value that fills the whole of what follows the folder (`./$x`, `"$PWD/$x"`, `.git/$x`: `bare`) is the folder
    /// itself where it is empty: the agent's whole folder, or its git history, is asked about like any path that
    /// cannot be checked. What is only the end of a name (`dist/$pkg`, `build-$n`) cannot leave the folder it is in.
    fn judge_below(&self, prefix: &str, bare: bool, target: &str) -> Option<Verdict> {
        let scope = self.scope.as_deref()?;
        if bare {
            let empty = if self.key(prefix) == self.key(scope) {
                Some("its whole folder")
            } else if self.key(prefix) == self.key(&format!("{scope}/.git")) {
                Some("its git history")
            } else {
                None
            };
            if let Some(empty) = empty {
                return self.unresolved(target, None, Some(empty));
            }
        }
        if self.inside(prefix, scope) || self.temps.iter().any(|temp| self.inside(prefix, temp)) {
            return None;
        }
        self.unresolved(target, Some(prefix), None)
    }

    fn judge_path(&self, path: &str, glob: bool, run: &mut Run) -> Option<Verdict> {
        let shown = show(path, glob);
        let above_home = self
            .home
            .as_deref()
            .is_some_and(|home| self.inside(home, path));
        if self.is_root(path) || above_home {
            return Some(Verdict {
                deny: true,
                reason: format!(
                    "In dummyPlane, this recursive delete was stopped: {shown} is {}. Delete the one folder you mean, once you have checked it exists and is yours.",
                    if self.is_root(path) {
                        "the root of a drive"
                    } else {
                        "your home folder or one above it"
                    }
                ),
            });
        }
        // Anything under the temp folder, and what a glob matches directly in it; not the folder itself.
        if self
            .temps
            .iter()
            .any(|temp| self.inside(path, temp) && (glob || self.key(path) != self.key(temp)))
        {
            return None;
        }
        let scope = self.scope.as_deref()?;
        let whole = !glob && (self.key(path) == self.key(scope));
        let history = !glob && self.key(path) == self.key(&format!("{scope}/.git"));
        if self.inside(path, scope) && !whole && !history {
            return None;
        }
        let what = if whole {
            "its whole folder"
        } else if history {
            "its git history"
        } else if glob {
            "what matches under it, outside its folder"
        } else {
            // Each look is a system call: a command with hundreds of targets is not looked up in full.
            let seen = if run.stats < MAX_STATS {
                run.stats += 1;
                (run.exists)(path)
            } else {
                None
            };
            match seen {
                Some(true) => "which exists, outside its folder",
                Some(false) => "which does not exist yet, outside its folder",
                None => "which was not checked, outside its folder",
            }
        };
        let scope = show(scope, false);
        // One text for the user's prompt and for the agent that reads it when the call is refused: the prompt
        // goes unanswered or `dontAsk` refuses it, and the agent must not retry the same delete.
        Some(if self.unattended {
            Verdict {
                deny: true,
                reason: format!(
                    "In dummyPlane, this recursive delete was stopped: it removes {shown}, {what}, and nobody can approve it in this session. You were started in {scope}. Do not retry it: {INSTEAD}"
                ),
            }
        } else {
            Verdict {
                deny: false,
                reason: format!(
                    "dummyPlane asks before a recursive delete that leaves the agent's own folder: this one removes {shown}, {what}. The agent was started in {scope}. The user approves it only if that really is meant to go. If it is refused or goes unanswered, do not retry it: {INSTEAD}"
                ),
            }
        })
    }

    /// A recursive delete of a path that cannot be worked out before the command runs: asked
    /// (refused, unattended), unless the agent has no folder to be judged against.
    fn unresolved(
        &self,
        target: &str,
        under: Option<&str>,
        empty: Option<&str>,
    ) -> Option<Verdict> {
        let scope = show(self.scope.as_deref()?, false);
        let target = clip(target);
        let what = match (under, empty) {
            (_, Some(empty)) => format!(
                "`{target}`, a path that is only known when the command runs (empty, it is {empty})"
            ),
            (Some(under), None) => format!(
                "`{target}`, something under {} that is only known when the command runs",
                show(under, false)
            ),
            (None, None) => format!("`{target}`, a path that is only known when the command runs"),
        };
        Some(if self.unattended {
            Verdict {
                deny: true,
                reason: format!(
                    "In dummyPlane, this recursive delete was stopped: it removes {what}, so it could not be checked, and nobody can approve it in this session. You were started in {scope}. Do not retry it as it is: {WRITE_OUT} {INSTEAD}"
                ),
            }
        } else {
            Verdict {
                deny: false,
                reason: format!(
                    "dummyPlane asks before a recursive delete it cannot check: this one removes {what} (a variable nothing set, a command's output, or a folder a `cd` lost). The agent was started in {scope}. The user approves it only if that really is meant to go. If it is refused or goes unanswered, do not retry it as it is: {WRITE_OUT} {INSTEAD}"
                ),
            }
        })
    }
}

/// What a command too long, or too tangled, to be read to its end is told.
fn unread(unattended: bool) -> Verdict {
    if unattended {
        Verdict {
            deny: true,
            reason: "In dummyPlane, this command was stopped: it is too long or too tangled to be checked for deletes in the time dummyPlane has, and nobody can approve it in this session. Do not retry it as it is: send it as smaller commands.".to_string(),
        }
    } else {
        Verdict {
            deny: false,
            reason: "dummyPlane asks before a command it could not read to its end: this one is too long or too tangled to be checked for deletes in the time dummyPlane has. The user approves it only if it really is meant to run. If it is refused or goes unanswered, do not retry it as it is: send it as smaller commands.".to_string(),
        }
    }
}

/// The targets of a tree walk: where it starts when nothing picks what is under it (`-delete` is
/// then `rm -rf` of the folder), else what is below where it starts.
fn find_targets(starts: &[String], whole: bool) -> Vec<String> {
    starts
        .iter()
        .take(MAX_STARTS)
        .map(|start| {
            if whole {
                start.clone()
            } else {
                format!("{start}/${{{WALK}}}")
            }
        })
        .collect()
}

/// The folders `Get-ChildItem` lists, and whether it goes down into them. `None` when a flag it does
/// not know could take a value, which this would then read as a folder.
fn get_childitem(args: &[String]) -> Option<(Vec<String>, bool)> {
    let mut starts = Vec::new();
    let mut tree = false;
    let mut at = 0;
    while at < args.len() {
        let arg = &args[at];
        let lower = arg.to_ascii_lowercase();
        at += 1;
        if !(lower.len() > 1 && lower.starts_with('-')) {
            starts.extend(list(arg));
            continue;
        }
        // `-Path:D:\x` carries its value; `-Path D:\x` is followed by it.
        let (flag, attached) = match lower[1..].split_once(':') {
            Some((flag, _)) => (flag, Some(arg[1 + flag.len() + 1..].to_string())),
            None => (&lower[1..], None),
        };
        let is = |full: &str, least: usize| flag.len() >= least && full.starts_with(flag);
        if is("recurse", 1) {
            tree = true;
        } else if is("path", 1) || is("literalpath", 2) {
            match attached {
                Some(path) => starts.extend(list(&path)),
                None => {
                    starts.extend(args.get(at).into_iter().flat_map(|path| list(path)));
                    at += 1;
                }
            }
        } else if is("filter", 2)
            || is("include", 1)
            || is("exclude", 1)
            || is("depth", 1)
            || is("attributes", 1)
            || is("erroraction", 3)
            || is("errorvariable", 6)
            || is("warningaction", 4)
            || is("warningvariable", 8)
            || is("informationaction", 5)
            || is("informationvariable", 12)
            || is("outvariable", 3)
            || is("outbuffer", 3)
            || is("pipelinevariable", 3)
            || matches!(
                flag,
                "ea" | "ev" | "wa" | "wv" | "infa" | "iv" | "ov" | "ob" | "pv"
            )
        {
            if attached.is_none() {
                at += 1;
            }
        } else if !(is("force", 2)
            || is("name", 1)
            || is("directory", 3)
            || is("file", 3)
            || is("hidden", 3)
            || is("readonly", 3)
            || is("system", 3)
            || is("followsymlink", 3)
            || is("verbose", 4)
            || is("debug", 3)
            || matches!(
                flag,
                "fo" | "ad" | "af" | "ah" | "ar" | "as" | "vb" | "db" | "n"
            ))
        {
            return None;
        }
    }
    Some((starts, tree))
}

/// Where the parenthesis opened before `text` closes: the length of what is inside it.
fn matching(text: &str) -> usize {
    let mut depth = 1usize;
    let mut quote: Option<char> = None;
    for (at, c) in text.char_indices() {
        match (quote, c) {
            (Some(open), c) if c == open => quote = None,
            (Some(_), _) => {}
            (None, '\'' | '"') => quote = Some(c),
            (None, '(') => depth += 1,
            (None, ')') => {
                depth -= 1;
                if depth == 0 {
                    return at;
                }
            }
            _ => {}
        }
    }
    text.len()
}

/// `name` without the scope of a PowerShell variable it starts with (`env:TEMP` is `TEMP`), whatever
/// characters it holds: a name may be in any script.
fn strip_scope<'a>(name: &'a str, scope: &str) -> Option<&'a str> {
    let head = name.get(..scope.len())?;
    (head.eq_ignore_ascii_case(scope) && name.len() > scope.len()).then(|| &name[scope.len()..])
}

/// A word of a `for` list that names something in the current folder: no variable, no way out of it.
fn loop_safe(word: &str) -> bool {
    let word = word.strip_prefix("./").unwrap_or(word);
    let bytes = word.as_bytes();
    !word.is_empty()
        && !word.contains(['$', '`', '(', ';'])
        && !word.starts_with(['/', '\\', '~', '-'])
        && !(bytes.len() >= 2 && bytes[1] == b':')
        && word
            .split(['/', '\\'])
            .all(|part| !matches!(part, "." | ".." | ".git"))
}

/// A bare word that names a command (`Get-Location`, `pwd`) rather than a path.
fn is_command_like(lower: &str) -> bool {
    let verb_noun = lower.contains('-')
        && lower
            .split('-')
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_alphabetic()));
    verb_noun
        || matches!(
            lower,
            "pwd"
                | "gl"
                | "gi"
                | "gci"
                | "dir"
                | "ls"
                | "hostname"
                | "whoami"
                | "get-date"
                | "date"
        )
}

/// What an agent does when a delete is refused or goes unanswered: not the same delete again.
const INSTEAD: &str = "delete the specific files you made, by name, or ask the user (or the agent that gave you the task) to remove the folder.";

/// What an agent does when a `git` command was stopped in the user's checkout: its own worktree is where it works.
const OWN_WORKTREE: &str = "run the same git command in your own worktree (cd there, or git -C its path), or ask the user (or the agent that gave you the task) to do it in their checkout.";

/// What an agent does when a target could not be worked out: say where it is.
const WRITE_OUT: &str = "write the path out in full (print the variable, then name the folder itself) so it can be checked, or";

fn show(path: &str, glob: bool) -> String {
    let base = match path {
        "" => "/".to_string(),
        drive if drive.len() == 2 && drive.ends_with(':') => format!("{drive}/"),
        path => path.to_string(),
    };
    if !glob {
        base
    } else if base.ends_with('/') {
        format!("{base}*")
    } else {
        format!("{base}/*")
    }
}

/// A target as the reasons name it, cut when long.
fn clip(text: &str) -> String {
    const SHOWN: usize = 120;
    let mut shown: String = text.chars().take(SHOWN).collect();
    if shown.len() < text.len() {
        shown.push('…');
    }
    shown
}

fn drive_relative(shell: Shell, target: &str) -> Verdict {
    let reason = match shell {
        Shell::Bash => format!(
            "In dummyPlane, this delete was stopped: `{target}` is a drive-relative path, what Bash makes of a Windows path written with backslashes (D:\\temp\\x reaches rm as D:tempx). Write the path with forward slashes (D:/temp/x), check that it names what you mean, and run it again."
        ),
        Shell::PowerShell => format!(
            "In dummyPlane, this delete was stopped: `{target}` is relative to the current folder of its drive, not to the one you are in. Write the whole path (D:\\temp\\x), check that it names what you mean, and run it again."
        ),
        Shell::Cmd => format!(
            "In dummyPlane, this delete was stopped: `{target}` is relative to the current folder of its drive, not to the one you are in (Bash drops the backslashes written outside quotes). Write the whole path inside the quotes of the cmd script (cmd /c \"rd /s /q D:\\temp\\x\"), check that it names what you mean, and run it again."
        ),
    };
    Verdict { deny: true, reason }
}
