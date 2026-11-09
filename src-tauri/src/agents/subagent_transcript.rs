//! A subagent's transcript, read as it grows: Claude Code appends one JSON
//! object per line to `<session>/subagents/agent-<id>.jsonl`, and dummyPlane
//! shows the lines that tell what the subagent does.

use std::fs::File;
use std::io::{ErrorKind, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

/// The first user message, as shown.
const MAX_PROMPT: usize = 2000;
/// An assistant text, or a report.
const MAX_TEXT: usize = 4000;
/// A tool call's summary.
const MAX_SUMMARY: usize = 160;
/// A tool result: this many lines, this many characters.
const RESULT_LINES: usize = 6;
const MAX_RESULT: usize = 400;
/// The prompt as the node's title.
const MAX_TITLE: usize = 200;
/// What one read takes from a file; the rest waits for the next poll.
const MAX_READ: u64 = 4 * 1024 * 1024;
/// A partial line longer than this is dropped up to its end.
const MAX_PARTIAL: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LineKind {
    Prompt,
    Text,
    Tool,
    Result,
    Error,
    Report,
}

/// One line a subagent's node shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SubagentLine {
    pub kind: LineKind,
    pub text: String,
}

impl SubagentLine {
    fn new(kind: LineKind, text: String) -> Self {
        Self { kind, text }
    }
}

/// What the parser remembers from one line to the next.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Parser {
    /// The first user message was shown: later user texts are reminders.
    prompt_seen: bool,
}

