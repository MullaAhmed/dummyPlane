//! An agent CLI started by hand in a Shell terminal, found in the process tree under the terminal's shell.
//!
//! A Shell terminal gets no hooks and no wrapper (`shell::manual_claude` is for a Claude terminal), so the agent
//! typed into it never reports to dummyPlane. What the operating system knows is enough: the program runs as a
//! child of the shell (or of a shell inside it), under its own name (`claude.exe`, `codex.exe`…). Each scan lists the
//! processes once for every Shell terminal that runs, finds such a child, and says so once it has stayed two scans in
//! a row, so `claude --version` or `codex exec` typed in a shell do not turn it into an agent terminal.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use super::shell::Agent;

/// How often the terminals running a Shell are scanned.
pub const SCAN_EVERY: Duration = Duration::from_secs(1);

/// A program seen on this many scans in a row is a session; a command that ends within a scan is not.
const CONFIRM_SCANS: u32 = 2;
/// A Claude that wrote no record of its session (an older version) is judged by its command line after this many scans.
const RECORD_WAIT_SCANS: u32 = 4;
/// How many shells may stand between the terminal's shell and the agent (Git Bash starts a second one).
const MAX_DEPTH: usize = 3;

/// One process of the machine, as a scan lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proc {
    pub pid: u32,
    pub parent: u32,
    /// The program, without its folder and its extension, in lower case: `claude` for `C:\...\Claude.exe`.
    pub name: String,
}

/// The program a path or a file name stands for: `claude` for `C:\Users\me\.local\bin\Claude.exe`.
pub fn program_name(file: &str) -> String {
    let base = file.rsplit(['\\', '/']).next().unwrap_or(file).trim();
    let lower = base.to_lowercase();
    for extension in [".exe", ".cmd", ".bat", ".com"] {
        if let Some(stem) = lower.strip_suffix(extension) {
            return stem.to_string();
        }
    }
    lower
}

/// The agent a program name is, among those started without options: Ollama needs a model, which its command line
/// alone does not give reliably, and a custom command has no name.
pub fn agent_named(name: &str) -> Option<Agent> {
    Some(match name {
        "claude" => Agent::Claude,
        "codex" => Agent::Codex,
        "gemini" => Agent::Gemini,
        "qwen" => Agent::Qwen,
        "cursor-agent" => Agent::Cursor,
        "opencode" => Agent::Opencode,
        "aider" => Agent::Aider,
        _ => return None,
    })
}

/// The programs a terminal's shell may run another shell through; the search goes down through these and no
/// other program, so a build that starts a Claude of its own is not the terminal's agent.
fn is_shell(name: &str) -> bool {
    matches!(
        name,
        "powershell" | "pwsh" | "cmd" | "bash" | "sh" | "zsh" | "fish" | "dash" | "ksh" | "nu"
    )
}

/// The agent that runs under `root`, a terminal's shell, and its process: the shallowest, then the oldest.
pub fn find_agent(procs: &[Proc], root: u32) -> Option<(Agent, u32)> {
    let mut children: HashMap<u32, Vec<&Proc>> = HashMap::new();
    for proc in procs {
        children.entry(proc.parent).or_default().push(proc);
    }
    let mut level = vec![root];
    let mut visited = HashSet::from([root]);
    for _ in 0..MAX_DEPTH {
        let mut below = Vec::new();
        let mut found: Option<(Agent, u32)> = None;
        for parent in &level {
            for child in children.get(parent).into_iter().flatten() {
                if !visited.insert(child.pid) {
                    continue;
                }
                if let Some(agent) = agent_named(&child.name) {
                    if found.is_none_or(|(_, pid)| child.pid < pid) {
                        found = Some((agent, child.pid));
                    }
                } else if is_shell(&child.name) {
                    below.push(child.pid);
                }
            }
        }
        if found.is_some() {
            return found;
        }
        level = below;
    }
    None
}

/// What a Claude Code session writes about itself in `<config>/sessions/<pid>.json` as it starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeRecord {
    pub session_id: String,
    /// The folder it runs in.
    pub cwd: Option<String>,
    /// A conversation with a person, not a one-shot run.
    pub interactive: bool,
}

/// The record of the Claude that runs as `pid`, when its version writes one and it is this process's.
pub fn read_claude_record(config: &Path, pid: u32) -> Option<ClaudeRecord> {
    let text = std::fs::read_to_string(config.join("sessions").join(format!("{pid}.json"))).ok()?;
    parse_claude_record(&text, pid)
}

fn parse_claude_record(text: &str, pid: u32) -> Option<ClaudeRecord> {
    let json: serde_json::Value = serde_json::from_str(text).ok()?;
    // Another process's record, left under a pid it no longer has, is none.
    if json.get("pid")?.as_u64()? != u64::from(pid) {
        return None;
    }
    let session_id = uuid::Uuid::parse_str(json.get("sessionId")?.as_str()?)
        .ok()?
        .hyphenated()
        .to_string();
    Some(ClaudeRecord {
        session_id,
        cwd: json
            .get("cwd")
            .and_then(|cwd| cwd.as_str())
            .filter(|cwd| !cwd.trim().is_empty())
            .map(str::to_string),
        interactive: json
            .get("kind")
            .and_then(|kind| kind.as_str())
            .is_none_or(|kind| kind == "interactive"),
    })
}

