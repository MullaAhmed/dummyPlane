//! The subagents each Claude session runs (spec orchestrateur §5.2): its
//! `SubagentStart` / `SubagentStop` hooks paired by id, and what their
//! transcripts show. The hooks only change this state; a poller reads the
//! files, off the hook server's threads.

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use super::subagent_transcript::{
    LineKind, Meta, SubagentLine, Tail, bare_id, meta_file, prompt_title, read_meta,
    transcript_file,
};

/// A new subagent is shown once its meta file names its parent, or after this.
pub const ANNOUNCE_WAIT: Duration = Duration::from_millis(1500);
/// After a stop the transcript is read this long more: its last lines may be on their way.
pub const FINAL_READ: Duration = Duration::from_millis(800);
/// A meta file already read is read again this often: `finished` tells a stop that was missed.
const META_RECHECK: Duration = Duration::from_millis(1500);
/// The lines kept per subagent, for a page that reloads.
pub const HISTORY: usize = 400;

/// A `SubagentStart` or `SubagentStop` hook.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SubagentHook {
    pub started: bool,
    /// Bare: the `agent-` some payloads put first is stripped.
    pub agent_id: Option<String>,
    pub agent_type: String,
    /// The session's transcript; a subagent's own for a hook fired inside one.
    pub transcript_path: Option<PathBuf>,
    /// The subagent's transcript, which only `SubagentStop` gives.
    pub agent_transcript_path: Option<PathBuf>,
}

impl SubagentHook {
    /// None for any other hook event.
    pub fn parse(json: &Value) -> Option<Self> {
        let started = match json["hook_event_name"].as_str()? {
            "SubagentStart" => true,
            "SubagentStop" => false,
            _ => return None,
        };
        let path = |key: &str| {
            json[key]
                .as_str()
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(PathBuf::from)
        };
        Some(Self {
            started,
            agent_id: json["agent_id"].as_str().and_then(bare_id),
            agent_type: json["agent_type"]
                .as_str()
                .unwrap_or_default()
                .trim()
                .to_string(),
            transcript_path: path("transcript_path"),
            agent_transcript_path: path("agent_transcript_path"),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SubagentState {
    Running,
    Done,
}

/// A subagent as its node shows it (`agent-subagent`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentInfo {
    pub node_id: String,
    pub agent_id: String,
    pub agent_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    pub state: SubagentState,
}

/// New lines of a subagent's transcript (`subagent-output`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentOutput {
    pub node_id: String,
    pub agent_id: String,
    pub lines: Vec<SubagentLine>,
}

/// A running subagent and its kept lines, for a page that reloads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SubagentSnapshot {
    #[serde(flatten)]
    pub info: SubagentInfo,
    pub lines: Vec<SubagentLine>,
}

/// What the frontend is told, in this order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Emit {
    /// `agent-subagents`: how many subagents a session runs now.
    Running { node_id: String, running: u32 },
    /// `agent-subagent`.
    Info(SubagentInfo),
    /// `subagent-output`.
    Output(SubagentOutput),
}

/// What `clear` found of a session.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Cleared {
    /// Some were running: the count goes back to zero.
    pub running: bool,
    /// Some were known: their nodes go.
    pub any: bool,
}

struct Entry {
    serial: u64,
    agent_id: String,
    agent_type: String,
    /// Started by a hook without `agent_id`: counted, never shown.
    synthetic: bool,
    running: bool,
    started_at: Instant,
    stopped_at: Option<Instant>,
    /// A transcript the hooks named, for the poller to take.
    path_hint: Option<PathBuf>,
    /// None while no path is known, or while the poller reads it.
    tail: Option<Tail>,
    /// Read for the last time after a stop.
    tail_done: bool,
    meta_found: bool,
    meta_read_at: Option<Instant>,
    /// The meta file said unfinished since the last start: `finished` then means done.
    unfinished_seen: bool,
    parent_agent_id: Option<String>,
    description: Option<String>,
    prompt: Option<String>,
    lines: VecDeque<SubagentLine>,
    /// Read but not sent yet: before the subagent is shown, they wait for it.
    pending: VecDeque<SubagentLine>,
    announced: bool,
    /// What the frontend was last told.
    sent: Option<SubagentInfo>,
}

