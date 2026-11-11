//! What gives a Codex session dummyPlane's tools and role: a profile file,
//! `$CODEX_HOME/dummyplane-<nodeId>.config.toml`, loaded with `codex -p`. Codex
//! takes neither an instructions file nor an MCP config file on its command line,
//! and the role is too long for a command typed into a shell. Codex layers the
//! profile on the user's own config for this session only: nothing is saved in
//! theirs. The token is not in the file: Codex reads it from `TOKEN_ENV`
//! (`bearer_token_env_var`), set on the terminal's process only.

use std::io;
use std::path::{Path, PathBuf};

use super::hooks_server::valid_node_id;
use super::mcp_files::{LINEAR, LINEAR_READONLY_URL};
use crate::pty::shell::Role;

/// The variable that carries a Codex session's MCP token.
pub const TOKEN_ENV: &str = "DUMMYPLANE_MCP_TOKEN";

const PREFIX: &str = "dummyplane-";
const SUFFIX: &str = ".config.toml";

/// The server dummyPlane's tools go by, as for Claude.
const SERVER: &str = "dummyplane";

/// What a fleet must not take from the user's Codex: tools that act out of reach
/// of its read-only sandbox (plugins, apps, the browser, the computer) and
/// sub-agents of its own, which the user would not see. Turned off on its command
/// line (`cli_args`): a trusted project's `.codex/config.toml` outranks a profile
/// (checked on Codex 0.167), never the command line. The user's MCP servers are
/// turned off one by one (`prepare`).
pub const FLEET_FEATURES_OFF: [&str; 8] = [
    "plugins",
    "apps",
    "browser_use",
    "browser_use_external",
    "computer_use",
    "in_app_browser",
    "image_generation",
    "multi_agent",
];

/// Codex's folder: `$CODEX_HOME`, else `~/.codex`.
pub fn codex_home() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CODEX_HOME").filter(|dir| !dir.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".codex"))
}

/// The name `codex -p` takes; a node id is letters, digits, `-` and `_`, so it is never quoted.
pub fn profile_name(node_id: &str) -> String {
    format!("{PREFIX}{node_id}")
}

fn profile_path(home: &Path, node_id: &str) -> PathBuf {
    home.join(format!("{}{SUFFIX}", profile_name(node_id)))
}

/// A TOML basic string.
pub fn toml_string(text: &str) -> String {
    let mut out = String::from("\"");
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// What one session's profile holds.
pub struct Profile<'a> {
    pub mcp_url: &'a str,
    pub prompt: &'a str,
    pub role: Role,
    /// A fleet whose night reads its tickets in Linear: Linear's read-only server.
    pub linear: bool,
}

/// The servers a session may keep: dummyPlane's, and Linear's read-only one for a fleet that reads its tickets there.
fn allowed(profile: &Profile, name: &str) -> bool {
    name == SERVER || (profile.linear && profile.role == Role::Fleet && name == LINEAR)
}

/// What goes on the session's command line rather than in its profile, which a
/// trusted project's own config outranks: where dummyPlane's server is and which
/// variable holds its token (a project could send that token elsewhere), and a
/// fleet's features off. Raw arguments, each quoted for the shell when typed.
pub fn cli_args(role: Role, mcp_url: &str) -> Vec<String> {
    let mut args = vec![
        "-c".to_string(),
        format!("mcp_servers.{SERVER}.url='{mcp_url}'"),
        "-c".to_string(),
        format!("mcp_servers.{SERVER}.bearer_token_env_var='{TOKEN_ENV}'"),
    ];
    if role == Role::Fleet {
        for feature in FLEET_FEATURES_OFF {
            args.push("--disable".to_string());
            args.push(feature.to_string());
        }
    }
    args
}

/// The file's text; `disabled`: the user's servers a fleet does not get.
pub fn profile_toml(profile: &Profile, disabled: &[String]) -> String {
    let mut out =
        String::from("# Written by dummyPlane for one of its terminals; removed when it closes.\n");
    out.push_str(&format!(
        "developer_instructions = {}\n",
        toml_string(profile.prompt)
    ));
    // dummyPlane types its lines as a paste then Enter: Codex's paste-burst guess would take that Enter for a new line.
    out.push_str("disable_paste_burst = true\n");
    out.push_str("check_for_update_on_startup = false\n");
    out.push_str(&format!("\n[mcp_servers.{SERVER}]\n"));
    out.push_str(&format!("url = {}\n", toml_string(profile.mcp_url)));
    out.push_str(&format!(
        "bearer_token_env_var = {}\n",
        toml_string(TOKEN_ENV)
    ));
    // dummyPlane's tools run without a question, even when nothing may be asked (`-a never`).
    out.push_str("default_tools_approval_mode = \"approve\"\n");
    if allowed(profile, LINEAR) {
        out.push_str(&format!("\n[mcp_servers.{LINEAR}]\n"));
        out.push_str(&format!("url = {}\n", toml_string(LINEAR_READONLY_URL)));
        out.push_str("enabled = true\n");
    }
    for name in disabled.iter().filter(|name| !allowed(profile, name)) {
        out.push_str(&format!(
            "\n[mcp_servers.{}]\nenabled = false\n",
            toml_string(name)
        ));
    }
    out
}

