//! What a parent agent picks for the sub-agent it opens with spawn_agent: the
//! skills, MCP servers and plugins the sub-agent gets, among those its CLI loads
//! in its folder (`Installed`). A kind left out of the pick keeps the CLI's
//! defaults, untouched; an empty list keeps none of that kind's optional items.
//! A plugin's own skills and MCP servers come with it: they follow the plugins
//! pick and are never picked alone. dummyPlane's own MCP server is never
//! optional. Every name is checked here against what the CLI lists, before a
//! terminal opens (`check`) and again at each launch (`for_claude`,
//! `for_codex`): only names the CLI gave reach a settings file or a command line.
//!
//! Claude (checked on Claude Code 2.1.323), in the session's `--settings` file
//! and on its line:
//! - skills: `skillOverrides`, each listed skill "on" or "off";
//! - plugins: `enabledPlugins`, each installed plugin true or false;
//! - MCP servers: `--strict-mcp-config`, as a fleet's, its `--mcp-config` file
//!   holding dummyPlane's server, the picked ones and the servers of the plugins
//!   it keeps (`extensions::servers_picked`); Claude in Chrome by `--chrome` or
//!   `--no-chrome`. A claude.ai connector, which no file lists, is left out.
//!
//! Codex (checked on Codex 0.167), on its command line, which a project's own
//! config cannot outrank (`codex_profile::cli_args`):
//! - skills: `-c skills.config=[{name='…',enabled=false},…]`, added to the
//!   user's own entries, a later entry winning;
//! - plugins: `-c plugins.<id>.enabled=…`;
//! - MCP servers: `-c mcp_servers.<name>.enabled=false`, for a server the
//!   user's or the project's config defines. A plugin's server, or Codex's app
//!   server, cannot be switched there (Codex then refuses to start: "invalid
//!   transport"): it follows its plugin.
//!
//! A pick may switch on what the user's settings leave off: a skill, a plugin (and
//! its servers), an MCP server. Never a project's MCP server the user has not
//! approved (Claude asks first, Codex only loads a trusted project's): only the
//! user lets a repository's own server run, so no agent can enable one for it.

use std::collections::{BTreeSet, HashMap};
use std::io;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use super::extensions::{self, ExtensionChoice, Fixed, Places, Source};
use crate::process::{hide_window, output_within};

/// dummyPlane's own MCP server: every sub-agent keeps it.
const OWN_SERVER: &str = "dummyplane";
/// Claude Code's Chrome server, switched by `--chrome` / `--no-chrome`.
const CHROME_SERVER: &str = "claude-in-chrome";
/// What the tool shows of a description: one line.
const DESCRIPTION_MAX: usize = 200;

/// A sub-agent's pick, by kind. `None`: the CLI's defaults for that kind.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Pick {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugins: Option<Vec<String>>,
    /// The most it may get, kind by kind: what its spawner has (`ceiling_of`), set by the check and read again at
    /// every launch (`within`). Never the caller's to give.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ceiling: Option<Ceiling>,
}

impl Pick {
    /// No kind picked: the launch is today's, byte for byte.
    pub fn is_empty(&self) -> bool {
        self.skills.is_none() && self.mcp_servers.is_none() && self.plugins.is_none()
    }
}

/// What a sub-agent's spawner has, kind by kind, as far as that is less than what its CLI lists. `None` for a
/// kind: no cap on it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Ceiling {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugins: Option<Vec<String>>,
}

/// The spawner of a sub-agent, as far as it is restricted: its own pick, and the switches it has set off in its
/// edit panel (Claude). Neither: nothing restricts it, and what it can give is whatever its CLI lists.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Spawner {
    pub extras: Option<Pick>,
    pub extensions: Option<ExtensionChoice>,
}

/// The most a sub-agent of `spawner` may get of the kinds `kinds` names: what the spawner has. A spawner restricted
/// at all (its own pick, or a switch it set off) has, of each kind, its pick or else what its CLI gives by default (the
/// items that are on) less the switches it set off, and what the user switched on for it in its panel (a plugin).
/// None at all (`None`) for a spawner nothing restricts, whose sub-agent may get whatever its CLI lists.
pub fn ceiling_of(spawner: &Spawner, installed: &Installed, kinds: Kinds) -> Option<Ceiling> {
    let own = spawner.extras.as_ref();
    let choice = spawner.extensions.as_ref();
    // Restricted at all: its own pick, or a switch it has off. A spawner nothing restricts may give anything.
    let restricted = own.is_some_and(|p| !p.is_empty())
        || choice.is_some_and(|c| {
            !c.skills_off.is_empty()
                || !c.agents_off.is_empty()
                || !c.mcp_off.is_empty()
                || c.plugins.values().any(|on| !on)
        });
    if !restricted {
        return None;
    }
    let bound = |named: bool,
                 picked: Option<&Vec<String>>,
                 listed: &[Extra],
                 off: BTreeSet<String>,
                 on: BTreeSet<String>| {
        if !named {
            return None;
        }
        // No pick on this kind: what it has by default, the items on, not the ones its settings leave off.
        let mut names: BTreeSet<String> = match picked {
            Some(picked) => picked.iter().cloned().collect(),
            None => listed
                .iter()
                .filter(|item| item.pickable() && item.on)
                .map(|item| item.name.clone())
                .collect(),
        };
        names.extend(on);
        for name in &off {
            names.remove(name);
        }
        Some(names.into_iter().collect::<Vec<String>>())
    };
    let plugins = |wanted: bool| -> BTreeSet<String> {
        choice
            .map(|c| {
                c.plugins
                    .iter()
                    .filter(|(_, on)| **on == wanted)
                    .map(|(id, _)| id.clone())
                    .collect()
            })
            .unwrap_or_default()
    };
    let ceiling = Ceiling {
        skills: bound(
            kinds.skills,
            own.and_then(|p| p.skills.as_ref()),
            &installed.skills,
            choice
                .map(|c| c.skills_off.iter().cloned().collect())
                .unwrap_or_default(),
            BTreeSet::new(),
        ),
        mcp_servers: bound(
            kinds.mcp_servers,
            own.and_then(|p| p.mcp_servers.as_ref()),
            &installed.mcp_servers,
            choice
                .map(|c| c.mcp_off.iter().cloned().collect())
                .unwrap_or_default(),
            BTreeSet::new(),
        ),
        plugins: bound(
            kinds.plugins,
            own.and_then(|p| p.plugins.as_ref()),
            &installed.plugins,
            plugins(false),
            plugins(true),
        ),
    };
    (ceiling != Ceiling::default()).then_some(ceiling)
}

/// A pick within the ceiling its spawner had, as the launch reads it again: refused when it names more, whatever
/// the check said then. A name the sub-agent's own panel switched off is not one it gets.
pub fn within(pick: &Pick, choice: Option<&ExtensionChoice>) -> Result<(), String> {
    let Some(ceiling) = &pick.ceiling else {
        return Ok(());
    };
    let switched_off = |kind: &str, name: &str| {
        choice.is_some_and(|c| match kind {
            "skill" => c.skills_off.iter().any(|n| n == name),
            "MCP server" => c.mcp_off.iter().any(|n| n == name),
            _ => c.plugins.get(name) == Some(&false),
        })
    };
    let mut beyond = Vec::new();
    for (kind, names, bound) in [
        ("skill", &pick.skills, &ceiling.skills),
        ("MCP server", &pick.mcp_servers, &ceiling.mcp_servers),
        ("plugin", &pick.plugins, &ceiling.plugins),
    ] {
        let (Some(names), Some(bound)) = (names, bound) else {
            continue;
        };
        for name in names {
            if !bound.contains(name) && !switched_off(kind, name) {
                beyond.push(format!("the {kind} {}", clip(name)));
            }
        }
    }
    if beyond.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "{} is beyond what its spawner has: a sub-agent gets at most what its spawner has",
            beyond.join(", ")
        ))
    }
}

/// A pick checked (`check`) for a sub-agent of `spawner`, its ceiling that spawner's own: the one a caller brings
/// is replaced.
pub fn check_for(
    pick: &Pick,
    installed: &Installed,
    cli: &str,
    spawner: &Spawner,
) -> Result<Pick, String> {
    let mut input = pick.clone();
    input.ceiling = ceiling_of(spawner, installed, Kinds::of(pick));
    check(&input, installed, cli)
}

/// Why a listed item cannot be picked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Locked {
    /// dummyPlane's own MCP server: always on.
    Own,
    /// A plugin's skill or MCP server (on Codex, an app's server too): it comes with its plugin.
    Plugin,
    /// A project's MCP server the user has not approved (or rejected): only the user lets it run.
    Approval,
    /// A name Codex's command line cannot carry: it is neither picked nor turned off.
    Name,
}

/// One skill, MCP server or plugin a sub-agent can be given.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Extra {
    /// What a pick names.
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// On when the pick leaves its kind out: what the CLI gives by default.
    pub on: bool,
    /// The plugin it comes with (`name@marketplace`), when the CLI says which.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked: Option<Locked>,
}

impl Extra {
    fn new(name: String, description: Option<String>, on: bool) -> Self {
        Extra {
            name,
            description: description.map(|d| short(&d)),
            on,
            plugin: None,
            locked: None,
        }
    }

    fn locked(mut self, why: Locked) -> Self {
        self.locked = Some(why);
        self
    }

    fn pickable(&self) -> bool {
        self.locked.is_none()
    }
}

/// What a sub-agent's CLI loads in its folder, by kind, each sorted by name.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub skills: Vec<Extra>,
    pub mcp_servers: Vec<Extra>,
    pub plugins: Vec<Extra>,
}

/// The kinds a listing reads: Codex answers each with a command of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Kinds {
    pub skills: bool,
    pub mcp_servers: bool,
    pub plugins: bool,
}

impl Kinds {
    pub const ALL: Kinds = Kinds {
        skills: true,
        mcp_servers: true,
        plugins: true,
    };

