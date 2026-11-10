//! The skills, plugins, MCP servers and subagents a Claude terminal can use, as
//! its folder and its profile set them up, and one terminal's choice among
//! them, written into its `--settings` file:
//! - a skill off: `skillOverrides: { name: "off" }` (hidden from Claude; a
//!   plugin's skills follow their plugin);
//! - a plugin on or off: `enabledPlugins: { "name@marketplace": bool }`, which
//!   wins over the user's, project's and local settings;
//! - an MCP server off: `permissions.deny: ["mcp__<name>"]` (its tools are
//!   refused) and `disabledMcpjsonServers` (a project `.mcp.json` server is not
//!   started);
//! - a subagent off: `permissions.deny: ["Agent(<name>)"]`.
//!
//! dummyPlane's own MCP server is never listed and never turned off.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use super::claude_settings::config_dir_for;

/// dummyPlane's MCP server (`mcp_files::config_json`): the orchestration's tools.
const OWN_SERVER: &str = "dummyplane";
/// A description longer than this is cut: the panel shows one line of it.
const DESCRIPTION_MAX: usize = 300;

/// Where an item is set up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// The Claude folder: `~/.claude` or the profile's.
    User,
    /// The project's files: `.claude/` and `.mcp.json`.
    Project,
    /// The project's entry in `.claude.json`, on this machine only.
    Local,
    /// A plugin's MCP server or subagent: on only while its plugin is.
    Plugin,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionItem {
    /// What a choice names: a skill or subagent name, a plugin id, a server name.
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub source: Source,
    /// On without the terminal's choice: what the user's own settings give.
    pub enabled: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ClaudeExtensions {
    pub skills: Vec<ExtensionItem>,
    pub plugins: Vec<ExtensionItem>,
    pub mcp: Vec<ExtensionItem>,
    pub agents: Vec<ExtensionItem>,
}

/// One terminal's changes to the user's setup; empty changes nothing.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExtensionChoice {
    pub skills_off: Vec<String>,
    pub agents_off: Vec<String>,
    pub mcp_off: Vec<String>,
    pub plugins: BTreeMap<String, bool>,
}

/// The files a terminal's Claude reads its setup from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Places {
    pub cwd: PathBuf,
    /// The Claude folder: the profile's, `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
    pub config: PathBuf,
    /// `.claude.json`: in the Claude folder when one is set, else in the home folder.
    pub claude_json: PathBuf,
    /// Installed plugins: `$CLAUDE_CODE_PLUGIN_CACHE_DIR`, else `<config>/plugins`.
    pub plugins: PathBuf,
}