fn write_file(home: &Path, node_id: &str, text: &str) -> io::Result<PathBuf> {
    if !valid_node_id(node_id) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid node id: {node_id}"),
        ));
    }
    std::fs::create_dir_all(home)?;
    let path = profile_path(home, node_id);
    std::fs::write(&path, text)?;
    Ok(path)
}

/// A server `codex mcp list` says is on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Listed {
    pub name: String,
    pub url: Option<String>,
}

/// Writes the session's profile. A fleet keeps none of the user's MCP servers:
/// `enabled` lists the servers Codex would start under the profile and the
/// session's command line (`codex mcp list`, in its folder, so the project's own
/// config counts). Those it may not have are turned off, then the list is read
/// again: a server still on, or dummyPlane's own pointing elsewhere, and the fleet
/// does not start, rather than with a tool that could write.
pub fn prepare(
    home: &Path,
    node_id: &str,
    profile: &Profile,
    enabled: impl Fn(&str) -> io::Result<Vec<Listed>>,
) -> Result<PathBuf, String> {
    let path =
        write_file(home, node_id, &profile_toml(profile, &[])).map_err(|err| err.to_string())?;
    if profile.role != Role::Fleet {
        return Ok(path);
    }
    let name = profile_name(node_id);
    let refuse = |cause: String| {
        remove(home, node_id);
        Err(cause)
    };
    let extra = match enabled(&name) {
        Ok(servers) => servers
            .into_iter()
            .map(|s| s.name)
            .filter(|s| !allowed(profile, s))
            .collect::<Vec<_>>(),
        Err(err) => return refuse(format!("Codex's MCP servers could not be listed: {err}")),
    };
    if !extra.is_empty()
        && let Err(err) = write_file(home, node_id, &profile_toml(profile, &extra))
    {
        return refuse(err.to_string());
    }
    let servers = match enabled(&name) {
        Ok(servers) => servers,
        Err(err) => return refuse(format!("Codex's MCP servers could not be listed: {err}")),
    };
    let left: Vec<_> = servers
        .iter()
        .map(|s| s.name.clone())
        .filter(|s| !allowed(profile, s))
        .collect();
    if !left.is_empty() {
        return refuse(format!("Codex keeps MCP servers on: {}", left.join(", ")));
    }
    let own = servers
        .iter()
        .find(|s| s.name == SERVER)
        .and_then(|s| s.url.as_deref());
    if own != Some(profile.mcp_url) {
        return refuse(format!(
            "Codex does not reach dummyPlane's server: {}",
            own.unwrap_or("no dummyplane server")
        ));
    }
    Ok(path)
}

/// The servers `codex mcp list --json` says are on.
pub fn enabled_servers(json: &[u8]) -> io::Result<Vec<Listed>> {
    let list: serde_json::Value = serde_json::from_slice(json).map_err(io::Error::other)?;
    let servers = list
        .as_array()
        .ok_or_else(|| io::Error::other("codex mcp list did not answer a list"))?;
    Ok(servers
        .iter()
        .filter(|server| server["enabled"].as_bool() != Some(false))
        .filter_map(|server| {
            Some(Listed {
                name: server["name"].as_str()?.to_string(),
                url: server["transport"]["url"].as_str().map(str::to_string),
            })
        })
        .collect())
}

/// Runs `codex -p <profile> <args> mcp list --json` in `cwd`, `args` being the session's own (`cli_args`).
pub fn list_servers(
    codex: &Path,
    profile: &str,
    args: &[String],
    cwd: &Path,
) -> io::Result<Vec<Listed>> {
    let mut command = std::process::Command::new(codex);
    command
        .args(["-p", profile])
        .args(args)
        .args(["mcp", "list", "--json"])
        .current_dir(cwd)
        .stdin(std::process::Stdio::null());
    crate::process::hide_window(&mut command);
    let output = command.output()?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(io::Error::other(error.trim().to_string()));
    }
    enabled_servers(&output.stdout)
}

