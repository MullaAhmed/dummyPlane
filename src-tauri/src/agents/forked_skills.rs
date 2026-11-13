//! Skills that fork. Claude Code runs a skill whose frontmatter says
//! `context: fork` in a sub-agent of its own, in the background, which the user
//! could only watch as a read-only mirror: while sub-agents open as terminals,
//! the hook server refuses it as it refuses the built-in Agent tool. The Skill
//! tool's `PreToolUse` names the skill and nothing more, so a skill that is a
//! file is read, and one that is not (bundled with Claude Code, a plugin's, an
//! account's) is known once it has forked: its `PostToolUse` says so, and
//! dummyPlane keeps its name across runs.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;

use super::claude_settings::claude_config_dir;
use crate::sync::lock;

/// The Skill tool, asked about at each call (`claude_settings`).
pub const SKILL_TOOL: &str = "Skill";

/// A skill that would fork.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fork {
    /// Its name, as the Skill tool was given it, without a leading slash.
    pub name: String,
    /// Its instructions, when they are a file: a terminal can read and follow them.
    pub file: Option<PathBuf>,
}

/// The skill a Skill call names: trimmed, without the slash a command is typed with.
pub fn skill_name(input: &Value) -> Option<String> {
    let name = input["skill"]
        .as_str()?
        .trim()
        .trim_start_matches('/')
        .trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// A name that is one folder's: a plugin's (`plugin:skill`) or a nested
/// folder's (`apps/web:deploy`) is not looked for on disk, only learned.
fn plain(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':'])
}

/// The project's `.claude` folders: the session's folder's and those above it,
/// up to the repository's root, nearest first.
fn project_dirs(cwd: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for dir in cwd.ancestors() {
        dirs.push(dir.join(".claude"));
        if dir.join(".git").exists() {
            break;
        }
    }
    dirs
}

/// The file a skill named alone runs from, in Claude Code's order: a skill
/// before a command of `commands/`, the user's before the project's.
pub fn skill_file(name: &str, cwd: Option<&Path>, config: Option<&Path>) -> Option<PathBuf> {
    if !plain(name) {
        return None;
    }
    let dirs: Vec<PathBuf> = config
        .map(Path::to_path_buf)
        .into_iter()
        .chain(cwd.map(project_dirs).unwrap_or_default())
        .collect();
    let skills = dirs
        .iter()
        .map(|dir| dir.join("skills").join(name).join("SKILL.md"));
    let commands = dirs
        .iter()
        .map(|dir| dir.join("commands").join(format!("{name}.md")));
    skills.chain(commands).find(|file| file.is_file())
}

/// Whether a skill's file says `context: fork` in its frontmatter.
pub fn forks(text: &str) -> bool {
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    if lines.next().map(str::trim) != Some("---") {
        return false;
    }
    lines
        .take_while(|line| line.trim() != "---")
        // A top-level key: one indented belongs to another's value.
        .filter(|line| !line.starts_with(char::is_whitespace))
        .filter_map(|line| line.split_once(':'))
        .any(|(key, value)| {
            let value = value.split(" #").next().unwrap_or_default().trim();
            key.trim_end() == "context" && value.trim_matches(['"', '\'']) == "fork"
        })
}

/// Claude's folder for this session, where the user's skills are: the one its
/// transcript is in (`<folder>/projects/<project>/...`), so a profile's are
/// found, else the usual one.
fn config_dir(json: &Value) -> Option<PathBuf> {
    json["transcript_path"]
        .as_str()
        .map(Path::new)
        .and_then(|transcript| {
            transcript
                .ancestors()
                .find(|dir| dir.file_name().is_some_and(|name| name == "projects"))?
                .parent()
        })
        .map(Path::to_path_buf)
        .or_else(claude_config_dir)
}

/// Whether a skill forks: its file says so, else it has been seen forking.
pub fn decide(
    name: &str,
    cwd: Option<&Path>,
    config: Option<&Path>,
    seen: impl FnOnce(&str) -> bool,
) -> Option<Fork> {
    let fork = |file| Fork {
        name: name.to_string(),
        file,
    };
    match skill_file(name, cwd, config) {
        Some(file) => {
            let text = std::fs::read_to_string(&file).ok()?;
            forks(&text).then(|| fork(Some(file)))
        }
        None => seen(name).then(|| fork(None)),
    }
}