impl Places {
    /// The places of a terminal in `cwd`, with this profile folder (none: the default account).
    pub fn of(cwd: &Path, profile: Option<&Path>) -> Option<Places> {
        let config = config_dir_for(profile)?;
        let set = profile.is_some() || std::env::var_os("CLAUDE_CONFIG_DIR").is_some();
        let claude_json = if set {
            config.join(".claude.json")
        } else {
            let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
            PathBuf::from(home).join(".claude.json")
        };
        let plugins = std::env::var_os("CLAUDE_CODE_PLUGIN_CACHE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| config.join("plugins"));
        Some(Places {
            cwd: cwd.to_path_buf(),
            config,
            claude_json,
            plugins,
        })
    }

    /// User, project, then local settings: a later file wins.
    fn settings(&self) -> Vec<Value> {
        [
            self.config.join("settings.json"),
            self.cwd.join(".claude").join("settings.json"),
            self.cwd.join(".claude").join("settings.local.json"),
        ]
        .iter()
        .filter_map(|file| read_json(file))
        .collect()
    }
}

fn read_json(file: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(file).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

/// Everything a terminal with these places can use, each kind sorted by name.
pub fn list(places: &Places) -> ClaudeExtensions {
    let settings = places.settings();
    let claude_json = read_json(&places.claude_json).unwrap_or(Value::Null);
    let installed = installed_plugins(places, &settings);
    let mut found = ClaudeExtensions {
        skills: skills(places, &settings),
        plugins: plugins(&installed),
        mcp: mcp_servers(places, &settings, &claude_json, &installed),
        agents: agents(places, &settings, &installed),
    };
    for items in [
        &mut found.skills,
        &mut found.plugins,
        &mut found.mcp,
        &mut found.agents,
    ] {
        items.sort_by_key(|item| item.name.to_lowercase());
    }
    found
}

// ---------------------------------------------------------------- skills

fn skills(places: &Places, settings: &[Value]) -> Vec<ExtensionItem> {
    let overrides = merged_object(settings, "skillOverrides");
    let mut seen = BTreeSet::new();
    let mut items = Vec::new();
    // The user's skill wins over a project's of the same name.
    for (dir, source) in [
        (places.config.join("skills"), Source::User),
        (places.cwd.join(".claude").join("skills"), Source::Project),
    ] {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let folder = entry.path();
            let Ok(text) = std::fs::read_to_string(folder.join("SKILL.md")) else {
                continue;
            };
            let front = front_matter(&text);
            let fallback = entry.file_name().to_string_lossy().into_owned();
            let id = front.get("name").cloned().unwrap_or(fallback);
            if !seen.insert(id.clone()) {
                continue;
            }
            let enabled = overrides.get(&id).and_then(Value::as_str) != Some("off");
            items.push(ExtensionItem {
                name: id.clone(),
                id,
                description: front.get("description").map(|d| short(d)),
                source,
                enabled,
            });
        }
    }
    items
}

// ---------------------------------------------------------------- subagents

fn agents(places: &Places, settings: &[Value], plugins: &[Plugin]) -> Vec<ExtensionItem> {
    let denied = denied_rules(settings);
    let mut seen = BTreeSet::new();
    let mut items = Vec::new();
    // A project's subagent wins over the user's of the same name. A plugin's is
    // `<plugin>:<name>`, the name Claude lists it under, and is on only with its plugin.
    let mut folders: Vec<(PathBuf, Source, Option<&Plugin>)> = vec![
        (places.cwd.join(".claude").join("agents"), Source::Project, None),
        (places.config.join("agents"), Source::User, None),
    ];
    folders.extend(
        plugins
            .iter()
            .filter_map(|p| Some((p.root.as_ref()?.join("agents"), Source::Plugin, Some(p)))),
    );
    for (dir, source, plugin) in folders {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let file = entry.path();
            if file.extension().is_none_or(|ext| ext != "md") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&file) else {
                continue;
            };
            let front = front_matter(&text);
            let fallback = file
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let name = front.get("name").cloned().unwrap_or(fallback);
            let id = match plugin {
                Some(plugin) => format!("{}:{name}", plugin.name),
                None => name,
            };
            if id.is_empty() || !seen.insert(id.clone()) {
                continue;
            }
            let enabled = plugin.is_none_or(|p| p.enabled)
                && !denied.contains(&format!("Agent({id})"))
                && !denied.contains(&format!("Task({id})"));
            items.push(ExtensionItem {
                name: id.clone(),
                id,
                description: front.get("description").map(|d| short(d)),
                source,
                enabled,
            });
        }
    }
    items
}

// ---------------------------------------------------------------- plugins

/// A plugin installed for the user or for this project.
struct Plugin {
    /// `name@marketplace`.
    id: String,
    /// The name its skills, subagents and MCP tools carry (`stripe`).
    name: String,
    /// Its install folder (`${CLAUDE_PLUGIN_ROOT}`), when the record names one.
    root: Option<PathBuf>,
    /// Its manifest, `.claude-plugin/plugin.json`.
    manifest: Option<Value>,
    source: Source,
    /// On in the user's, project's or local settings.
    enabled: bool,
}