impl Entry {
    fn new(serial: u64, agent_id: String, hook: SubagentHook, now: Instant) -> Self {
        let synthetic = hook.agent_id.is_none();
        let path_hint = hook
            .transcript_path
            .filter(|_| !synthetic)
            .map(|transcript| transcript_file(&transcript, &agent_id));
        Self {
            serial,
            agent_id,
            agent_type: hook.agent_type,
            synthetic,
            running: true,
            started_at: now,
            stopped_at: None,
            path_hint,
            tail: None,
            tail_done: false,
            meta_found: false,
            meta_read_at: None,
            unfinished_seen: false,
            parent_agent_id: None,
            description: None,
            prompt: None,
            lines: VecDeque::new(),
            pending: VecDeque::new(),
            announced: false,
            sent: None,
        }
    }

    fn info(&self, node_id: &str) -> SubagentInfo {
        SubagentInfo {
            node_id: node_id.into(),
            agent_id: self.agent_id.clone(),
            agent_type: self.agent_type.clone(),
            parent_agent_id: self.parent_agent_id.clone(),
            description: self.description.clone(),
            prompt: self.prompt.clone(),
            state: if self.running {
                SubagentState::Running
            } else {
                SubagentState::Done
            },
        }
    }

    /// The info to send when the frontend shows it and it changed.
    fn sync(&mut self, node_id: &str) -> Option<SubagentInfo> {
        let info = self.info(node_id);
        if !self.announced || self.sent.as_ref() == Some(&info) {
            return None;
        }
        self.sent = Some(info.clone());
        Some(info)
    }

    fn stop(&mut self, now: Instant) {
        self.running = false;
        self.stopped_at = Some(now);
    }

    /// Started again (a resume): its transcript goes on from where it was.
    fn resume(&mut self) {
        self.running = true;
        self.stopped_at = None;
        self.tail_done = false;
        self.unfinished_seen = false;
        self.meta_read_at = None;
    }

    fn push(&mut self, line: SubagentLine) {
        if line.kind == LineKind::Prompt && self.prompt.is_none() {
            self.prompt = prompt_title(&line.text);
        }
        for kept in [&mut self.lines, &mut self.pending] {
            kept.push_back(line.clone());
            if kept.len() > HISTORY {
                kept.pop_front();
            }
        }
    }

    fn take_meta(&mut self, meta: Meta, now: Instant) -> bool {
        self.meta_found = true;
        if meta.description.is_some() {
            self.description = meta.description;
        }
        if meta.parent_agent_id.is_some() {
            self.parent_agent_id = meta.parent_agent_id;
        }
        if !meta.finished {
            self.unfinished_seen = true;
            return false;
        }
        // A resumed subagent's meta file may still say finished from its last run.
        let missed_stop = self.running && self.unfinished_seen;
        if missed_stop {
            self.stop(now);
        }
        missed_stop
    }
}

/// One file read the poller does without the lock.
pub struct Job {
    node_id: String,
    serial: u64,
    tail: Tail,
    /// The meta file, when it is to be read.
    meta: Option<PathBuf>,
    /// Stopped long enough: this read is the last.
    last: bool,
}

impl Job {
    /// Reads the transcript, and the meta file when asked.
    pub fn run(mut self) -> Done {
        let lines = self.tail.read().unwrap_or_else(|err| {
            log::debug!("{} not read: {err}", self.tail.path.display());
            Vec::new()
        });
        let meta = self
            .meta
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| read_meta(&text));
        Done {
            node_id: self.node_id,
            serial: self.serial,
            last: self.last && self.tail.caught_up(),
            tail: self.tail,
            lines,
            meta,
        }
    }
}