/// What a scan reads besides the process list: the I/O the pure logic stays out of.
pub trait Probe {
    /// The command line of a process, when the system lets this user read it.
    fn command_line(&self, pid: u32) -> Option<String>;
    /// The record of the Claude running as `pid`.
    fn claude_record(&self, pid: u32) -> Option<ClaudeRecord>;
}

/// The words of a command line: spaces split, double quotes group, the program first.
fn words(command_line: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quoted = false;
    let mut started = false;
    for c in command_line.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    words.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            c => {
                word.push(c);
                started = true;
            }
        }
    }
    if started {
        words.push(word);
    }
    words
}

/// What makes a run of an agent's program an ordinary command: its flags and its first word, that print something,
/// change its setup or run once and leave. Not a session to turn a terminal into.
struct Quiet {
    flags: &'static [&'static str],
    commands: &'static [&'static str],
}

fn quiet(agent: Agent) -> Quiet {
    match agent {
        // As `claude --help` lists them (2.1): what runs once, prints or manages something, or starts a session in the background.
        Agent::Claude => Quiet {
            flags: &[
                "-p",
                "--print",
                "-v",
                "--version",
                "-h",
                "--help",
                "--bg",
                "--background",
            ],
            commands: &[
                "agents",
                "auth",
                "auto-mode",
                "doctor",
                "gateway",
                "import",
                "install",
                "logs",
                "mcp",
                "plugin",
                "plugins",
                "purge",
                "respawn",
                "rm",
                "setup-token",
                "stop",
                "kill",
                "ultrareview",
                "update",
                "upgrade",
                "migrate-installer",
            ],
        },
        // As `codex --help` lists them: `resume` and `fork` are conversations, not among them.
        Agent::Codex => Quiet {
            flags: &["--version", "-V", "-h", "--help"],
            commands: &[
                "exec",
                "e",
                "review",
                "login",
                "logout",
                "mcp",
                "plugin",
                "app-server",
                "remote-control",
                "app",
                "completion",
                "update",
                "doctor",
                "sandbox",
                "debug",
                "apply",
                "a",
                "queue",
                "archive",
                "delete",
                "unarchive",
                "migrate-rollouts",
                "migrate-nfs-db",
                "cloud",
                "exec-server",
                "features",
                "help",
                "proto",
                "mcp-server",
            ],
        },
        Agent::Gemini | Agent::Qwen => Quiet {
            flags: &["-p", "--prompt", "-v", "--version", "-h", "--help"],
            commands: &["mcp", "extensions"],
        },
        Agent::Cursor => Quiet {
            flags: &["-p", "--print", "-v", "--version", "-h", "--help"],
            commands: &[
                "login",
                "logout",
                "status",
                "about",
                "update",
                "mcp",
                "ls",
                "generate-rule",
            ],
        },
        Agent::Opencode => Quiet {
            flags: &["-v", "--version", "-h", "--help"],
            commands: &[
                "run", "serve", "web", "auth", "models", "upgrade", "export", "import", "stats",
                "agent", "mcp", "github",
            ],
        },
        Agent::Aider => Quiet {
            flags: &[
                "--version",
                "-h",
                "--help",
                "-m",
                "--message",
                "--message-file",
                "--list-models",
                "--models",
                "--exit",
                "--check-update",
                "--just-check-update",
            ],
            commands: &[],
        },
        Agent::Ollama | Agent::Shell | Agent::Custom => Quiet {
            flags: &[],
            commands: &[],
        },
    }
}

/// Whether `command_line` is an ordinary run of the agent's program rather than a conversation.
fn one_shot(agent: Agent, command_line: &str) -> bool {
    let quiet = quiet(agent);
    let mut command_seen = false;
    for word in words(command_line).iter().skip(1) {
        if word.starts_with('-') {
            let flag = word.split('=').next().unwrap_or(word);
            if quiet.flags.contains(&flag) {
                return true;
            }
        } else if !command_seen {
            command_seen = true;
            if quiet.commands.contains(&word.as_str()) {
                return true;
            }
        }
    }
    false
}

fn conversation_id(text: &str) -> Option<String> {
    uuid::Uuid::parse_str(text.trim())
        .ok()
        .map(|id| id.hyphenated().to_string())
}

/// The conversation the command line names (`claude --resume <id>`, `claude --session-id <id>`, `codex resume <id>`).
fn conversation_in(agent: Agent, command_line: &str) -> Option<String> {
    let words = words(command_line);
    let mut words = words.iter().skip(1);
    while let Some(word) = words.next() {
        let named = match agent {
            Agent::Claude => ["--resume", "-r", "--session-id"]
                .iter()
                .find_map(|flag| word.strip_prefix(&format!("{flag}=")))
                .map(str::to_string)
                .or_else(|| {
                    ["--resume", "-r", "--session-id"]
                        .contains(&word.as_str())
                        .then(|| words.clone().next().cloned())
                        .flatten()
                }),
            Agent::Codex if word == "resume" => words.clone().next().cloned(),
            _ => None,
        };
        if let Some(id) = named.as_deref().and_then(conversation_id) {
            return Some(id);
        }
    }
    None
}