    /// The kinds a pick names.
    pub fn of(pick: &Pick) -> Kinds {
        Kinds {
            skills: pick.skills.is_some(),
            mcp_servers: pick.mcp_servers.is_some(),
            plugins: pick.plugins.is_some(),
        }
    }
}

/// `text` without its control characters.
fn plain(text: &str) -> String {
    text.chars().filter(|c| !c.is_control()).collect()
}

fn short(text: &str) -> String {
    let line = plain(&text.split_whitespace().collect::<Vec<_>>().join(" "));
    if line.chars().count() <= DESCRIPTION_MAX {
        return line;
    }
    let cut: String = line.chars().take(DESCRIPTION_MAX - 1).collect();
    format!("{}…", cut.trim_end())
}

/// A name comes from disk (a skill's, a server's key, a plugin's) and reaches the spawner's context in a listing, a
/// line a newline would end and another begin: it is shown without control characters, and one that had any cannot
/// be picked (it is no name the CLI would find again).
fn sorted(mut items: Vec<Extra>) -> Vec<Extra> {
    for item in &mut items {
        if item.name.chars().any(char::is_control) {
            item.name = plain(&item.name);
            item.locked.get_or_insert(Locked::Name);
        }
        if let Some(plugin) = &mut item.plugin {
            *plugin = plain(plugin);
        }
    }
    items.sort_by_key(|item| item.name.to_lowercase());
    items
}

// ---------------------------------------------------------------- Claude

/// What a Claude sub-agent in these places can be given: its panel's lists
/// (`extensions::list`), a plugin's skills and servers marked as its plugin's.
pub fn claude_installed(places: &Places) -> Installed {
    let found = extensions::list(places);
    let skills = found
        .skills
        .into_iter()
        .map(|item| {
            let plugin = item.plugin.clone();
            let extra = Extra::new(item.id, item.description, item.enabled);
            match item.fixed {
                Some(Fixed::Plugin) => Extra { plugin, ..extra }.locked(Locked::Plugin),
                _ => extra,
            }
        })
        .collect();
    let mcp_servers = found
        .mcp
        .into_iter()
        .map(|item| {
            let plugin = item.plugin.clone();
            let awaiting = item.awaiting_approval;
            let extra = Extra::new(item.id, item.description, item.enabled);
            match (item.fixed, item.source) {
                (Some(Fixed::Own), _) => extra.locked(Locked::Own),
                (_, Source::Plugin) => Extra { plugin, ..extra }.locked(Locked::Plugin),
                _ if awaiting => extra.locked(Locked::Approval),
                _ => extra,
            }
        })
        .collect();
    let plugins = found
        .plugins
        .into_iter()
        .map(|item| Extra::new(item.id, item.description, item.enabled))
        .collect();
    Installed {
        skills: sorted(skills),
        mcp_servers: sorted(mcp_servers),
        plugins: sorted(plugins),
    }
}

/// What a pick adds to a Claude session.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ClaudeExtras {
    /// Added to its `--settings` file after the terminal's own choice: `skillOverrides`, `enabledPlugins`.
    pub settings: Option<Value>,
    /// With an MCP pick: the servers its `--mcp-config` file holds besides dummyPlane's, read alone (`--strict-mcp-config`).
    pub servers: Option<Map<String, Value>>,
    /// With an MCP pick and Claude in Chrome listed: `--chrome` or `--no-chrome`.
    pub chrome: Option<bool>,
}

/// The picked names of `kind` still installed and pickable, as the CLI names them;
/// one gone since the spawn is dropped (there is nothing left to give).
fn kept(names: &[String], listed: &[Extra], what: &str) -> BTreeSet<String> {
    names
        .iter()
        .filter_map(|name| {
            let found = listed
                .iter()
                .find(|item| item.pickable() && item.name == *name);
            if found.is_none() {
                log::warn!("{what} {name} of a sub-agent's pick is no longer installed: left out");
            }
            found.map(|item| item.name.clone())
        })
        .collect()
}

/// A Claude sub-agent's pick, over its terminal's own choice (`choice`: the
/// user's switches in its edit panel, which win where they say something).
pub fn for_claude(
    pick: &Pick,
    choice: Option<&ExtensionChoice>,
    places: &Places,
) -> Result<ClaudeExtras, String> {
    within(pick, choice)?;
    let installed = claude_installed(places);
    let mut settings = Map::new();
    let skills_off = |name: &str| choice.is_some_and(|c| c.skills_off.iter().any(|n| n == name));
    if let Some(names) = &pick.skills {
        let keep = kept(names, &installed.skills, "skill");
        let mut overrides = extensions::skill_overrides(places);
        for skill in installed.skills.iter().filter(|s| s.pickable()) {
            let on = keep.contains(&skill.name) && !skills_off(&skill.name);
            overrides.insert(skill.name.clone(), json!(if on { "on" } else { "off" }));
        }
        settings.insert("skillOverrides".into(), Value::Object(overrides));
    }
    let picked_plugins = pick
        .plugins
        .as_ref()
        .map(|names| kept(names, &installed.plugins, "plugin"));
    // On for the session: the user's switch in the panel, else the pick, else the user's settings.
    let plugin_on = |id: &str, default: bool| {
        choice
            .and_then(|c| c.plugins.get(id).copied())
            .unwrap_or_else(|| picked_plugins.as_ref().map_or(default, |p| p.contains(id)))
    };
    // Named for the session by the user's switch in the panel or by the pick, not left to the user's settings.
    let plugin_named = |id: &str| {
        choice.and_then(|c| c.plugins.get(id).copied()) == Some(true)
            || picked_plugins.as_ref().is_some_and(|p| p.contains(id))
    };
    if picked_plugins.is_some() {
        let plugins: Map<String, Value> = installed
            .plugins
            .iter()
            .map(|p| (p.name.clone(), Value::Bool(plugin_on(&p.name, p.on))))
            .collect();
        settings.insert("enabledPlugins".into(), Value::Object(plugins));
    }
    let (servers, chrome) = match &pick.mcp_servers {
        Some(names) => {
            let keep = kept(names, &installed.mcp_servers, "MCP server");
            let chrome = installed
                .mcp_servers
                .iter()
                .any(|s| s.name == CHROME_SERVER)
                .then(|| keep.contains(CHROME_SERVER));
            let mut configured = keep;
            configured.remove(CHROME_SERVER);
            let servers =
                extensions::servers_picked(places, &configured, &plugin_on, &plugin_named)?;
            (Some(servers), chrome)
        }
        None => (None, None),
    };
    Ok(ClaudeExtras {
        settings: (!settings.is_empty()).then_some(Value::Object(settings)),
        servers,
        chrome,
    })
}

// ---------------------------------------------------------------- Codex

/// What a Codex command printed, run in the sub-agent's folder (`run_codex`).
pub type Run<'a> = dyn Fn(&[&str]) -> io::Result<String> + Sync + 'a;

/// How long a Codex listing may run before it is taken for hung. A cold one, which
/// fetches Codex's marketplaces, took a minute here; a warm one takes a few seconds.
/// A sub-agent's launch waits for it, and so does every spawn_agent, which are queued one at a time.
pub const LISTING_LIMIT: Duration = Duration::from_secs(120);

/// Runs `codex <args>` in `cwd`, its input closed, and answers what it printed; stopped and refused when Codex has
/// not ended within `limit`: with the processes it
/// started, which a shim (`codex.cmd`) leaves running when only it is killed (`process::output_within`).
pub fn run_codex_within(
    codex: &Path,
    args: &[&str],
    cwd: &Path,
    limit: Duration,
) -> io::Result<String> {
    let mut command = std::process::Command::new(codex);
    command.args(args).current_dir(cwd);
    let output = output_within(hide_window(&mut command), limit)?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(io::Error::other(error.trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// How old a cached Codex listing may be for a check and for the tool's listing, and for a launch. A cold listing
/// took a minute here and a warm one a few seconds, while the router gives up on a tool call after 30 s: the first
/// call that finds Codex cold is refused in time (`spawn_agent`'s budget) and leaves its listings here, so the call
/// made again a moment later is answered at once.
pub const LISTING_WARM: Duration = Duration::from_secs(300);
pub const LISTING_FRESH: Duration = Duration::from_secs(60);

/// One command's last answer, in the folder and the Codex home it ran in; the slot is held while it is being read.
type Slot = Arc<Mutex<Option<(Instant, String)>>>;
static LISTINGS: LazyLock<Mutex<HashMap<String, Slot>>> = LazyLock::new(Mutex::default);

/// `run_codex`, answered from the last listing of the same command in the same folder when that is younger than
/// `max_age` (never one wanted fresh, `Duration::ZERO`). A failure is not kept.
pub fn run_codex_cached(
    codex: &Path,
    args: &[&str],
    cwd: &Path,
    max_age: Duration,
) -> io::Result<String> {
    run_cached_within(codex, args, cwd, max_age, LISTING_LIMIT)
}

/// `run_codex_cached` with its own limit. A second caller of the same command waits for the first one's listing
/// rather than starting another: a retry made while a cold listing is still being read costs nothing more.
pub fn run_cached_within(
    codex: &Path,
    args: &[&str],
    cwd: &Path,
    max_age: Duration,
    limit: Duration,
) -> io::Result<String> {
    let key = format!(
        "{}\u{1}{}\u{1}{}\u{1}{}",
        codex.display(),
        cwd.display(),
        std::env::var("CODEX_HOME").unwrap_or_default(),
        args.join("\u{2}")
    );
    let slot = LISTINGS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .entry(key)
        .or_default()
        .clone();
    let mut held = slot.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some((at, text)) = held.as_ref()
        && at.elapsed() < max_age
    {
        return Ok(text.clone());
    }
    let text = run_codex_within(codex, args, cwd, limit)?;
    *held = Some((Instant::now(), text.clone()));
    Ok(text)
}

/// A pick checked against what `list` gives for a listing of a given age, a refusal tried once more on a fresh
/// one when `retry` (Codex's listings are kept: a refusal may be of an old one, a plugin installed since).
pub fn check_listed<E>(
    list: &dyn Fn(Duration) -> Result<Installed, E>,
    pick: &Pick,
    cli: &str,
    spawner: &Spawner,
    retry: bool,
    refuse: impl Fn(String) -> E,
) -> Result<Pick, E> {
    match check_for(pick, &list(LISTING_WARM)?, cli, spawner) {
        Err(_) if retry => check_for(pick, &list(Duration::ZERO)?, cli, spawner).map_err(refuse),
        checked => checked.map_err(refuse),
    }
}

/// The commands that list each kind, as Codex 0.167 answers them.
const PLUGIN_LIST: &[&str] = &["plugin", "list", "--json"];
/// The model's prompt, whose skills section lists the skills Codex loads here.
const PROMPT_INPUT: &[&str] = &["debug", "prompt-input"];
const MCP_LIST: &[&str] = &["mcp", "list", "--json"];
/// The servers a config defines: without plugins and apps, whose servers cannot be switched alone.
const MCP_CONFIGURED: &[&str] = &[
    "--disable",
    "plugins",
    "--disable",
    "apps",
    "mcp",
    "list",
    "--json",
];

/// A name Codex's command line takes as a TOML key or literal string, quoted
/// for no shell: letters, digits, `_`, `-`, and in a skill's name `:` and `.`
/// (a plugin's skill is `<plugin>:<skill>`).
fn codex_name(name: &str, skill: bool) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && name.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '_' | '-') || (skill && matches!(c, ':' | '.'))
        })
}