/// How long the user has to sign in to Linear in their browser.
pub const LOGIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// `codex mcp login` for the server a fleet reads Linear with: the same name and the
/// same read-only endpoint as in its profile, so Codex keeps the sign-in for it.
pub fn linear_login_args() -> Vec<String> {
    vec![
        "-c".into(),
        format!(
            "mcp_servers.{LINEAR}.url={}",
            toml_string(LINEAR_READONLY_URL)
        ),
        "mcp".into(),
        "login".into(),
        LINEAR.into(),
    ]
}

/// Runs the sign-in: Codex opens the browser and waits for Linear's answer.
pub fn linear_login(codex: &Path) -> Result<(), String> {
    let mut command = std::process::Command::new(codex);
    command
        .args(linear_login_args())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    crate::process::hide_window(&mut command);
    let mut child = command.spawn().map_err(|err| err.to_string())?;
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => {
                let mut error = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    let _ = std::io::Read::read_to_string(&mut stderr, &mut error);
                }
                return Err(error
                    .trim()
                    .lines()
                    .last()
                    .unwrap_or("Codex could not sign in")
                    .to_string());
            }
            Ok(None) if started.elapsed() > LOGIN_TIMEOUT => {
                let _ = child.kill();
                return Err("no answer from Linear within 5 minutes".to_string());
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(250)),
            Err(err) => return Err(err.to_string()),
        }
    }
}

pub fn remove(home: &Path, node_id: &str) {
    if valid_node_id(node_id) {
        let _ = std::fs::remove_file(profile_path(home, node_id));
    }
}

/// Profiles a previous run left: their sessions and tokens are gone. Only dummyPlane's.
pub fn clear(home: &Path) {
    let Ok(entries) = std::fs::read_dir(home) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(id) = name
            .strip_prefix(PREFIX)
            .and_then(|rest| rest.strip_suffix(SUFFIX))
            && valid_node_id(id)
        {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Codex's thread ids are UUIDs.
pub fn thread_id(text: &str) -> Option<String> {
    uuid::Uuid::parse_str(text).ok().map(|id| id.to_string())
}

/// True when Codex saved the thread (`sessions/<year>/<month>/<day>/rollout-…-<id>.jsonl`):
/// only a saved one can be resumed. The title Codex has its model write for a new
/// conversation runs on a thread of its own that it does not save, and its end is
/// notified too. The newest days are looked at, a few at most.
pub fn thread_saved(home: &Path, id: &str) -> bool {
    saved_within(home, id, RECENT_DAYS)
}

/// The day folders a just-ended turn is looked for in: one turn may straddle midnight.
const RECENT_DAYS: usize = 3;

/// Before a resume, every day: a conversation may be weeks old.
pub fn thread_saved_ever(home: &Path, id: &str) -> bool {
    saved_within(home, id, usize::MAX)
}

fn saved_within(home: &Path, id: &str, days: usize) -> bool {
    let suffix = format!("-{id}.jsonl");
    newest_days(&home.join("sessions"), days).iter().any(|day| {
        std::fs::read_dir(day).is_ok_and(|entries| {
            entries
                .flatten()
                .any(|entry| entry.file_name().to_string_lossy().ends_with(&suffix))
        })
    })
}

fn newest_dirs(dir: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .map(|entry| entry.path())
                .collect()
        })
        .unwrap_or_default();
    dirs.sort();
    dirs.reverse();
    dirs
}