fn installed_plugins(places: &Places, settings: &[Value]) -> Vec<Plugin> {
    let Some(installed) = read_json(&places.plugins.join("installed_plugins.json")) else {
        return Vec::new();
    };
    let enabled = merged_object(settings, "enabledPlugins");
    let Some(records) = installed.get("plugins").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for (id, record) in records {
        // Version 2 keeps a list of installs per plugin, version 1 one install.
        let installs: Vec<&Value> = match record {
            Value::Array(list) => list.iter().collect(),
            other => vec![other],
        };
        let Some(install) = installs.iter().find(|i| applies(i, &places.cwd)) else {
            continue;
        };
        let source = match install.get("scope").and_then(Value::as_str) {
            Some("project") => Source::Project,
            Some("local") => Source::Local,
            _ => Source::User,
        };
        let root = install.get("installPath").and_then(Value::as_str).map(PathBuf::from);
        let manifest = root
            .as_ref()
            .and_then(|root| read_json(&root.join(".claude-plugin").join("plugin.json")));
        let name = manifest
            .as_ref()
            .and_then(|m| m.get("name")?.as_str().map(String::from))
            .unwrap_or_else(|| id.split('@').next().unwrap_or(id).to_string());
        found.push(Plugin {
            id: id.clone(),
            name,
            root,
            manifest,
            source,
            enabled: enabled.get(id).and_then(Value::as_bool).unwrap_or(false),
        });
    }
    found
}

fn plugins(plugins: &[Plugin]) -> Vec<ExtensionItem> {
    plugins
        .iter()
        .map(|plugin| ExtensionItem {
            id: plugin.id.clone(),
            name: plugin.name.clone(),
            description: plugin
                .manifest
                .as_ref()
                .and_then(|m| m.get("description")?.as_str().map(short)),
            source: plugin.source,
            enabled: plugin.enabled,
        })
        .collect()
}

/// A plugin's MCP servers: its `.mcp.json`, or the manifest's `mcpServers`
/// (inline, or the path of a file in the plugin).
fn plugin_servers(plugin: &Plugin) -> Map<String, Value> {
    let Some(root) = &plugin.root else {
        return Map::new();
    };
    let from_file = |file: &Path| {
        read_json(file)
            .and_then(|v| v.get("mcpServers").and_then(Value::as_object).cloned())
            .unwrap_or_default()
    };
    let mut servers = from_file(&root.join(".mcp.json"));
    match plugin.manifest.as_ref().and_then(|m| m.get("mcpServers")) {
        Some(Value::Object(inline)) => servers.extend(inline.clone()),
        Some(Value::String(file)) => servers.extend(from_file(&root.join(file))),
        _ => {}
    }
    servers
}

/// An install counts for a terminal when it is the user's, or its project's.
fn applies(install: &Value, cwd: &Path) -> bool {
    match install.get("scope").and_then(Value::as_str) {
        Some("user") | Some("managed") | None => true,
        Some(_) => install
            .get("projectPath")
            .and_then(Value::as_str)
            .is_some_and(|project| same_path(Path::new(project), cwd)),
    }
}

// ---------------------------------------------------------------- MCP servers