/// A plugin id Codex's command line takes: `<name>@<marketplace>`, no `.` (`-c` splits the key on it).
fn codex_plugin_id(id: &str) -> bool {
    id.split_once('@')
        .is_some_and(|(name, market)| codex_name(name, false) && codex_name(market, false))
}

/// What a Codex sub-agent in its folder can be given: Codex's own answers, the
/// kinds `kinds` names read at once.
pub fn codex_installed(run: &Run, kinds: Kinds) -> Result<Installed, String> {
    let [plugins, skills, all, configured] = std::thread::scope(|scope| {
        let start = |args: &'static [&'static str], wanted: bool| {
            wanted.then(|| scope.spawn(move || run(args)))
        };
        // A plugin's skills are named after it: the skills need the plugins' names.
        [
            start(PLUGIN_LIST, kinds.plugins || kinds.skills),
            start(PROMPT_INPUT, kinds.skills),
            start(MCP_LIST, kinds.mcp_servers),
            start(MCP_CONFIGURED, kinds.mcp_servers),
        ]
        .map(|handle| {
            handle.map(|h| {
                h.join()
                    .unwrap_or_else(|_| Err(io::Error::other("the listing stopped")))
            })
        })
    });
    let failed = |what: &str, err: io::Error| format!("Codex's {what} could not be listed: {err}");
    let plugins = match plugins {
        Some(text) => codex_plugins(&text.map_err(|e| failed("plugins", e))?)?,
        None => Vec::new(),
    };
    let skills = match skills {
        Some(text) => codex_skills(&text.map_err(|e| failed("skills", e))?, &plugins)?,
        None => Vec::new(),
    };
    let mcp_servers = match (all, configured) {
        (Some(all), Some(configured)) => codex_servers(
            &all.map_err(|e| failed("MCP servers", e))?,
            &configured.map_err(|e| failed("MCP servers", e))?,
        )?,
        _ => Vec::new(),
    };
    Ok(Installed {
        skills: sorted(skills),
        mcp_servers: sorted(mcp_servers),
        plugins: if kinds.plugins {
            sorted(plugins.into_iter().map(|p| p.extra).collect())
        } else {
            Vec::new()
        },
    })
}

/// An installed Codex plugin, and the name its skills carry (`<name>:<skill>`).
struct CodexPlugin {
    extra: Extra,
    name: String,
}

/// `codex plugin list --json`'s installed plugins; a local one is described by its manifest.
fn codex_plugins(text: &str) -> Result<Vec<CodexPlugin>, String> {
    let list: Value =
        serde_json::from_str(text).map_err(|err| format!("Codex's plugin list: {err}"))?;
    let installed = list
        .get("installed")
        .and_then(Value::as_array)
        .ok_or("Codex's plugin list has no installed plugins")?;
    Ok(installed
        .iter()
        .filter(|p| p.get("installed").and_then(Value::as_bool) != Some(false))
        .filter_map(|p| {
            let id = p.get("pluginId")?.as_str()?.to_string();
            let name = p
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_else(|| id.split('@').next().unwrap_or(&id))
                .to_string();
            let on = p.get("enabled").and_then(Value::as_bool).unwrap_or(false);
            let description = p
                .get("source")
                .filter(|s| s.get("source").and_then(Value::as_str) == Some("local"))
                .and_then(|s| s.get("path")?.as_str())
                .and_then(|path| plugin_description(Path::new(path)));
            let extra = Extra::new(id.clone(), description, on);
            let extra = if codex_plugin_id(&id) {
                extra
            } else {
                extra.locked(Locked::Name)
            };
            Some(CodexPlugin { extra, name })
        })
        .collect())
}

/// A Codex plugin's description, from its `.codex-plugin/plugin.json`.
fn plugin_description(root: &Path) -> Option<String> {
    let text = std::fs::read_to_string(root.join(".codex-plugin").join("plugin.json")).ok()?;
    let manifest: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    manifest
        .get("description")
        .and_then(Value::as_str)
        .map(String::from)
}

/// The skills `codex debug prompt-input` lists under "### Available skills",
/// one per line: `- <name>: <description> (file: <path>)`. A skill named
/// `<plugin>:<skill>` after an installed plugin is that plugin's. No skills
/// section is an error: an empty pick must never reach none for want of a list.
fn codex_skills(text: &str, plugins: &[CodexPlugin]) -> Result<Vec<Extra>, String> {
    let prompt: Value =
        serde_json::from_str(text).map_err(|err| format!("Codex's prompt: {err}"))?;
    // The heading on a line of its own: a sentence that names it ("under \"### Available skills\"") comes first in
    // some prompts, and read as the list it would be empty.
    let section = strings(&prompt)
        .into_iter()
        .find_map(|text| {
            let mut lines = text.lines();
            lines.find(|line| line.trim_end() == "### Available skills")?;
            Some(lines.collect::<Vec<_>>().join("\n"))
        })
        .ok_or("Codex's prompt lists no skills section")?;
    let mut seen = BTreeSet::new();
    let mut skills = Vec::new();
    for line in section.lines() {
        let Some(entry) = line.strip_prefix("- ") else {
            break;
        };
        // Its path last; a skill with no description is `- <name>:`.
        let body = entry.rsplit_once(" (file:").map_or(entry, |(body, _)| body);
        let (name, description) = body
            .split_once(": ")
            .unwrap_or((body.trim_end().trim_end_matches(':'), ""));
        let name = name.trim().to_string();
        if name.is_empty() || !seen.insert(name.clone()) {
            continue;
        }
        let description = description.trim();
        let description = (!description.is_empty()).then(|| description.to_string());
        let mut extra = Extra::new(name.clone(), description, true);
        let plugin = name
            .split_once(':')
            .and_then(|(prefix, _)| plugins.iter().find(|p| p.name == prefix));
        if let Some(plugin) = plugin {
            extra.plugin = Some(plugin.extra.name.clone());
            extra = extra.locked(Locked::Plugin);
        } else if !codex_name(&name, true) {
            extra = extra.locked(Locked::Name);
        }
        skills.push(extra);
    }
    Ok(skills)
}

/// Every string of a JSON value, depth first.
fn strings(value: &Value) -> Vec<&str> {
    match value {
        Value::String(text) => vec![text.as_str()],
        Value::Array(list) => list.iter().flat_map(strings).collect(),
        Value::Object(map) => map.values().flat_map(strings).collect(),
        _ => Vec::new(),
    }
}

/// `codex mcp list --json`'s servers: those `configured` lists (no plugins, no
/// apps) can be picked; the others come with a plugin or an app. dummyPlane's
/// own is listed once, fixed: its launch line gives it whatever the user's
/// config says of a server of that name.
fn codex_servers(all: &str, configured: &str) -> Result<Vec<Extra>, String> {
    let read = |text: &str| -> Result<Vec<(String, bool, Option<String>)>, String> {
        let list: Value =
            serde_json::from_str(text).map_err(|err| format!("Codex's MCP servers: {err}"))?;
        let servers = list.as_array().ok_or("Codex's MCP list is not a list")?;
        Ok(servers
            .iter()
            .filter_map(|server| {
                let name = server.get("name")?.as_str()?.to_string();
                let on = server.get("enabled").and_then(Value::as_bool) != Some(false);
                let transport = server.get("transport");
                let kind = transport
                    .and_then(|t| t.get("type")?.as_str())
                    .map(String::from);
                Some((name, on, kind))
            })
            .collect())
    };
    let defined: BTreeSet<String> = read(configured)?.into_iter().map(|(n, ..)| n).collect();
    let mut servers: Vec<Extra> = read(all)?
        .into_iter()
        .filter(|(name, ..)| !name.eq_ignore_ascii_case(OWN_SERVER))
        .map(|(name, on, kind)| {
            let pickable = defined.contains(&name);
            let extra = Extra::new(name.clone(), kind, on);
            if !pickable {
                extra.locked(Locked::Plugin)
            } else if !codex_name(&name, false) {
                extra.locked(Locked::Name)
            } else {
                extra
            }
        })
        .collect();
    servers.push(Extra::new(OWN_SERVER.into(), None, true).locked(Locked::Own));
    Ok(servers)
}

