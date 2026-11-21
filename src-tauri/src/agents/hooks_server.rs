//! The local HTTP endpoint the agents' hooks post to.
//! Bound to 127.0.0.1 on a port the system picks; every request must carry the
//! token drawn at startup.

use std::fmt;
use std::io::Read;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::de::{Deserialize, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value, json};
use tiny_http::{Header, Method, Request, Response, Server};

use super::activity::{
    Activity, HookSource, claude_activity, claude_session_ended, clean_message, codex_activity,
    gemini_activity,
};
use super::delete_guard;
use super::forked_skills::{self, Fork, SKILL_TOOL};
use super::mcp;
use super::subagents::SubagentHook;

/// A status line's body: larger ones are refused.
pub const MAX_BODY: usize = 64 * 1024;

/// A hook's body is read whole up to this size, and no further. A `PostToolUse` of Claude's
/// `Edit` or `Write` carries the old and the new text and the tool's response (the file as it
/// was, its patch), so it grows with the file: 64 KiB refused any edit of a big file, and the
/// event was lost. Past this size the body is not read on: see `parse_hook_body`. It stays under
/// `MAX_ANNOUNCED_BODY`, so the rest of such a body is still drained and answered.
const HOOK_MAX_BODY: usize = 16 * 1024 * 1024;

/// The longest shell command the delete guard reads. Its time grows in step with the command
/// (up to a second a MiB, measured on a debug build, for a command of `rm`s, nested shells or
/// thousands of targets), and a hook not answered in the 2 seconds its settings give it lets the
/// call run: a longer command, though the hook was read whole, is asked about instead
/// (`pre_tool_use_unread`). A model's command is never that long.
const GUARD_MAX_COMMAND: usize = 256 * 1024;

/// Of a hook body past `HOOK_MAX_BODY`, a text field longer than this is not kept: the fields
/// that matter (names, a mode, a folder, a message) are far shorter.
const SALVAGED_TEXT: usize = 4 * 1024;

/// A hook event that changes a terminal's activity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookHit {
    pub node_id: String,
    pub source: HookSource,
    pub activity: Activity,
    /// Claude left (`SessionEnd`): its shell's output decides again.
    pub session_ended: bool,
    /// What a waiting agent says it waits for, cleaned.
    pub message: Option<String>,
}

/// What the server reports, and the questions it forwards.
pub trait HookSink: Send + Sync + 'static {
    /// A hook event that changes a terminal's activity.
    fn hit(&self, hit: HookHit);
    /// A Claude session started or stopped a subagent (`SubagentStart` / `SubagentStop`).
    fn subagent(&self, node_id: &str, hook: SubagentHook);
    /// The node an MCP token was given to.
    fn mcp_node(&self, token: &str) -> Option<String>;
    /// `tools/list` or `tools/call` for a node, answered by the interface.
    fn mcp_call(&self, node_id: &str, method: &str, params: Value) -> Result<Value, String>;
    /// A Codex turn ended in this thread (its notify's `thread-id`).
    fn codex_thread(&self, _node_id: &str, _thread: &str) {}
    /// What a Claude session's status line was given: its usage.
    fn status(&self, _node_id: &str, _status: Value) {}
}

/// The header that carries the token for callers given it through a curl
/// config file, so it never shows on a command line.
pub const TOKEN_HEADER: &str = "X-dummyPlane-Token";

pub struct HookServer {
    pub port: u16,
    pub token: String,
}

impl HookServer {
    /// The URL a terminal's hooks post to, with the token: for Claude's
    /// settings file, never for a command line.
    pub fn url(&self, source: HookSource, node_id: &str) -> String {
        format!("{}?t={}", self.bare_url(source, node_id), self.token)
    }

    /// The same URL without the token, which then travels in `TOKEN_HEADER`.
    pub fn bare_url(&self, source: HookSource, node_id: &str) -> String {
        let kind = match source {
            HookSource::Claude => "claude",
            HookSource::Codex => "codex",
            HookSource::Gemini => "gemini",
        };
        format!("http://127.0.0.1:{}/hook/{kind}/{node_id}", self.port)
    }

    /// The URL a Claude session's status line posts its JSON to, with the token.
    #[cfg(test)]
    pub fn status_url(&self, node_id: &str) -> String {
        format!("{}?t={}", self.bare_status_url(node_id), self.token)
    }

    /// The status line's URL without the token, which then travels in `TOKEN_HEADER`.
    pub fn bare_status_url(&self, node_id: &str) -> String {
        format!("http://127.0.0.1:{}/status/{node_id}", self.port)
    }

    /// The URL of dummyPlane's MCP server.
    pub fn mcp_url(&self) -> String {
        format!("http://127.0.0.1:{}/mcp", self.port)
    }
}

/// Past this announced length a request is abandoned, not answered: tiny_http
/// allocates what is left of a body when it drops a request, and an absurd
/// `Content-Length` would abort the whole application, token or not.
const MAX_ANNOUNCED_BODY: usize = 64 * 1024 * 1024;

/// Starts the server; every request is answered on its own thread: a tools call
/// waits for the interface, and a client that announces a body and sends none
/// holds its own thread, not the others. tiny_http reads what is left of that
/// body even for a refused caller.
pub fn start(sink: impl HookSink) -> std::io::Result<HookServer> {
    let server =
        Server::http("127.0.0.1:0").map_err(|err| std::io::Error::other(err.to_string()))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|addr| addr.port())
        .ok_or_else(|| std::io::Error::other("no TCP port for the hook server"))?;
    let token = uuid::Uuid::new_v4().to_string();
    let expected: Arc<str> = token.as_str().into();
    let sink = Arc::new(sink);
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            if request
                .body_length()
                .is_some_and(|length| length > MAX_ANNOUNCED_BODY)
            {
                // Before anything that could panic: unwinding would drop it, and abort.
                std::mem::forget(request);
                log::warn!("request abandoned: its announced body is absurd");
                continue;
            }
            let sink = Arc::clone(&sink);
            if request.url().split('?').next() == Some("/mcp") {
                dispatch(request, move |request| answer_mcp(request, &*sink));
            } else {
                let expected = Arc::clone(&expected);
                dispatch(request, move |request| {
                    answer_hook(request, &expected, &*sink)
                });
            }
        }
    });
    Ok(HookServer { port, token })
}

/// Whether Claude's built-in sub-agents give way to `spawn_agent`'s terminals:
/// read at each hook, so the setting reaches sessions already running.
static SUBAGENT_TERMINALS: AtomicBool = AtomicBool::new(true);

/// The user's "Sub-agents open as terminals" setting.
pub fn set_subagent_terminals(on: bool) {
    SUBAGENT_TERMINALS.store(on, Ordering::Relaxed);
}

/// The tools refused while sub-agents open as terminals: Claude's built-in sub-agent
/// tool, under its old name and its current one, and its Workflow tool, whose script
/// fans out sub-agents the user could only watch as read-only mirrors.
pub const BUILTIN_SUBAGENT_TOOLS: [&str; 3] = ["Task", "Agent", WORKFLOW_TOOL];

/// What `claude_settings`'s `PreToolUse` matcher names exactly: the tools above, and
/// the Skill tool, refused only for a skill that forks into a sub-agent of its own.
pub const ASKED_TOOLS: [&str; 4] = ["Task", "Agent", WORKFLOW_TOOL, SKILL_TOOL];

const WORKFLOW_TOOL: &str = "Workflow";

const SPAWN_AGENT_INSTEAD: &str = "In dummyPlane, delegate with the dummyplane spawn_agent tool so the sub-agent opens as a terminal.";

/// A Workflow is refused as a whole: its parallel work goes to spawn_agent, one terminal per sub-agent.
const SPAWN_AGENTS_INSTEAD_OF_A_WORKFLOW: &str = "In dummyPlane, Workflows are refused: their sub-agents would run where the user cannot watch them. For parallel work, call the dummyplane spawn_agent tool once per sub-agent, each with its complete instructions: every one opens in a terminal of its own and works alongside the others.";

/// A Manager has no `spawn_agent`: its team's agents start from the queue.
const QUEUE_INSTEAD: &str = "In dummyPlane, your team's agents start from the queue, each in a terminal of its own: put the work in the queue with add_tasks, or hand a task to a new agent with next_task or reassign.";

/// Added to the query of a Manager's `PreToolUse` hook (`claude_settings`): it
/// only words the refusal, the decision is everyone's.
const MANAGER_TAG: &str = "role=manager";

/// A Manager's `PreToolUse` hook URL: the session's own, tagged.
pub fn manager_hook_url(url: &str) -> String {
    let joint = if url.contains('?') { '&' } else { '?' };
    format!("{url}{joint}{MANAGER_TAG}")
}

/// Whether a hook came from a Manager's session (`manager_hook_url`).
fn from_manager(url: &str) -> bool {
    url.split_once('?')
        .is_some_and(|(_, query)| query.split('&').any(|pair| pair == MANAGER_TAG))
}

/// A skill that forks is refused like a sub-agent: its work is done in the session, or in
/// a terminal. The sub-agent is told not to call the skill, which would be refused again.
fn spawn_agent_instead_of_a_skill(fork: &Fork) -> String {
    let name = &fork.name;
    let mut reason = format!(
        "In dummyPlane, the {name} skill is refused: it runs in a background sub-agent the user cannot watch. Do its work yourself, or delegate it with the dummyplane spawn_agent tool so it opens as a terminal: write in the task what the skill is for and its arguments, and tell the sub-agent not to call the Skill tool for {name}."
    );
    if let Some(file) = &fork.file {
        reason.push_str(&format!(
            " Its instructions are in {}: the sub-agent can read them and follow them itself.",
            file.display()
        ));
    }
    reason
}