/// The `count` newest `<year>/<month>/<day>` folders.
fn newest_days(sessions: &Path, count: usize) -> Vec<PathBuf> {
    let mut days = Vec::new();
    for year in newest_dirs(sessions) {
        for month in newest_dirs(&year) {
            for day in newest_dirs(&month) {
                days.push(day);
                if days.len() == count {
                    return days;
                }
            }
        }
    }
    days
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn on(names: &[&str]) -> Vec<Listed> {
        names
            .iter()
            .map(|name| Listed {
                name: name.to_string(),
                url: (*name == "dummyplane").then(|| "http://127.0.0.1:4242/mcp".to_string()),
            })
            .collect()
    }

    fn profile(role: Role, linear: bool) -> Profile<'static> {
        Profile {
            mcp_url: "http://127.0.0.1:4242/mcp",
            prompt: "Tu es \"la\" flotte.\nC:\\dossier",
            role,
            linear,
        }
    }

    #[test]
    fn escapes_what_a_toml_basic_string_cannot_hold() {
        assert_eq!(
            toml_string("a\"b\\c\nd\te\u{1}"),
            "\"a\\\"b\\\\c\\nd\\te\\u0001\""
        );
        assert_eq!(toml_string("D:\\temp"), "\"D:\\\\temp\"");
    }

    #[test]
    fn gives_dummyplane_s_server_its_token_by_variable_never_in_the_file() {
        let text = profile_toml(&profile(Role::Agent, false), &[]);
        assert!(text.contains("[mcp_servers.dummyplane]\nurl = \"http://127.0.0.1:4242/mcp\"\nbearer_token_env_var = \"DUMMYPLANE_MCP_TOKEN\"\ndefault_tools_approval_mode = \"approve\"\n"), "{text}");
        assert!(
            text.contains(
                "developer_instructions = \"Tu es \\\"la\\\" flotte.\\nC:\\\\dossier\"\n"
            )
        );
        assert!(text.contains("disable_paste_burst = true\n"));
        assert!(
            !text.contains("[features]"),
            "features go on the command line"
        );
        assert!(!text.contains("linear"));
    }

    #[test]
    fn puts_what_a_project_could_override_on_the_command_line() {
        let agent = cli_args(Role::Agent, "http://127.0.0.1:4242/mcp");
        assert_eq!(
            agent,
            vec![
                "-c",
                "mcp_servers.dummyplane.url='http://127.0.0.1:4242/mcp'",
                "-c",
                "mcp_servers.dummyplane.bearer_token_env_var='DUMMYPLANE_MCP_TOKEN'"
            ]
        );
        let fleet = cli_args(Role::Fleet, "http://127.0.0.1:4242/mcp");
        for feature in FLEET_FEATURES_OFF {
            assert!(
                fleet
                    .windows(2)
                    .any(|pair| pair[0] == "--disable" && pair[1] == feature),
                "{feature}"
            );
        }
        assert!(fleet.starts_with(&agent));
    }

    #[test]
    fn a_fleet_loses_the_user_s_servers() {
        let text = profile_toml(
            &profile(Role::Fleet, false),
            &["supabase".into(), "a.b".into(), "dummyplane".into()],
        );
        assert!(text.contains("[mcp_servers.\"supabase\"]\nenabled = false\n"));
        assert!(
            text.contains("[mcp_servers.\"a.b\"]\nenabled = false\n"),
            "a dotted name stays one key"
        );
        assert!(
            !text.contains("[mcp_servers.\"dummyplane\"]"),
            "its own server is never turned off"
        );
    }

    #[test]
    fn a_fleet_reading_linear_gets_its_read_only_endpoint_in_place_of_the_user_s() {
        let text = profile_toml(&profile(Role::Fleet, true), &["linear".into()]);
        assert!(text.contains(
            "[mcp_servers.linear]\nurl = \"https://mcp.linear.app/mcp/readonly\"\nenabled = true\n"
        ));
        assert!(!text.contains("[mcp_servers.\"linear\"]\nenabled = false"));
        // An agent never gets it, even if asked.
        assert!(!profile_toml(&profile(Role::Agent, true), &[]).contains("linear"));
    }

    #[test]
    fn a_fleet_turns_off_the_user_s_servers_then_checks_that_codex_did() {
        let home = tempfile::tempdir().unwrap();
        let calls = RefCell::new(0);
        let path = prepare(home.path(), "n1", &profile(Role::Fleet, false), |name| {
            assert_eq!(name, "dummyplane-n1");
            *calls.borrow_mut() += 1;
            let text =
                std::fs::read_to_string(home.path().join("dummyplane-n1.config.toml")).unwrap();
            Ok(
                if text.contains("[mcp_servers.\"vercel\"]\nenabled = false") {
                    on(&["dummyplane"])
                } else {
                    on(&["dummyplane", "vercel"])
                },
            )
        })
        .unwrap();
        assert_eq!(*calls.borrow(), 2);
        assert_eq!(path, home.path().join("dummyplane-n1.config.toml"));
    }

    #[test]
    fn a_fleet_does_not_start_while_a_server_stays_on_or_cannot_be_listed() {
        let home = tempfile::tempdir().unwrap();
        let stays = prepare(home.path(), "n1", &profile(Role::Fleet, false), |_| {
            Ok(on(&["dummyplane", "stubborn"]))
        });
        assert_eq!(
            stays,
            Err("Codex keeps MCP servers on: stubborn".to_string())
        );
        assert!(
            !home.path().join("dummyplane-n1.config.toml").exists(),
            "its profile goes with it"
        );
        let unknown = prepare(home.path(), "n1", &profile(Role::Fleet, false), |_| {
            Err(io::Error::other("boom"))
        });
        assert_eq!(
            unknown,
            Err("Codex's MCP servers could not be listed: boom".to_string())
        );
        assert!(!home.path().join("dummyplane-n1.config.toml").exists());
        // A trusted project's config could point dummyPlane's server, and its token, elsewhere.
        let elsewhere = prepare(home.path(), "n1", &profile(Role::Fleet, false), |_| {
            Ok(vec![Listed {
                name: "dummyplane".into(),
                url: Some("https://elsewhere.example/mcp".into()),
            }])
        });
        assert_eq!(
            elsewhere,
            Err(
                "Codex does not reach dummyPlane's server: https://elsewhere.example/mcp"
                    .to_string()
            )
        );
        let missing = prepare(home.path(), "n1", &profile(Role::Fleet, false), |_| {
            Ok(vec![])
        });
        assert!(missing.is_err());
    }

    #[test]
    fn an_agent_keeps_the_user_s_servers_and_lists_nothing() {
        let home = tempfile::tempdir().unwrap();
        prepare(home.path(), "n1", &profile(Role::Agent, false), |_| {
            panic!("not listed")
        })
        .unwrap();
        assert!(
            prepare(home.path(), "../x", &profile(Role::Agent, false), |_| Ok(
                vec![]
            ))
            .is_err()
        );
    }

    #[test]
    fn signs_in_to_the_read_only_endpoint_the_fleet_s_profile_names() {
        assert_eq!(
            linear_login_args(),
            vec![
                "-c",
                "mcp_servers.linear.url=\"https://mcp.linear.app/mcp/readonly\"",
                "mcp",
                "login",
                "linear"
            ]
        );
    }

    #[test]
    fn reads_the_servers_codex_starts() {
        let json = br#"[{"name":"dummyplane","enabled":true,"transport":{"type":"streamable_http","url":"http://127.0.0.1:4242/mcp"}},{"name":"linear","enabled":false},{"name":"vercel","enabled":true,"transport":{"type":"stdio"}}]"#;
        assert_eq!(
            enabled_servers(json).unwrap(),
            vec![
                Listed {
                    name: "dummyplane".into(),
                    url: Some("http://127.0.0.1:4242/mcp".into())
                },
                Listed {
                    name: "vercel".into(),
                    url: None
                },
            ]
        );
        assert!(enabled_servers(b"{}").is_err());
    }

    #[test]
    fn clears_only_dummyplane_s_profiles() {
        let home = tempfile::tempdir().unwrap();
        for file in [
            "dummyplane-a.config.toml",
            "dummyplane-b_2.config.toml",
            "work.config.toml",
            "config.toml",
            "dummyplane-..config.toml",
        ] {
            std::fs::write(home.path().join(file), "x").unwrap();
        }
        clear(home.path());
        let mut left: Vec<_> = std::fs::read_dir(home.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(
            left,
            vec![
                "config.toml",
                "dummyplane-..config.toml",
                "work.config.toml"
            ]
        );
    }

    #[test]
    fn knows_a_thread_codex_saved_from_one_it_did_not() {
        let home = tempfile::tempdir().unwrap();
        let day = home
            .path()
            .join("sessions")
            .join("2026")
            .join("11")
            .join("11");
        std::fs::create_dir_all(&day).unwrap();
        let id = "01a1c9a1-5e88-7920-b099-408693fc32af";
        std::fs::write(
            day.join(format!("rollout-2026-11-11T13-32-38-{id}.jsonl")),
            "",
        )
        .unwrap();
        assert!(thread_saved(home.path(), id));
        // An older conversation, found only by the walk before a resume.
        let old_day = home
            .path()
            .join("sessions")
            .join("2026")
            .join("10")
            .join("01");
        std::fs::create_dir_all(&old_day).unwrap();
        for day in ["09", "10"] {
            std::fs::create_dir_all(
                home.path()
                    .join("sessions")
                    .join("2026")
                    .join("11")
                    .join(day),
            )
            .unwrap();
        }
        let old_id = "01a1aaaa-5e88-7920-b099-408693fc32af";
        std::fs::write(
            old_day.join(format!("rollout-2026-10-01T09-00-00-{old_id}.jsonl")),
            "",
        )
        .unwrap();
        assert!(!thread_saved(home.path(), old_id));
        assert!(thread_saved_ever(home.path(), old_id));
        assert!(!thread_saved(
            home.path(),
            "01a1c9a1-84b0-7ee0-a247-829519596587"
        ));
        assert_eq!(thread_id(id).as_deref(), Some(id));
        assert_eq!(thread_id("not-a-thread"), None);
    }
}