/// What a job read.
pub struct Done {
    node_id: String,
    serial: u64,
    tail: Tail,
    lines: Vec<SubagentLine>,
    meta: Option<Meta>,
    last: bool,
}

#[derive(Default)]
pub struct Subagents {
    nodes: HashMap<String, Vec<Entry>>,
    serial: u64,
}

impl Subagents {
    /// A hook: the count and the subagent's state change, nothing is read.
    pub fn hook(&mut self, node_id: &str, hook: SubagentHook, now: Instant) -> Vec<Emit> {
        let before = self.running_count(node_id);
        let info = if hook.started {
            self.start(node_id, hook, now)
        } else {
            self.stop(node_id, hook, now)
        };
        let running = self.running_count(node_id);
        let mut emits = Vec::new();
        if running != before {
            emits.push(Emit::Running {
                node_id: node_id.into(),
                running,
            });
        }
        emits.extend(info.map(Emit::Info));
        emits
    }

    /// A start without a type is not a subagent; one of a known id resumes it.
    fn start(&mut self, node_id: &str, hook: SubagentHook, now: Instant) -> Option<SubagentInfo> {
        if hook.agent_type.is_empty() {
            return None;
        }
        let entries = self.nodes.entry(node_id.to_string()).or_default();
        if let Some(id) = &hook.agent_id
            && let Some(entry) = entries
                .iter_mut()
                .find(|e| !e.synthetic && e.agent_id == *id)
        {
            if entry.path_hint.is_none() {
                entry.path_hint = hook
                    .transcript_path
                    .map(|transcript| transcript_file(&transcript, id));
            }
            if !entry.running {
                entry.resume();
            }
            return entry.sync(node_id);
        }
        self.serial += 1;
        let agent_id = hook
            .agent_id
            .clone()
            .unwrap_or_else(|| format!("synthetic-{}", self.serial));
        entries.push(Entry::new(self.serial, agent_id, hook, now));
        None
    }

    /// A stop pairs with the start of its id; one without an id, with the
    /// oldest id-less start of its type. Any other stop is Claude's own agent.
    fn stop(&mut self, node_id: &str, hook: SubagentHook, now: Instant) -> Option<SubagentInfo> {
        let entries = self.nodes.get_mut(node_id)?;
        let entry = match &hook.agent_id {
            Some(id) => entries
                .iter_mut()
                .find(|e| !e.synthetic && e.agent_id == *id)?,
            None => entries
                .iter_mut()
                .find(|e| e.synthetic && e.running && e.agent_type == hook.agent_type)?,
        };
        if !entry.running {
            return None;
        }
        if !entry.synthetic && hook.agent_transcript_path.is_some() {
            entry.path_hint = hook.agent_transcript_path;
        }
        entry.stop(now);
        entry.sync(node_id)
    }

    /// The subagents a session runs now.
    pub fn running_count(&self, node_id: &str) -> u32 {
        self.nodes.get(node_id).map_or(0, |entries| {
            entries.iter().filter(|entry| entry.running).count() as u32
        })
    }

    /// The sessions that run some, for a page that (re)loads.
    pub fn running(&self) -> Vec<(String, u32)> {
        let mut running: Vec<(String, u32)> = self
            .nodes
            .keys()
            .map(|node_id| (node_id.clone(), self.running_count(node_id)))
            .filter(|(_, count)| *count > 0)
            .collect();
        running.sort();
        running
    }

    /// The session or its process ended: its subagents went with it.
    pub fn clear(&mut self, node_id: &str) -> Cleared {
        let Some(entries) = self.nodes.remove(node_id) else {
            return Cleared::default();
        };
        Cleared {
            running: entries.iter().any(|entry| entry.running),
            any: !entries.is_empty(),
        }
    }