impl Parser {
    /// The lines one transcript line shows; none for the lines Claude keeps
    /// for itself (attachments, API requests, reminders, thinking).
    pub fn parse(&mut self, line: &str) -> Vec<SubagentLine> {
        let Ok(json) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };
        match json["type"].as_str() {
            Some("assistant") => assistant_lines(&json["message"]["content"]),
            Some("user") if json["isMeta"].as_bool() != Some(true) => {
                self.user_lines(&json["message"]["content"])
            }
            _ => Vec::new(),
        }
    }

    fn user_lines(&mut self, content: &Value) -> Vec<SubagentLine> {
        let mut lines = Vec::new();
        let mut texts = Vec::new();
        match content {
            Value::String(text) => texts.push(text.as_str()),
            Value::Array(blocks) => {
                for block in blocks {
                    match block["type"].as_str() {
                        Some("tool_result") => lines.extend(result_line(block)),
                        Some("text") => texts.extend(block["text"].as_str()),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
        let prompt = texts.join("\n");
        if !self.prompt_seen && lines.is_empty() && !prompt.trim().is_empty() {
            self.prompt_seen = true;
            lines.push(SubagentLine::new(
                LineKind::Prompt,
                truncate(&prompt, MAX_PROMPT),
            ));
        }
        lines
    }
}

fn assistant_lines(content: &Value) -> Vec<SubagentLine> {
    let Some(blocks) = content.as_array() else {
        return Vec::new();
    };
    blocks
        .iter()
        .filter_map(|block| match block["type"].as_str()? {
            "text" => {
                let text = block["text"].as_str()?;
                (!text.trim().is_empty())
                    .then(|| SubagentLine::new(LineKind::Text, truncate(text, MAX_TEXT)))
            }
            "tool_use" => {
                let name = block["name"].as_str().unwrap_or("tool");
                let input = &block["input"];
                match input["message"].as_str() {
                    Some(report) if name == "SubagentHandback" => Some(SubagentLine::new(
                        LineKind::Report,
                        truncate(report, MAX_TEXT),
                    )),
                    _ => Some(SubagentLine::new(LineKind::Tool, tool_summary(name, input))),
                }
            }
            _ => None,
        })
        .collect()
}

/// A tool result: `error` when it failed, nothing when it said nothing.
fn result_line(block: &Value) -> Option<SubagentLine> {
    let failed = block["is_error"].as_bool() == Some(true);
    let text = result_text(&block["content"]);
    if text.is_empty() {
        return failed.then(|| SubagentLine::new(LineKind::Error, "error".into()));
    }
    let kind = if failed {
        LineKind::Error
    } else {
        LineKind::Result
    };
    Some(SubagentLine::new(kind, text))
}

/// A result's text (a string, or text blocks), its first lines only.
pub fn result_text(content: &Value) -> String {
    let text = match content {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|block| match block["type"].as_str() {
                Some("text") => block["text"].as_str().map(str::to_string),
                Some("image") => Some("[image]".into()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    let text = text.trim_matches(['\n', '\r']);
    let all: Vec<&str> = text.lines().collect();
    let mut kept = all[..all.len().min(RESULT_LINES)].join("\n");
    if all.len() > RESULT_LINES {
        kept.push('…');
    }
    truncate(&kept, MAX_RESULT)
}

/// The input fields that tell most about a call, best first.
const SUMMARY_FIELDS: [&str; 14] = [
    "command",
    "file_path",
    "notebook_path",
    "pattern",
    "url",
    "query",
    "description",
    "skill",
    "title",
    "subject",
    "prompt",
    "path",
    "message",
    "name",
];

/// `Name(summary)`, the summary on one line; `Name` alone when no field tells.
pub fn tool_summary(name: &str, input: &Value) -> String {
    let field = SUMMARY_FIELDS
        .iter()
        .find_map(|field| {
            let value = input[*field].as_str()?;
            (!value.trim().is_empty()).then_some((*field, value))
        })
        .or_else(|| {
            input.as_object()?.iter().find_map(|(field, value)| {
                let value = value.as_str()?;
                (!value.trim().is_empty()).then_some((field.as_str(), value))
            })
        });
    let Some((field, value)) = field else {
        return name.to_string();
    };
    let summary = if matches!(field, "prompt" | "message") {
        first_line(value).unwrap_or_default().to_string()
    } else {
        value.split_whitespace().collect::<Vec<_>>().join(" ")
    };
    format!("{name}({})", truncate(&summary, MAX_SUMMARY))
}

fn first_line(text: &str) -> Option<&str> {
    text.lines().map(str::trim).find(|line| !line.is_empty())
}

/// The prompt as the node's title: its first non-empty line.
pub fn prompt_title(prompt: &str) -> Option<String> {
    first_line(prompt).map(|line| truncate(line, MAX_TITLE))
}

/// At most `max` characters, `…` last when cut; never splits a character.
pub fn truncate(text: &str, max: usize) -> String {
    let text = text.trim_end();
    match text.char_indices().nth(max) {
        None => text.to_string(),
        Some(_) => {
            let end = text
                .char_indices()
                .nth(max.saturating_sub(1))
                .map_or(0, |(index, _)| index);
            format!("{}…", &text[..end])
        }
    }
}

/// What the sidecar `agent-<id>.meta.json` says of a subagent.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Meta {
    pub description: Option<String>,
    /// The bare id of the subagent that spawned it, for a nested one.
    pub parent_agent_id: Option<String>,
    pub finished: bool,
}

/// None while the file is not whole JSON yet.
pub fn read_meta(text: &str) -> Option<Meta> {
    let json: Value = serde_json::from_str(text).ok()?;
    json.is_object().then_some(())?;
    let text_of = |key: &str| {
        json[key]
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    Some(Meta {
        description: text_of("description"),
        parent_agent_id: text_of("parentAgentId").and_then(|id| bare_id(&id)),
        finished: json["finished"].as_bool() == Some(true),
    })
}

/// A hook's `agent_id` as the files name it: `agent-` stripped.
pub fn bare_id(id: &str) -> Option<String> {
    let id = id.trim();
    let id = id.strip_prefix("agent-").unwrap_or(id);
    (!id.is_empty()).then(|| id.to_string())
}

/// The transcript of subagent `agent_id` of the session whose transcript is
/// `transcript`; a hook fired inside a subagent names a file of `subagents/` already.
pub fn transcript_file(transcript: &Path, agent_id: &str) -> PathBuf {
    let file = format!("agent-{agent_id}.jsonl");
    match transcript.parent() {
        Some(folder) if folder.file_name().is_some_and(|name| name == "subagents") => {
            folder.join(file)
        }
        _ => transcript.with_extension("").join("subagents").join(file),
    }
}

/// The sidecar of a subagent's transcript.
pub fn meta_file(transcript: &Path) -> PathBuf {
    transcript.with_extension("meta.json")
}

/// A transcript read from where the last read stopped: only whole lines are
/// parsed, the partial last one waits for the rest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tail {
    pub path: PathBuf,
    offset: u64,
    partial: Vec<u8>,
    /// A partial line grew too long: skipped up to its end.
    skipping: bool,
    /// The last read reached the end of the file.
    caught_up: bool,
    parser: Parser,
}

impl Tail {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            offset: 0,
            partial: Vec::new(),
            skipping: false,
            caught_up: true,
            parser: Parser::default(),
        }
    }

    /// Nothing read yet: another path may still replace this one.
    pub fn untouched(&self) -> bool {
        self.offset == 0
    }

    /// The last read left nothing behind.
    pub fn caught_up(&self) -> bool {
        self.caught_up
    }

    /// The lines added since the last read; none while the file does not exist.
    pub fn read(&mut self) -> std::io::Result<Vec<SubagentLine>> {
        let mut file = match File::open(&self.path) {
            Ok(file) => file,
            Err(err) if err.kind() == ErrorKind::NotFound => {
                self.caught_up = true;
                return Ok(Vec::new());
            }
            Err(err) => return Err(err),
        };
        let length = file.metadata()?.len();
        if length < self.offset {
            // Rewritten from the start: read it again.
            *self = Self::new(std::mem::take(&mut self.path));
        }
        self.caught_up = length == self.offset;
        if self.caught_up {
            return Ok(Vec::new());
        }
        file.seek(SeekFrom::Start(self.offset))?;
        let mut chunk = Vec::new();
        file.take(MAX_READ).read_to_end(&mut chunk)?;
        self.offset += chunk.len() as u64;
        self.caught_up = self.offset >= length;
        Ok(self.feed(&chunk))
    }

    /// The lines `chunk` completes.
    fn feed(&mut self, chunk: &[u8]) -> Vec<SubagentLine> {
        self.partial.extend_from_slice(chunk);
        let Some(end) = self.partial.iter().rposition(|&byte| byte == b'\n') else {
            if self.partial.len() > MAX_PARTIAL {
                self.partial.clear();
                self.skipping = true;
            }
            return Vec::new();
        };
        let whole: Vec<u8> = self.partial.drain(..=end).collect();
        let mut lines = Vec::new();
        for (index, raw) in whole.split(|&byte| byte == b'\n').enumerate() {
            if index == 0 && std::mem::take(&mut self.skipping) {
                continue;
            }
            let raw = String::from_utf8_lossy(raw);
            let raw = raw.trim();
            if !raw.is_empty() {
                lines.extend(self.parser.parse(raw));
            }
        }
        lines
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use serde_json::json;

    use super::*;

    fn parse(lines: &[Value]) -> Vec<SubagentLine> {
        let mut parser = Parser::default();
        lines
            .iter()
            .flat_map(|line| parser.parse(&line.to_string()))
            .collect()
    }

    fn line(kind: LineKind, text: &str) -> SubagentLine {
        SubagentLine::new(kind, text.into())
    }

    fn user(content: Value) -> Value {
        json!({
            "parentUuid": null, "isSidechain": true, "agentId": "a4d2c6eef3e5fb6b0",
            "type": "user", "message": { "role": "user", "content": content },
            "uuid": "f06db7a8", "sessionId": "b7be53c0"
        })
    }

    fn assistant(content: Value) -> Value {
        json!({
            "parentUuid": "ee40b8b0", "isSidechain": true, "agentId": "a4d2c6eef3e5fb6b0",
            "message": {
                "model": "claude-haiku-5-5", "type": "message", "role": "assistant",
                "content": content, "stop_reason": "tool_use"
            },
            "type": "assistant", "uuid": "696fcdc8"
        })
    }

    #[test]
    fn shows_the_first_prompt_and_skips_reminders_and_meta_lines() {
        let mut reminder = user(json!("<system-reminder>\nYour final report"));
        reminder["isMeta"] = json!(true);
        let lines = parse(&[
            user(json!("You are polishing UI in the worktree.\nEdit ONLY your files.")),
            reminder,
            user(json!("<system-reminder>later</system-reminder>")),
        ]);
        assert_eq!(
            lines,
            vec![line(
                LineKind::Prompt,
                "You are polishing UI in the worktree.\nEdit ONLY your files."
            )]
        );
    }

    #[test]
    fn a_meta_line_first_does_not_take_the_prompt_s_place() {
        let mut reminder = user(json!("<system-reminder>first</system-reminder>"));
        reminder["isMeta"] = json!(true);
        let lines = parse(&[
            reminder,
            user(json!([{ "type": "text", "text": "Find the bug." }])),
        ]);
        assert_eq!(lines, vec![line(LineKind::Prompt, "Find the bug.")]);
    }

    #[test]
    fn shows_texts_and_tool_calls_and_skips_thinking() {
        let lines = parse(&[assistant(json!([
            { "type": "thinking", "thinking": "", "signature": "abc" },
            { "type": "text", "text": "Let me look at the file." },
            { "type": "text", "text": "  \n" },
            { "type": "tool_use", "id": "toolu_1", "name": "Bash",
              "input": { "command": "cd \"D:/x\" &&\n  ls   src", "description": "List" } },
            { "type": "tool_use", "id": "toolu_2", "name": "Read",
              "input": { "file_path": "D:/x/src/main.rs" } },
            { "type": "tool_use", "id": "toolu_3", "name": "Grep",
              "input": { "pattern": "fn main", "path": "src" } },
            { "type": "tool_use", "id": "toolu_4", "name": "Agent",
              "input": { "description": "Fix taxonomy", "prompt": "You fix\nthings",
                         "subagent_type": "general-purpose" } },
            { "type": "tool_use", "id": "toolu_5", "name": "TodoWrite",
              "input": { "todos": [] } },
        ]))]);
        assert_eq!(
            lines,
            vec![
                line(LineKind::Text, "Let me look at the file."),
                line(LineKind::Tool, "Bash(cd \"D:/x\" && ls src)"),
                line(LineKind::Tool, "Read(D:/x/src/main.rs)"),
                line(LineKind::Tool, "Grep(fn main)"),
                line(LineKind::Tool, "Agent(Fix taxonomy)"),
                line(LineKind::Tool, "TodoWrite"),
            ]
        );
    }

    #[test]
    fn a_handback_is_the_report() {
        let lines = parse(&[assistant(json!([
            { "type": "tool_use", "id": "toolu_9", "name": "SubagentHandback",
              "input": { "message": "UI polish is done.\n\nFiles changed (3)." } }
        ]))]);
        assert_eq!(
            lines,
            vec![line(LineKind::Report, "UI polish is done.\n\nFiles changed (3).")]
        );
    }

    #[test]
    fn shows_tool_results_string_or_blocks_and_errors() {
        let mut result = user(json!([{
            "tool_use_id": "toolu_1", "type": "tool_result",
            "content": "    22 a.ts\n    19 b.ts\n", "is_error": false
        }]));
        result["toolUseResult"] = json!({ "stdout": "    22 a.ts" });
        let lines = parse(&[
            user(json!("Prompt")),
            result,
            user(json!([{
                "tool_use_id": "toolu_2", "type": "tool_result",
                "content": [{ "type": "text", "text": "{\"success\":true}" }]
            }])),
            user(json!([{
                "tool_use_id": "toolu_3", "type": "tool_result",
                "content": "Exit code 127\nnpx: command not found", "is_error": true
            }])),
            user(json!([{ "tool_use_id": "toolu_4", "type": "tool_result", "content": "" }])),
        ]);
        assert_eq!(
            lines,
            vec![
                line(LineKind::Prompt, "Prompt"),
                line(LineKind::Result, "    22 a.ts\n    19 b.ts"),
                line(LineKind::Result, "{\"success\":true}"),
                line(LineKind::Error, "Exit code 127\nnpx: command not found"),
            ]
        );
    }

    #[test]
    fn a_long_result_keeps_its_first_lines() {
        let text = (1..=10)
            .map(|n| format!("line {n}"))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(
            result_text(&json!(text)),
            "line 1\nline 2\nline 3\nline 4\nline 5\nline 6…"
        );
        let long = "é".repeat(1000);
        let cut = result_text(&json!(long));
        assert_eq!(cut.chars().count(), MAX_RESULT);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn skips_the_lines_claude_keeps_for_itself() {
        let blob = json!({
            "type": "api-request-blob", "agentId": "a4d2c6eef3e5fb6b0",
            "message": { "content": [
                { "type": "text", "text": "<system-reminder>" },
                { "type": "tool_use", "id": "toolu_1", "name": "Read", "input": {} }
            ]}
        });
        let lines = parse(&[
            json!({ "type": "attachment", "attachment": { "type": "skill_listing" } }),
            json!({ "type": "api-request-shape", "system": "huge" }),
            blob,
            json!({ "type": "api-request", "requestId": "req_1" }),
        ]);
        assert!(lines.is_empty());
        assert!(Parser::default().parse("{not json").is_empty());
    }

    #[test]
    fn summaries_stay_on_one_short_line() {
        let long = "x".repeat(500);
        let summary = tool_summary("Bash", &json!({ "command": long }));
        assert_eq!(summary.chars().count(), "Bash()".len() + MAX_SUMMARY);
        assert_eq!(
            tool_summary("WebFetch", &json!({ "url": "https://a.b", "prompt": "Read" })),
            "WebFetch(https://a.b)"
        );
        assert_eq!(
            tool_summary("mcp__x__step", &json!({ "state": "done" })),
            "mcp__x__step(done)"
        );
    }

    #[test]
    fn truncates_on_characters() {
        assert_eq!(truncate("héllo", 10), "héllo");
        assert_eq!(truncate("héllo", 3), "hé…");
        assert_eq!(truncate("日本語のテキスト", 4), "日本語…");
        assert_eq!(prompt_title("\n\n  Fix the bug  \nmore"), Some("Fix the bug".into()));
        assert_eq!(prompt_title(" \n "), None);
    }

    #[test]
    fn reads_the_sidecar_meta() {
        let meta = read_meta(
            r#"{"agentType":"general-purpose","description":"Fix feature-taxonomy","toolUseId":"toolu_1","parentAgentId":"ad41f90eb6504b6e1","spawnDepth":2,"finished":true}"#,
        )
        .unwrap();
        assert_eq!(
            meta,
            Meta {
                description: Some("Fix feature-taxonomy".into()),
                parent_agent_id: Some("ad41f90eb6504b6e1".into()),
                finished: true,
            }
        );
        let top = read_meta(r#"{"agentType":"Explore","description":"Look","spawnDepth":1}"#);
        assert_eq!(top.unwrap().parent_agent_id, None);
        assert_eq!(read_meta(r#"{"agentType":"Expl"#), None);
    }

    #[test]
    fn strips_the_agent_prefix_of_ids() {
        assert_eq!(bare_id("agent-abc123"), Some("abc123".into()));
        assert_eq!(bare_id("abc123"), Some("abc123".into()));
        assert_eq!(bare_id(" "), None);
        assert_eq!(bare_id("agent-"), None);
    }

    #[test]
    fn finds_a_subagent_s_files_next_to_its_session() {
        let session = Path::new("projects").join("D--x").join("b7be.jsonl");
        let file = transcript_file(&session, "a4d2");
        assert_eq!(
            file,
            Path::new("projects")
                .join("D--x")
                .join("b7be")
                .join("subagents")
                .join("agent-a4d2.jsonl")
        );
        // A hook fired inside a subagent: nested ones live in the same folder.
        assert_eq!(transcript_file(&file, "ad41"), file.with_file_name("agent-ad41.jsonl"));
        assert_eq!(meta_file(&file), file.with_file_name("agent-a4d2.meta.json"));
    }

    #[test]
    fn tails_a_growing_file_line_by_line_exactly_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agent-a1.jsonl");
        let mut tail = Tail::new(path.clone());
        assert_eq!(tail.read().unwrap(), vec![], "no file yet");
        let prompt = user(json!("Résumé du problème")).to_string();
        let text = assistant(json!([{ "type": "text", "text": "Voilà — fini" }])).to_string();
        let bytes = format!("{prompt}\n{text}\n");
        let cut = prompt.len() + 1 + text.find("à").unwrap() + 1; // inside `à`
        let mut file = File::create(&path).unwrap();
        file.write_all(&bytes.as_bytes()[..cut]).unwrap();
        file.flush().unwrap();
        assert_eq!(tail.read().unwrap(), vec![line(LineKind::Prompt, "Résumé du problème")]);
        assert!(!tail.untouched());
        assert_eq!(tail.read().unwrap(), vec![], "the partial line waits");
        file.write_all(&bytes.as_bytes()[cut..]).unwrap();
        file.flush().unwrap();
        assert_eq!(tail.read().unwrap(), vec![line(LineKind::Text, "Voilà — fini")]);
        assert_eq!(tail.read().unwrap(), vec![]);
    }

    #[test]
    fn a_partial_line_too_long_is_skipped_to_its_end() {
        let mut tail = Tail::new(PathBuf::from("unused"));
        assert!(tail.feed(&vec![b'x'; MAX_PARTIAL + 1]).is_empty());
        let text = assistant(json!([{ "type": "text", "text": "after" }])).to_string();
        let lines = tail.feed(format!("xxxx\n{text}\n").as_bytes());
        assert_eq!(lines, vec![line(LineKind::Text, "after")]);
    }
}