/// What a `PreToolUse` gets back: a denial of the built-in sub-agent tool, of a
/// Workflow and of a skill that forks while sub-agents open as terminals, else no
/// decision. An agent's, a fleet's and a Manager's alike (`claude_settings` gives
/// them all the hook); an agent and a fleet are sent to `spawn_agent`, a Manager,
/// which lacks it, to its queue.
fn pre_tool_use(json: &Value, terminals: bool, manager: bool) -> Option<Value> {
    pre_tool_use_with(json, terminals, manager, forked_skills::lookup)
}

/// `pre_tool_use`, told by `fork` whether the skill a Skill call names forks.
fn pre_tool_use_with(
    json: &Value,
    terminals: bool,
    manager: bool,
    fork: impl FnOnce(&Value) -> Option<Fork>,
) -> Option<Value> {
    if !terminals {
        return None;
    }
    let tool = json["tool_name"].as_str()?;
    let reason = if BUILTIN_SUBAGENT_TOOLS.contains(&tool) {
        if manager {
            QUEUE_INSTEAD.to_string()
        } else if tool == WORKFLOW_TOOL {
            SPAWN_AGENTS_INSTEAD_OF_A_WORKFLOW.to_string()
        } else {
            SPAWN_AGENT_INSTEAD.to_string()
        }
    } else if tool == SKILL_TOOL {
        let fork = fork(json)?;
        if manager {
            QUEUE_INSTEAD.to_string()
        } else {
            spawn_agent_instead_of_a_skill(&fork)
        }
    } else {
        return None;
    };
    Some(json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
}

/// A hook or a status line. A panic in the sink is answered 500 rather than
/// lost (backlog R1). A hook's decision travels as JSON in a 200.
fn answer_hook(mut request: Request, token: &str, sink: &dyn HookSink) {
    let (status, body) = catch_unwind(AssertUnwindSafe(|| {
        if request.url().starts_with("/status/") {
            (status_line_of(&mut request, token, sink), None)
        } else {
            status_of(&mut request, token, sink)
        }
    }))
    .unwrap_or((500, None));
    let _ = match body {
        None => request.respond(Response::empty(status)),
        Some(json) => request.respond(
            Response::from_data(json.to_string().into_bytes())
                .with_status_code(status)
                .with_header(
                    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
                ),
        ),
    };
}

/// One thread per request. When the system refuses the thread, the caller is
/// told so (503) instead of the process panicking.
fn dispatch(request: Request, answer: impl FnOnce(Request) + Send + 'static) {
    dispatch_with(request, answer, |job| {
        std::thread::Builder::new()
            .name("local-request".into())
            .spawn(job)
            .map(drop)
    });
}

/// `spawn` starts the job; on failure the request is answered 503.
fn dispatch_with(
    request: Request,
    answer: impl FnOnce(Request) + Send + 'static,
    spawn: impl FnOnce(Box<dyn FnOnce() + Send>) -> std::io::Result<()>,
) {
    let slot = Arc::new(Mutex::new(Some(request)));
    let job_slot = Arc::clone(&slot);
    let job = Box::new(move || {
        if let Some(request) = crate::sync::lock(&job_slot).take() {
            answer(request);
        }
    });
    if let Err(err) = spawn(job) {
        log::error!("request not served, no thread: {err}");
        if let Some(request) = crate::sync::lock(&slot).take() {
            let _ = request.respond(Response::empty(503));
        }
    }
}

/// Node ids name files too: only the characters of our UUIDs pass.
pub fn valid_node_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The token, from `TOKEN_HEADER` or from `?t=`.
fn authorized(query: &str, token: &str, header: Option<&str>) -> bool {
    header == Some(token)
        || query
            .split('&')
            .any(|pair| pair.strip_prefix("t=") == Some(token))
}

/// The value of `TOKEN_HEADER`, if the request has one.
fn token_header(request: &Request) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv(TOKEN_HEADER))
        .map(|header| header.value.as_str().to_string())
}

/// `/hook/<claude|codex>/<nodeId>`, the token in `?t=` or in `TOKEN_HEADER`.
/// The token is checked first (403), so nothing about the routes is told to a
/// caller without it; then 404.
pub fn parse_route(
    url: &str,
    token: &str,
    header: Option<&str>,
) -> Result<(HookSource, String), u16> {
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    if !authorized(query, token, header) {
        return Err(403);
    }
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    match parts.as_slice() {
        ["hook", "claude", node_id] if valid_node_id(node_id) => {
            Ok((HookSource::Claude, node_id.to_string()))
        }
        ["hook", "codex", node_id] if valid_node_id(node_id) => {
            Ok((HookSource::Codex, node_id.to_string()))
        }
        ["hook", "gemini", node_id] if valid_node_id(node_id) => {
            Ok((HookSource::Gemini, node_id.to_string()))
        }
        _ => Err(404),
    }
}

/// `/status/<nodeId>`, the token checked first as for hooks.
pub fn parse_status_route(url: &str, token: &str, header: Option<&str>) -> Result<String, u16> {
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    if !authorized(query, token, header) {
        return Err(403);
    }
    match path
        .trim_start_matches('/')
        .split('/')
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["status", node_id] if valid_node_id(node_id) => Ok(node_id.to_string()),
        _ => Err(404),
    }
}

/// A body of at most `MAX_BODY` bytes, as JSON.
fn json_body(request: &mut Request) -> Result<Value, u16> {
    let mut body = Vec::new();
    if request
        .as_reader()
        .take(MAX_BODY as u64 + 1)
        .read_to_end(&mut body)
        .is_err()
    {
        return Err(400);
    }
    if body.len() > MAX_BODY {
        return Err(413);
    }
    serde_json::from_slice(&body).map_err(|_| 400)
}

/// What a hook posted.
#[derive(Debug)]
struct HookBody {
    json: Value,
    /// The body was past the size read whole: `json` holds only what its top level said in short
    /// values (`salvage`), and nothing of what was inside its objects, a tool's input included.
    cut: bool,
}

/// At most `cap` bytes of `reader`, and whether it went on past them. Never holds more than
/// `cap + 1` bytes, whatever the body announces or sends; `hint` (the announced length) only
/// sizes the buffer once.
fn read_capped(reader: &mut dyn Read, cap: usize, hint: usize) -> std::io::Result<(Vec<u8>, bool)> {
    let mut body = Vec::with_capacity(hint.min(cap + 1));
    reader.take(cap as u64 + 1).read_to_end(&mut body)?;
    let cut = body.len() > cap;
    body.truncate(cap);
    Ok((body, cut))
}

/// A hook's body as JSON: whole when it fits in `cap` bytes (what a hook is asked about, a
/// command included, is then read in full), else only its short top-level fields, `cut`. A
/// body that is not JSON is refused (400), and a cut one that does not open as an object (413).
fn parse_hook_body(reader: &mut dyn Read, hint: usize, cap: usize) -> Result<HookBody, u16> {
    let (body, cut) = read_capped(reader, cap, hint).map_err(|_| 400_u16)?;
    if !cut {
        let json = serde_json::from_slice(&body).map_err(|_| 400_u16)?;
        return Ok(HookBody { json, cut });
    }
    let fields = salvage(&body);
    // A JSON object whose first field is the huge one has nothing short to keep, and it is still
    // answered (`HookBody::cut`): a refusal here would let a call it asks about run. What is no
    // object, so no hook's, is refused.
    if fields.is_empty() && !body.trim_ascii_start().starts_with(b"{") {
        return Err(413);
    }
    Ok(HookBody {
        json: Value::Object(fields),
        cut,
    })
}

/// The top-level fields of a JSON object cut short, as far as they are short scalars: the event's
/// name, the tool's, the session's folder and mode, a notification's message. A field that holds
/// an object or a list, or a long text, is walked past without being kept, so the memory used is
/// that of the keys and the short values, not of the body. The cut itself is an error to serde
/// after the last whole field, which is the end of what is kept, not a failure.
fn salvage(prefix: &[u8]) -> Map<String, Value> {
    let mut fields = Map::new();
    let mut reader = serde_json::Deserializer::from_slice(prefix);
    let _ = (&mut reader).deserialize_map(TopLevel(&mut fields));
    fields
}

struct TopLevel<'a>(&'a mut Map<String, Value>);

impl<'de> Visitor<'de> for TopLevel<'_> {
    type Value = ();

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a JSON object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        while let Some(key) = map.next_key::<String>()? {
            if let Short(Some(value)) = map.next_value()? {
                self.0.insert(key, value);
            }
        }
        Ok(())
    }
}

/// A short scalar, kept; anything else is skipped over.
struct Short(Option<Value>);

impl<'de> Deserialize<'de> for Short {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(ShortValue)
    }
}

struct ShortValue;