    /// The running subagents the frontend was shown, with their kept lines.
    pub fn snapshot(&self) -> Vec<SubagentSnapshot> {
        let mut nodes: Vec<_> = self.nodes.iter().collect();
        nodes.sort_by_key(|(node_id, _)| *node_id);
        nodes
            .into_iter()
            .flat_map(|(node_id, entries)| {
                entries
                    .iter()
                    .filter(|entry| entry.running && entry.announced)
                    .map(|entry| SubagentSnapshot {
                        info: entry.info(node_id),
                        lines: entry.lines.iter().cloned().collect(),
                    })
            })
            .collect()
    }

    /// The reads to do now; their transcripts are lent to them until `apply`.
    pub fn jobs(&mut self, now: Instant) -> Vec<Job> {
        let mut jobs = Vec::new();
        for (node_id, entries) in &mut self.nodes {
            for entry in entries
                .iter_mut()
                .filter(|entry| !entry.synthetic && !entry.tail_done)
            {
                if let Some(hint) = entry.path_hint.take()
                    && entry
                        .tail
                        .as_ref()
                        .is_none_or(|tail| tail.path != hint && tail.untouched())
                {
                    entry.tail = Some(Tail::new(hint));
                }
                let Some(tail) = entry.tail.take() else {
                    continue;
                };
                let meta = (!entry.meta_found
                    || entry.meta_read_at.is_none_or(|at| now >= at + META_RECHECK))
                .then(|| meta_file(&tail.path));
                if meta.is_some() {
                    entry.meta_read_at = Some(now);
                }
                jobs.push(Job {
                    node_id: node_id.clone(),
                    serial: entry.serial,
                    tail,
                    meta,
                    last: entry.stopped_at.is_some_and(|at| now >= at + FINAL_READ),
                });
            }
        }
        jobs
    }

    /// What the reads found, then what the frontend is to be told: new
    /// subagents shown, changed ones, their new lines.
    pub fn apply(&mut self, done: Vec<Done>, now: Instant) -> Vec<Emit> {
        let mut stopped = BTreeSet::new();
        for done in done {
            let Some(entry) = self
                .nodes
                .get_mut(&done.node_id)
                .and_then(|entries| entries.iter_mut().find(|e| e.serial == done.serial))
            else {
                continue;
            };
            entry.tail = Some(done.tail);
            if let Some(meta) = done.meta
                && entry.take_meta(meta, now)
            {
                stopped.insert(done.node_id.clone());
            }
            for line in done.lines {
                entry.push(line);
            }
            if done.last && !entry.running {
                entry.tail_done = true;
            }
        }
        let mut emits: Vec<Emit> = stopped
            .into_iter()
            .map(|node_id| Emit::Running {
                running: self.running_count(&node_id),
                node_id,
            })
            .collect();
        let mut nodes: Vec<_> = self.nodes.iter_mut().collect();
        nodes.sort_by_key(|(node_id, _)| *node_id);
        for (node_id, entries) in nodes {
            for entry in entries.iter_mut().filter(|entry| !entry.synthetic) {
                announce_or_update(node_id, entry, now, &mut emits);
            }
        }
        emits
    }
}

/// Shows a subagent once its parent is known (or after `ANNOUNCE_WAIT`, or
/// when it already stopped), then its lines; a transcript read for the last
/// time keeps no lines: only running subagents are shown again on a reload.
fn announce_or_update(node_id: &str, entry: &mut Entry, now: Instant, emits: &mut Vec<Emit>) {
    let path_known = entry.tail.is_some() || entry.path_hint.is_some();
    if !path_known && entry.stopped_at.is_some_and(|at| now >= at + FINAL_READ) {
        entry.tail_done = true;
    }
    if !entry.announced
        && (entry.meta_found || !entry.running || now >= entry.started_at + ANNOUNCE_WAIT)
    {
        entry.announced = true;
    }
    if !entry.announced {
        return;
    }
    emits.extend(entry.sync(node_id).map(Emit::Info));
    if !entry.pending.is_empty() {
        emits.push(Emit::Output(SubagentOutput {
            node_id: node_id.into(),
            agent_id: entry.agent_id.clone(),
            lines: entry.pending.drain(..).collect(),
        }));
    }
    if entry.tail_done {
        entry.lines.clear();
    }
}

