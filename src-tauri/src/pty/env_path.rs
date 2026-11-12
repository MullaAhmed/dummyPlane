//! The PATH terminals start with, re-read: on Windows from the registry, so an
//! agent installed while dummyPlane runs is found; on macOS from the user's
//! login shell, because an app launched from Finder is given a bare PATH.

use std::ffi::OsString;
use std::sync::RwLock;

static REFRESHED: RwLock<Option<OsString>> = RwLock::new(None);

/// Expands `%NAME%` references like a `REG_EXPAND_SZ` value; an unknown
/// variable, or a lone `%`, stays as written.
#[cfg(any(windows, test))]
pub fn expand(raw: &str, var: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => match var(&after[..end]) {
                Some(value) => {
                    out.push_str(&value);
                    rest = &after[end + 1..];
                }
                None => {
                    out.push('%');
                    rest = after;
                }
            },
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// A variable for `expand`: the process's, else the registry's, where an
/// installer may just have created it (its own `%…%` expanded from the
/// process's). Names compare case-insensitively, as Windows does.
#[cfg(any(windows, test))]
pub fn lookup(
    name: &str,
    process: impl Fn(&str) -> Option<String>,
    registry: &[(String, String)],
) -> Option<String> {
    process(name).or_else(|| {
        registry
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| expand(value, &process))
    })
}

#[cfg(any(windows, test))]
fn same_folder(entry: &str) -> String {
    entry.trim_end_matches(['\\', '/']).to_lowercase()
}

/// A quoted entry (`"C:\Program Files\x"`) names the same folder as its
/// unquoted form; the quotes must go, or the folder is not found.
#[cfg(any(windows, test))]
fn unquote(entry: &str) -> &str {
    entry
        .strip_prefix('"')
        .and_then(|entry| entry.strip_suffix('"'))
        .unwrap_or(entry)
}

/// This process's PATH in its order, then the registry's entries it lacks,
/// machine then user (as Windows orders them): a new install is found and
/// what dummyPlane was started with still comes first (final review R5d).
#[cfg(any(windows, test))]
pub fn merge(machine: &str, user: &str, process: &str) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut entries: Vec<&str> = Vec::new();
    for entry in [process, machine, user]
        .into_iter()
        .flat_map(|list| list.split(';'))
    {
        let entry = unquote(entry.trim()).trim();
        if !entry.is_empty() && seen.insert(same_folder(entry)) {
            entries.push(entry);
        }
    }
    entries.join(";")
}

#[cfg(windows)]
const MACHINE_ENVIRONMENT: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";

/// The variables of a registry `Environment` key, `Path` included.
#[cfg(windows)]
fn registry_variables(root: winreg::HKEY, key: &str) -> Vec<(String, String)> {
    let Ok(key) = winreg::RegKey::predef(root).open_subkey(key) else {
        return Vec::new();
    };
    key.enum_values()
        .flatten()
        .filter_map(|(name, _)| {
            key.get_value::<String, _>(&name)
                .ok()
                .map(|value| (name, value))
        })
        .collect()
}

#[cfg(windows)]
fn path_of(variables: &[(String, String)]) -> &str {
    variables
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("Path"))
        .map_or("", |(_, value)| value.as_str())
}

/// Entries of a login shell's PATH that this process's lacks, after the
/// process's own (colon-separated): what dummyPlane was started with still
/// comes first.
#[cfg(any(target_os = "macos", test))]
pub fn merge_login_path(process: &str, login: &str) -> String {
    let mut seen = std::collections::HashSet::new();
    process
        .split(':')
        .chain(login.split(':'))
        .map(str::trim)
        .filter(|entry| !entry.is_empty() && seen.insert(*entry))
        .collect::<Vec<_>>()
        .join(":")
}

/// The text a login shell printed between two markers: its startup files may
/// print banners around what was asked of it.
#[cfg(any(target_os = "macos", test))]
fn between<'a>(text: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let from = text.find(start)? + start.len();
    let to = from + text[from..].find(end)?;
    Some(&text[from..to])
}

#[cfg(target_os = "macos")]
const LOGIN_SHELL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// The PATH the user's login shell builds. A Finder-launched app is given a
/// bare one (`/usr/bin:/bin:...`), so `claude`, `codex` or Homebrew's tools
/// would not be found. Bounded: a slow startup file costs a few seconds, never
/// a hang.
#[cfg(target_os = "macos")]
fn login_shell_path() -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    const START: &str = "__DUMMYPLANE_PATH_START__";
    const END: &str = "__DUMMYPLANE_PATH_END__";
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let script = format!("printf '%s%s%s' '{START}' \"$PATH\" '{END}'");
    let mut child = Command::new(shell)
        .args(["-ilc", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).into_owned()
    });
    let deadline = Instant::now() + LOGIN_SHELL_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20));
            }
            _ => {
                // Too slow: stop it, and do not wait for a reader that a
                // grandchild may keep blocked.
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let output = reader.join().ok()?;
    between(&output, START, END).map(str::to_owned)
}