/// What a Codex sub-agent's pick puts on its command line, after its profile's
/// own arguments: only what differs from Codex's defaults. Raw arguments, each
/// quoted for the shell when typed (`shell::codex_command`). A name the line
/// cannot carry that the pick would turn off, and the launch does not start.
pub fn for_codex(pick: &Pick, installed: &Installed) -> Result<Vec<String>, String> {
    within(pick, None)?;
    let mut args = Vec::new();
    if let Some(names) = &pick.skills {
        let keep = kept(names, &installed.skills, "skill");
        let off = turned_off(&installed.skills, &keep, "skill", "Codex")?;
        if !off.is_empty() {
            let entries: Vec<String> = off
                .iter()
                .map(|name| format!("{{name='{name}',enabled=false}}"))
                .collect();
            args.push("-c".to_string());
            args.push(format!("skills.config=[{}]", entries.join(",")));
        }
    }
    if let Some(names) = &pick.plugins {
        let keep = kept(names, &installed.plugins, "plugin");
        turned_off(&installed.plugins, &keep, "plugin", "Codex")?;
        for plugin in installed.plugins.iter().filter(|p| p.pickable()) {
            let on = keep.contains(&plugin.name);
            if on != plugin.on {
                args.push("-c".to_string());
                args.push(format!("plugins.{}.enabled={on}", plugin.name));
            }
        }
    }
    if let Some(names) = &pick.mcp_servers {
        let keep = kept(names, &installed.mcp_servers, "MCP server");
        for name in turned_off(&installed.mcp_servers, &keep, "MCP server", "Codex")? {
            args.push("-c".to_string());
            args.push(format!("mcp_servers.{name}.enabled=false"));
        }
        // What the user turned off and the pick keeps: on.
        for server in installed
            .mcp_servers
            .iter()
            .filter(|s| s.pickable() && !s.on && keep.contains(&s.name))
        {
            args.push("-c".to_string());
            args.push(format!("mcp_servers.{}.enabled=true", server.name));
        }
    }
    Ok(args)
}

/// The items of a kind that are on and that the pick leaves out; refused when
/// one of them is a name the line cannot carry (it would stay on unsaid).
fn turned_off<'a>(
    listed: &'a [Extra],
    keep: &BTreeSet<String>,
    what: &str,
    cli: &str,
) -> Result<Vec<&'a str>, String> {
    let mut off = Vec::new();
    for item in listed
        .iter()
        .filter(|item| item.on && !keep.contains(&item.name))
    {
        match item.locked {
            None => off.push(item.name.as_str()),
            Some(Locked::Name) => {
                return Err(format!(
                    "the {what} \"{}\" cannot be turned off from dummyPlane on {cli}: its name holds characters {cli} cannot be given",
                    item.name
                ));
            }
            Some(_) => {}
        }
    }
    Ok(off)
}

// ---------------------------------------------------------------- the check

/// A pick checked against what the CLI lists, before a terminal opens: each
/// name as the CLI writes it, each once; dummyPlane's own server dropped (it is
/// always on). Refused, with every reason at once: a name not installed, a
/// plugin's skill or server (pick its plugin), a server the user's settings
/// leave off, a name Codex's line cannot carry.
pub fn check(pick: &Pick, installed: &Installed, cli: &str) -> Result<Pick, String> {
    let mut problems = Vec::new();
    let mut check_kind = |names: &Option<Vec<String>>,
                          listed: &[Extra],
                          kind: &str,
                          bound: Option<&Vec<String>>| {
        let names = names.as_ref()?;
        let mut kept: Vec<String> = Vec::new();
        let mut unknown = Vec::new();
        for raw in names {
            let name = raw.trim();
            if name.is_empty() {
                continue;
            }
            // As written, else the one item of that name whatever its case.
            let found = listed.iter().find(|item| item.name == name).or_else(|| {
                let same: Vec<&Extra> = listed
                    .iter()
                    .filter(|item| item.name.eq_ignore_ascii_case(name))
                    .collect();
                (same.len() == 1).then(|| same[0])
            });
            let Some(item) = found else {
                unknown.push(clip(name));
                continue;
            };
            match item.locked {
                None if bound.is_some_and(|b| !b.contains(&item.name)) => {
                    problems.push(format!(
                        "{kind} \"{}\" is beyond what its spawner has: a sub-agent gets at most what its spawner has",
                        item.name
                    ));
                }
                None if !kept.contains(&item.name) => kept.push(item.name.clone()),
                None | Some(Locked::Own) => {}
                Some(Locked::Plugin) => problems.push(match &item.plugin {
                    Some(plugin) => format!(
                        "{kind} \"{}\" comes with the plugin \"{plugin}\": pick that plugin in plugins instead",
                        item.name
                    ),
                    None => format!(
                        "{kind} \"{}\" comes with a plugin or an app of {cli}: it follows the plugins pick",
                        item.name
                    ),
                }),
                Some(Locked::Approval) => problems.push(format!(
                    "{kind} \"{}\" is a project server waiting for the user's approval: only the user approves one",
                    item.name
                )),
                Some(Locked::Name) => problems.push(format!(
                    "{kind} \"{}\" has a name {cli}'s command line cannot carry",
                    item.name
                )),
            }
        }
        if !unknown.is_empty() {
            problems.push(format!(
                "not installed for {cli} here ({kind}): {}",
                unknown.join(", ")
            ));
        }
        // Every item of the kind the pick leaves on must be one a launch can turn off.
        let keep: BTreeSet<String> = kept.iter().cloned().collect();
        // Claude reads the servers of an MCP pick alone (a strict MCP file): one it cannot name is left out, not left on.
        let own_file = cli == "Claude" && kind == "MCP server";
        if !own_file && let Err(cause) = turned_off(listed, &keep, kind, cli) {
            problems.push(cause);
        }
        Some(kept)
    };
    let checked = Pick {
        skills: check_kind(
            &pick.skills,
            &installed.skills,
            "skill",
            pick.ceiling.as_ref().and_then(|c| c.skills.as_ref()),
        ),
        mcp_servers: check_kind(
            &pick.mcp_servers,
            &installed.mcp_servers,
            "MCP server",
            pick.ceiling.as_ref().and_then(|c| c.mcp_servers.as_ref()),
        ),
        plugins: check_kind(
            &pick.plugins,
            &installed.plugins,
            "plugin",
            pick.ceiling.as_ref().and_then(|c| c.plugins.as_ref()),
        ),
        ceiling: pick.ceiling.clone(),
    };
    if problems.is_empty() {
        Ok(checked)
    } else {
        Err(problems.join("; "))
    }
}