impl<'de> Visitor<'de> for ShortValue {
    type Value = Short;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("any JSON value")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Short, E> {
        Ok(Short(Some(Value::Bool(value))))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Short, E> {
        Ok(Short(Some(Value::from(value))))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Short, E> {
        Ok(Short(Some(Value::from(value))))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Short, E> {
        Ok(Short(
            serde_json::Number::from_f64(value).map(Value::Number),
        ))
    }

    fn visit_unit<E>(self) -> Result<Short, E> {
        Ok(Short(Some(Value::Null)))
    }

    fn visit_str<E>(self, value: &str) -> Result<Short, E> {
        Ok(Short(
            (value.len() <= SALVAGED_TEXT).then(|| Value::String(value.to_string())),
        ))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Short, A::Error> {
        while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
        Ok(Short(None))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Short, A::Error> {
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        Ok(Short(None))
    }
}

/// Whether the shell command of a call is longer than the delete guard reads.
fn command_too_long(json: &Value) -> bool {
    json["tool_input"]["command"]
        .as_str()
        .is_some_and(|command| command.len() > GUARD_MAX_COMMAND)
}

/// What a `PreToolUse` gets back when its command was not read for deletes (`delete_guard`),
/// because its body was cut (`HookBody::cut`) or its command is past `GUARD_MAX_COMMAND`. The
/// tools dummyPlane refuses by name are still refused (`pre_tool_use`: their name was read);
/// for anything else a hook that answers nothing, or 413, lets the call run: so the user is
/// asked, as the guard asks, and where nobody can answer (`dontAsk`) it is refused, saying why.
fn pre_tool_use_unread(json: &Value, terminals: bool, manager: bool) -> Value {
    if let Some(decision) = pre_tool_use(json, terminals, manager) {
        return decision;
    }
    let tool = json["tool_name"].as_str().unwrap_or("tool");
    let size = GUARD_MAX_COMMAND / 1024;
    let unattended = json["permission_mode"].as_str() == Some("dontAsk");
    let (decision, reason) = if unattended {
        (
            "deny",
            format!(
                "In dummyPlane, this {tool} call was stopped: it is larger than the {size} KiB of a command dummyPlane reads, so it could not be checked for deletes, and nobody can approve it in this session. Do not retry it as it is: send it as smaller calls."
            ),
        )
    } else {
        (
            "ask",
            format!(
                "{} dummyPlane asks before a {tool} call it cannot read: this one is larger than the {size} KiB of a command it reads, so it could not be checked for deletes. The user approves it only if it really is meant to run. If it is refused or goes unanswered, do not retry it as it is: send it as smaller calls.",
                delete_guard::GUARD_MARKER
            ),
        )
    };
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    })
}

fn status_line_of(request: &mut Request, token: &str, sink: &dyn HookSink) -> u16 {
    let header = token_header(request);
    let node_id = match parse_status_route(request.url(), token, header.as_deref()) {
        Ok(node_id) => node_id,
        Err(status) => return status,
    };
    if *request.method() != Method::Post {
        return 405;
    }
    match json_body(request) {
        Ok(json) => {
            sink.status(&node_id, json);
            204
        }
        Err(status) => status,
    }
}

/// The status of a hook's answer, and the decision it carries, if any.
fn status_of(request: &mut Request, token: &str, sink: &dyn HookSink) -> (u16, Option<Value>) {
    let header = token_header(request);
    let (source, node_id) = match parse_route(request.url(), token, header.as_deref()) {
        Ok(route) => route,
        Err(status) => return (status, None),
    };
    if *request.method() != Method::Post {
        return (405, None);
    }
    let hint = request.body_length().unwrap_or(0);
    let HookBody { json, cut } = match parse_hook_body(request.as_reader(), hint, HOOK_MAX_BODY) {
        Ok(body) => body,
        Err(status) => return (status, None),
    };
    if cut {
        log::warn!(
            "hook of {node_id} is past {HOOK_MAX_BODY} bytes: only its short fields were read"
        );
    }
    let (activity, session_ended) = match source {
        HookSource::Claude => {
            if let Some(hook) = SubagentHook::parse(&json) {
                sink.subagent(&node_id, hook);
                return (204, None);
            }
            let event = json["hook_event_name"].as_str().unwrap_or_default();
            // A body cut short that names no event could be the question below as well.
            if event == "PreToolUse" || (cut && event.is_empty()) {
                // A question, not an activity: the terminal's state stays as it is.
                let terminals = SUBAGENT_TERMINALS.load(Ordering::Relaxed);
                let manager = from_manager(request.url());
                let decision = if cut || command_too_long(&json) {
                    // The command was not read, so no delete was looked for: never a silent allow.
                    Some(pre_tool_use_unread(&json, terminals, manager))
                } else {
                    // A delete is read whatever the "Sub-agents open as terminals" switch says.
                    delete_guard::pre_tool_use(&json, request.url())
                        .or_else(|| pre_tool_use(&json, terminals, manager))
                };
                return match decision {
                    Some(decision) => (200, Some(decision)),
                    None => (204, None),
                };
            }
            if event == "PostToolUse" {
                // A skill that forked is refused from now on, a bundled one included.
                forked_skills::learn_from(&json);
            }
            if claude_session_ended(event, json["reason"].as_str()) {
                (Some(Activity::Idle), true)
            } else {
                (
                    claude_activity(event, json["notification_type"].as_str()),
                    false,
                )
            }
        }
        HookSource::Codex => {
            if let Some(thread) = json["thread-id"]
                .as_str()
                .and_then(super::codex_profile::thread_id)
            {
                sink.codex_thread(&node_id, &thread);
            }
            (
                codex_activity(json["type"].as_str().unwrap_or_default()),
                false,
            )
        }
        HookSource::Gemini => {
            let event = json["hook_event_name"].as_str().unwrap_or_default();
            (
                gemini_activity(event, json["notification_type"].as_str()),
                false,
            )
        }
    };
    if let Some(activity) = activity {
        let message = (activity == Activity::Waiting)
            .then(|| json["message"].as_str().and_then(clean_message))
            .flatten();
        sink.hit(HookHit {
            node_id,
            source,
            activity,
            session_ended,
            message,
        });
    }
    (204, None)
}

fn answer_mcp(mut request: Request, sink: &dyn HookSink) {
    let (status, body) =
        catch_unwind(AssertUnwindSafe(|| mcp_response(&mut request, sink))).unwrap_or((500, None));
    let mut response = Response::from_data(
        body.map(|json| json.to_string().into_bytes())
            .unwrap_or_default(),
    )
    .with_status_code(status);
    if status == 200 {
        response = response.with_header(
            Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
        );
    }
    let _ = request.respond(response);
}

/// The token names the calling node (401 first, like the hooks' 403).
fn mcp_response(request: &mut Request, sink: &dyn HookSink) -> (u16, Option<Value>) {
    let header = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Authorization"))
        .map(|header| header.value.as_str().to_string());
    let Some(node_id) = mcp::bearer(header.as_deref()).and_then(|token| sink.mcp_node(token))
    else {
        return (401, None);
    };
    if *request.method() != Method::Post {
        return (405, None);
    }
    let mut body = Vec::new();
    if request
        .as_reader()
        .take(mcp::MAX_BODY as u64 + 1)
        .read_to_end(&mut body)
        .is_err()
    {
        return (400, None);
    }
    if body.len() > mcp::MAX_BODY {
        return (413, None);
    }
    mcp::handle(&body, |method, params| {
        sink.mcp_call(&node_id, method, params)
    })
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex, mpsc};
    use std::time::{Duration, Instant};

    use super::*;

    const TOKEN: &str = "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10";

    #[test]
    fn routes_a_hook_to_its_terminal() {
        assert_eq!(
            parse_route(&format!("/hook/claude/node-1?t={TOKEN}"), TOKEN, None),
            Ok((HookSource::Claude, "node-1".to_string()))
        );
        assert_eq!(
            parse_route(&format!("/hook/codex/abc_2?x=1&t={TOKEN}"), TOKEN, None),
            Ok((HookSource::Codex, "abc_2".to_string()))
        );
    }

    #[test]
    fn takes_the_token_from_its_header_too() {
        assert_eq!(
            parse_route("/hook/codex/n1", TOKEN, Some(TOKEN)),
            Ok((HookSource::Codex, "n1".to_string()))
        );
        assert_eq!(parse_route("/hook/codex/n1", TOKEN, Some("bad")), Err(403));
        assert_eq!(parse_route("/hook/codex/n1", TOKEN, None), Err(403));
        assert_eq!(
            parse_status_route("/status/n1", TOKEN, Some(TOKEN)),
            Ok("n1".to_string())
        );
        assert_eq!(
            parse_status_route("/status/n1", TOKEN, Some("bad")),
            Err(403)
        );
    }

    #[test]
    fn routes_a_status_line_to_its_terminal() {
        assert_eq!(
            parse_status_route(&format!("/status/n1?t={TOKEN}"), TOKEN, None),
            Ok("n1".into())
        );
        assert_eq!(
            parse_status_route("/status/n1?t=nope", TOKEN, None),
            Err(403)
        );
        assert_eq!(
            parse_status_route(&format!("/status/..?t={TOKEN}"), TOKEN, None),
            Err(404)
        );
        assert_eq!(
            parse_status_route(&format!("/status/a/b?t={TOKEN}"), TOKEN, None),
            Err(404)
        );
    }

    #[test]
    fn refuses_a_missing_or_wrong_token_before_anything_else() {
        assert_eq!(parse_route("/hook/claude/node-1", TOKEN, None), Err(403));
        assert_eq!(
            parse_route("/hook/claude/node-1?t=nope", TOKEN, None),
            Err(403)
        );
        assert_eq!(parse_route("/nothing?t=nope", TOKEN, None), Err(403));
    }

    #[test]
    fn refuses_unknown_routes_and_doubtful_node_ids() {
        for path in [
            "/hook/aider/n",
            "/hook/claude",
            "/hook/claude/a/b",
            "/hook/claude/..",
            "/hook/claude/%2e%2e",
            "/other/claude/n",
        ] {
            assert_eq!(
                parse_route(&format!("{path}?t={TOKEN}"), TOKEN, None),
                Err(404),
                "{path}"
            );
        }
        assert!(!valid_node_id("../x"));
        assert!(!valid_node_id(""));
        assert!(valid_node_id("0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10"));
    }

    struct TestSink {
        hits: Mutex<mpsc::Sender<HookHit>>,
        subagents: Mutex<Vec<(String, SubagentHook)>>,
        statuses: Mutex<Vec<(String, serde_json::Value)>>,
        tokens: mcp::Tokens,
    }

    impl TestSink {
        fn new(hits: mpsc::Sender<HookHit>) -> Self {
            Self {
                hits: Mutex::new(hits),
                subagents: Mutex::new(Vec::new()),
                statuses: Mutex::new(Vec::new()),
                tokens: mcp::Tokens::default(),
            }
        }
    }

    impl HookSink for Arc<TestSink> {
        fn hit(&self, hit: HookHit) {
            let _ = self.hits.lock().unwrap().send(hit);
        }
        fn subagent(&self, node_id: &str, hook: SubagentHook) {
            self.subagents
                .lock()
                .unwrap()
                .push((node_id.to_string(), hook));
        }
        fn mcp_node(&self, token: &str) -> Option<String> {
            self.tokens
                .node(token)
                .or_else(|| token.strip_prefix("tok-").map(str::to_string))
        }
        fn status(&self, node_id: &str, status: serde_json::Value) {
            assert_ne!(node_id, "boom", "a sink that panics");
            self.statuses
                .lock()
                .unwrap()
                .push((node_id.to_string(), status));
        }
        fn mcp_call(
            &self,
            node_id: &str,
            method: &str,
            params: serde_json::Value,
        ) -> Result<serde_json::Value, String> {
            if node_id == "pending" {
                // dummyPlane's answer takes its time: the call stays open.
                std::thread::sleep(Duration::from_millis(1500));
            }
            assert_ne!(node_id, "boom", "a sink that panics");
            if node_id == "slow" {
                return Err("dummyPlane is not responding".into());
            }
            Ok(serde_json::json!({ "node": node_id, "method": method, "params": params }))
        }
    }

    /// One raw HTTP/1.1 request; returns the status code.
    fn send(port: u16, method: &str, path: &str, body: &[u8]) -> u16 {
        send_headed(port, method, path, "", body)
    }

    /// `extra`: header lines, each ending with CRLF.
    fn send_headed(port: u16, method: &str, path: &str, extra: &str, body: &[u8]) -> u16 {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let head = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(head.as_bytes()).unwrap();
        let _ = stream.write_all(body);
        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);
        response
            .split_whitespace()
            .nth(1)
            .unwrap_or("0")
            .parse()
            .unwrap()
    }

    #[test]
    fn answers_hooks_and_reports_their_activity() {
        let (tx, rx) = mpsc::channel();
        let server = start(Arc::new(TestSink::new(tx))).unwrap();
        let claude = server.url(HookSource::Claude, "n1");
        let path = claude.trim_start_matches(&format!("http://127.0.0.1:{}", server.port));

        assert_eq!(
            send(
                server.port,
                "POST",
                path,
                br#"{"hook_event_name":"UserPromptSubmit"}"#
            ),
            204
        );
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            HookHit {
                node_id: "n1".into(),
                source: HookSource::Claude,
                activity: Activity::Working,
                session_ended: false,
                message: None,
            }
        );
        let waiting =
            br#"{"hook_event_name":"Notification","notification_type":"permission_prompt"}"#;
        assert_eq!(send(server.port, "POST", path, waiting), 204);
        let hit = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(
            (hit.activity, hit.message),
            (Activity::Waiting, None),
            "no `message`: no preview"
        );
        let waiting = br#"{"hook_event_name":"Notification","notification_type":"permission_prompt","message":"  May \u001b[31mI\u001b[0m\nrun Bash?"}"#;
        assert_eq!(send(server.port, "POST", path, waiting), 204);
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5))
                .unwrap()
                .message
                .as_deref(),
            Some("May I run Bash?")
        );
        let odd = br#"{"hook_event_name":"Notification","notification_type":"permission_prompt","message":42}"#;
        assert_eq!(send(server.port, "POST", path, odd), 204);
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap().message,
            None
        );
        let idle = br#"{"hook_event_name":"Notification","notification_type":"idle_prompt","message":"Waiting for your input"}"#;
        assert_eq!(send(server.port, "POST", path, idle), 204);
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap().message,
            None
        );
        let ended = br#"{"hook_event_name":"SessionEnd","reason":"prompt_input_exit"}"#;
        assert_eq!(send(server.port, "POST", path, ended), 204);
        assert!(
            rx.recv_timeout(Duration::from_secs(5))
                .unwrap()
                .session_ended
        );
        // `/clear` goes on in the same process: no hit, the next one is Codex's.
        let cleared = br#"{"hook_event_name":"SessionEnd","reason":"clear"}"#;
        assert_eq!(send(server.port, "POST", path, cleared), 204);

        let codex = server.url(HookSource::Codex, "n2");
        let codex_path = codex.trim_start_matches(&format!("http://127.0.0.1:{}", server.port));
        assert_eq!(
            send(
                server.port,
                "POST",
                codex_path,
                br#"{"type":"agent-turn-complete"}"#
            ),
            204
        );
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            HookHit {
                node_id: "n2".into(),
                source: HookSource::Codex,
                activity: Activity::Idle,
                session_ended: false,
                message: None,
            }
        );
    }

    #[test]
    fn hears_gemini_cli_s_hooks() {
        let (tx, rx) = mpsc::channel();
        let server = start(Arc::new(TestSink::new(tx))).unwrap();
        let url = server.url(HookSource::Gemini, "g1");
        let path = url.trim_start_matches(&format!("http://127.0.0.1:{}", server.port));
        let post = |body: &[u8]| send(server.port, "POST", path, body);
        let next = || rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(
            post(br#"{"hook_event_name":"BeforeAgent","prompt":"hi"}"#),
            204
        );
        let hit = next();
        assert_eq!(
            (hit.source, hit.activity),
            (HookSource::Gemini, Activity::Working)
        );
        let ask = br#"{"hook_event_name":"Notification","notification_type":"ToolPermission","message":"Run ls?"}"#;
        assert_eq!(post(ask), 204);
        let hit = next();
        assert_eq!(
            (hit.activity, hit.message.as_deref()),
            (Activity::Waiting, Some("Run ls?"))
        );
        assert_eq!(
            post(br#"{"hook_event_name":"AfterAgent","prompt_response":"ok"}"#),
            204
        );
        assert_eq!(next().activity, Activity::Idle);
        // Events dummyPlane does not follow are accepted and ignored.
        assert_eq!(post(br#"{"hook_event_name":"BeforeTool"}"#), 204);
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
    }

    #[test]
    fn passes_a_status_line_s_json_to_its_terminal() {
        let (tx, _rx) = mpsc::channel();
        let sink = Arc::new(TestSink::new(tx));
        let server = start(Arc::clone(&sink)).unwrap();
        let url = server.status_url("n1");
        let path = url
            .trim_start_matches(&format!("http://127.0.0.1:{}", server.port))
            .to_string();
        let body = br#"{"session_id":"s1","rate_limits":{}}"#;
        assert_eq!(send(server.port, "POST", &path, body), 204);
        assert_eq!(send(server.port, "GET", &path, b""), 405);
        assert_eq!(send(server.port, "POST", &path, b"{"), 400);
        assert_eq!(send(server.port, "POST", "/status/n1?t=wrong", b"{}"), 403);
        assert_eq!(
            *sink.statuses.lock().unwrap(),
            vec![(
                "n1".to_string(),
                serde_json::json!({ "session_id": "s1", "rate_limits": {} })
            )]
        );
    }

    #[test]
    fn a_status_line_posting_its_token_in_a_header_is_heard() {
        let (tx, _rx) = mpsc::channel();
        let sink = Arc::new(TestSink::new(tx));
        let server = start(Arc::clone(&sink)).unwrap();
        let bare = server.bare_status_url("n1");
        assert_eq!(bare, format!("http://127.0.0.1:{}/status/n1", server.port));
        assert_eq!(
            server.bare_url(HookSource::Codex, "n1"),
            format!("http://127.0.0.1:{}/hook/codex/n1", server.port)
        );
        let header = format!("{TOKEN_HEADER}: {}\r\n", server.token);
        assert_eq!(
            send_headed(server.port, "POST", "/status/n1", &header, b"{}"),
            204
        );
        let wrong = format!("{TOKEN_HEADER}: nope\r\n");
        assert_eq!(
            send_headed(server.port, "POST", "/status/n1", &wrong, b"{}"),
            403
        );
    }

    #[test]
    fn rejects_bad_requests_without_reporting_anything() {
        let (tx, rx) = mpsc::channel();
        let server = start(Arc::new(TestSink::new(tx))).unwrap();
        let path = format!("/hook/claude/n1?t={}", server.token);
        assert_eq!(
            send(server.port, "POST", "/hook/claude/n1?t=wrong", b"{}"),
            403
        );
        assert_eq!(send(server.port, "GET", &path, b""), 405);
        assert_eq!(
            send(
                server.port,
                "POST",
                &format!("/hook/claude/..?t={}", server.token),
                b"{}"
            ),
            404
        );
        assert_eq!(send(server.port, "POST", &path, b"not json"), 400);
        // Not a status line: a hook's body may pass 64 KiB (`a_hook_past_64_kib_is_read_whole`), and
        // this one, which is not JSON, is refused for that.
        let big = vec![b' '; MAX_BODY + 1];
        assert_eq!(send(server.port, "POST", &path, &big), 400);
        // Past what a hook is read whole, with nothing in it to read.
        let huge = vec![b' '; HOOK_MAX_BODY + 1];
        assert_eq!(send(server.port, "POST", &path, &huge), 413);
        // An event dummyPlane does not track is accepted and ignored.
        assert_eq!(
            send(
                server.port,
                "POST",
                &path,
                br#"{"hook_event_name":"SessionStart"}"#
            ),
            204
        );
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
    }

    /// One raw HTTP/1.1 request with extra headers; returns the status and the body.
    fn exchange(
        port: u16,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> (u16, String) {
        let response = raw_exchange(port, method, path, headers, body);
        let status = response
            .split_whitespace()
            .nth(1)
            .unwrap_or("0")
            .parse()
            .unwrap();
        let body = response
            .split_once("\r\n\r\n")
            .map(|(_, b)| b.to_string())
            .unwrap_or_default();
        (status, body)
    }

    /// The same request; returns the whole response, head included.
    fn raw_exchange(
        port: u16,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let extra: String = headers
            .iter()
            .map(|(k, v)| format!("{k}: {v}\r\n"))
            .collect();
        let head = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(head.as_bytes()).unwrap();
        let _ = stream.write_all(body);
        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);
        response
    }

    /// A tool refused must be one the settings file asks about, or the refusal never runs.
    #[test]
    fn the_matcher_asks_about_every_refused_tool_and_the_skill_tool() {
        for tool in BUILTIN_SUBAGENT_TOOLS.iter().chain([&SKILL_TOOL]) {
            assert!(ASKED_TOOLS.contains(tool), "{tool}");
        }
        assert_eq!(ASKED_TOOLS.len(), BUILTIN_SUBAGENT_TOOLS.len() + 1);
    }

    #[test]
    fn only_the_built_in_subagent_tool_is_denied_and_only_while_the_switch_is_on() {
        let call = |tool: &str| json!({ "hook_event_name": "PreToolUse", "tool_name": tool });
        for tool in ["Agent", "Task", "Workflow"] {
            for manager in [false, true] {
                let decision = pre_tool_use(&call(tool), true, manager).unwrap();
                assert_eq!(decision["hookSpecificOutput"]["permissionDecision"], "deny");
                assert_eq!(pre_tool_use(&call(tool), false, manager), None, "{tool}");
            }
        }
        // Matched by its exact name: tools named alike are not Claude's sub-agent.
        for tool in [
            "TaskStop",
            "TaskCreate",
            "TaskOutput",
            "agent",
            "workflow",
            "WorkflowStop",
            "Bash",
            "mcp__dummyplane__show_output",
            "mcp__dummyplane__read_node",
        ] {
            assert_eq!(pre_tool_use(&call(tool), true, false), None, "{tool}");
            assert_eq!(pre_tool_use(&call(tool), true, true), None, "{tool}");
        }
        let nameless = json!({ "hook_event_name": "PreToolUse" });
        assert_eq!(pre_tool_use(&nameless, true, false), None);
    }

    #[test]
    fn a_manager_is_sent_to_its_queue_never_to_spawn_agent_which_it_lacks() {
        let call = json!({ "hook_event_name": "PreToolUse", "tool_name": "Agent" });
        let reason = |manager| {
            pre_tool_use(&call, true, manager).unwrap()["hookSpecificOutput"]
                ["permissionDecisionReason"]
                .as_str()
                .unwrap()
                .to_string()
        };
        let manager = reason(true);
        assert!(!manager.contains("spawn_agent"), "{manager}");
        for tool in ["add_tasks", "next_task", "reassign"] {
            assert!(manager.contains(tool), "{tool}");
        }
        assert_eq!(reason(false), SPAWN_AGENT_INSTEAD);
        // The tag rides the session's own URL, token and all, and nothing else reads as it.
        let url = "http://127.0.0.1:1/hook/claude/m1?t=tok";
        let tagged = manager_hook_url(url);
        assert_eq!(tagged, format!("{url}&role=manager"));
        assert!(from_manager(&tagged));
        assert!(!from_manager(url));
        assert!(!from_manager("/hook/claude/m1?t=tok&role=managers"));
        assert!(!from_manager("/hook/claude/role=manager"));
        assert_eq!(
            parse_route(&tagged.replace("http://127.0.0.1:1", ""), "tok", None),
            Ok((HookSource::Claude, "m1".to_string()))
        );
    }

    /// Regression: a Workflow's sub-agents ran with the switch on, drawn as read-only mirrors.
    #[test]
    fn a_workflow_is_refused_for_spawn_agent_s_terminals_or_a_manager_s_queue() {
        let call = json!({ "hook_event_name": "PreToolUse", "tool_name": "Workflow" });
        let reason = |manager| {
            pre_tool_use(&call, true, manager).unwrap()["hookSpecificOutput"]
                ["permissionDecisionReason"]
                .as_str()
                .unwrap()
                .to_string()
        };
        // An agent and a fleet are told how to run its parallel work in terminals.
        let agent = reason(false);
        assert_eq!(agent, SPAWN_AGENTS_INSTEAD_OF_A_WORKFLOW);
        for phrase in [
            "Workflows are refused",
            "spawn_agent",
            "once per sub-agent",
            "parallel",
        ] {
            assert!(agent.contains(phrase), "{phrase}: {agent}");
        }
        // A Manager, which has no spawn_agent, is sent to its queue, as for any sub-agent.
        assert_eq!(reason(true), QUEUE_INSTEAD);
        // Switched off, it runs, a Manager's too.
        assert_eq!(pre_tool_use(&call, false, false), None);
        assert_eq!(pre_tool_use(&call, false, true), None);
    }

    /// Regression: Batman's /code-review, a skill that forks, ran as a read-only mirror
    /// with "Sub-agents as terminals" on: the Skill tool was never asked about.
    #[test]
    fn a_skill_that_forks_is_refused_and_one_that_runs_inline_is_not() {
        let call = |skill: &str| {
            json!({
                "hook_event_name": "PreToolUse", "tool_name": "Skill",
                "tool_input": { "skill": skill, "args": "601" }
            })
        };
        let bundled = |json: &Value| {
            (json["tool_input"]["skill"] == "code-review").then(|| Fork {
                name: "code-review".into(),
                file: None,
            })
        };
        let reason = |json: &Value, manager| {
            pre_tool_use_with(json, true, manager, bundled).unwrap()["hookSpecificOutput"]
                ["permissionDecisionReason"]
                .as_str()
                .unwrap()
                .to_string()
        };
        let agent = reason(&call("code-review"), false);
        for phrase in [
            "the code-review skill is refused",
            "Do its work yourself",
            "spawn_agent",
            "not to call the Skill tool for code-review",
        ] {
            assert!(agent.contains(phrase), "{phrase}: {agent}");
        }
        assert!(!agent.contains("Its instructions are in"), "{agent}");
        assert_eq!(reason(&call("code-review"), true), QUEUE_INSTEAD);
        // Inline, it runs; switched off, a forking one runs too, and is not looked up.
        assert_eq!(pre_tool_use_with(&call("run"), true, false, bundled), None);
        let unasked = |_: &Value| -> Option<Fork> { panic!("looked up with the switch off") };
        assert_eq!(
            pre_tool_use_with(&call("code-review"), false, false, unasked),
            None
        );
        // A skill that is a file: the sub-agent is pointed to it.
        let file = PathBuf::from("C:/Users/u/.claude/skills/research/SKILL.md");
        let on_disk = |_: &Value| {
            Some(Fork {
                name: "research".into(),
                file: Some(file.clone()),
            })
        };
        let decision = pre_tool_use_with(&call("research"), true, false, on_disk).unwrap();
        let text = decision["hookSpecificOutput"]["permissionDecisionReason"]
            .as_str()
            .unwrap();
        assert!(
            text.contains(&format!("Its instructions are in {}", file.display())),
            "{text}"
        );
    }

    #[test]
    fn a_skill_seen_forking_through_post_tool_use_is_refused_from_then_on() {
        let (tx, rx) = mpsc::channel();
        let server = start(Arc::new(TestSink::new(tx))).unwrap();
        let path = format!("/hook/claude/n1?t={}", server.token);
        // A name of this test's own: the list of skills seen forking is the process's.
        let skill = "dummyplane-test-forking-skill";
        let pre = json!({
            "hook_event_name": "PreToolUse", "tool_name": "Skill",
            "tool_input": { "skill": skill }
        });
        assert_eq!(pre_tool_use(&pre, true, false), None);
        let post = json!({
            "hook_event_name": "PostToolUse", "tool_name": "Skill",
            "tool_input": { "skill": skill },
            "tool_response": { "success": true, "commandName": skill, "status": "forked" }
        });
        let (status, _) = exchange(server.port, "POST", &path, &[], post.to_string().as_bytes());
        assert_eq!(status, 204);
        // Still an activity, as any tool's end.
        assert!(rx.recv_timeout(Duration::from_secs(2)).is_ok());
        let decision = pre_tool_use(&pre, true, false).unwrap();
        assert_eq!(decision["hookSpecificOutput"]["permissionDecision"], "deny");
    }

    /// Puts the switch back on, even when an assertion fails.
    struct TerminalsBackOn;

    impl Drop for TerminalsBackOn {
        fn drop(&mut self) {
            set_subagent_terminals(true);
        }
    }

    /// The only test that flips the global switch: `cargo test` runs tests in parallel.
    #[test]
    fn denies_the_built_in_subagent_tool_and_workflows_while_subagents_open_as_terminals() {
        let _back_on = TerminalsBackOn;
        let (tx, rx) = mpsc::channel();
        let server = start(Arc::new(TestSink::new(tx))).unwrap();
        let path = format!("/hook/claude/n1?t={}", server.token);
        // A fleet's session posts to its own node's route: it is answered the same way.
        let fleet_path = format!("/hook/claude/fleet1?t={}", server.token);
        let call = |tool: &str| {
            json!({ "hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": {} })
                .to_string()
        };
        let pre = |tool: &str| exchange(server.port, "POST", &path, &[], call(tool).as_bytes());
        let fleet_pre =
            |tool: &str| exchange(server.port, "POST", &fleet_path, &[], call(tool).as_bytes());
        // A Manager's hook carries its tag (`manager_hook_url`): denied the same, worded for its queue.
        let manager_path = manager_hook_url(&format!("/hook/claude/manager1?t={}", server.token));
        let manager_pre = |tool: &str| {
            exchange(
                server.port,
                "POST",
                &manager_path,
                &[],
                call(tool).as_bytes(),
            )
        };
        let denial = json!({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "In dummyPlane, delegate with the dummyplane spawn_agent tool so the sub-agent opens as a terminal."
            }
        });

        set_subagent_terminals(true);
        for tool in ["Agent", "Task"] {
            for (status, body) in [pre(tool), fleet_pre(tool)] {
                assert_eq!(status, 200, "{tool}");
                assert_eq!(
                    serde_json::from_str::<Value>(&body).unwrap(),
                    denial,
                    "{tool}"
                );
            }
            let (status, body) = manager_pre(tool);
            assert_eq!(status, 200, "{tool}");
            let body = serde_json::from_str::<Value>(&body).unwrap();
            assert_eq!(body["hookSpecificOutput"]["permissionDecision"], "deny");
            assert_eq!(
                body["hookSpecificOutput"]["permissionDecisionReason"],
                QUEUE_INSTEAD
            );
        }
        // A Workflow is denied the same way, its wording sending its parallel work to spawn_agent.
        let workflow_denial = json!({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": SPAWN_AGENTS_INSTEAD_OF_A_WORKFLOW
            }
        });
        for (status, body) in [pre("Workflow"), fleet_pre("Workflow")] {
            assert_eq!(status, 200);
            assert_eq!(
                serde_json::from_str::<Value>(&body).unwrap(),
                workflow_denial
            );
        }
        let (status, body) = manager_pre("Workflow");
        assert_eq!(status, 200);
        let body = serde_json::from_str::<Value>(&body).unwrap();
        assert_eq!(body["hookSpecificOutput"]["permissionDecision"], "deny");
        assert_eq!(
            body["hookSpecificOutput"]["permissionDecisionReason"],
            QUEUE_INSTEAD
        );
        let head = raw_exchange(server.port, "POST", &path, &[], call("Agent").as_bytes())
            .to_ascii_lowercase();
        assert!(
            head.contains("\r\ncontent-type: application/json\r\n"),
            "{head}"
        );
        // Another tool's call goes on, without a decision; the Skill tool's too, for a
        // skill that names none or has not been seen forking.
        for tool in [
            "Skill",
            "TaskStop",
            "Bash",
            "mcp__dummyplane__spawn_agent",
            "mcp__dummyplane__show_output",
            "mcp__dummyplane__output_guide",
            "mcp__dummyplane__read_node",
        ] {
            assert_eq!(pre(tool), (204, String::new()), "{tool}");
        }

        // Switched off, Claude's own sub-agents and Workflows run, in sessions already started too, a fleet's included.
        set_subagent_terminals(false);
        for tool in ["Agent", "Task", "Workflow"] {
            assert_eq!(pre(tool), (204, String::new()), "{tool}");
            assert_eq!(fleet_pre(tool), (204, String::new()), "{tool}");
            assert_eq!(manager_pre(tool), (204, String::new()), "{tool}");
        }
        // A delete is read all the same: the switch is about sub-agents, not about the user's files.
        let scoped = delete_guard::with_scope(
            &format!("/hook/claude/n1?t={}", server.token),
            std::path::Path::new("/work/proj"),
        );
        let bash = |command: &str| {
            let body = json!({
                "hook_event_name": "PreToolUse",
                "tool_name": "Bash",
                "tool_input": { "command": command },
                "cwd": "/work/proj",
            })
            .to_string();
            exchange(server.port, "POST", &scoped, &[], body.as_bytes())
        };
        let (status, body) = bash("rm -rf /work/other");
        assert_eq!(status, 200);
        let body = serde_json::from_str::<Value>(&body).unwrap();
        assert_eq!(body["hookSpecificOutput"]["permissionDecision"], "ask");
        assert_eq!(bash("rm -rf dist node_modules"), (204, String::new()));
        set_subagent_terminals(true);
        assert_eq!(pre("Agent").0, 200);
        assert_eq!(bash("rm -rf /work/other").0, 200);
        assert_eq!(bash("rm -rf dist node_modules"), (204, String::new()));

        // A question, not an activity: no hit.
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
    }

    #[test]
    fn serves_mcp_to_the_node_a_token_was_given_to() {
        let (tx, _rx) = mpsc::channel();
        let server = start(Arc::new(TestSink::new(tx))).unwrap();
        assert_eq!(
            server.mcp_url(),
            format!("http://127.0.0.1:{}/mcp", server.port)
        );
        let auth = [("Authorization", "Bearer tok-n1")];
        let (status, body) = exchange(
            server.port,
            "POST",
            "/mcp",
            &auth,
            br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
        );
        assert_eq!(status, 200);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["result"]["serverInfo"]["name"], "dummyplane");
        let (status, body) = exchange(
            server.port,
            "POST",
            "/mcp",
            &auth,
            br#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"etape"}}"#,
        );
        assert_eq!(status, 200);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(
            json["result"],
            serde_json::json!({ "node": "n1", "method": "tools/call", "params": { "name": "etape" } })
        );
        let (status, _) = exchange(
            server.port,
            "POST",
            "/mcp",
            &auth,
            br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        );
        assert_eq!(status, 202);
        let slow = [("Authorization", "Bearer tok-slow")];
        let (_, body) = exchange(
            server.port,
            "POST",
            "/mcp",
            &slow,
            br#"{"jsonrpc":"2.0","id":3,"method":"tools/list"}"#,
        );
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["error"]["message"], "dummyPlane is not responding");
    }

    #[test]
    fn a_status_line_posting_too_much_gets_413() {
        let (tx, _rx) = mpsc::channel();
        let sink = Arc::new(TestSink::new(tx));
        let server = start(Arc::clone(&sink)).unwrap();
        let path = server
            .status_url("n1")
            .trim_start_matches(&format!("http://127.0.0.1:{}", server.port))
            .to_string();
        let huge = vec![b' '; MAX_BODY + 1];
        assert_eq!(send(server.port, "POST", &path, &huge), 413);
        assert!(sink.statuses.lock().unwrap().is_empty());
    }

    /// A Claude hook body of `event` for an edit whose text is `padding` bytes long, three times.
    fn edit_body(event: &str, padding: usize) -> Vec<u8> {
        let text = "x".repeat(padding);
        format!(
            r#"{{"session_id":"s1","cwd":"/work/proj","hook_event_name":"{event}","tool_name":"Edit","tool_input":{{"file_path":"/work/proj/a.rs","old_string":"{text}","new_string":"{text}"}},"tool_response":{{"filePath":"/work/proj/a.rs","originalFile":"{text}","structuredPatch":[{{"lines":["-a","+b"]}}]}}}}"#
        )
        .into_bytes()
    }

    /// Regression: "PostToolUse:Edit hook failed HTTP 413": the edit of a big file posts its old and
    /// new text and the file as it was, and 64 KiB refused it, so the event was lost.
    #[test]
    fn a_hook_past_64_kib_is_read_whole() {
        let (tx, rx) = mpsc::channel();
        let server = start(Arc::new(TestSink::new(tx))).unwrap();
        let path = format!("/hook/claude/n1?t={}", server.token);
        let body = edit_body("PostToolUse", 100 * 1024);
        assert!(body.len() > 3 * MAX_BODY && body.len() < HOOK_MAX_BODY);
        assert_eq!(send(server.port, "POST", &path, &body), 204);
        let hit = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(
            (hit.node_id.as_str(), hit.source, hit.activity),
            ("n1", HookSource::Claude, Activity::Working)
        );
        // The same, as a Gemini or Codex session would post it.
        let codex = format!("/hook/codex/n2?t={}", server.token);
        let turn = format!(
            r#"{{"type":"agent-turn-complete","last-assistant-message":"{}"}}"#,
            "y".repeat(2 * MAX_BODY)
        );
        assert_eq!(send(server.port, "POST", &codex, turn.as_bytes()), 204);
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap().activity,
            Activity::Idle
        );
    }

    /// Past the hard cap the event is still answered and recorded, from the short fields the body
    /// opens with, rather than dropped.
    #[test]
    fn a_hook_past_the_hard_cap_is_recorded_from_its_short_fields() {
        let (tx, rx) = mpsc::channel();
        let server = start(Arc::new(TestSink::new(tx))).unwrap();
        let path = format!("/hook/claude/n1?t={}", server.token);
        let body = edit_body("PostToolUse", HOOK_MAX_BODY / 2);
        assert!(body.len() > HOOK_MAX_BODY);
        assert_eq!(send(server.port, "POST", &path, &body), 204);
        let hit = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(hit.activity, Activity::Working);
        // A cut `Stop` still ends the turn.
        let stop = edit_body("Stop", HOOK_MAX_BODY / 2);
        assert_eq!(send(server.port, "POST", &path, &stop), 204);
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap().activity,
            Activity::Idle
        );
        // The server goes on serving.
        assert_eq!(
            send(
                server.port,
                "POST",
                &path,
                br#"{"hook_event_name":"UserPromptSubmit"}"#
            ),
            204
        );
    }

    /// A hook is answered 200 with a decision, whatever the size of the call it asks about.
    fn pre_bash(port: u16, url: &str, command: &str, mode: &str) -> (u16, Value) {
        let body = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": { "command": command },
            "cwd": "/work/proj",
            "permission_mode": mode,
        })
        .to_string();
        let (status, body) = exchange(port, "POST", url, &[], body.as_bytes());
        (status, serde_json::from_str(&body).unwrap_or(Value::Null))
    }

    /// Past 64 KiB a command is judged all the same, and past the hard cap, where it cannot be
    /// read, it is asked about: a hook answered 413 lets the call run.
    #[test]
    fn a_big_pre_tool_use_is_judged_and_one_too_big_to_read_is_asked_about() {
        let (tx, rx) = mpsc::channel();
        let server = start(Arc::new(TestSink::new(tx))).unwrap();
        let url = delete_guard::with_scope(
            &format!("/hook/claude/n1?t={}", server.token),
            std::path::Path::new("/work/proj"),
        );
        let decision = |body: &Value| {
            body["hookSpecificOutput"]["permissionDecision"]
                .as_str()
                .unwrap_or("none")
                .to_string()
        };
        let reason = |body: &Value| {
            body["hookSpecificOutput"]["permissionDecisionReason"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        };

        // Past 64 KiB: read in full, so the delete at its end is found, and a harmless one passes.
        let padding = "# x".repeat(30 * 1024);
        assert!(padding.len() > MAX_BODY && padding.len() < GUARD_MAX_COMMAND);
        let (status, body) = pre_bash(
            server.port,
            &url,
            &format!("{padding}\nrm -rf /work/other"),
            "default",
        );
        assert_eq!((status, decision(&body).as_str()), (200, "ask"));
        assert!(
            reason(&body).contains("leaves the agent's own folder"),
            "{body}"
        );
        let (status, _) = pre_bash(
            server.port,
            &url,
            &format!("{padding}\nrm -rf dist"),
            "default",
        );
        assert_eq!(status, 204);

        // As long as the guard reads in time it is judged; one byte more, though the hook still reads
        // it whole, it is asked about, or a guard slower than the hook's timeout would let it run.
        let tail = "\nrm -rf /work/other";
        let exact = format!("{}{tail}", "#".repeat(GUARD_MAX_COMMAND - tail.len()));
        let (status, body) = pre_bash(server.port, &url, &exact, "default");
        assert_eq!((status, decision(&body).as_str()), (200, "ask"));
        assert!(
            reason(&body).contains("leaves the agent's own folder"),
            "{body}"
        );
        for command in ["rm -rf /work/other", "echo hello"] {
            let long = format!("{command} # {}", "x".repeat(GUARD_MAX_COMMAND));
            assert!(long.len() < HOOK_MAX_BODY);
            let (status, body) = pre_bash(server.port, &url, &long, "default");
            assert_eq!(
                (status, decision(&body).as_str()),
                (200, "ask"),
                "{command}"
            );
            assert!(
                reason(&body).starts_with(delete_guard::GUARD_MARKER),
                "{body}"
            );
            assert!(
                reason(&body).contains("could not be checked for deletes"),
                "{body}"
            );
        }

        // Past the hard cap the command is not read: asked, with the guard's marker, whatever it is.
        for command in ["rm -rf /work/other", "echo hello"] {
            let huge = format!("{command} # {}", "x".repeat(HOOK_MAX_BODY));
            let (status, body) = pre_bash(server.port, &url, &huge, "default");
            assert_eq!(
                (status, decision(&body).as_str()),
                (200, "ask"),
                "{command}"
            );
            assert!(
                reason(&body).starts_with(delete_guard::GUARD_MARKER),
                "{body}"
            );
            assert!(
                reason(&body).contains("could not be checked for deletes"),
                "{body}"
            );
            // Nobody to answer a question (`dontAsk`): refused, and said so.
            let (status, body) = pre_bash(server.port, &url, &huge, "dontAsk");
            assert_eq!(
                (status, decision(&body).as_str()),
                (200, "deny"),
                "{command}"
            );
            assert!(reason(&body).contains("Do not retry"), "{body}");
        }
        // However the body is ordered: here the command comes before the tool's name.
        let huge = format!(
            r#"{{"hook_event_name":"PreToolUse","tool_input":{{"command":"{}"}},"tool_name":"PowerShell"}}"#,
            "x".repeat(HOOK_MAX_BODY)
        );
        let (status, body) = exchange(server.port, "POST", &url, &[], huge.as_bytes());
        let body: Value = serde_json::from_str(&body).unwrap();
        assert_eq!((status, decision(&body).as_str()), (200, "ask"));
        // Nothing of the event is read when the cut comes first: still a question, never a pass,
        // whether a short field opens the body or the huge one does.
        for opening in [r#""session_id":"s1","#, ""] {
            let unnamed = format!(
                r#"{{{opening}"tool_input":{{"command":"{}"}},"hook_event_name":"PreToolUse","tool_name":"Bash"}}"#,
                "x".repeat(HOOK_MAX_BODY)
            );
            let (status, body) = exchange(server.port, "POST", &url, &[], unnamed.as_bytes());
            let body: Value = serde_json::from_str(&body).unwrap();
            assert_eq!(
                (status, decision(&body).as_str()),
                (200, "ask"),
                "{opening}"
            );
        }
        // A body that is no object has no hook in it: refused, nothing asked.
        let spaces = vec![b' '; HOOK_MAX_BODY + 1];
        assert_eq!(exchange(server.port, "POST", &url, &[], &spaces).0, 413);
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
    }

    #[test]
    fn what_cannot_be_read_still_gets_the_refusals_it_names() {
        let call = |tool: &str| json!({ "hook_event_name": "PreToolUse", "tool_name": tool });
        // The sub-agent tools are refused by name, as for a call that fits.
        for tool in ["Agent", "Task", "Workflow"] {
            let decision = pre_tool_use_unread(&call(tool), true, false);
            assert_eq!(decision["hookSpecificOutput"]["permissionDecision"], "deny");
            assert!(
                decision["hookSpecificOutput"]["permissionDecisionReason"]
                    .as_str()
                    .unwrap()
                    .contains("spawn_agent")
            );
        }
        // Where they are allowed, and for every other tool, a call that was not read is asked about.
        for (tool, terminals) in [
            ("Agent", false),
            ("Bash", true),
            ("PowerShell", true),
            ("Skill", true),
        ] {
            let decision = pre_tool_use_unread(&call(tool), terminals, false);
            assert_eq!(
                decision["hookSpecificOutput"]["permissionDecision"], "ask",
                "{tool}"
            );
            assert_eq!(
                decision["hookSpecificOutput"]["hookEventName"],
                "PreToolUse"
            );
        }
        // No tool named: the same.
        let nameless = json!({ "hook_event_name": "PreToolUse", "permission_mode": "dontAsk" });
        assert_eq!(
            pre_tool_use_unread(&nameless, true, false)["hookSpecificOutput"]["permissionDecision"],
            "deny"
        );
    }

    /// Counts what a reader gave.
    struct Counting<R> {
        inner: R,
        read: usize,
    }

    impl<R: Read> Read for Counting<R> {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let read = self.inner.read(buf)?;
            self.read += read;
            Ok(read)
        }
    }

    #[test]
    fn a_body_of_any_length_is_read_up_to_the_cap_and_no_further() {
        // A body that never ends: the read stops one byte past the cap.
        let mut endless = Counting {
            inner: std::io::repeat(b'a'),
            read: 0,
        };
        let (body, cut) = read_capped(&mut endless, 4096, 0).unwrap();
        assert_eq!((body.len(), cut), (4096, true));
        assert_eq!(endless.read, 4097);
        // A body that fits is whole, and so is one of exactly the cap.
        for length in [0, 10, 4096] {
            let (body, cut) = read_capped(&mut &vec![b'a'; length][..], 4096, length).unwrap();
            assert_eq!((body.len(), cut), (length, false));
        }
        // What the announced length says does not size the buffer past the cap.
        let (body, _) = read_capped(&mut std::io::empty(), 4096, usize::MAX).unwrap();
        assert!(body.capacity() <= 4097);

        // A JSON object that never ends, cut at the cap: its first fields are kept, and nothing
        // is read past the cap.
        let head =
            br#"{"hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"old_string":""#;
        let mut endless = Counting {
            inner: std::io::Cursor::new(head.to_vec()).chain(std::io::repeat(b'a')),
            read: 0,
        };
        let body = parse_hook_body(&mut endless, 0, 8192).unwrap();
        assert!(body.cut);
        assert_eq!(endless.read, 8193);
        assert_eq!(
            body.json,
            json!({ "hook_event_name": "PostToolUse", "tool_name": "Edit" })
        );
    }

    #[test]
    fn a_hook_body_is_whole_cut_or_refused() {
        let parse = |body: &[u8], cap: usize| parse_hook_body(&mut &body[..], body.len(), cap);
        // Whole: any shape, however deep.
        let whole = parse(br#"{"a":{"b":[1,2]},"c":"d"}"#, 1024).unwrap();
        assert!(!whole.cut);
        assert_eq!(whole.json, json!({ "a": { "b": [1, 2] }, "c": "d" }));
        assert_eq!(parse(b"not json", 1024).unwrap_err(), 400);
        assert_eq!(parse(br#"{"a":"#, 1024).unwrap_err(), 400);

        // Cut: the short scalars before the cut are kept, in any order, and lists, objects and long
        // text are walked past without being kept (a quote inside a string does not end it).
        let long = "q".repeat(SALVAGED_TEXT + 1);
        let text = format!(
            r#"{{"id":7,"on":true,"off":null,"ratio":1.5,"long":"{long}","nested":{{"hook_event_name":"x\"}}","l":[1,{{"k":"v"}}]}},"list":["a","b"],"hook_event_name":"PostToolUse","message":"ok é","tool_input":{{"command":"rm -rf /"#
        );
        let cut = parse(text.as_bytes(), text.len() - 4).unwrap();
        assert!(cut.cut);
        assert_eq!(
            cut.json,
            json!({
                "id": 7, "on": true, "off": null, "ratio": 1.5,
                "hook_event_name": "PostToolUse", "message": "ok é",
            })
        );
        // A text cut in the middle is not kept.
        let cut = parse(br#"{"hook_event_name":"Stop","message":"half"#, 38).unwrap();
        assert_eq!(cut.json, json!({ "hook_event_name": "Stop" }));
        // An object whose first field is the huge one has nothing short to keep, and is not refused:
        // its answer may be a question (`status_of`).
        let first = parse(br#"{"tool_input":{"command":"rm -rf /"#, 10).unwrap();
        assert!(first.cut);
        assert_eq!(first.json, json!({}));
        let first = parse(b"  \n{garbage", 4).unwrap();
        assert!(first.cut);
        assert_eq!(first.json, json!({}));
        // What is no object, so no hook's, is refused.
        assert_eq!(parse(&[b' '; 64], 16).unwrap_err(), 413);
        assert_eq!(parse(&[b'['; 64], 16).unwrap_err(), 413);
        assert_eq!(parse(b"garbage", 4).unwrap_err(), 413);
    }

    #[test]
    fn a_hook_is_served_while_an_mcp_call_waits_for_its_answer() {
        let (tx, rx) = mpsc::channel();
        let sink = Arc::new(TestSink::new(tx));
        let server = start(Arc::clone(&sink)).unwrap();
        let port = server.port;
        let call = std::thread::spawn(move || {
            exchange(
                port,
                "POST",
                "/mcp",
                &[("Authorization", "Bearer tok-pending")],
                br#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
            )
            .0
        });
        std::thread::sleep(Duration::from_millis(200));
        let started = Instant::now();
        let path = format!("/hook/claude/n1?t={}", server.token);
        assert_eq!(
            send(
                server.port,
                "POST",
                &path,
                br#"{"hook_event_name":"UserPromptSubmit"}"#
            ),
            204
        );
        assert!(started.elapsed() < Duration::from_millis(1000));
        assert!(rx.recv_timeout(Duration::from_secs(1)).is_ok());
        assert_eq!(call.join().unwrap(), 200);
    }

    #[test]
    fn a_revoked_mcp_token_gets_401() {
        let (tx, _rx) = mpsc::channel();
        let sink = Arc::new(TestSink::new(tx));
        let server = start(Arc::clone(&sink)).unwrap();
        let token = sink.tokens.issue("n1");
        let auth = format!("Bearer {token}");
        let call = |auth: &str| {
            exchange(
                server.port,
                "POST",
                "/mcp",
                &[("Authorization", auth)],
                br#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
            )
            .0
        };
        assert_eq!(call(&auth), 200);
        // What `ended()` does when the process stops.
        sink.tokens.revoke("n1");
        assert_eq!(call(&auth), 401);
    }

    #[test]
    fn refuses_mcp_without_a_known_token_and_counts_subagents() {
        let (tx, _rx) = mpsc::channel();
        let sink = Arc::new(TestSink::new(tx));
        let server = start(Arc::clone(&sink)).unwrap();
        assert_eq!(exchange(server.port, "POST", "/mcp", &[], b"{}").0, 401);
        assert_eq!(
            exchange(
                server.port,
                "POST",
                "/mcp",
                &[("Authorization", "Bearer nope")],
                b"{}"
            )
            .0,
            401
        );
        assert_eq!(
            exchange(
                server.port,
                "GET",
                "/mcp",
                &[("Authorization", "Bearer tok-n1")],
                b""
            )
            .0,
            405
        );
        assert_eq!(
            exchange(
                server.port,
                "POST",
                "/mcp",
                &[("Authorization", "Bearer tok-n1")],
                b"not json"
            )
            .0,
            200
        );
        let path = format!("/hook/claude/n1?t={}", server.token);
        // The real payloads: the start's id is prefixed, the stop's bare.
        let start = br#"{"session_id":"b7be","transcript_path":"C:/p/b7be.jsonl","cwd":"C:/w","hook_event_name":"SubagentStart","agent_id":"agent-a4d2c6eef3e5fb6b0","agent_type":"Explore"}"#;
        let stop = br#"{"session_id":"b7be","transcript_path":"C:/p/b7be.jsonl","cwd":"C:/w","hook_event_name":"SubagentStop","stop_hook_active":false,"agent_id":"a4d2c6eef3e5fb6b0","agent_type":"Explore","agent_transcript_path":"C:/p/b7be/subagents/agent-a4d2c6eef3e5fb6b0.jsonl","last_assistant_message":"Done.","background_tasks":[],"session_crons":[]}"#;
        assert_eq!(send(server.port, "POST", &path, start), 204);
        assert_eq!(send(server.port, "POST", &path, stop), 204);
        let hook = SubagentHook {
            started: true,
            agent_id: Some("a4d2c6eef3e5fb6b0".into()),
            agent_type: "Explore".into(),
            transcript_path: Some("C:/p/b7be.jsonl".into()),
            agent_transcript_path: None,
        };
        let stopped = SubagentHook {
            started: false,
            agent_transcript_path: Some("C:/p/b7be/subagents/agent-a4d2c6eef3e5fb6b0.jsonl".into()),
            ..hook.clone()
        };
        assert_eq!(
            *sink.subagents.lock().unwrap(),
            vec![("n1".to_string(), hook), ("n1".to_string(), stopped)]
        );
    }

    #[test]
    fn a_panic_while_answering_gives_a_500_and_the_server_goes_on() {
        let (tx, _rx) = mpsc::channel();
        let sink = Arc::new(TestSink::new(tx));
        let server = start(Arc::clone(&sink)).unwrap();
        let header = format!("{TOKEN_HEADER}: {}\r\n", server.token);
        assert_eq!(
            send_headed(server.port, "POST", "/status/boom", &header, b"{}"),
            500
        );
        let mcp = [("Authorization", "Bearer tok-boom")];
        let call = br#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        assert_eq!(exchange(server.port, "POST", "/mcp", &mcp, call).0, 500);
        // Still serving.
        assert_eq!(
            send_headed(server.port, "POST", "/status/n1", &header, b"{}"),
            204
        );
        let ok = [("Authorization", "Bearer tok-n1")];
        assert_eq!(exchange(server.port, "POST", "/mcp", &ok, call).0, 200);
    }

    #[test]
    fn a_request_without_a_thread_is_answered_503() {
        // A listener of our own, its spawner always failing.
        let probe = Server::http("127.0.0.1:0").unwrap();
        let port = probe.server_addr().to_ip().unwrap().port();
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        client
            .write_all(
                b"POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .unwrap();
        let request = probe.recv().unwrap();
        dispatch_with(
            request,
            |_| panic!("must not run"),
            |_| Err(std::io::Error::other("no thread")),
        );
        let mut response = String::new();
        let _ = client.read_to_string(&mut response);
        assert!(response.starts_with("HTTP/1.1 503"), "{response}");
    }

    #[test]
    fn a_client_stalling_on_its_body_does_not_hold_the_others_up() {
        let (tx, _rx) = mpsc::channel();
        let server = start(Arc::new(TestSink::new(tx))).unwrap();
        // Past 1024 bytes: tiny_http reads smaller bodies itself, before the server sees them.
        let path = format!("/status/n1?t={}", server.token);
        let stalled = announce(server.port, &path, 100_000);

        let (done, finished) = mpsc::channel();
        let port = server.port;
        std::thread::spawn(move || {
            let mcp = [("Authorization", "Bearer tok-n1")];
            let call = br#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
            let _ = done.send(exchange(port, "POST", "/mcp", &mcp, call).0);
        });
        assert_eq!(
            finished.recv_timeout(Duration::from_secs(3)),
            Ok(200),
            "a stalled hook client blocks the server loop"
        );
        let header = format!("{TOKEN_HEADER}: {}\r\n", server.token);
        assert_eq!(
            send_headed(server.port, "POST", "/status/n1", &header, b"{}"),
            204
        );
        drop(stalled);
    }

    /// Announces a body, sends none of it, and keeps the connection open.
    fn announce(port: u16, path: &str, length: u64) -> TcpStream {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let head = format!("POST {path} HTTP/1.1\r\nHost: x\r\nContent-Length: {length}\r\n\r\n");
        stream.write_all(head.as_bytes()).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        stream
    }

    /// Whether the server still serves, hooks and MCP, within a few seconds.
    fn still_serving(port: u16, token: &str) -> bool {
        let (done, finished) = mpsc::channel();
        let token = token.to_string();
        std::thread::spawn(move || {
            let mcp = [("Authorization", "Bearer tok-n1")];
            let call = br#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
            let header = format!("{TOKEN_HEADER}: {token}\r\n");
            let _ = done.send((
                exchange(port, "POST", "/mcp", &mcp, call).0,
                send_headed(port, "POST", "/status/n1", &header, b"{}"),
            ));
        });
        finished.recv_timeout(Duration::from_secs(3)) == Ok((200, 204))
    }

    #[test]
    fn a_caller_without_the_token_cannot_stall_the_server() {
        let (tx, _rx) = mpsc::channel();
        let server = start(Arc::new(TestSink::new(tx))).unwrap();
        let stalled = announce(server.port, "/status/n1", 100_000);
        assert!(
            still_serving(server.port, &server.token),
            "a client without the token blocks the server loop"
        );
        drop(stalled);
    }

    /// tiny_http allocates what is left of an announced body when it drops the
    /// request: an absurd length aborts the whole application, agents included.
    #[test]
    fn an_absurd_announced_length_does_not_bring_the_application_down() {
        let (tx, _rx) = mpsc::channel();
        let server = start(Arc::new(TestSink::new(tx))).unwrap();
        let mut stalled = Vec::new();
        for path in ["/status/n1", "/hook/claude/n1", "/mcp"] {
            stalled.push(announce(server.port, path, 9_000_000_000_000_000));
        }
        assert!(still_serving(server.port, &server.token));
        drop(stalled);
    }

    #[test]
    fn many_agents_calling_at_once_are_all_answered() {
        let (tx, _rx) = mpsc::channel();
        let server = start(Arc::new(TestSink::new(tx))).unwrap();
        let port = server.port;
        let token = server.token.clone();
        let workers: Vec<_> = (0..48)
            .map(|i| {
                let token = token.clone();
                std::thread::spawn(move || {
                    let node = format!("tok-n{}", i % 8);
                    let auth = [("Authorization", node.as_str())];
                    let auth = [(auth[0].0, format!("Bearer {}", auth[0].1))];
                    let call = br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"etape"}}"#;
                    let mcp = exchange(port, "POST", "/mcp", &[(auth[0].0, auth[0].1.as_str())], call).0;
                    let header = format!("{TOKEN_HEADER}: {token}\r\n");
                    let hook = send_headed(port, "POST", "/status/n1", &header, b"{}");
                    (mcp, hook)
                })
            })
            .collect();
        for worker in workers {
            assert_eq!(worker.join().unwrap(), (200, 204));
        }
    }
}