fn mcp_servers(
    places: &Places,
    settings: &[Value],
    claude_json: &Value,
    plugins: &[Plugin],
) -> Vec<ExtensionItem> {
    let project_entry = claude_json
        .get("projects")
        .and_then(Value::as_object)
        .and_then(|projects| {
            projects
                .iter()
                .find(|(path, _)| same_path(Path::new(path), &places.cwd))
                .map(|(_, entry)| entry)
        });
    let entry_list = |key: &str| -> BTreeSet<String> {
        project_entry
            .and_then(|e| e.get(key))
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
            .unwrap_or_default()
    };
    let switched_off = entry_list("disabledMcpServers");
    let mut rejected = entry_list("disabledMcpjsonServers");
    rejected.extend(merged_list(settings, "disabledMcpjsonServers"));
    let mut approved = entry_list("enabledMcpjsonServers");
    approved.extend(merged_list(settings, "enabledMcpjsonServers"));
    let approve_all = settings
        .iter()
        .rev()
        .find_map(|s| s.get("enableAllProjectMcpServers")?.as_bool())
        .unwrap_or(false);

    let project_file = read_json(&places.cwd.join(".mcp.json"));
    let scopes: [(Option<&Value>, Source); 3] = [
        (project_entry.and_then(|e| e.get("mcpServers")), Source::Local),
        (project_file.as_ref().and_then(|f| f.get("mcpServers")), Source::Project),
        (claude_json.get("mcpServers"), Source::User),
    ];
    // Local wins over project, project over user: one server per name.
    let mut seen = BTreeSet::new();
    let mut items = Vec::new();
    for (servers, source) in scopes {
        let Some(servers) = servers.and_then(Value::as_object) else {
            continue;
        };
        for (name, server) in servers {
            if name.eq_ignore_ascii_case(OWN_SERVER) || !seen.insert(name.clone()) {
                continue;
            }
            let enabled = !switched_off.contains(name)
                && (source != Source::Project
                    || (!rejected.contains(name) && (approve_all || approved.contains(name))));
            items.push(ExtensionItem {
                id: name.clone(),
                name: name.clone(),
                description: Some(server_summary(server)),
                source,
                enabled,
            });
        }
    }
    // A plugin's server: its tools are `mcp__plugin_<plugin>_<server>__…`, so
    // that prefix is its id, the name a deny rule takes; on only with its plugin.
    for plugin in plugins {
        for (name, server) in plugin_servers(plugin) {
            let id = format!("{PLUGIN_SERVER}{}_{name}", plugin.name);
            if !seen.insert(id.clone()) {
                continue;
            }
            let enabled = plugin.enabled
                && !switched_off.contains(&id)
                && !switched_off.contains(&format!("plugin:{}:{name}", plugin.name));
            items.push(ExtensionItem {
                id,
                name,
                description: Some(format!("{} · {}", plugin.name, server_summary(&server))),
                source: Source::Plugin,
                enabled,
            });
        }
    }
    items
}

/// What a plugin's MCP server id starts with: `plugin_<plugin>_<server>`.
const PLUGIN_SERVER: &str = "plugin_";

/// "http · mcp.stripe.com" or "stdio · npx": how it runs, without its arguments,
/// headers, environment or query string (they can hold secrets).
fn server_summary(server: &Value) -> String {
    let url = server.get("url").and_then(Value::as_str);
    let kind = server
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or(if url.is_some() { "http" } else { "stdio" });
    let target = match url {
        Some(url) => url
            .split_once("://")
            .map_or(url, |(_, rest)| rest)
            .split(['/', '?', '#'])
            .next()
            .unwrap_or_default()
            .rsplit('@')
            .next()
            .unwrap_or_default()
            .to_string(),
        None => server
            .get("command")
            .and_then(Value::as_str)
            .map(|command| command.rsplit(['/', '\\']).next().unwrap_or(command).to_string())
            .unwrap_or_default(),
    };
    if target.is_empty() {
        kind.to_string()
    } else {
        format!("{kind} · {target}")
    }
}

// ---------------------------------------------------------------- the choice in --settings

/// The settings a choice adds, `None` when it changes nothing. The user's own
/// skill overrides are carried over, in case flag settings replace the object.
pub fn settings_patch(choice: &ExtensionChoice, places: &Places) -> Option<Value> {
    let mut patch = Map::new();

    let plugins: Map<String, Value> = choice
        .plugins
        .iter()
        .filter(|(id, _)| valid_name(id))
        .map(|(id, on)| (id.clone(), Value::Bool(*on)))
        .collect();
    if !plugins.is_empty() {
        patch.insert("enabledPlugins".into(), Value::Object(plugins));
    }

    let skills: Vec<&String> = choice.skills_off.iter().filter(|n| valid_name(n)).collect();
    if !skills.is_empty() {
        let mut overrides = merged_object(&places.settings(), "skillOverrides");
        for name in skills {
            overrides.insert(name.clone(), json!("off"));
        }
        patch.insert("skillOverrides".into(), Value::Object(overrides));
    }

    let servers: Vec<&String> = choice
        .mcp_off
        .iter()
        .filter(|n| valid_name(n) && !n.eq_ignore_ascii_case(OWN_SERVER))
        .collect();
    let mut deny: Vec<Value> = servers
        .iter()
        .map(|name| json!(format!("mcp__{}", tool_prefix(name))))
        .collect();
    deny.extend(
        choice
            .agents_off
            .iter()
            .filter(|n| valid_name(n) && !n.contains(['(', ')']))
            .map(|name| json!(format!("Agent({name})"))),
    );
    if !deny.is_empty() {
        patch.insert("permissions".into(), json!({ "deny": deny }));
    }
    // Only a project's `.mcp.json` servers can be kept from starting; a plugin's are denied above.
    let project_servers: Vec<&&String> = servers
        .iter()
        .filter(|n| !n.starts_with(PLUGIN_SERVER))
        .collect();
    if !project_servers.is_empty() {
        patch.insert("disabledMcpjsonServers".into(), json!(project_servers));
    }

    (!patch.is_empty()).then_some(Value::Object(patch))
}