/// A name as an error repeats it: one line, a few dozen characters.
fn clip(name: &str) -> String {
    let line: String = name.chars().filter(|c| !c.is_control()).take(60).collect();
    format!("\"{line}\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn put_json(path: &Path, value: Value) {
        put(path, &value.to_string());
    }

    /// A Claude setup: two skills (one off in the user's settings), a plugin
    /// with a skill and a server, another plugin off, a user server, a project
    /// server not approved, Claude in Chrome on.
    fn claude_places() -> (tempfile::TempDir, Places) {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let config = home.join(".claude");
        let cwd = root.path().join("project");
        let skill = |dir: &Path, name: &str| {
            put(
                &dir.join("skills").join(name).join("SKILL.md"),
                &format!("---\nname: {name}\ndescription: The {name} skill\n---\n"),
            )
        };
        skill(&config, "deploy");
        skill(&config, "review");
        let stripe = root.path().join("cache").join("stripe");
        put_json(
            &stripe.join(".claude-plugin").join("plugin.json"),
            json!({ "name": "stripe", "description": "Payments" }),
        );
        skill(&stripe, "charge");
        put_json(
            &stripe.join(".mcp.json"),
            json!({ "mcpServers": { "api": { "type": "http", "url": "https://mcp.stripe.com" } } }),
        );
        let linear = root.path().join("cache").join("linear");
        put_json(
            &linear.join(".claude-plugin").join("plugin.json"),
            json!({ "name": "linear" }),
        );
        put_json(
            &config.join("plugins").join("installed_plugins.json"),
            json!({ "version": 2, "plugins": {
                "stripe@market": [{ "scope": "user", "installPath": stripe.to_string_lossy() }],
                "linear@market": [{ "scope": "user", "installPath": linear.to_string_lossy() }],
            } }),
        );
        put_json(
            &config.join("settings.json"),
            json!({
                "skillOverrides": { "review": "off" },
                "enabledPlugins": { "stripe@market": true, "linear@market": false },
            }),
        );
        put_json(
            &cwd.join(".mcp.json"),
            json!({ "mcpServers": { "repo-db": { "command": "db-mcp" } } }),
        );
        let claude_json = home.join(".claude.json");
        put_json(
            &claude_json,
            json!({
                "claudeInChromeDefaultEnabled": true,
                "mcpServers": { "github": { "type": "http", "url": "https://api.github.com/mcp" } },
            }),
        );
        let places = Places {
            cwd,
            config: config.clone(),
            claude_json,
            plugins: config.join("plugins"),
        };
        (root, places)
    }

    fn names(items: &[Extra]) -> Vec<(&str, bool, Option<Locked>)> {
        items
            .iter()
            .map(|item| (item.name.as_str(), item.on, item.locked))
            .collect()
    }

    fn pick(skills: Option<&[&str]>, mcp: Option<&[&str]>, plugins: Option<&[&str]>) -> Pick {
        let own = |names: Option<&[&str]>| names.map(|n| n.iter().map(|s| s.to_string()).collect());
        Pick {
            skills: own(skills),
            mcp_servers: own(mcp),
            plugins: own(plugins),
            ..Pick::default()
        }
    }

    #[test]
    fn lists_what_a_claude_sub_agent_can_be_given_a_plugin_s_items_with_their_plugin() {
        let (_root, places) = claude_places();
        let found = claude_installed(&places);
        assert_eq!(
            names(&found.skills),
            vec![
                ("deploy", true, None),
                ("review", false, None),
                ("stripe:charge", true, Some(Locked::Plugin)),
            ]
        );
        assert_eq!(found.skills[2].plugin.as_deref(), Some("stripe@market"));
        assert_eq!(
            found.skills[0].description.as_deref(),
            Some("The deploy skill")
        );
        assert_eq!(
            names(&found.mcp_servers),
            vec![
                ("claude-in-chrome", true, None),
                ("dummyplane", true, Some(Locked::Own)),
                ("github", true, None),
                ("plugin_stripe_api", true, Some(Locked::Plugin)),
                ("repo-db", false, Some(Locked::Approval)),
            ]
        );
        assert_eq!(
            found.mcp_servers[3].plugin.as_deref(),
            Some("stripe@market")
        );
        assert_eq!(
            names(&found.plugins),
            vec![
                ("linear@market", false, None),
                ("stripe@market", true, None)
            ]
        );
    }

    #[test]
    fn a_pick_is_checked_against_what_is_installed_every_reason_at_once() {
        let (_root, places) = claude_places();
        let found = claude_installed(&places);
        let ok = check(
            &pick(
                Some(&["Deploy", "deploy", " review "]),
                Some(&["github", "dummyplane"]),
                Some(&[]),
            ),
            &found,
            "Claude",
        )
        .unwrap();
        assert_eq!(
            ok,
            pick(Some(&["deploy", "review"]), Some(&["github"]), Some(&[]))
        );
        // Each kind left out stays left out.
        assert_eq!(
            check(
                &pick(None, None, Some(&["linear@market"])),
                &found,
                "Claude"
            )
            .unwrap(),
            pick(None, None, Some(&["linear@market"]))
        );
        let err = check(
            &pick(
                Some(&["stripe:charge", "made-up", "rm -rf /;"]),
                Some(&["repo-db", "plugin_stripe_api"]),
                None,
            ),
            &found,
            "Claude",
        )
        .unwrap_err();
        assert!(
            err.contains("\"stripe:charge\" comes with the plugin \"stripe@market\""),
            "{err}"
        );
        assert!(
            err.contains("not installed for Claude here (skill): \"made-up\", \"rm -rf /;\""),
            "{err}"
        );
        assert!(
            err.contains("\"repo-db\" is a project server waiting for the user's approval"),
            "{err}"
        );
        assert!(
            err.contains("\"plugin_stripe_api\" comes with the plugin"),
            "{err}"
        );
    }

    #[test]
    fn a_claude_pick_sets_every_skill_and_plugin_and_reads_its_servers_alone() {
        let (_root, places) = claude_places();
        let extras = for_claude(
            &pick(
                Some(&["review"]),
                Some(&["github"]),
                Some(&["linear@market"]),
            ),
            None,
            &places,
        )
        .unwrap();
        let settings = extras.settings.unwrap();
        // The picked skill on (the user had it off), the other off; a plugin's skill follows its plugin.
        assert_eq!(
            settings["skillOverrides"],
            json!({ "review": "on", "deploy": "off" })
        );
        assert_eq!(
            settings["enabledPlugins"],
            json!({ "linear@market": true, "stripe@market": false })
        );
        // The picked server alone: stripe is off, its server goes with it.
        let servers = extras.servers.unwrap();
        assert_eq!(servers.keys().collect::<Vec<_>>(), vec!["github"]);
        assert_eq!(servers["github"]["url"], "https://api.github.com/mcp");
        assert_eq!(extras.chrome, Some(false));
    }

    #[test]
    fn a_claude_pick_keeps_a_kept_plugin_s_server_and_the_panel_s_switches() {
        let (_root, places) = claude_places();
        let choice = ExtensionChoice {
            skills_off: vec!["deploy".into()],
            plugins: [("stripe@market".to_string(), false)].into(),
            ..Default::default()
        };
        let extras = for_claude(
            &pick(Some(&["deploy"]), Some(&["claude-in-chrome"]), None),
            Some(&choice),
            &places,
        )
        .unwrap();
        // The user's switch in the panel wins over the pick.
        assert_eq!(
            extras.settings.unwrap()["skillOverrides"]["deploy"],
            json!("off")
        );
        assert!(extras.servers.unwrap().is_empty());
        assert_eq!(extras.chrome, Some(true));
        // Without the panel's switch, stripe stays on (its settings) and brings its server.
        let extras = for_claude(&pick(None, Some(&[]), None), None, &places).unwrap();
        let servers = extras.servers.unwrap();
        assert_eq!(
            servers.keys().collect::<Vec<_>>(),
            vec!["plugin_stripe_api"]
        );
        assert!(extras.settings.is_none());
    }

    #[test]
    fn a_claude_launch_drops_a_name_no_longer_installed_and_writes_only_listed_names() {
        let (_root, places) = claude_places();
        let extras = for_claude(
            &pick(Some(&["gone\"}, \"x"]), None, Some(&["gone@market"])),
            None,
            &places,
        )
        .unwrap();
        let settings = extras.settings.unwrap();
        assert_eq!(
            settings["skillOverrides"],
            json!({ "review": "off", "deploy": "off" })
        );
        assert_eq!(
            settings["enabledPlugins"],
            json!({ "linear@market": false, "stripe@market": false })
        );
    }

    #[test]
    fn a_claude_pick_is_added_over_the_terminal_s_choice_in_its_settings() {
        // As `hooks_for` writes them: the choice's patch, then the pick's over it.
        let (_root, places) = claude_places();
        let choice = ExtensionChoice {
            skills_off: vec!["deploy".into()],
            mcp_off: vec!["github".into()],
            ..Default::default()
        };
        let mut settings = extensions::settings_patch(&choice, &places).unwrap();
        let picked = for_claude(
            &pick(Some(&["deploy", "review"]), None, None),
            Some(&choice),
            &places,
        )
        .unwrap();
        extensions::apply(&mut settings, &picked.settings.unwrap());
        assert_eq!(
            settings["skillOverrides"],
            json!({ "deploy": "off", "review": "on" })
        );
        assert_eq!(settings["permissions"]["deny"], json!(["mcp__github"]));
    }

    #[test]
    fn no_pick_adds_nothing_to_a_claude_session() {
        let (_root, places) = claude_places();
        assert!(Pick::default().is_empty());
        assert_eq!(
            for_claude(&Pick::default(), None, &places).unwrap(),
            ClaudeExtras::default()
        );
    }

    /// The user's setup for a pick that may switch things on: `github` (a user server) and `repo-api` (a project
    /// server the user approved) switched off for this project, a project server never approved (`repo-db`) and one
    /// the user rejected, a plugin server switched off, the plugin `linear` off.
    fn switched_off_places() -> (tempfile::TempDir, Places) {
        let (root, places) = claude_places();
        put_json(
            &root.path().join("cache").join("linear").join(".mcp.json"),
            json!({ "mcpServers": { "mail": { "type": "http", "url": "https://mail.example" } } }),
        );
        put_json(
            &places.cwd.join(".mcp.json"),
            json!({ "mcpServers": {
                "repo-db": { "command": "db-mcp" },
                "repo-api": { "command": "api-mcp" },
                "repo-rejected": { "command": "rejected-mcp" },
            } }),
        );
        put_json(
            &places.claude_json,
            json!({
                "claudeInChromeDefaultEnabled": true,
                "mcpServers": { "github": { "type": "http", "url": "https://api.github.com/mcp" } },
                "projects": { places.cwd.to_string_lossy(): {
                    "disabledMcpServers": ["github", "repo-api", "plugin_linear_mail"],
                    "enabledMcpjsonServers": ["repo-api"],
                    "disabledMcpjsonServers": ["repo-rejected"],
                } },
            }),
        );
        (root, places)
    }

    #[test]
    fn a_server_the_user_switched_off_can_be_picked_but_a_project_server_awaiting_approval_never_can()
     {
        let (_root, places) = switched_off_places();
        let found = claude_installed(&places);
        let server = |name: &str| found.mcp_servers.iter().find(|s| s.name == name).unwrap();
        // Switched off by the user, whatever its scope: theirs to be switched on by a pick.
        for name in ["github", "repo-api"] {
            assert!(!server(name).on, "{name}");
            assert_eq!(server(name).locked, None, "{name}");
        }
        // Never approved, or rejected: only the user lets a project's server run.
        for name in ["repo-db", "repo-rejected"] {
            assert_eq!(server(name).locked, Some(Locked::Approval), "{name}");
        }
        let picked = check(
            &pick(None, Some(&["github", "repo-api"]), None),
            &found,
            "Claude",
        )
        .unwrap();
        assert_eq!(
            picked.mcp_servers,
            Some(vec!["github".into(), "repo-api".into()])
        );
        for name in ["repo-db", "repo-rejected"] {
            let err = check(&pick(None, Some(&[name]), None), &found, "Claude").unwrap_err();
            assert!(
                err.contains(&format!(
                    "\"{name}\" is a project server waiting for the user's approval"
                )),
                "{err}"
            );
        }
        // At the launch too: a name that reaches it anyway is dropped, never written.
        let extras = for_claude(
            &pick(
                None,
                Some(&["github", "repo-api", "repo-db", "repo-rejected"]),
                // No plugin: stripe's server would come with it.
                Some(&[]),
            ),
            None,
            &places,
        )
        .unwrap();
        let servers = extras.servers.unwrap();
        assert_eq!(
            servers.keys().collect::<Vec<_>>(),
            vec!["github", "repo-api"]
        );
    }

    #[test]
    fn a_picked_plugin_brings_its_servers_the_user_switched_off_too() {
        let (_root, places) = switched_off_places();
        // linear is off in the user's settings and its `mail` server is switched off: the pick names the plugin.
        let extras = for_claude(
            &pick(None, Some(&[]), Some(&["linear@market"])),
            None,
            &places,
        )
        .unwrap();
        assert!(extras.servers.unwrap().contains_key("plugin_linear_mail"));
        // Left out, the plugin keeps what the user's settings give: nothing of linear.
        let extras = for_claude(&pick(None, Some(&[]), Some(&[])), None, &places).unwrap();
        assert!(!extras.servers.unwrap().contains_key("plugin_linear_mail"));
    }

    fn restricted() -> Spawner {
        Spawner {
            extras: Some(pick(
                Some(&["deploy", "review"]),
                None,
                Some(&["stripe@market"]),
            )),
            extensions: Some(ExtensionChoice {
                skills_off: vec!["review".into()],
                plugins: std::collections::BTreeMap::from([("linear@market".to_string(), true)]),
                ..ExtensionChoice::default()
            }),
        }
    }

    #[test]
    fn a_restricted_spawner_has_a_ceiling_kind_by_kind_and_an_unrestricted_one_none() {
        let (_root, places) = claude_places();
        let found = claude_installed(&places);
        assert_eq!(ceiling_of(&Spawner::default(), &found, Kinds::ALL), None);
        // Its pick, less the switches it set off, plus a plugin the user switched on in its panel.
        let ceiling = ceiling_of(&restricted(), &found, Kinds::ALL).unwrap();
        assert_eq!(ceiling.skills, Some(vec!["deploy".to_string()]));
        // A kind it has no pick on is what it has by default: the servers that are on, not every one installed.
        assert_eq!(
            ceiling.mcp_servers,
            Some(vec!["claude-in-chrome".to_string(), "github".to_string()])
        );
        assert_eq!(
            ceiling.plugins,
            Some(vec![
                "linear@market".to_string(),
                "stripe@market".to_string()
            ])
        );
        // Switches off and no pick: what it has by default but those (dummyPlane's own server is never listed).
        let off = Spawner {
            extras: None,
            extensions: Some(ExtensionChoice {
                mcp_off: vec!["github".into()],
                ..ExtensionChoice::default()
            }),
        };
        let ceiling = ceiling_of(&off, &found, Kinds::ALL).unwrap();
        // review is off in the user's settings: a spawner restricted at all does not have it to give.
        assert_eq!(ceiling.skills, Some(vec!["deploy".to_string()]));
        assert_eq!(ceiling.plugins, Some(vec!["stripe@market".to_string()]));
        let servers = ceiling.mcp_servers.unwrap();
        assert!(
            servers.contains(&"claude-in-chrome".to_string()),
            "{servers:?}"
        );
        assert!(!servers.contains(&"github".to_string()), "{servers:?}");
        assert!(!servers.contains(&"dummyplane".to_string()), "{servers:?}");
        // Only the kinds the sub-agent names are bounded.
        let ceiling = ceiling_of(
            &restricted(),
            &found,
            Kinds::of(&pick(Some(&[]), None, None)),
        )
        .unwrap();
        assert_eq!(ceiling.plugins, None);
    }

    #[test]
    fn a_sub_agent_cannot_be_picked_more_than_its_spawner_has_a_ceiling_the_caller_cannot_give() {
        let (_root, places) = claude_places();
        let found = claude_installed(&places);
        let err = check_for(
            &pick(
                Some(&["deploy", "review"]),
                Some(&["github"]),
                Some(&["linear@market"]),
            ),
            &found,
            "Claude",
            &restricted(),
        )
        .unwrap_err();
        // review is switched off on the spawner; github is no concern of a spawner that restricts only skills and plugins.
        assert!(
            err.contains("skill \"review\" is beyond what its spawner has"),
            "{err}"
        );
        assert!(!err.contains("\"github\""), "{err}");
        // linear is in the ceiling (the user switched it on for the spawner): allowed.
        assert!(!err.contains("linear@market"), "{err}");
        let ok = check_for(
            &pick(Some(&["deploy"]), Some(&["github"]), Some(&[])),
            &found,
            "Claude",
            &restricted(),
        )
        .unwrap();
        assert_eq!(ok.skills, Some(vec!["deploy".to_string()]));
        assert_eq!(ok.ceiling.unwrap().skills, Some(vec!["deploy".to_string()]));
        // The ceiling a caller brings is replaced by the spawner's own.
        let mut forged = pick(Some(&["deploy"]), None, None);
        forged.ceiling = Some(Ceiling {
            skills: Some(vec!["deploy".into(), "review".into()]),
            ..Ceiling::default()
        });
        let ok = check_for(&forged, &found, "Claude", &restricted()).unwrap();
        assert_eq!(ok.ceiling.unwrap().skills, Some(vec!["deploy".to_string()]));
        // Nothing restricts the top-level agent: no ceiling at all.
        let ok = check_for(&forged, &found, "Claude", &Spawner::default()).unwrap();
        assert_eq!(ok.ceiling, None);
    }

    #[test]
    fn a_restricted_spawner_cannot_widen_through_a_kind_it_has_no_pick_on_but_an_unrestricted_one_can()
     {
        let (_root, places) = claude_places();
        let found = claude_installed(&places);
        let check = |pick: &Pick, spawner: &Spawner| check_for(pick, &found, "Claude", spawner);
        // Only skills picked: the plugin linear is off in the user's settings, and it has no say to switch it on.
        let skills_only = Spawner {
            extras: Some(pick(Some(&["deploy"]), None, None)),
            extensions: None,
        };
        let err = check(&pick(None, None, Some(&["linear@market"])), &skills_only).unwrap_err();
        assert!(
            err.contains("plugin \"linear@market\" is beyond what its spawner has"),
            "{err}"
        );
        // Only a switch off: review is off in the user's settings, deploy is switched off for it.
        let switched = Spawner {
            extras: None,
            extensions: Some(ExtensionChoice {
                skills_off: vec!["deploy".into()],
                ..ExtensionChoice::default()
            }),
        };
        let err = check(&pick(Some(&["review", "deploy"]), None, None), &switched).unwrap_err();
        assert!(err.contains("skill \"review\" is beyond"), "{err}");
        assert!(err.contains("skill \"deploy\" is beyond"), "{err}");
        // What it has by default, it may hand down.
        assert!(
            check(
                &pick(None, Some(&["github"]), Some(&["stripe@market"])),
                &switched
            )
            .is_ok()
        );
        // Nothing restricts the top-level agent: it may switch on what the user's settings leave off (B).
        let free = Spawner::default();
        assert!(
            check(
                &pick(Some(&["review"]), None, Some(&["linear@market"])),
                &free
            )
            .is_ok()
        );
    }

    #[test]
    fn a_launch_refuses_a_pick_beyond_its_ceiling_unless_the_name_is_switched_off_for_it() {
        let (_root, places) = claude_places();
        let mut beyond = pick(Some(&["deploy", "review"]), None, None);
        beyond.ceiling = Some(Ceiling {
            skills: Some(vec!["deploy".into()]),
            ..Ceiling::default()
        });
        let err = for_claude(&beyond, None, &places).unwrap_err();
        assert!(err.contains("beyond what its spawner has"), "{err}");
        // An inherited name its panel switched off is not one it gets.
        let choice = ExtensionChoice {
            skills_off: vec!["review".into()],
            ..ExtensionChoice::default()
        };
        assert!(for_claude(&beyond, Some(&choice), &places).is_ok());
        // Within it, nothing in the way; a pick with no ceiling is as before.
        beyond.skills = Some(vec!["deploy".into()]);
        assert!(for_claude(&beyond, None, &places).is_ok());
        let found = codex_installed(&codex(SKILLS), Kinds::ALL).unwrap();
        let mut codex_pick = pick(Some(&["imagegen", "dummyindex"]), None, None);
        codex_pick.ceiling = Some(Ceiling {
            skills: Some(vec!["imagegen".into()]),
            ..Ceiling::default()
        });
        let err = for_codex(&codex_pick, &found).unwrap_err();
        assert!(err.contains("beyond what its spawner has"), "{err}");
    }

    #[test]
    fn a_name_with_a_control_character_is_listed_without_it_and_cannot_be_picked() {
        let (_root, places) = claude_places();
        // A server's key can hold a newline: listed as a line, it would end that line and start the spawner's next.
        put_json(
            &places.claude_json,
            json!({
                "mcpServers": {
                    "evil\n- dummyplane [always kept]": { "type": "http", "url": "https://x.example" },
                    "tabbed\tname": { "type": "http", "url": "https://y.example" },
                },
            }),
        );
        let found = claude_installed(&places);
        let listed: Vec<&str> = found.mcp_servers.iter().map(|s| s.name.as_str()).collect();
        assert!(
            listed.contains(&"evil- dummyplane [always kept]"),
            "{listed:?}"
        );
        assert!(listed.contains(&"tabbedname"), "{listed:?}");
        for item in found
            .mcp_servers
            .iter()
            .filter(|s| s.name.starts_with("evil") || s.name.starts_with("tabbed"))
        {
            assert!(!item.name.chars().any(char::is_control), "{:?}", item.name);
            assert_eq!(item.locked, Some(Locked::Name), "{:?}", item.name);
        }
        let err = check(
            &pick(None, Some(&["evil- dummyplane [always kept]"]), None),
            &found,
            "Claude",
        )
        .unwrap_err();
        assert!(err.contains("cannot carry"), "{err}");
        // A description is one line without control characters too.
        assert_eq!(short("one\n\ttwo \u{1b}[31mred"), "one two [31mred");
    }

    #[test]
    fn an_item_dummyplane_cannot_name_does_not_stop_a_claude_mcp_pick_and_is_refused_in_claude_s_own_words_elsewhere()
     {
        let (_root, places) = claude_places();
        put_json(
            &places.claude_json,
            json!({ "mcpServers": { "odd\nname": { "type": "http", "url": "https://x.example" } } }),
        );
        let found = claude_installed(&places);
        // Claude reads the servers it is picked alone: the one it cannot name is left out of that file, not left on.
        let ok = check(&pick(None, Some(&[]), None), &found, "Claude");
        assert!(ok.is_ok(), "{ok:?}");
        // A skill it cannot name stays on whatever the pick says: refused, and not in Codex's words.
        let stays = Installed {
            skills: vec![Extra::new("odd".into(), None, true).locked(Locked::Name)],
            ..Installed::default()
        };
        let err = check(&pick(Some(&[]), None, None), &stays, "Claude").unwrap_err();
        assert!(
            err.contains("cannot be turned off from dummyPlane on Claude"),
            "{err}"
        );
        assert!(!err.contains("Codex"), "{err}");
    }

    // ------------------------------------------------------------ Codex

    const PLUGINS: &str = r#"{ "installed": [
        { "pluginId": "pdf@openai-runtime", "name": "pdf", "installed": true, "enabled": true,
          "source": { "source": "local", "path": "C:/nowhere" } },
        { "pluginId": "figma@openai-curated", "name": "figma", "installed": true, "enabled": false,
          "source": { "source": "remote", "id": "x" } },
        { "pluginId": "odd.name@market", "name": "odd", "installed": true, "enabled": false } ] }"#;

    fn prompt(skills: &str) -> String {
        json!([{ "type": "message", "content": [{ "type": "input_text",
            "text": format!("<skills_instructions>\n## Skills\n### Available skills\n{skills}\n### How to use skills\n- x: not a skill") }] }])
        .to_string()
    }

    const MCP_ALL: &str = r#"[
        { "name": "supabase", "enabled": true, "transport": { "type": "streamable_http", "url": "https://x" } },
        { "name": "vercel", "enabled": false, "transport": { "type": "streamable_http", "url": "https://y" } },
        { "name": "cua_repl", "enabled": true, "transport": { "type": "stdio", "command": "node" } },
        { "name": "codex_app", "enabled": false, "transport": { "type": "stdio", "command": "cmd.exe" } } ]"#;
    const MCP_CONFIGURED: &str = r#"[
        { "name": "supabase", "enabled": true, "transport": { "type": "streamable_http" } },
        { "name": "vercel", "enabled": false, "transport": { "type": "streamable_http" } } ]"#;

    fn codex(skills: &str) -> impl Fn(&[&str]) -> io::Result<String> + Sync {
        let prompt = prompt(skills);
        move |args: &[&str]| -> io::Result<String> {
            Ok(match args {
                ["plugin", "list", "--json"] => PLUGINS.to_string(),
                ["debug", "prompt-input"] => prompt.clone(),
                ["mcp", "list", "--json"] => MCP_ALL.to_string(),
                [
                    "--disable",
                    "plugins",
                    "--disable",
                    "apps",
                    "mcp",
                    "list",
                    "--json",
                ] => MCP_CONFIGURED.to_string(),
                other => return Err(io::Error::other(format!("unexpected {other:?}"))),
            })
        }
    }

    const SKILLS: &str = "- imagegen: Generate images. (file: r1/imagegen/SKILL.md)\n\
        - dummyindex: Context engine: builds an index. (file: r0/dummyindex/SKILL.md)\n\
        - pdf:pdf: Read PDFs (file: r3/pdf/skills/pdf/SKILL.md)";

    #[test]
    fn lists_what_codex_loads_its_plugins_skills_and_app_servers_locked() {
        let found = codex_installed(&codex(SKILLS), Kinds::ALL).unwrap();
        assert_eq!(
            names(&found.skills),
            vec![
                ("dummyindex", true, None),
                ("imagegen", true, None),
                ("pdf:pdf", true, Some(Locked::Plugin)),
            ]
        );
        assert_eq!(
            found.skills[0].description.as_deref(),
            Some("Context engine: builds an index.")
        );
        assert_eq!(
            found.skills[2].plugin.as_deref(),
            Some("pdf@openai-runtime")
        );
        assert_eq!(
            names(&found.plugins),
            vec![
                ("figma@openai-curated", false, None),
                ("odd.name@market", false, Some(Locked::Name)),
                ("pdf@openai-runtime", true, None),
            ]
        );
        assert_eq!(
            names(&found.mcp_servers),
            vec![
                ("codex_app", false, Some(Locked::Plugin)),
                ("cua_repl", true, Some(Locked::Plugin)),
                ("dummyplane", true, Some(Locked::Own)),
                ("supabase", true, None),
                ("vercel", false, None),
            ]
        );
    }

    #[test]
    fn a_codex_listing_runs_only_what_the_pick_needs_and_fails_closed() {
        let ran = std::sync::Mutex::new(Vec::new());
        let run = |args: &[&str]| {
            ran.lock().unwrap().push(args.join(" "));
            codex(SKILLS)(args)
        };
        codex_installed(&run, Kinds::of(&pick(None, None, Some(&[])))).unwrap();
        assert_eq!(*ran.lock().unwrap(), vec!["plugin list --json"]);
        // No skills section: an error, never an empty list.
        let none = |args: &[&str]| match args {
            ["debug", "prompt-input"] => Ok(json!([{ "text": "no skills here" }]).to_string()),
            other => codex(SKILLS)(other),
        };
        let err = codex_installed(&none, Kinds::of(&pick(Some(&[]), None, None))).unwrap_err();
        assert!(err.contains("no skills section"), "{err}");
        let broken = |_: &[&str]| -> io::Result<String> { Err(io::Error::other("codex crashed")) };
        let err = codex_installed(&broken, Kinds::ALL).unwrap_err();
        assert!(err.contains("codex crashed"), "{err}");
    }

    #[test]
    fn a_codex_pick_turns_off_what_it_leaves_out_on_the_command_line() {
        let found = codex_installed(&codex(SKILLS), Kinds::ALL).unwrap();
        let picked = check(
            &pick(
                Some(&["imagegen"]),
                Some(&[]),
                Some(&["figma@openai-curated"]),
            ),
            &found,
            "Codex",
        )
        .unwrap();
        assert_eq!(
            for_codex(&picked, &found).unwrap(),
            vec![
                "-c",
                "skills.config=[{name='dummyindex',enabled=false}]",
                "-c",
                "plugins.figma@openai-curated.enabled=true",
                "-c",
                "plugins.pdf@openai-runtime.enabled=false",
                "-c",
                "mcp_servers.supabase.enabled=false",
            ]
        );
        // Everything kept that is on by default: nothing to say.
        let all = pick(
            Some(&["imagegen", "dummyindex"]),
            Some(&["supabase"]),
            Some(&["pdf@openai-runtime"]),
        );
        assert!(for_codex(&all, &found).unwrap().is_empty());
        assert!(for_codex(&Pick::default(), &found).unwrap().is_empty());
    }

    /// spawn_agent requires all three kinds of a call (`REQUIRED_EXTRA_KINDS` in `@/agents/spawn`), `[]` for a kind the
    /// task needs none of: every sub-agent's pick names all three, so the empty one is the common case of both CLIs.
    #[test]
    fn an_empty_list_for_every_kind_is_checked_and_applied_on_both_clis() {
        let none = pick(Some(&[]), Some(&[]), Some(&[]));
        // Not "no pick": the command checks it (a pick of nothing, not the CLI's defaults), and Codex lists all three kinds.
        assert!(!none.is_empty());
        assert_eq!(Kinds::of(&none), Kinds::ALL);

        let (_root, places) = claude_places();
        let found = claude_installed(&places);
        assert_eq!(check(&none, &found, "Claude").unwrap(), none);
        let extras = for_claude(&none, None, &places).unwrap();
        let settings = extras.settings.unwrap();
        assert_eq!(settings["skillOverrides"]["deploy"], json!("off"));
        assert_eq!(settings["skillOverrides"]["review"], json!("off"));
        assert_eq!(settings["enabledPlugins"]["stripe@market"], json!(false));
        // Only dummyPlane's own server stays (written by the launch, not by the pick); Chrome is switched off.
        assert!(extras.servers.unwrap().is_empty());
        assert_eq!(extras.chrome, Some(false));

        let found = codex_installed(&codex(SKILLS), Kinds::of(&none)).unwrap();
        assert_eq!(check(&none, &found, "Codex").unwrap(), none);
        assert_eq!(
            for_codex(&none, &found).unwrap(),
            vec![
                "-c",
                "skills.config=[{name='dummyindex',enabled=false},{name='imagegen',enabled=false}]",
                "-c",
                "plugins.pdf@openai-runtime.enabled=false",
                "-c",
                "mcp_servers.supabase.enabled=false",
            ]
        );
    }

    #[test]
    fn a_codex_pick_turns_on_a_server_the_user_turned_off() {
        let found = codex_installed(&codex(SKILLS), Kinds::ALL).unwrap();
        let picked = check(
            &pick(None, Some(&["supabase", "vercel"]), None),
            &found,
            "Codex",
        )
        .unwrap();
        assert_eq!(
            for_codex(&picked, &found).unwrap(),
            vec!["-c", "mcp_servers.vercel.enabled=true"]
        );
        // A server of a plugin or an app still follows its plugin.
        let err = check(&pick(None, Some(&["cua_repl"]), None), &found, "Codex").unwrap_err();
        assert!(err.contains("comes with a plugin or an app"), "{err}");
    }

    #[test]
    fn a_codex_name_with_odd_characters_never_reaches_the_command_line() {
        let odd = "- evil'],x=[{name='y: Sneaky (file: r0/evil/SKILL.md)\n- good: Fine (file: r0/good/SKILL.md)";
        let found = codex_installed(&codex(odd), Kinds::ALL).unwrap();
        let evil = found
            .skills
            .iter()
            .find(|s| s.name.starts_with("evil"))
            .unwrap();
        assert_eq!(evil.locked, Some(Locked::Name));
        // Picked: refused. Left out, it cannot be turned off: refused too, never left on unsaid.
        let err = check(&pick(Some(&[&evil.name]), None, None), &found, "Codex").unwrap_err();
        assert!(err.contains("command line cannot carry"), "{err}");
        let err = check(&pick(Some(&["good"]), None, None), &found, "Codex").unwrap_err();
        assert!(
            err.contains("cannot be turned off from dummyPlane"),
            "{err}"
        );
        let err = for_codex(&pick(Some(&["good"]), None, None), &found).unwrap_err();
        assert!(err.contains("cannot be turned off"), "{err}");
        // A name only matches one Codex listed: what goes on the line is Codex's own spelling.
        let args = for_codex(
            &pick(None, Some(&["supabase'];rm"]), Some(&["odd.name@market"])),
            &codex_installed(&codex(SKILLS), Kinds::ALL).unwrap(),
        )
        .unwrap();
        assert_eq!(
            args,
            vec![
                "-c",
                "plugins.pdf@openai-runtime.enabled=false",
                "-c",
                "mcp_servers.supabase.enabled=false"
            ]
        );
        assert!(codex_plugin_id("a-b@c_d") && !codex_plugin_id("a.b@c") && !codex_plugin_id("ab"));
        assert!(codex_name("pdf:pdf", true) && !codex_name("pdf:pdf", false));
        assert!(!codex_name("-c", true) && !codex_name("a b", true) && !codex_name("a'b", true));
    }

    /// A stand-in for `codex` that runs `body`, a script of the platform's own kind.
    fn fake_codex(dir: &Path, body: &str) -> std::path::PathBuf {
        #[cfg(windows)]
        {
            let path = dir.join("codex.cmd");
            std::fs::write(&path, format!("@echo off\r\n{body}\r\n")).unwrap();
            path
        }
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;
            let path = dir.join("codex");
            std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        }
    }

    #[cfg(windows)]
    const HANGS: &str = "ping -n 30 127.0.0.1 >nul";
    #[cfg(not(windows))]
    const HANGS: &str = "sleep 30";

    #[test]
    fn a_codex_listing_that_never_answers_is_stopped_and_refused_instead_of_holding_the_launch() {
        let dir = tempfile::tempdir().unwrap();
        let codex = fake_codex(dir.path(), HANGS);
        let started = std::time::Instant::now();
        let err = run_codex_within(
            &codex,
            &["plugin", "list", "--json"],
            dir.path(),
            std::time::Duration::from_millis(500),
        )
        .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::TimedOut, "{err}");
        assert!(err.to_string().contains("no answer within"), "{err}");
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
    }

    #[test]
    fn a_sentence_naming_the_skills_heading_before_the_list_is_not_taken_for_the_list() {
        // As Codex 0.167 prints it when its instructions name the section before the catalog: the first text that
        // holds the heading is a sentence. Read as the list it is empty, and an empty pick would leave every skill on.
        let text = json!([
            { "type": "message", "content": [{ "type": "input_text",
                "text": "They are listed in the \"## Skills\" section under \"### Available skills\".\n\nEach entry includes a name." }] },
            { "type": "message", "content": [{ "type": "input_text",
                "text": "<skills_instructions>\n## Skills\n### Available skills\n- imagegen: Make images. (file: r0/imagegen/SKILL.md)\n- pdf:pdf: Read PDFs. (file: r1/pdf/SKILL.md)\n### How to use skills\n- x: not a skill" }] },
        ])
        .to_string();
        let skills = codex_skills(&text, &[]).unwrap();
        let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["imagegen", "pdf:pdf"]);
    }

    /// A `codex` shim as npm and bun install it: a `.cmd` that starts the real one, here a process that
    /// holds `child.lock` open (its output goes there) for some 46 s, while the shim itself waits for ever.
    #[cfg(windows)]
    #[test]
    fn a_stopped_codex_listing_takes_the_processes_its_shim_started_with_it() {
        let dir = tempfile::tempdir().unwrap();
        let lock = dir.path().join("child.lock");
        let codex = fake_codex(
            dir.path(),
            "start /b cmd /c \"ping -n 47 127.0.0.1 >child.lock\"\r\nping -n 60 127.0.0.1 >nul",
        );
        // Time enough, on a machine under load, for the shim and the process it starts to have started when the
        // listing is stopped: stopped before that, it would show nothing, and a stop that lands while the shim
        // starts its child is a race of the machine's speed, not of the code.
        let err = run_codex_within(&codex, &[], dir.path(), Duration::from_secs(5)).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::TimedOut, "{err}");
        assert!(
            lock.exists(),
            "the shim did not start its child within the limit: nothing was shown"
        );
        // Windows does not delete a file a process has open, so it can be once the shim's child, and what that
        // started, are gone. The child would live on for 46 s: wait for its end, up to a deadline that is long for
        // a loaded machine to end a process and well short of that.
        let deadline = Instant::now() + Duration::from_secs(30);
        while let Err(error) = std::fs::remove_file(&lock) {
            assert!(
                Instant::now() < deadline,
                "the shim's child outlived the listing that was stopped: {error}"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// A `codex` that counts its runs in `count.txt` (in the folder it runs in) and takes `seconds` to answer.
    fn counting_codex(dir: &Path, seconds: u32) -> std::path::PathBuf {
        #[cfg(windows)]
        let body = format!(
            "echo x>>count.txt\r\nping -n {} 127.0.0.1 >nul\r\necho listed",
            seconds + 1
        );
        #[cfg(not(windows))]
        let body = format!("echo x >> count.txt\nsleep {seconds}\necho listed");
        fake_codex(dir, &body)
    }

    fn runs(dir: &Path) -> usize {
        std::fs::read_to_string(dir.join("count.txt")).map_or(0, |text| text.lines().count())
    }

    #[test]
    fn a_codex_listing_is_kept_for_a_while_per_folder_so_a_retry_after_a_slow_first_one_is_instant()
    {
        let dir = tempfile::tempdir().unwrap();
        let codex = counting_codex(dir.path(), 0);
        let args = ["plugin", "list", "--json"];
        let limit = Duration::from_secs(30);
        let run = |age: Duration| run_cached_within(&codex, &args, dir.path(), age, limit).unwrap();
        assert_eq!(run(LISTING_WARM).trim(), "listed");
        assert_eq!(run(LISTING_WARM).trim(), "listed");
        assert_eq!(runs(dir.path()), 1, "the second answer was the first's");
        // Too old for this caller (a launch wants a younger one than a check): read again.
        std::thread::sleep(Duration::from_millis(30));
        run(Duration::from_millis(10));
        assert_eq!(runs(dir.path()), 2);
        // Another command, or another folder, is another listing.
        run_cached_within(&codex, &["mcp", "list"], dir.path(), LISTING_WARM, limit).unwrap();
        assert_eq!(runs(dir.path()), 3);
        // Never kept: a listing wanted fresh.
        run(Duration::ZERO);
        assert_eq!(runs(dir.path()), 4);
    }

    #[test]
    fn a_failed_listing_is_not_kept_and_two_callers_at_once_share_one_run() {
        let dir = tempfile::tempdir().unwrap();
        let hangs = fake_codex(dir.path(), HANGS);
        let first = run_cached_within(
            &hangs,
            &[],
            dir.path(),
            LISTING_WARM,
            Duration::from_millis(300),
        );
        assert_eq!(first.unwrap_err().kind(), io::ErrorKind::TimedOut);
        let second = run_cached_within(
            &hangs,
            &[],
            dir.path(),
            LISTING_WARM,
            Duration::from_millis(300),
        );
        assert_eq!(
            second.unwrap_err().kind(),
            io::ErrorKind::TimedOut,
            "a failure was kept"
        );
        // Two spawns asking while the first listing is still being read: the second waits for it, it does not start another.
        let slow = counting_codex(dir.path(), 2);
        let args = ["debug", "prompt-input"];
        let ask = || {
            run_cached_within(
                &slow,
                &args,
                dir.path(),
                LISTING_WARM,
                Duration::from_secs(30),
            )
            .unwrap()
        };
        let (a, b) = std::thread::scope(|scope| {
            let a = scope.spawn(ask);
            std::thread::sleep(Duration::from_millis(300));
            let b = scope.spawn(ask);
            (a.join().unwrap(), b.join().unwrap())
        });
        assert_eq!((a.trim(), b.trim()), ("listed", "listed"));
        assert_eq!(
            runs(dir.path()),
            1,
            "the retry started a second cold listing"
        );
    }

    #[test]
    fn a_refusal_from_an_old_listing_is_checked_once_more_on_a_fresh_one() {
        let (_root, places) = claude_places();
        let current = claude_installed(&places);
        let stale = Installed::default();
        let ages = std::cell::RefCell::new(Vec::new());
        let list = |age: Duration| -> Result<Installed, String> {
            ages.borrow_mut().push(age);
            Ok(if age == Duration::ZERO {
                current.clone()
            } else {
                stale.clone()
            })
        };
        // deploy was installed after the cached listing was read.
        let ok = check_listed(
            &list,
            &pick(Some(&["deploy"]), None, None),
            "Codex",
            &Spawner::default(),
            true,
            |e| e,
        )
        .unwrap();
        assert_eq!(ok.skills, Some(vec!["deploy".to_string()]));
        assert_eq!(*ages.borrow(), vec![LISTING_WARM, Duration::ZERO]);
        // Still refused on a fresh listing: refused, after that one retry only.
        ages.borrow_mut().clear();
        let err = check_listed(
            &list,
            &pick(Some(&["made-up"]), None, None),
            "Codex",
            &Spawner::default(),
            true,
            |e| e,
        )
        .unwrap_err();
        assert!(err.contains("not installed"), "{err}");
        assert_eq!(ages.borrow().len(), 2);
        // Claude reads files: no retry.
        ages.borrow_mut().clear();
        check_listed(
            &list,
            &pick(Some(&["deploy"]), None, None),
            "Claude",
            &Spawner::default(),
            false,
            |e| e,
        )
        .unwrap_err();
        assert_eq!(ages.borrow().len(), 1);
    }

    #[test]
    fn a_codex_listing_that_answers_in_time_gives_what_it_printed() {
        let dir = tempfile::tempdir().unwrap();
        let codex = fake_codex(dir.path(), "echo listed");
        let text =
            run_codex_within(&codex, &[], dir.path(), std::time::Duration::from_secs(30)).unwrap();
        assert_eq!(text.trim(), "listed");
    }

    #[test]
    fn a_pick_reads_and_writes_the_interface_s_shape() {
        let read: Pick =
            serde_json::from_value(json!({ "skills": ["a"], "mcpServers": [] })).unwrap();
        assert_eq!(read, pick(Some(&["a"]), Some(&[]), None));
        assert_eq!(
            serde_json::to_value(&read).unwrap(),
            json!({ "skills": ["a"], "mcpServers": [] })
        );
    }
}