/// An agent running in a terminal's shell: what the interface turns the terminal into.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sighting {
    pub agent: Agent,
    pub pid: u32,
    /// The conversation it runs, when it can be known for sure.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// The folder it runs in, when it says (the shell may have changed folder before starting it).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

/// What a scan found out about a terminal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    /// An agent runs in it, or more is known of the one reported: its conversation.
    Running(Sighting),
    /// The agent reported is gone (its process pid): the terminal is back at its shell.
    Ended(u32),
}

/// The process under watch, and how long it has been seen.
struct Seen {
    pid: u32,
    scans: u32,
}

#[derive(Default)]
struct Node {
    /// The terminal's shell: another one, once it relaunched, starts the watch over.
    root: u32,
    seen: Option<Seen>,
    reported: Option<Sighting>,
    /// The process the user turned the terminal back to a shell for: not reported again while it runs.
    dismissed: Option<u32>,
}

/// The agents started by hand in every Shell terminal that runs.
#[derive(Default)]
pub struct Watch {
    nodes: HashMap<String, Node>,
}

/// Whether what `pid` runs is a conversation to turn a terminal into, and which one.
fn judge(agent: Agent, pid: u32, scans: u32, probe: &dyn Probe) -> Option<Sighting> {
    let args = probe.command_line(pid);
    if args.as_deref().is_some_and(|args| one_shot(agent, args)) {
        return None;
    }
    let record = (agent == Agent::Claude)
        .then(|| probe.claude_record(pid))
        .flatten();
    if agent == Agent::Claude {
        match &record {
            // Another kind of session than a person's (a print-mode run, a background one).
            Some(record) if !record.interactive => return None,
            // Its version writes a record as it starts: it has not yet.
            None if scans < RECORD_WAIT_SCANS => return None,
            _ => {}
        }
    }
    let session_id = record
        .as_ref()
        .map(|record| record.session_id.clone())
        .or_else(|| {
            args.as_deref()
                .and_then(|args| conversation_in(agent, args))
        });
    Some(Sighting {
        agent,
        pid,
        session_id,
        cwd: record.and_then(|record| record.cwd),
    })
}

impl Watch {
    /// One scan: `roots` are the Shell terminals that run (node id, shell pid), `procs` the machine's processes.
    pub fn scan(
        &mut self,
        roots: &[(String, u32)],
        procs: &[Proc],
        probe: &dyn Probe,
    ) -> Vec<(String, Change)> {
        self.nodes
            .retain(|id, _| roots.iter().any(|(root, _)| root == id));
        let mut changes = Vec::new();
        for (id, root) in roots {
            let node = self.nodes.entry(id.clone()).or_default();
            if node.root != *root {
                *node = Node {
                    root: *root,
                    ..Node::default()
                };
            }
            let found = find_agent(procs, *root);
            if let Some(dismissed) = node.dismissed {
                if found.is_some_and(|(_, pid)| pid == dismissed) {
                    continue;
                }
                node.dismissed = None;
            }
            let Some((agent, pid)) = found else {
                node.seen = None;
                if let Some(gone) = node.reported.take() {
                    changes.push((id.clone(), Change::Ended(gone.pid)));
                }
                continue;
            };
            // Another process than the one reported: that one is gone.
            if node.reported.as_ref().is_some_and(|r| r.pid != pid)
                && let Some(gone) = node.reported.take()
            {
                changes.push((id.clone(), Change::Ended(gone.pid)));
            }
            let scans = match &mut node.seen {
                Some(seen) if seen.pid == pid => {
                    seen.scans += 1;
                    seen.scans
                }
                seen => {
                    *seen = Some(Seen { pid, scans: 1 });
                    1
                }
            };
            if let Some(known) = node.reported.as_ref().map(|r| r.session_id.clone()) {
                // Reported already: Claude's record says its conversation as it is now: it came late, or a
                // `/clear` or a `/resume` in that Claude changed it.
                if agent == Agent::Claude
                    && let Some(sighting) = judge(agent, pid, scans, probe)
                    && sighting.session_id.is_some()
                    && sighting.session_id != known
                {
                    node.reported = Some(sighting.clone());
                    changes.push((id.clone(), Change::Running(sighting)));
                }
            } else if scans >= CONFIRM_SCANS
                && let Some(sighting) = judge(agent, pid, scans, probe)
            {
                node.reported = Some(sighting.clone());
                changes.push((id.clone(), Change::Running(sighting)));
            }
        }
        changes
    }

    /// The user made the terminal a shell again while its agent runs: that process is not reported again.
    pub fn dismiss(&mut self, node_id: &str) {
        let Some(node) = self.nodes.get_mut(node_id) else {
            return;
        };
        let pid = node
            .reported
            .take()
            .map(|reported| reported.pid)
            .or(node.seen.as_ref().map(|seen| seen.pid));
        node.dismissed = pid.or(node.dismissed);
    }

    /// The agents reported and still running, for a page that reloads.
    pub fn running(&self) -> Vec<(String, Sighting)> {
        self.nodes
            .iter()
            .filter_map(|(id, node)| Some((id.clone(), node.reported.clone()?)))
            .collect()
    }
}

/// The system's own view of its processes.
pub struct SystemProbe;

impl Probe for SystemProbe {
    fn command_line(&self, pid: u32) -> Option<String> {
        sys::command_line(pid)
    }