/// Adds a patch to dummyPlane's settings: objects key by key, lists appended,
/// so dummyPlane's own permissions and hooks stay.
pub fn apply(settings: &mut Value, patch: &Value) {
    let Some(patch) = patch.as_object() else {
        return;
    };
    for (key, value) in patch {
        match (key.as_str(), value) {
            ("permissions", Value::Object(rules)) => {
                for (kind, list) in rules {
                    let mut kept = settings["permissions"][kind]
                        .as_array()
                        .cloned()
                        .unwrap_or_default();
                    kept.extend(list.as_array().cloned().unwrap_or_default());
                    settings["permissions"][kind] = Value::Array(kept);
                }
            }
            (_, Value::Object(entries)) => {
                for (name, entry) in entries {
                    settings[key][name] = entry.clone();
                }
            }
            (_, Value::Array(list)) => {
                let mut kept = settings[key].as_array().cloned().unwrap_or_default();
                kept.extend(list.iter().cloned());
                settings[key] = Value::Array(kept);
            }
            _ => settings[key] = value.clone(),
        }
    }
}

/// A name that can go into a settings file and a permission rule.
fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.len() <= 200 && !name.chars().any(char::is_control)
}

/// An MCP server's name as its tools carry it: `mcp__<name>__<tool>`.
fn tool_prefix(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

// ---------------------------------------------------------------- helpers

/// An object setting across the files, a later file's keys winning.
fn merged_object(settings: &[Value], key: &str) -> Map<String, Value> {
    let mut merged = Map::new();
    for file in settings {
        if let Some(object) = file.get(key).and_then(Value::as_object) {
            merged.extend(object.clone());
        }
    }
    merged
}

/// A list setting across the files: lists add up.
fn merged_list(settings: &[Value], key: &str) -> BTreeSet<String> {
    settings
        .iter()
        .filter_map(|file| file.get(key)?.as_array())
        .flatten()
        .filter_map(Value::as_str)
        .map(String::from)
        .collect()
}

fn denied_rules(settings: &[Value]) -> BTreeSet<String> {
    settings
        .iter()
        .filter_map(|file| file.get("permissions")?.get("deny")?.as_array())
        .flatten()
        .filter_map(Value::as_str)
        .map(|rule| rule.trim().to_string())
        .collect()
}

/// The same folder, whatever the separators, a trailing one or (on Windows) the case.
fn same_path(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        let text = p.to_string_lossy().replace('\\', "/");
        let text = text.trim_end_matches('/').to_string();
        if cfg!(windows) { text.to_lowercase() } else { text }
    };
    norm(a) == norm(b)
}

fn short(text: &str) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= DESCRIPTION_MAX {
        return line;
    }
    let cut: String = line.chars().take(DESCRIPTION_MAX - 1).collect();
    format!("{}…", cut.trim_end())
}

/// `name` and `description` of a Markdown file's front matter. Enough YAML for
/// skills and agents: `key: value`, quoted values, and `>`/`|` blocks.
fn front_matter(text: &str) -> BTreeMap<String, String> {
    let mut fields = BTreeMap::new();
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return fields;
    }
    let body: Vec<&str> = lines.take_while(|line| line.trim_end() != "---").collect();
    let mut i = 0;
    while i < body.len() {
        let line = body[i];
        i += 1;
        if line.starts_with([' ', '\t']) {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        if key != "name" && key != "description" {
            continue;
        }
        let value = value.trim();
        let value = if value.is_empty() || value.starts_with(['>', '|']) {
            let mut block = Vec::new();
            while i < body.len() && (body[i].starts_with([' ', '\t']) || body[i].trim().is_empty()) {
                block.push(body[i].trim());
                i += 1;
            }
            block.join(" ").trim().to_string()
        } else {
            unquote(value)
        };
        if !value.is_empty() {
            fields.insert(key.to_string(), value);
        }
    }
    fields
}

