//! Claude Code's own colours in a dummyPlane terminal: its prompt, accents,
//! panels and diffs in the palette's colours, not in its default 24-bit theme.
//!
//! The theme is Claude's ANSI-only dark theme (`dark-ansi`): every colour it
//! draws is one of the 16 that xterm takes from the palette
//! (src/nodes/terminal/terminalTheme.ts), so a palette switch recolours a
//! running Claude at once, with the terminal. Terminals are dark in every
//! palette, hence the dark base. On top of it, `claude_theme.json` moves the
//! backgrounds `dark-ansi` paints in the bright black (the palette's dim text
//! colour, too light under its text) to the body a step lighter, and its diff
//! lines to dark 256-colour greens and reds. src/nodes/terminal/claudeTheme.test.ts
//! computes each text-on-background pair in every palette.
//!
//! Claude reads custom themes from `<config dir>/themes/<slug>.json` and is
//! given `"theme": "custom:dummyplane"` in a terminal's `--settings` file only:
//! sessions outside dummyPlane keep the user's own theme, and a theme the user
//! sets in their settings wins in dummyPlane too.

use std::path::{Path, PathBuf};

use serde_json::Value;

/// The theme file, the same in every palette.
pub const THEME_JSON: &str = include_str!("claude_theme.json");

const SLUG: &str = "dummyplane";

/// What a terminal's settings name: Claude's way to pick a custom theme.
pub const SETTING: &str = "custom:dummyplane";

fn theme_file(config_dir: &Path) -> PathBuf {
    config_dir.join("themes").join(format!("{SLUG}.json"))
}

/// Writes the theme into Claude's folder, unless it is already there as it
/// should be. True when Claude will find it.
pub fn install(config_dir: &Path) -> bool {
    let path = theme_file(config_dir);
    // Rewritten only when it differs: Claude may be watching the folder.
    if std::fs::read_to_string(&path).is_ok_and(|text| text == THEME_JSON) {
        return true;
    }
    let written = path
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| std::fs::write(&path, THEME_JSON));
    written
        .inspect_err(|err| log::warn!("Claude's theme not written to {}: {err}", path.display()))
        .is_ok()
}

/// The `theme` a settings file sets, if any.
fn theme_in(settings: &Path) -> Option<String> {
    let bytes = std::fs::read(settings).ok()?;
    // Notepad saves with a byte order mark.
    let bytes = bytes.strip_prefix("\u{feff}".as_bytes()).unwrap_or(&bytes);
    let read: Value = serde_json::from_slice(bytes).ok()?;
    read.get("theme")?
        .as_str()
        .filter(|theme| !theme.trim().is_empty())
        .map(str::to_owned)
}

/// The theme the user chose in the settings Claude reads in `cwd`: the
/// project's local settings, its shared ones, then the user's.
pub fn user_theme(cwd: &Path, user: Option<&Path>) -> Option<String> {
    let project = cwd.join(".claude");
    [
        project.join("settings.local.json"),
        project.join("settings.json"),
    ]
    .iter()
    .find_map(|file| theme_in(file))
    .or_else(|| user.and_then(theme_in))
}

/// The `theme` one terminal's settings get: dummyPlane's, installed in the
/// terminal's Claude folder, unless the user chose one, or the file could not
/// be written (Claude then keeps its own theme).
pub fn for_terminal(cwd: &Path, config_dir: Option<&Path>) -> Option<&'static str> {
    let user = config_dir.map(|dir| dir.join("settings.json"));
    if user_theme(cwd, user.as_deref()).is_some() {
        return None;
    }
    install(config_dir?).then_some(SETTING)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("dp-claude-theme-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn is_claude_s_ansi_dark_theme_with_overrides_claude_accepts() {
        let theme: Value = serde_json::from_str(THEME_JSON).unwrap();
        assert_eq!(theme["base"], "dark-ansi");
        assert_eq!(theme["name"], "dummyPlane");
        let overrides = theme["overrides"].as_object().unwrap();
        assert!(!overrides.is_empty());
        for (key, value) in overrides {
            let value = value.as_str().unwrap();
            // Claude keeps an override only in one of its colour forms; ansi256 up to 255.
            let ansi = value.strip_prefix("ansi:").is_some();
            let cube = value
                .strip_prefix("ansi256(")
                .and_then(|rest| rest.strip_suffix(')'))
                .and_then(|n| n.parse::<u8>().ok())
                .is_some();
            assert!(ansi || cube, "{key}: {value}");
        }
    }

    #[test]
    fn installs_the_theme_in_claude_s_folder_once() {
        let dir = folder("install");
        assert!(install(&dir));
        let path = dir.join("themes").join("dummyplane.json");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), THEME_JSON);
        // Already there as it should be: left alone.
        let before = std::fs::metadata(&path).unwrap().modified().unwrap();
        assert!(install(&dir));
        assert_eq!(
            std::fs::metadata(&path).unwrap().modified().unwrap(),
            before
        );
        // Changed by hand: put back.
        std::fs::write(&path, "{}").unwrap();
        assert!(install(&dir));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), THEME_JSON);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_terminal_gets_dummyplane_s_theme_unless_the_user_chose_one() {
        let config = folder("config");
        let cwd = folder("cwd");
        assert_eq!(for_terminal(&cwd, Some(&config)), Some(SETTING));
        assert!(config.join("themes").join("dummyplane.json").exists());

        // The user's own settings, saved with a byte order mark.
        std::fs::write(
            config.join("settings.json"),
            "\u{feff}{\"theme\":\"light\"}",
        )
        .unwrap();
        assert_eq!(for_terminal(&cwd, Some(&config)), None);
        std::fs::remove_file(config.join("settings.json")).unwrap();

        // The project's, local or shared.
        std::fs::create_dir_all(cwd.join(".claude")).unwrap();
        std::fs::write(
            cwd.join(".claude").join("settings.json"),
            r#"{"theme":"dark-daltonized"}"#,
        )
        .unwrap();
        assert_eq!(user_theme(&cwd, None).as_deref(), Some("dark-daltonized"));
        assert_eq!(for_terminal(&cwd, Some(&config)), None);
        // An empty one says nothing.
        std::fs::write(cwd.join(".claude").join("settings.json"), r#"{"theme":""}"#).unwrap();
        assert_eq!(for_terminal(&cwd, Some(&config)), Some(SETTING));

        let _ = std::fs::remove_dir_all(&config);
        let _ = std::fs::remove_dir_all(&cwd);
    }

    #[test]
    fn no_claude_folder_no_theme() {
        let cwd = folder("nofolder");
        assert_eq!(for_terminal(&cwd, None), None);
        let _ = std::fs::remove_dir_all(&cwd);
    }
}