    fn claude_record(&self, pid: u32) -> Option<ClaudeRecord> {
        let config = crate::agents::claude_settings::config_dir_for(None)?;
        read_claude_record(&config, pid)
    }
}

/// Every process of the machine.
pub fn processes() -> Vec<Proc> {
    sys::snapshot()
}

/// The lines of `ps -A -o pid=,ppid=,comm=`: two numbers, then the program (which may hold spaces on macOS).
#[cfg_attr(windows, allow(dead_code))]
pub fn parse_ps(text: &str) -> Vec<Proc> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let pid = parts.next()?.parse().ok()?;
            let parent = parts.next()?.parse().ok()?;
            let command: Vec<&str> = parts.collect();
            (!command.is_empty()).then(|| Proc {
                pid,
                parent,
                name: program_name(&command.join(" ")),
            })
        })
        .collect()
}

#[cfg(windows)]
mod sys {
    use super::{Proc, program_name};
    use windows_sys::Wdk::System::Threading::NtQueryInformationProcess;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    /// `ProcessCommandLineInformation`: a UNICODE_STRING followed by its characters (Windows 8.1 and later).
    const PROCESS_COMMAND_LINE_INFORMATION: i32 = 60;
    /// The size of the UNICODE_STRING that starts the answer: two lengths, padding, a pointer.
    const UNICODE_STRING_SIZE: usize = if cfg!(target_pointer_width = "64") {
        16
    } else {
        8
    };

    pub fn snapshot() -> Vec<Proc> {
        // SAFETY: a snapshot handle is closed below; the entry is the size the calls ask for.
        unsafe {
            let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if handle == INVALID_HANDLE_VALUE {
                return Vec::new();
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut procs = Vec::new();
            let mut more = Process32FirstW(handle, &mut entry) != 0;
            while more {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&unit| unit == 0)
                    .unwrap_or(entry.szExeFile.len());
                procs.push(Proc {
                    pid: entry.th32ProcessID,
                    parent: entry.th32ParentProcessID,
                    name: program_name(&String::from_utf16_lossy(&entry.szExeFile[..len])),
                });
                more = Process32NextW(handle, &mut entry) != 0;
            }
            CloseHandle(handle);
            procs
        }
    }

    pub fn command_line(pid: u32) -> Option<String> {
        // SAFETY: the handle is closed before returning; the buffer is as long as the call is told.
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return None;
            }
            let mut buffer = vec![0u8; 2048];
            let mut text = None;
            for _ in 0..3 {
                let mut needed = 0u32;
                let status = NtQueryInformationProcess(
                    handle,
                    PROCESS_COMMAND_LINE_INFORMATION,
                    buffer.as_mut_ptr().cast(),
                    buffer.len() as u32,
                    &mut needed,
                );
                if status >= 0 {
                    text = decode(&buffer);
                    break;
                }
                // STATUS_INFO_LENGTH_MISMATCH, STATUS_BUFFER_OVERFLOW, STATUS_BUFFER_TOO_SMALL: asked again, larger.
                let too_small =
                    [0xC000_0004u32, 0x8000_0005, 0xC000_0023].contains(&(status as u32));
                if !too_small || needed as usize <= buffer.len() {
                    break;
                }
                buffer.resize(needed as usize, 0);
            }
            CloseHandle(handle);
            text
        }
    }

    /// The characters after the UNICODE_STRING that starts `buffer`.
    fn decode(buffer: &[u8]) -> Option<String> {
        let length = u16::from_le_bytes([*buffer.first()?, *buffer.get(1)?]) as usize;
        let chars = buffer.get(UNICODE_STRING_SIZE..UNICODE_STRING_SIZE + length)?;
        let units: Vec<u16> = chars
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_le_bytes(*pair))
            .collect();
        Some(String::from_utf16_lossy(&units))
    }
}

#[cfg(not(windows))]
mod sys {
    use super::{Proc, parse_ps};
    use std::process::Command;

    pub fn snapshot() -> Vec<Proc> {
        Command::new("ps")
            .args(["-A", "-o", "pid=,ppid=,comm="])
            .output()
            .map(|out| parse_ps(&String::from_utf8_lossy(&out.stdout)))
            .unwrap_or_default()
    }