fn unquote(value: &str) -> String {
    for quote in ['"', '\''] {
        if value.len() >= 2 && value.starts_with(quote) && value.ends_with(quote) {
            return value[1..value.len() - 1].to_string();
        }
    }
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        _root: tempfile::TempDir,
        places: Places,
    }

    fn fixture() -> Fixture {
        let root = tempfile::tempdir().unwrap();
        let cwd = root.path().join("project");
        let config = root.path().join("claude");
        std::fs::create_dir_all(&cwd).unwrap();
        std::fs::create_dir_all(&config).unwrap();
        let places = Places {
            claude_json: root.path().join(".claude.json"),
            plugins: config.join("plugins"),
            cwd,
            config,
        };
        Fixture { _root: root, places }
    }

    fn put(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn put_json(path: &Path, value: Value) {
        put(path, &serde_json::to_string_pretty(&value).unwrap());
    }

    fn ids(items: &[ExtensionItem]) -> Vec<(&str, bool)> {
        items.iter().map(|i| (i.id.as_str(), i.enabled)).collect()
    }

    #[test]
    fn reads_name_and_description_from_front_matter() {
        let fields = front_matter(
            "---\nname: \"deploy\"\ndescription: >\n  Ships the app\n  to production.\nallowed-tools: Bash\n---\n# Body",
        );
        assert_eq!(fields.get("name").map(String::as_str), Some("deploy"));
        assert_eq!(
            fields.get("description").map(String::as_str),
            Some("Ships the app to production.")
        );
        assert!(front_matter("# no front matter").is_empty());
    }

    #[test]
    fn lists_user_and_project_skills_with_the_settings_overrides() {
        let f = fixture();
        let p = &f.places;
        put(&p.config.join("skills/deploy/SKILL.md"), "---\nname: deploy\ndescription: Ships it\n---\n");
        put(&p.config.join("skills/notes/SKILL.md"), "---\ndescription: Takes notes\n---\n");
        // A folder without SKILL.md (a plugin folder, a stray file) is not a skill.
        put(&p.config.join("skills/stray/README.md"), "x");
        put(&p.cwd.join(".claude/skills/lint/SKILL.md"), "---\nname: lint\n---\n");
        put(&p.cwd.join(".claude/skills/deploy/SKILL.md"), "---\nname: deploy\n---\n");
        put_json(&p.cwd.join(".claude/settings.local.json"), json!({ "skillOverrides": { "notes": "off" } }));

        let skills = list(p).skills;
        assert_eq!(ids(&skills), vec![("deploy", true), ("lint", true), ("notes", false)]);
        assert_eq!(skills[0].source, Source::User);
        assert_eq!(skills[0].description.as_deref(), Some("Ships it"));
        assert_eq!(skills[1].source, Source::Project);
    }

    #[test]
    fn lists_subagents_and_sees_the_ones_already_denied() {
        let f = fixture();
        let p = &f.places;
        put(&p.config.join("agents/reviewer.md"), "---\nname: code-reviewer\ndescription: Reviews\n---\n");
        put(&p.cwd.join(".claude/agents/tester.md"), "---\nname: tester\n---\n");
        put(&p.cwd.join(".claude/agents/notes.txt"), "not an agent");
        put_json(&p.config.join("settings.json"), json!({ "permissions": { "deny": ["Agent(tester)"] } }));

        assert_eq!(ids(&list(p).agents), vec![("code-reviewer", true), ("tester", false)]);
    }

    #[test]
    fn lists_the_plugins_installed_for_the_user_or_this_project() {
        let f = fixture();
        let p = &f.places;
        let other = p.cwd.parent().unwrap().join("elsewhere");
        let codex_root = p.plugins.join("cache/openai/codex/1.0.0");
        put_json(&codex_root.join(".claude-plugin/plugin.json"), json!({ "description": "Codex from Claude" }));
        put_json(
            &p.plugins.join("installed_plugins.json"),
            json!({ "version": 2, "plugins": {
                "codex@openai": [{ "scope": "user", "installPath": codex_root.to_string_lossy() }],
                "here@market": [{ "scope": "project", "projectPath": p.cwd.to_string_lossy(), "installPath": "x" }],
                "there@market": [{ "scope": "project", "projectPath": other.to_string_lossy(), "installPath": "x" }],
            } }),
        );
        put_json(&p.config.join("settings.json"), json!({ "enabledPlugins": { "codex@openai": true, "here@market": true } }));
        put_json(&p.cwd.join(".claude/settings.json"), json!({ "enabledPlugins": { "here@market": false } }));

        let plugins = list(p).plugins;
        assert_eq!(ids(&plugins), vec![("codex@openai", true), ("here@market", false)]);
        assert_eq!(plugins[0].name, "codex");
        assert_eq!(plugins[0].description.as_deref(), Some("Codex from Claude"));
        assert_eq!(plugins[1].source, Source::Project);
    }

    #[test]
    fn lists_a_plugin_s_mcp_servers_and_subagents_under_the_names_claude_gives_them() {
        let f = fixture();
        let p = &f.places;
        let on = p.plugins.join("cache/m/stripe/1.0.0");
        let off = p.plugins.join("cache/m/figma/1.0.0");
        put_json(&on.join(".claude-plugin/plugin.json"), json!({ "name": "stripe" }));
        put_json(&on.join(".mcp.json"), json!({ "mcpServers": { "stripe": { "type": "http", "url": "https://mcp.stripe.com" } } }));
        put(&on.join("agents/research.md"), "---\nname: Company Researcher\ndescription: Researches\n---\n");
        put_json(&off.join(".claude-plugin/plugin.json"), json!({ "name": "figma", "mcpServers": { "figma": { "command": "npx" } } }));
        put_json(
            &p.plugins.join("installed_plugins.json"),
            json!({ "version": 2, "plugins": {
                "stripe@m": [{ "scope": "user", "installPath": on.to_string_lossy() }],
                "figma@m": [{ "scope": "user", "installPath": off.to_string_lossy() }],
            } }),
        );
        put_json(&p.config.join("settings.json"), json!({ "enabledPlugins": { "stripe@m": true } }));

        let found = list(p);
        // A plugin that is off leaves its server off.
        assert_eq!(ids(&found.mcp), vec![("plugin_figma_figma", false), ("plugin_stripe_stripe", true)]);
        assert_eq!(found.mcp[1].name, "stripe");
        assert_eq!(found.mcp[1].source, Source::Plugin);
        assert_eq!(found.mcp[1].description.as_deref(), Some("stripe · http · mcp.stripe.com"));
        assert_eq!(ids(&found.agents), vec![("stripe:Company Researcher", true)]);

        // Turned off, a plugin's server is denied by its tools' prefix and never put in `.mcp.json`'s list.
        let choice = ExtensionChoice {
            mcp_off: vec!["plugin_stripe_stripe".into()],
            agents_off: vec!["stripe:Company Researcher".into()],
            ..Default::default()
        };
        let patch = settings_patch(&choice, p).unwrap();
        assert_eq!(
            patch["permissions"]["deny"],
            json!(["mcp__plugin_stripe_stripe", "Agent(stripe:Company Researcher)"])
        );
        assert!(patch.get("disabledMcpjsonServers").is_none());
    }

    #[test]
    fn lists_mcp_servers_of_every_scope_but_dummyplane_s_own() {
        let f = fixture();
        let p = &f.places;
        // `.claude.json` keys projects with forward slashes.
        let mut projects = Map::new();
        projects.insert(
            p.cwd.to_string_lossy().replace('\\', "/"),
            json!({
                "mcpServers": { "db": { "command": "C:\\tools\\pg-mcp.exe", "args": ["--password", "secret"] } },
                "disabledMcpServers": ["github"],
                "enabledMcpjsonServers": ["docs"],
            }),
        );
        put_json(
            &p.claude_json,
            json!({
                "mcpServers": {
                    "github": { "type": "http", "url": "https://user:secret@api.github.com/mcp?token=abc" },
                    "dummyplane": { "type": "http", "url": "http://127.0.0.1:1/mcp" },
                },
                "projects": projects,
            }),
        );
        put_json(
            &p.cwd.join(".mcp.json"),
            json!({ "mcpServers": { "docs": { "command": "npx" }, "pending": { "command": "npx" } } }),
        );

        let mcp = list(p).mcp;
        assert_eq!(
            ids(&mcp),
            vec![("db", true), ("docs", true), ("github", false), ("pending", false)]
        );
        assert_eq!(mcp[0].source, Source::Local);
        assert_eq!(mcp[0].description.as_deref(), Some("stdio · pg-mcp.exe"));
        // No credentials, path or query string reach the interface.
        assert_eq!(mcp[2].description.as_deref(), Some("http · api.github.com"));
    }

    #[test]
    fn an_empty_choice_changes_nothing() {
        let f = fixture();
        assert_eq!(settings_patch(&ExtensionChoice::default(), &f.places), None);
    }

    #[test]
    fn a_choice_becomes_settings_and_keeps_dummyplane_on() {
        let f = fixture();
        put_json(&f.places.config.join("settings.json"), json!({ "skillOverrides": { "old": "name-only" } }));
        let choice = ExtensionChoice {
            skills_off: vec!["deploy".into()],
            agents_off: vec!["tester".into(), "bad)name".into()],
            mcp_off: vec!["github".into(), "DummyPlane".into(), "my server".into()],
            plugins: BTreeMap::from([("codex@openai".into(), false), ("here@market".into(), true)]),
        };
        let patch = settings_patch(&choice, &f.places).unwrap();
        assert_eq!(patch["enabledPlugins"], json!({ "codex@openai": false, "here@market": true }));
        assert_eq!(patch["skillOverrides"], json!({ "old": "name-only", "deploy": "off" }));
        assert_eq!(
            patch["permissions"]["deny"],
            json!(["mcp__github", "mcp__my_server", "Agent(tester)"])
        );
        assert_eq!(patch["disabledMcpjsonServers"], json!(["github", "my server"]));
    }

    #[test]
    fn applying_a_patch_keeps_dummyplane_s_own_rules() {
        let mut settings = json!({
            "hooks": { "Stop": [] },
            "permissions": { "allow": ["mcp__dummyplane"], "deny": ["Bash"] },
        });
        apply(
            &mut settings,
            &json!({
                "permissions": { "deny": ["mcp__github"] },
                "enabledPlugins": { "codex@openai": false },
                "disabledMcpjsonServers": ["github"],
            }),
        );
        assert_eq!(settings["permissions"]["allow"], json!(["mcp__dummyplane"]));
        assert_eq!(settings["permissions"]["deny"], json!(["Bash", "mcp__github"]));
        assert_eq!(settings["enabledPlugins"], json!({ "codex@openai": false }));
        assert_eq!(settings["disabledMcpjsonServers"], json!(["github"]));
        assert_eq!(settings["hooks"], json!({ "Stop": [] }));
    }

    #[test]
    fn reads_the_stored_choice_from_the_interface() {
        let choice: ExtensionChoice =
            serde_json::from_value(json!({ "skillsOff": ["a"], "plugins": { "p@m": true } })).unwrap();
        assert_eq!(choice.skills_off, vec!["a".to_string()]);
        assert!(choice.mcp_off.is_empty());
        assert_eq!(choice.plugins.get("p@m"), Some(&true));
    }

    #[test]
    fn compares_project_paths_whatever_the_separators() {
        assert!(same_path(Path::new("D:/Projects/app/"), Path::new("D:\\Projects\\app")));
        assert!(!same_path(Path::new("D:/Projects/app"), Path::new("D:/Projects/other")));
    }
}