#[cfg(test)]
mod tests {
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::path::Path;

    use serde_json::json;

    use super::*;

    fn start(id: Option<&str>, agent_type: &str) -> SubagentHook {
        SubagentHook {
            started: true,
            agent_id: id.map(str::to_string),
            agent_type: agent_type.into(),
            ..Default::default()
        }
    }

    fn stop(id: Option<&str>, agent_type: &str) -> SubagentHook {
        SubagentHook {
            started: false,
            ..start(id, agent_type)
        }
    }

    fn running(node_id: &str, running: u32) -> Emit {
        Emit::Running {
            node_id: node_id.into(),
            running,
        }
    }

    fn infos(emits: &[Emit]) -> Vec<(String, SubagentState)> {
        emits
            .iter()
            .filter_map(|emit| match emit {
                Emit::Info(info) => Some((info.agent_id.clone(), info.state)),
                _ => None,
            })
            .collect()
    }

    /// One poll, the way the app's poller does it.
    fn poll(subagents: &mut Subagents, now: Instant) -> Vec<Emit> {
        let done = subagents.jobs(now).into_iter().map(Job::run).collect();
        subagents.apply(done, now)
    }

    #[test]
    fn reads_the_hook_payloads() {
        let start = SubagentHook::parse(&json!({
            "session_id": "b7be", "transcript_path": "C:/p/b7be.jsonl", "cwd": "C:/w",
            "hook_event_name": "SubagentStart", "agent_id": "agent-abc123", "agent_type": "Explore"
        }))
        .unwrap();
        assert_eq!(
            start,
            SubagentHook {
                started: true,
                agent_id: Some("abc123".into()),
                agent_type: "Explore".into(),
                transcript_path: Some(PathBuf::from("C:/p/b7be.jsonl")),
                agent_transcript_path: None,
            }
        );
        let stop = SubagentHook::parse(&json!({
            "hook_event_name": "SubagentStop", "stop_hook_active": false, "agent_id": "def456",
            "agent_type": "Explore", "agent_transcript_path": "C:/p/b7be/subagents/agent-def456.jsonl",
            "last_assistant_message": "Done.", "background_tasks": [], "session_crons": []
        }))
        .unwrap();
        assert!(!stop.started);
        assert_eq!(stop.agent_id.as_deref(), Some("def456"));
        assert_eq!(
            stop.agent_transcript_path,
            Some(PathBuf::from("C:/p/b7be/subagents/agent-def456.jsonl"))
        );
        let internal = SubagentHook::parse(&json!({ "hook_event_name": "SubagentStop" })).unwrap();
        assert_eq!(
            (internal.agent_id, internal.agent_type),
            (None, String::new())
        );
        assert_eq!(
            SubagentHook::parse(&json!({ "hook_event_name": "Stop" })),
            None
        );
    }

    #[test]
    fn pairs_starts_and_stops_by_id_and_counts_the_running_ones() {
        let now = Instant::now();
        let mut subagents = Subagents::default();
        assert_eq!(
            subagents.hook("n1", start(Some("a"), "Explore"), now),
            vec![running("n1", 1)]
        );
        assert_eq!(
            subagents.hook("n1", start(Some("b"), "Plan"), now),
            vec![running("n1", 2)]
        );
        // The prefixed and the bare id are the same subagent.
        let prefixed = SubagentHook::parse(&json!({
            "hook_event_name": "SubagentStop", "agent_id": "agent-a", "agent_type": "Explore"
        }))
        .unwrap();
        assert_eq!(subagents.hook("n1", prefixed, now), vec![running("n1", 1)]);
        assert_eq!(
            subagents.hook("n1", stop(Some("a"), "Explore"), now),
            vec![],
            "stopped already"
        );
        assert_eq!(subagents.running(), vec![("n1".to_string(), 1)]);
        assert_eq!(
            subagents.hook("n1", stop(Some("b"), "Plan"), now),
            vec![running("n1", 0)]
        );
        assert!(subagents.running().is_empty());
    }