    pub fn command_line(pid: u32) -> Option<String> {
        let out = Command::new("ps")
            .args(["-o", "args=", "-p", &pid.to_string()])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!text.is_empty()).then_some(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    const ID: &str = "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10";

    fn proc(pid: u32, parent: u32, name: &str) -> Proc {
        Proc {
            pid,
            parent,
            name: name.to_string(),
        }
    }

    /// A machine whose command lines and Claude records are told by the test.
    #[derive(Default)]
    struct Fake {
        lines: RefCell<HashMap<u32, String>>,
        records: RefCell<HashMap<u32, ClaudeRecord>>,
    }

    impl Fake {
        fn line(self, pid: u32, line: &str) -> Self {
            self.lines.borrow_mut().insert(pid, line.to_string());
            self
        }

        fn session(self, pid: u32, id: &str) -> Self {
            self.records.borrow_mut().insert(
                pid,
                ClaudeRecord {
                    session_id: id.to_string(),
                    cwd: None,
                    interactive: true,
                },
            );
            self
        }

        fn record(self, pid: u32, interactive: bool) -> Self {
            self.records.borrow_mut().insert(
                pid,
                ClaudeRecord {
                    session_id: ID.to_string(),
                    cwd: Some(r"D:\code\app".to_string()),
                    interactive,
                },
            );
            self
        }
    }

    impl Probe for Fake {
        fn command_line(&self, pid: u32) -> Option<String> {
            self.lines.borrow().get(&pid).cloned()
        }

        fn claude_record(&self, pid: u32) -> Option<ClaudeRecord> {
            self.records.borrow().get(&pid).cloned()
        }
    }

    fn roots() -> Vec<(String, u32)> {
        vec![("n1".to_string(), 100)]
    }

    /// The tree of the app: the terminal's shell (100), its console host beside it, and what runs under it.
    fn tree(under_shell: &[(u32, &str)]) -> Vec<Proc> {
        let mut procs = vec![
            proc(1, 0, "dummyplane"),
            proc(2, 1, "conhost"),
            proc(100, 1, "powershell"),
        ];
        procs.extend(under_shell.iter().map(|(pid, name)| proc(*pid, 100, name)));
        procs
    }

    #[test]
    fn a_program_is_named_by_its_file_alone() {
        assert_eq!(program_name(r"C:\Users\me\.local\bin\Claude.exe"), "claude");
        assert_eq!(program_name("/usr/local/bin/codex"), "codex");
        assert_eq!(program_name("cursor-agent.cmd"), "cursor-agent");
        assert_eq!(
            program_name("/Applications/Visual Studio Code.app/code"),
            "code"
        );
        assert_eq!(program_name("node"), "node");
    }

    #[test]
    fn the_agents_are_named_by_their_programs() {
        assert_eq!(agent_named("claude"), Some(Agent::Claude));
        assert_eq!(agent_named("codex"), Some(Agent::Codex));
        assert_eq!(agent_named("cursor-agent"), Some(Agent::Cursor));
        // Ollama needs a model, a shell, a custom command: none is found by a program name.
        assert_eq!(agent_named("ollama"), None);
        assert_eq!(agent_named("powershell"), None);
        assert_eq!(agent_named("git"), None);
        assert_eq!(agent_named("node"), None);
    }

    #[test]
    fn finds_an_agent_that_is_a_child_of_the_shell() {
        let procs = tree(&[(200, "claude")]);
        assert_eq!(find_agent(&procs, 100), Some((Agent::Claude, 200)));
    }

    #[test]
    fn finds_an_agent_under_the_shell_a_shell_started() {
        // Git Bash: the launcher is the terminal's shell, its real bash a child, the agent that one's.
        let mut procs = tree(&[(150, "bash")]);
        procs.push(proc(200, 150, "codex"));
        assert_eq!(find_agent(&procs, 100), Some((Agent::Codex, 200)));
    }

    #[test]
    fn ordinary_commands_are_no_agent() {
        let procs = tree(&[(200, "git"), (201, "node"), (202, "cargo"), (203, "python")]);
        assert_eq!(find_agent(&procs, 100), None);
        assert_eq!(find_agent(&tree(&[]), 100), None);
    }

    #[test]
    fn an_agent_under_another_program_is_not_the_terminals() {
        // A build that starts a Claude of its own, or a Claude's own tools: the program on the way is no shell.
        let mut procs = tree(&[(200, "cargo")]);
        procs.push(proc(300, 200, "claude"));
        assert_eq!(find_agent(&procs, 100), None);
    }

    #[test]
    fn an_agent_of_another_terminal_is_not_this_ones() {
        let mut procs = tree(&[]);
        procs.push(proc(500, 1, "powershell"));
        procs.push(proc(501, 500, "claude"));
        assert_eq!(find_agent(&procs, 100), None);
        assert_eq!(find_agent(&procs, 500), Some((Agent::Claude, 501)));
    }

    #[test]
    fn the_shallowest_agent_wins_then_the_oldest() {
        let mut procs = tree(&[(210, "codex"), (150, "bash")]);
        procs.push(proc(160, 150, "claude"));
        procs.push(proc(205, 100, "gemini"));
        assert_eq!(find_agent(&procs, 100), Some((Agent::Gemini, 205)));
    }

    #[test]
    fn the_depth_of_the_search_is_bounded() {
        let mut procs = vec![proc(100, 1, "bash")];
        procs.push(proc(101, 100, "bash"));
        procs.push(proc(102, 101, "bash"));
        procs.push(proc(103, 102, "bash"));
        procs.push(proc(104, 103, "claude"));
        assert_eq!(find_agent(&procs, 100), None);
    }

    #[test]
    fn splits_a_command_line_into_its_words() {
        assert_eq!(
            words(r#""C:\Program Files\x\claude.exe" --model sonnet "fix it""#),
            vec![
                r"C:\Program Files\x\claude.exe",
                "--model",
                "sonnet",
                "fix it"
            ]
        );
        assert_eq!(words(r#"a "" b"#), vec!["a", "", "b"]);
    }

    #[test]
    fn a_conversation_is_not_a_one_shot_run() {
        for line in [
            "claude",
            "claude -c",
            "claude --resume",
            &format!("claude --resume {ID}"),
            "claude --model opus",
            "claude \"explain the mcp server\"",
        ] {
            assert!(!one_shot(Agent::Claude, line), "{line}");
        }
        for line in [
            "claude --version",
            "claude -v",
            "claude -p \"hi\"",
            "claude --print x",
            "claude mcp list",
            "claude doctor",
            "claude update",
            "claude --help",
        ] {
            assert!(one_shot(Agent::Claude, line), "{line}");
        }
        assert!(!one_shot(Agent::Codex, "codex"));
        assert!(!one_shot(Agent::Codex, &format!("codex resume {ID}")));
        for line in [
            "codex exec fix",
            "codex login",
            "codex --version",
            "codex mcp list",
            "codex review",
        ] {
            assert!(one_shot(Agent::Codex, line), "{line}");
        }
        assert!(one_shot(Agent::Gemini, "gemini -p hi"));
        assert!(!one_shot(Agent::Gemini, "gemini"));
        assert!(one_shot(Agent::Aider, "aider --version"));
        assert!(!one_shot(Agent::Aider, "aider --model sonnet"));
    }

    #[test]
    fn reads_the_conversation_a_command_line_names() {
        assert_eq!(
            conversation_in(Agent::Claude, &format!("claude --resume {ID}")).as_deref(),
            Some(ID)
        );
        assert_eq!(
            conversation_in(Agent::Claude, &format!("claude -r {ID} --model x")).as_deref(),
            Some(ID)
        );
        assert_eq!(
            conversation_in(Agent::Claude, &format!("claude --session-id={ID}")).as_deref(),
            Some(ID)
        );
        assert_eq!(
            conversation_in(Agent::Claude, "claude --resume").as_deref(),
            None
        );
        assert_eq!(
            conversation_in(Agent::Claude, "claude --resume my-session").as_deref(),
            None
        );
        assert_eq!(
            conversation_in(Agent::Codex, &format!("codex resume {ID}")).as_deref(),
            Some(ID)
        );
        assert_eq!(
            conversation_in(Agent::Codex, "codex resume --last").as_deref(),
            None
        );
        assert_eq!(
            conversation_in(Agent::Gemini, &format!("gemini --resume {ID}")).as_deref(),
            None
        );
    }

    #[test]
    fn parses_the_record_a_claude_writes_of_its_session() {
        let text = format!(
            r#"{{"pid":10028,"sessionId":"{ID}","cwd":"D:\\code\\app","kind":"interactive","entrypoint":"cli"}}"#
        );
        let record = parse_claude_record(&text, 10028).unwrap();
        assert_eq!(record.session_id, ID);
        assert_eq!(record.cwd.as_deref(), Some(r"D:\code\app"));
        assert!(record.interactive);
        // Another process's record under the same file name, and what is not a conversation id, are none.
        assert_eq!(parse_claude_record(&text, 10029), None);
        assert_eq!(
            parse_claude_record(&text.replace(ID, "not-an-id"), 10028),
            None
        );
        assert_eq!(parse_claude_record("{", 10028), None);
        let print = text.replace("interactive", "print");
        assert!(!parse_claude_record(&print, 10028).unwrap().interactive);
        // A version that names no kind: a person's session, as before.
        let bare = format!(r#"{{"pid":7,"sessionId":"{ID}"}}"#);
        assert!(parse_claude_record(&bare, 7).unwrap().interactive);
    }

    #[test]
    fn reads_a_record_from_the_configuration_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("sessions")).unwrap();
        std::fs::write(
            dir.path().join("sessions").join("42.json"),
            format!(r#"{{"pid":42,"sessionId":"{ID}","kind":"interactive"}}"#),
        )
        .unwrap();
        assert_eq!(read_claude_record(dir.path(), 42).unwrap().session_id, ID);
        assert_eq!(read_claude_record(dir.path(), 43), None);
    }

    #[test]
    fn a_claude_seen_twice_is_reported_with_its_conversation() {
        let mut watch = Watch::default();
        let procs = tree(&[(200, "claude")]);
        let probe = Fake::default().line(200, "claude").record(200, true);
        // A command that has run for one scan only is not a session yet.
        assert_eq!(watch.scan(&roots(), &procs, &probe), vec![]);
        let changes = watch.scan(&roots(), &procs, &probe);
        assert_eq!(
            changes,
            vec![(
                "n1".to_string(),
                Change::Running(Sighting {
                    agent: Agent::Claude,
                    pid: 200,
                    session_id: Some(ID.to_string()),
                    cwd: Some(r"D:\code\app".to_string()),
                })
            )]
        );
        // Said once.
        assert_eq!(watch.scan(&roots(), &procs, &probe), vec![]);
        assert_eq!(watch.running().len(), 1);
    }

    #[test]
    fn a_command_that_ends_within_a_scan_is_no_session() {
        let mut watch = Watch::default();
        let probe = Fake::default().line(200, "claude --version");
        assert_eq!(
            watch.scan(&roots(), &tree(&[(200, "claude")]), &probe),
            vec![]
        );
        assert_eq!(watch.scan(&roots(), &tree(&[]), &probe), vec![]);
        assert_eq!(watch.running().len(), 0);
    }

    #[test]
    fn a_one_shot_run_is_never_reported_however_long_it_lasts() {
        let mut watch = Watch::default();
        let procs = tree(&[(200, "claude"), (201, "codex")]);
        let probe = Fake::default()
            .line(200, "claude mcp list")
            .line(201, "codex exec fix");
        for _ in 0..6 {
            assert_eq!(watch.scan(&roots(), &procs, &probe), vec![]);
        }
        let procs = tree(&[(300, "claude")]);
        let probe = Fake::default().line(300, "claude -p hi").record(300, true);
        for _ in 0..6 {
            assert_eq!(watch.scan(&roots(), &procs, &probe), vec![]);
        }
    }

    #[test]
    fn a_claude_of_another_kind_than_a_conversation_is_not_reported() {
        let mut watch = Watch::default();
        let procs = tree(&[(200, "claude")]);
        let probe = Fake::default().line(200, "claude").record(200, false);
        for _ in 0..6 {
            assert_eq!(watch.scan(&roots(), &procs, &probe), vec![]);
        }
    }

    #[test]
    fn a_claude_without_a_record_is_judged_by_its_command_line_after_a_while() {
        let mut watch = Watch::default();
        let procs = tree(&[(200, "claude")]);
        let probe = Fake::default().line(200, &format!("claude --resume {ID}"));
        let mut reported = Vec::new();
        for scan in 1..=RECORD_WAIT_SCANS {
            let changes = watch.scan(&roots(), &procs, &probe);
            if scan < RECORD_WAIT_SCANS {
                assert_eq!(changes, vec![], "scan {scan}");
            }
            reported.extend(changes);
        }
        assert_eq!(
            reported,
            vec![(
                "n1".to_string(),
                Change::Running(Sighting {
                    agent: Agent::Claude,
                    pid: 200,
                    session_id: Some(ID.to_string()),
                    cwd: None,
                })
            )]
        );
    }

    #[test]
    fn a_record_that_comes_late_completes_what_was_reported() {
        let mut watch = Watch::default();
        let procs = tree(&[(200, "claude")]);
        let bare = Fake::default().line(200, "claude");
        let mut reported = Vec::new();
        for _ in 0..RECORD_WAIT_SCANS {
            reported.extend(watch.scan(&roots(), &procs, &bare));
        }
        assert_eq!(reported.len(), 1);
        assert!(matches!(&reported[0].1, Change::Running(s) if s.session_id.is_none()));
        let with_record = Fake::default().line(200, "claude").record(200, true);
        let changes = watch.scan(&roots(), &procs, &with_record);
        assert!(
            matches!(&changes[..], [(_, Change::Running(s))] if s.session_id.as_deref() == Some(ID))
        );
        assert_eq!(watch.scan(&roots(), &procs, &with_record), vec![]);
    }

    #[test]
    fn a_conversation_that_changes_in_the_claude_that_runs_is_reported_again() {
        let mut watch = Watch::default();
        let procs = tree(&[(200, "claude")]);
        let first = Fake::default().line(200, "claude").record(200, true);
        watch.scan(&roots(), &procs, &first);
        assert_eq!(watch.scan(&roots(), &procs, &first).len(), 1);
        // `/clear` in that Claude: its record names the new conversation.
        let other = "6c1f0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
        let cleared = Fake::default().line(200, "claude").session(200, other);
        let changes = watch.scan(&roots(), &procs, &cleared);
        assert!(
            matches!(&changes[..], [(_, Change::Running(s))] if s.session_id.as_deref() == Some(other) && s.pid == 200),
            "{changes:?}"
        );
        assert_eq!(watch.scan(&roots(), &procs, &cleared), vec![]);
        assert_eq!(
            watch.running()[0].1.session_id.as_deref(),
            Some(other),
            "the page that reloads is told the new one"
        );
        // A record that is gone says nothing new: what was reported stands.
        let gone = Fake::default().line(200, "claude");
        assert_eq!(watch.scan(&roots(), &procs, &gone), vec![]);
    }

    #[test]
    fn a_codex_is_reported_without_a_conversation_unless_its_command_line_names_one() {
        let mut watch = Watch::default();
        let procs = tree(&[(200, "codex")]);
        let probe = Fake::default().line(200, "codex");
        watch.scan(&roots(), &procs, &probe);
        let changes = watch.scan(&roots(), &procs, &probe);
        assert!(
            matches!(&changes[..], [(_, Change::Running(s))] if s.agent == Agent::Codex && s.session_id.is_none())
        );
        let mut watch = Watch::default();
        let probe = Fake::default().line(200, &format!("codex resume {ID}"));
        watch.scan(&roots(), &procs, &probe);
        let changes = watch.scan(&roots(), &procs, &probe);
        assert!(
            matches!(&changes[..], [(_, Change::Running(s))] if s.session_id.as_deref() == Some(ID))
        );
    }

    #[test]
    fn an_unreadable_command_line_does_not_hide_an_agent() {
        let mut watch = Watch::default();
        let procs = tree(&[(200, "gemini")]);
        let probe = Fake::default();
        watch.scan(&roots(), &procs, &probe);
        assert_eq!(watch.scan(&roots(), &procs, &probe).len(), 1);
    }

    #[test]
    fn the_end_of_a_reported_agent_is_reported_once() {
        let mut watch = Watch::default();
        let procs = tree(&[(200, "claude")]);
        let probe = Fake::default().line(200, "claude").record(200, true);
        watch.scan(&roots(), &procs, &probe);
        watch.scan(&roots(), &procs, &probe);
        assert_eq!(
            watch.scan(&roots(), &tree(&[]), &probe),
            vec![("n1".to_string(), Change::Ended(200))]
        );
        assert_eq!(watch.scan(&roots(), &tree(&[]), &probe), vec![]);
        assert_eq!(watch.running().len(), 0);
    }

    #[test]
    fn another_agent_after_the_first_is_reported_after_its_end() {
        let mut watch = Watch::default();
        let claude = Fake::default().line(200, "claude").record(200, true);
        watch.scan(&roots(), &tree(&[(200, "claude")]), &claude);
        watch.scan(&roots(), &tree(&[(200, "claude")]), &claude);
        let codex = Fake::default().line(300, "codex");
        // Replaced between two scans: the first one is gone before the second is spoken of.
        assert_eq!(
            watch.scan(&roots(), &tree(&[(300, "codex")]), &codex),
            vec![("n1".to_string(), Change::Ended(200))]
        );
        let changes = watch.scan(&roots(), &tree(&[(300, "codex")]), &codex);
        assert!(
            matches!(&changes[..], [(_, Change::Running(s))] if s.agent == Agent::Codex && s.pid == 300)
        );
    }

    #[test]
    fn a_process_the_user_turned_the_terminal_back_for_is_not_reported_again() {
        let mut watch = Watch::default();
        let procs = tree(&[(200, "claude")]);
        let probe = Fake::default().line(200, "claude").record(200, true);
        watch.scan(&roots(), &procs, &probe);
        watch.scan(&roots(), &procs, &probe);
        watch.dismiss("n1");
        assert_eq!(watch.running().len(), 0);
        for _ in 0..4 {
            assert_eq!(watch.scan(&roots(), &procs, &probe), vec![]);
        }
        // Its end is not news either; the next Claude is.
        assert_eq!(watch.scan(&roots(), &tree(&[]), &probe), vec![]);
        let again = tree(&[(201, "claude")]);
        let probe = Fake::default().line(201, "claude").record(201, true);
        watch.scan(&roots(), &again, &probe);
        assert_eq!(watch.scan(&roots(), &again, &probe).len(), 1);
    }

    #[test]
    fn a_terminal_that_started_again_starts_its_watch_over() {
        let mut watch = Watch::default();
        let procs = tree(&[(200, "claude")]);
        let probe = Fake::default().line(200, "claude").record(200, true);
        watch.scan(&roots(), &procs, &probe);
        watch.scan(&roots(), &procs, &probe);
        // The terminal restarted under another shell (pid 101): what ran under the old one is not reported as ended.
        let mut procs = vec![proc(1, 0, "dummyplane"), proc(101, 1, "powershell")];
        procs.push(proc(900, 1, "cmd"));
        assert_eq!(
            watch.scan(&[("n1".to_string(), 101)], &procs, &probe),
            vec![]
        );
        assert_eq!(watch.running().len(), 0);
    }

    #[test]
    fn a_terminal_that_stopped_is_forgotten() {
        let mut watch = Watch::default();
        let procs = tree(&[(200, "claude")]);
        let probe = Fake::default().line(200, "claude").record(200, true);
        watch.scan(&roots(), &procs, &probe);
        watch.scan(&roots(), &procs, &probe);
        assert_eq!(watch.scan(&[], &procs, &probe), vec![]);
        assert_eq!(watch.running().len(), 0);
    }

    #[test]
    fn parses_the_process_list_of_ps() {
        let text = "    1     0 /sbin/launchd\n  501     1 /Applications/Visual Studio Code.app/Contents/MacOS/Electron\n  777   501 claude\nbad line\n";
        let procs = parse_ps(text);
        assert_eq!(procs.len(), 3);
        assert_eq!(procs[1].name, "electron");
        assert_eq!(procs[2], proc(777, 501, "claude"));
    }

    /// A program named like an agent's (a copy of cmd.exe) really started under this process, as a shell starts one.
    #[cfg(windows)]
    #[test]
    fn finds_a_program_named_like_an_agent_that_runs_on_this_machine() {
        use std::process::{Command, Stdio};
        let dir = tempfile::tempdir().unwrap();
        let comspec =
            std::env::var_os("ComSpec").unwrap_or_else(|| r"C:\Windows\System32\cmd.exe".into());
        let fake = dir.path().join("Claude.exe");
        std::fs::copy(comspec, &fake).unwrap();
        let mut child = Command::new(&fake)
            .args(["/c", "ping -n 20 127.0.0.1 >nul"])
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        let procs = processes();
        let found = find_agent(&procs, std::process::id());
        let line = sys::command_line(child.id());
        let pid = child.id();
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(found, Some((Agent::Claude, pid)));
        let line = line.expect("the command line of a child is readable");
        assert!(line.contains("ping -n 20"), "{line}");
        assert!(!one_shot(Agent::Claude, &line));
    }

    #[cfg(windows)]
    #[test]
    fn reads_the_processes_and_a_command_line_of_this_machine() {
        let me = std::process::id();
        let procs = processes();
        let mine = procs
            .iter()
            .find(|proc| proc.pid == me)
            .expect("this process is listed");
        assert!(!mine.name.is_empty());
        assert!(procs.iter().any(|proc| proc.pid == mine.parent) || mine.parent != 0);
        let line = sys::command_line(me).expect("its own command line is readable");
        assert!(!line.trim().is_empty());
    }
}