/// The names of a Skill call that forked, from its `PostToolUse`: the one
/// Claude gave and the one the skill answers to.
pub fn forked_names(json: &Value) -> Vec<String> {
    if json["tool_name"] != SKILL_TOOL {
        return Vec::new();
    }
    let response = &json["tool_response"];
    let forked = response["status"] == "forked"
        || response
            .as_str()
            .is_some_and(|text| text.contains("(forked execution"));
    if !forked {
        return Vec::new();
    }
    let mut names: Vec<String> = [
        skill_name(&json["tool_input"]),
        skill_name(&serde_json::json!({ "skill": response["commandName"] })),
    ]
    .into_iter()
    .flatten()
    .collect();
    names.dedup();
    names
}

/// The skills seen forking, kept in a file of dummyPlane's own.
#[derive(Debug, Default)]
pub struct Seen {
    file: Option<PathBuf>,
    names: BTreeSet<String>,
}

impl Seen {
    pub const fn new() -> Self {
        Self {
            file: None,
            names: BTreeSet::new(),
        }
    }

    /// Read from its file; a missing or unreadable one is an empty list.
    pub fn load(file: PathBuf) -> Self {
        let names = std::fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<String>>(&bytes).ok())
            .unwrap_or_default()
            .into_iter()
            .collect();
        Self {
            file: Some(file),
            names,
        }
    }

    pub fn contains(&self, name: &str) -> bool {
        self.names.contains(name)
    }

    /// Adds a name, written to the file when it is new.
    pub fn learn(&mut self, name: &str) {
        if !self.names.insert(name.to_string()) {
            return;
        }
        let Some(file) = &self.file else {
            return;
        };
        let written = serde_json::to_vec_pretty(&self.names)
            .map_err(std::io::Error::other)
            .and_then(|bytes| std::fs::write(file, bytes));
        if let Err(err) = written {
            log::warn!("forked skill {name} not kept: {err}");
        }
    }
}

static SEEN: Mutex<Seen> = Mutex::new(Seen::new());

/// At startup: the skills the runs before saw forking.
pub fn init(file: PathBuf) {
    *lock(&SEEN) = Seen::load(file);
}

/// Whether the skill a `PreToolUse` of the Skill tool is about would fork.
pub fn lookup(json: &Value) -> Option<Fork> {
    let name = skill_name(&json["tool_input"])?;
    let cwd = json["cwd"].as_str().map(Path::new);
    let config = config_dir(json);
    decide(&name, cwd, config.as_deref(), |name| {
        lock(&SEEN).contains(name)
    })
}