    #[test]
    fn a_start_again_for_a_known_id_is_not_a_second_subagent() {
        let now = Instant::now();
        let mut subagents = Subagents::default();
        subagents.hook("n1", start(Some("a"), "Explore"), now);
        assert_eq!(
            subagents.hook("n1", start(Some("a"), "Explore"), now),
            vec![]
        );
        assert_eq!(subagents.running_count("n1"), 1);
    }

    #[test]
    fn ignores_claude_s_own_agents_and_untyped_starts() {
        let now = Instant::now();
        let mut subagents = Subagents::default();
        subagents.hook("n1", start(Some("a"), "Explore"), now);
        assert_eq!(
            subagents.hook("n1", stop(Some("prompt-suggestion"), ""), now),
            vec![]
        );
        assert_eq!(subagents.hook("n1", stop(None, ""), now), vec![]);
        assert_eq!(
            subagents.hook("n2", stop(Some("a"), "Explore"), now),
            vec![]
        );
        assert_eq!(subagents.hook("n1", start(Some("c"), ""), now), vec![]);
        assert_eq!(subagents.running_count("n1"), 1);
    }

    #[test]
    fn id_less_hooks_pair_by_type_and_are_never_shown() {
        let now = Instant::now();
        let mut subagents = Subagents::default();
        subagents.hook("n1", start(None, "Explore"), now);
        subagents.hook("n1", start(None, "Explore"), now);
        subagents.hook("n1", start(None, "Plan"), now);
        assert_eq!(
            subagents.hook("n1", stop(None, "Explore"), now),
            vec![running("n1", 2)]
        );
        assert_eq!(subagents.hook("n1", stop(None, "Review"), now), vec![]);
        assert_eq!(
            subagents.hook("n1", stop(None, "Explore"), now),
            vec![running("n1", 1)]
        );
        assert_eq!(subagents.hook("n1", stop(None, "Explore"), now), vec![]);
        assert!(poll(&mut subagents, now + ANNOUNCE_WAIT * 2).is_empty());
        assert!(subagents.snapshot().is_empty());
    }

    #[test]
    fn shows_a_subagent_after_a_while_without_meta_and_resumes_it() {
        let now = Instant::now();
        let mut subagents = Subagents::default();
        subagents.hook("n1", start(Some("a"), "Explore"), now);
        assert!(poll(&mut subagents, now + Duration::from_millis(400)).is_empty());
        assert!(subagents.snapshot().is_empty(), "not shown yet");
        let later = now + ANNOUNCE_WAIT;
        assert_eq!(
            infos(&poll(&mut subagents, later)),
            vec![("a".into(), SubagentState::Running)]
        );
        assert!(poll(&mut subagents, later).is_empty(), "told once");
        assert_eq!(subagents.snapshot().len(), 1);
        let emits = subagents.hook("n1", stop(Some("a"), "Explore"), later);
        assert_eq!(emits[0], running("n1", 0));
        assert_eq!(infos(&emits), vec![("a".into(), SubagentState::Done)]);
        assert!(
            subagents.snapshot().is_empty(),
            "a reload does not revive it"
        );
        let emits = subagents.hook("n1", start(Some("a"), "Explore"), later);
        assert_eq!(emits[0], running("n1", 1));
        assert_eq!(infos(&emits), vec![("a".into(), SubagentState::Running)]);
    }