/// Re-reads the PATH: from the registry on Windows, from the login shell on
/// macOS (no-op elsewhere).
pub fn refresh() {
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        let user_vars = registry_variables(HKEY_CURRENT_USER, "Environment");
        let machine_vars = registry_variables(HKEY_LOCAL_MACHINE, MACHINE_ENVIRONMENT);
        // A user variable overrides a machine one of the same name, as in Windows.
        let registry: Vec<(String, String)> =
            user_vars.iter().chain(&machine_vars).cloned().collect();
        let env = |name: &str| lookup(name, |n| std::env::var(n).ok(), &registry);
        let user = expand(path_of(&user_vars), env);
        let machine = expand(path_of(&machine_vars), env);
        let process = std::env::var("PATH").unwrap_or_default();
        let merged = merge(&machine, &user, &process);
        *REFRESHED.write().unwrap_or_else(|e| e.into_inner()) = Some(merged.into());
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(login) = login_shell_path() {
            let process = std::env::var("PATH").unwrap_or_default();
            let merged = merge_login_path(&process, &login);
            *REFRESHED.write().unwrap_or_else(|e| e.into_inner()) = Some(merged.into());
        }
    }
}

/// The refreshed PATH; `None` until the first refresh.
pub fn current() -> Option<OsString> {
    REFRESHED.read().unwrap_or_else(|e| e.into_inner()).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(name: &str) -> Option<String> {
        match name {
            "USERPROFILE" => Some(r"C:\Users\Me".into()),
            "LOCALAPPDATA" => Some(r"C:\Users\Me\AppData\Local".into()),
            _ => None,
        }
    }

    #[test]
    fn expands_known_variables() {
        assert_eq!(
            expand(r"%USERPROFILE%\bin;;C:\x", vars),
            r"C:\Users\Me\bin;;C:\x"
        );
        assert_eq!(
            expand(r"%LOCALAPPDATA%\Programs\a", vars),
            r"C:\Users\Me\AppData\Local\Programs\a"
        );
    }

    #[test]
    fn reads_a_variable_an_installer_just_created_from_the_registry() {
        // pnpm's setup adds PNPM_HOME and %PNPM_HOME% to the PATH: this
        // process never had the variable (final review R5d).
        let registry = vec![
            ("PNPM_HOME".to_string(), r"%LOCALAPPDATA%\pnpm".to_string()),
            ("USERPROFILE".to_string(), r"C:\Elsewhere".to_string()),
        ];
        let var = |name: &str| lookup(name, vars, &registry);
        assert_eq!(
            expand(r"%PNPM_HOME%;%pnpm_home%\bin;C:\x", var),
            r"C:\Users\Me\AppData\Local\pnpm;C:\Users\Me\AppData\Local\pnpm\bin;C:\x"
        );
        // The process's own value comes first.
        assert_eq!(expand(r"%USERPROFILE%", var), r"C:\Users\Me");
        assert_eq!(expand(r"%NOPE%", var), r"%NOPE%");
    }

    #[test]
    fn keeps_unknown_variables_and_lone_percents() {
        assert_eq!(expand(r"%NOPE%\bin", vars), r"%NOPE%\bin");
        assert_eq!(expand(r"C:\100%\x", vars), r"C:\100%\x");
        assert_eq!(expand("%%", vars), "%%");
    }

    #[test]
    fn keeps_the_process_path_in_its_order_then_adds_the_registry_s_new_entries() {
        // Launched from a shell with its own prepends (nvm, venv), a terminal
        // still finds the same tools first (final review R5d).
        assert_eq!(
            merge(r"C:\m1;C:\m2", r"C:\u1;C:\u2", r"C:\p0;C:\m2;C:\u1"),
            r"C:\p0;C:\m2;C:\u1;C:\m1;C:\u2"
        );
    }

    #[test]
    fn merge_drops_the_quotes_of_a_quoted_entry() {
        assert_eq!(
            merge(r#""C:\Program Files\x""#, "", r""),
            r"C:\Program Files\x"
        );
        assert_eq!(merge(r#""C:\Bin""#, "", r"C:\Bin"), r"C:\Bin");
    }

    #[test]
    fn merge_drops_empty_entries_and_duplicates() {
        assert_eq!(
            merge(r"C:\Bin;;C:\bin\;c:\BIN/", "", r"C:\other\"),
            r"C:\other\;C:\Bin"
        );
        assert_eq!(merge("", "", ""), "");
    }

    #[test]
    fn merge_strips_the_quotes_around_an_entry() {
        assert_eq!(
            merge(r#""C:\Program Files\x""#, "", r"C:\Program Files\x\;C:\y"),
            r"C:\Program Files\x\;C:\y"
        );
        assert_eq!(merge("", "", r#""""#), "");
    }

    #[test]
    fn a_login_shell_path_adds_what_the_process_lacks_after_its_own() {
        // A Finder launch gives a bare PATH; the login shell knows Homebrew,
        // nvm and ~/.local/bin.
        assert_eq!(
            merge_login_path(
                "/usr/bin:/bin",
                "/opt/homebrew/bin:/usr/bin:/Users/me/.local/bin:/bin"
            ),
            "/usr/bin:/bin:/opt/homebrew/bin:/Users/me/.local/bin"
        );
        assert_eq!(merge_login_path("/a::/b", ":/a"), "/a:/b");
        assert_eq!(merge_login_path("", ""), "");
    }

    #[test]
    fn what_a_login_shell_prints_around_the_path_is_ignored() {
        let output = "Last login: today\n__S__/usr/bin:/bin__E__\nbye";
        assert_eq!(between(output, "__S__", "__E__"), Some("/usr/bin:/bin"));
        assert_eq!(between("no markers", "__S__", "__E__"), None);
        assert_eq!(between("__S__ unfinished", "__S__", "__E__"), None);
    }
}