/// Keeps the names of a skill a `PostToolUse` says forked.
pub fn learn_from(json: &Value) {
    let names = forked_names(json);
    if names.is_empty() {
        return;
    }
    let mut seen = lock(&SEEN);
    for name in names {
        seen.learn(&name);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn reads_context_fork_in_the_frontmatter_only() {
        assert!(forks(
            "---\nname: deep\ncontext: fork\nagent: Explore\n---\nBody"
        ));
        assert!(forks("\u{feff}---\r\ncontext: \"fork\"\r\n---\r\n"));
        assert!(forks("---\ncontext: 'fork' # isolated\n---\n"));
        assert!(!forks("---\nname: inline\n---\ncontext: fork\n"));
        assert!(!forks("context: fork\n"));
        assert!(!forks("---\nmetadata:\n  context: fork\n---\n"));
        assert!(!forks("---\ncontext: forked\n---\n"));
        assert!(!forks("---\ncontexts: fork\n---\n"));
        assert!(!forks(""));
    }

    #[test]
    fn names_the_skill_without_its_slash() {
        assert_eq!(
            skill_name(&json!({ "skill": " /code-review ", "args": "601" })),
            Some("code-review".into())
        );
        assert_eq!(skill_name(&json!({ "skill": "/" })), None);
        assert_eq!(skill_name(&json!({})), None);
    }

    #[test]
    fn finds_a_skill_s_file_as_claude_code_ranks_them() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config");
        let repo = dir.path().join("repo");
        let cwd = repo.join("app");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::create_dir_all(&cwd).unwrap();
        // Above the repository: never read.
        write(
            &dir.path().join(".claude/skills/outer/SKILL.md"),
            "---\n---\n",
        );
        assert_eq!(skill_file("outer", Some(&cwd), Some(&config)), None);

        write(&repo.join(".claude/commands/deploy.md"), "");
        assert_eq!(
            skill_file("deploy", Some(&cwd), Some(&config)),
            Some(repo.join(".claude/commands/deploy.md"))
        );
        // A skill beats a command, the root's included.
        write(&repo.join(".claude/skills/deploy/SKILL.md"), "");
        assert_eq!(
            skill_file("deploy", Some(&cwd), Some(&config)),
            Some(repo.join(".claude/skills/deploy/SKILL.md"))
        );
        // The nearer folder's before the root's.
        write(&cwd.join(".claude/skills/deploy/SKILL.md"), "");
        assert_eq!(
            skill_file("deploy", Some(&cwd), Some(&config)),
            Some(cwd.join(".claude/skills/deploy/SKILL.md"))
        );
        // The user's before the project's.
        write(&config.join("skills/deploy/SKILL.md"), "");
        assert_eq!(
            skill_file("deploy", Some(&cwd), Some(&config)),
            Some(config.join("skills/deploy/SKILL.md"))
        );
        // A plugin's or a nested one's name is not a folder to look in.
        for name in ["codex:rescue", "apps/web:deploy", "..", "a\\b", ""] {
            assert_eq!(skill_file(name, Some(&cwd), Some(&config)), None, "{name}");
        }
    }

    #[test]
    fn a_file_decides_and_a_skill_without_one_forks_once_seen_forking() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path();
        write(
            &config.join("skills/research/SKILL.md"),
            "---\ncontext: fork\n---\nResearch $ARGUMENTS",
        );
        write(
            &config.join("skills/notes/SKILL.md"),
            "---\nname: notes\n---\n",
        );
        assert_eq!(
            decide("research", None, Some(config), |_| false),
            Some(Fork {
                name: "research".into(),
                file: Some(config.join("skills/research/SKILL.md")),
            })
        );
        // Its file says it runs inline: having forked once does not change that.
        assert_eq!(decide("notes", None, Some(config), |_| true), None);
        // Bundled: no file, known from having forked.
        assert_eq!(decide("code-review", None, Some(config), |_| false), None);
        assert_eq!(
            decide("code-review", None, Some(config), |name| name
                == "code-review"),
            Some(Fork {
                name: "code-review".into(),
                file: None,
            })
        );
    }

    #[test]
    fn learns_a_skill_from_a_post_tool_use_that_says_it_forked() {
        // As Claude Code wrote it for Batman's /code-review.
        let forked = json!({
            "hook_event_name": "PostToolUse",
            "tool_name": "Skill",
            "tool_input": { "skill": "code-review", "args": "601" },
            "tool_response": {
                "success": true, "commandName": "code-review", "status": "forked",
                "background": true, "agentId": "a8f099338fcba3436",
                "result": "Running in the background as @code-review"
            }
        });
        assert_eq!(forked_names(&forked), ["code-review"]);
        // As a PostToolUse hook was given it, for a fork that ran to its end (`claude -p`).
        let waited = json!({
            "hook_event_name": "PostToolUse",
            "tool_name": "Skill",
            "tool_input": { "skill": "probe" },
            "tool_response": {
                "success": true, "commandName": "probe", "status": "forked",
                "agentId": "a6586352ec5daf2a9", "result": "done"
            }
        });
        assert_eq!(forked_names(&waited), ["probe"]);
        let mut alias = forked.clone();
        alias["tool_input"]["skill"] = json!("/review");
        assert_eq!(forked_names(&alias), ["review", "code-review"]);
        let text = json!({
            "tool_name": "Skill",
            "tool_input": { "skill": "deep" },
            "tool_response": "Skill \"deep\" launched (forked execution, running in the background)."
        });
        assert_eq!(forked_names(&text), ["deep"]);
        // Inline, or another tool: nothing learned.
        let inline = json!({
            "tool_name": "Skill",
            "tool_input": { "skill": "run" },
            "tool_response": { "success": true, "commandName": "run" }
        });
        assert!(forked_names(&inline).is_empty());
        let mut other = forked.clone();
        other["tool_name"] = json!("Agent");
        assert!(forked_names(&other).is_empty());
    }

    #[test]
    fn keeps_what_it_saw_across_runs() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("forked-skills.json");
        let mut seen = Seen::load(file.clone());
        assert!(!seen.contains("code-review"));
        seen.learn("code-review");
        seen.learn("code-review");
        assert!(seen.contains("code-review"));
        let read: Vec<String> = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        assert_eq!(read, ["code-review"]);
        assert!(Seen::load(file.clone()).contains("code-review"));
        // A damaged file is an empty list, not a failure.
        std::fs::write(&file, "{").unwrap();
        assert!(!Seen::load(file).contains("code-review"));
    }

    #[test]
    fn finds_the_user_s_folder_from_the_transcript_a_sub_agent_s_too() {
        let main = json!({ "transcript_path": "C:/Users/u/.claude-work/projects/D--x/s1.jsonl" });
        assert_eq!(
            config_dir(&main),
            Some(PathBuf::from("C:/Users/u/.claude-work"))
        );
        let sub = json!({ "transcript_path": "C:/Users/u/.claude/projects/D--x/s1/subagents/agent-a1.jsonl" });
        assert_eq!(config_dir(&sub), Some(PathBuf::from("C:/Users/u/.claude")));
    }
}