    #[test]
    fn a_subagent_stopped_before_it_was_shown_is_shown_done() {
        let now = Instant::now();
        let mut subagents = Subagents::default();
        subagents.hook("n1", start(Some("a"), "Explore"), now);
        assert_eq!(
            subagents.hook("n1", stop(Some("a"), "Explore"), now),
            vec![running("n1", 0)]
        );
        assert_eq!(
            infos(&poll(&mut subagents, now)),
            vec![("a".into(), SubagentState::Done)]
        );
    }

    #[test]
    fn clearing_a_session_tells_whether_some_ran_or_were_known() {
        let now = Instant::now();
        let mut subagents = Subagents::default();
        subagents.hook("n1", start(Some("a"), "Explore"), now);
        subagents.hook("n2", start(Some("b"), "Explore"), now);
        subagents.hook("n2", stop(Some("b"), "Explore"), now);
        assert_eq!(
            subagents.clear("n1"),
            Cleared {
                running: true,
                any: true
            }
        );
        assert_eq!(
            subagents.clear("n2"),
            Cleared {
                running: false,
                any: true
            }
        );
        assert_eq!(subagents.clear("n2"), Cleared::default());
        assert!(subagents.running().is_empty());
    }

    #[test]
    fn a_finished_meta_stops_a_subagent_only_after_it_said_unfinished() {
        let now = Instant::now();
        let mut subagents = Subagents::default();
        subagents.hook("n1", start(Some("a"), "Explore"), now);
        let done = |meta: Meta, subagents: &mut Subagents| {
            let done = Done {
                node_id: "n1".into(),
                serial: 1,
                tail: Tail::new(PathBuf::from("agent-a.jsonl")),
                lines: Vec::new(),
                meta: Some(meta),
                last: false,
            };
            subagents.apply(vec![done], now)
        };
        let finished = Meta {
            finished: true,
            ..Default::default()
        };
        done(finished.clone(), &mut subagents);
        assert_eq!(
            subagents.running_count("n1"),
            1,
            "finished from a previous run"
        );
        done(Meta::default(), &mut subagents);
        let emits = done(finished, &mut subagents);
        assert_eq!(emits[0], running("n1", 0), "the stop hook was missed");
        assert_eq!(infos(&emits), vec![("a".into(), SubagentState::Done)]);
    }

    fn append(path: &Path, lines: &[Value]) {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
    }

    #[test]
    fn tails_a_subagent_s_transcript_from_start_to_stop() {
        let dir = tempfile::tempdir().unwrap();
        let session = dir.path().join("b7be.jsonl");
        let folder = dir.path().join("b7be").join("subagents");
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join("agent-ad41.jsonl");
        let now = Instant::now();
        let mut subagents = Subagents::default();
        let hook = SubagentHook::parse(&json!({
            "hook_event_name": "SubagentStart", "agent_id": "agent-ad41",
            "agent_type": "general-purpose", "transcript_path": session.to_string_lossy()
        }))
        .unwrap();
        subagents.hook("n1", hook, now);
        assert!(
            poll(&mut subagents, now).is_empty(),
            "no meta, no transcript yet"
        );

        std::fs::write(
            folder.join("agent-ad41.meta.json"),
            r#"{"agentType":"general-purpose","description":"Fix feature-taxonomy","parentAgentId":"a4d2","spawnDepth":2}"#,
        )
        .unwrap();
        append(
            &file,
            &[
                json!({ "type": "user", "agentId": "ad41", "message": { "role": "user", "content": "Fix the taxonomy.\nThen report." } }),
                json!({ "type": "attachment", "agentId": "ad41", "attachment": {} }),
            ],
        );
        let emits = poll(&mut subagents, now + Duration::from_millis(350));
        let info = SubagentInfo {
            node_id: "n1".into(),
            agent_id: "ad41".into(),
            agent_type: "general-purpose".into(),
            parent_agent_id: Some("a4d2".into()),
            description: Some("Fix feature-taxonomy".into()),
            prompt: Some("Fix the taxonomy.".into()),
            state: SubagentState::Running,
        };
        let prompt = SubagentLine {
            kind: LineKind::Prompt,
            text: "Fix the taxonomy.\nThen report.".into(),
        };
        assert_eq!(
            emits,
            vec![
                Emit::Info(info.clone()),
                Emit::Output(SubagentOutput {
                    node_id: "n1".into(),
                    agent_id: "ad41".into(),
                    lines: vec![prompt.clone()],
                }),
            ]
        );

        append(
            &file,
            &[json!({ "type": "assistant", "message": { "content": [
                { "type": "tool_use", "id": "toolu_1", "name": "Bash", "input": { "command": "ls" } }
            ]}})],
        );
        let tool = SubagentLine {
            kind: LineKind::Tool,
            text: "Bash(ls)".into(),
        };
        let emits = poll(&mut subagents, now + Duration::from_millis(700));
        assert_eq!(
            emits,
            vec![Emit::Output(SubagentOutput {
                node_id: "n1".into(),
                agent_id: "ad41".into(),
                lines: vec![tool.clone()],
            })]
        );
        assert_eq!(
            serde_json::to_value(subagents.snapshot()).unwrap(),
            json!([{
                "nodeId": "n1", "agentId": "ad41", "agentType": "general-purpose",
                "parentAgentId": "a4d2", "description": "Fix feature-taxonomy",
                "prompt": "Fix the taxonomy.", "state": "running",
                "lines": [
                    { "kind": "prompt", "text": "Fix the taxonomy.\nThen report." },
                    { "kind": "tool", "text": "Bash(ls)" }
                ]
            }])
        );

        let stopped = now + Duration::from_secs(1);
        let hook = SubagentHook::parse(&json!({
            "hook_event_name": "SubagentStop", "agent_id": "ad41", "agent_type": "general-purpose",
            "agent_transcript_path": file.to_string_lossy()
        }))
        .unwrap();
        let emits = subagents.hook("n1", hook, stopped);
        let done = SubagentInfo {
            state: SubagentState::Done,
            ..info
        };
        assert_eq!(emits, vec![running("n1", 0), Emit::Info(done)]);
        // The handback lands after the stop hook.
        append(
            &file,
            &[json!({ "type": "assistant", "message": { "content": [
                { "type": "tool_use", "id": "toolu_2", "name": "SubagentHandback", "input": { "message": "Fixed." } }
            ]}})],
        );
        let emits = poll(&mut subagents, stopped + FINAL_READ);
        assert!(
            matches!(&emits[..], [Emit::Output(output)] if output.lines[0].kind == LineKind::Report)
        );
        assert!(
            subagents.jobs(stopped + FINAL_READ * 2).is_empty(),
            "read for the last time"
        );
        assert!(subagents.snapshot().is_empty());
    }

    #[test]
    fn serializes_events_in_camel_case_without_unknown_fields() {
        let info = SubagentInfo {
            node_id: "n1".into(),
            agent_id: "a4d2".into(),
            agent_type: "Explore".into(),
            parent_agent_id: None,
            description: None,
            prompt: None,
            state: SubagentState::Done,
        };
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            json!({ "nodeId": "n1", "agentId": "a4d2", "agentType": "Explore", "state": "done" })
        );
        let output = SubagentOutput {
            node_id: "n1".into(),
            agent_id: "a4d2".into(),
            lines: vec![SubagentLine {
                kind: LineKind::Error,
                text: "boom".into(),
            }],
        };
        assert_eq!(
            serde_json::to_value(output).unwrap(),
            json!({ "nodeId": "n1", "agentId": "a4d2", "lines": [{ "kind": "error", "text": "boom" }] })
        );
    }
}
