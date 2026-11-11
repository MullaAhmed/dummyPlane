//! The log file a user can send:
//! `%LOCALAPPDATA%\dev.dummyplane.app\logs\dummyplane.log`. Never a token, a
//! terminal's text, an instruction or a file's content.

use tauri::Runtime;
use tauri::plugin::TauriPlugin;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

/// A file is rotated past this size; the three previous ones are kept.
const MAX_FILE_SIZE: u128 = 5_000_000;
const KEPT_FILES: usize = 3;

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };
    let mut targets = vec![Target::new(TargetKind::LogDir {
        file_name: Some("dummyplane".into()),
    })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        .level(level)
        // The libraries under the window stay quiet below a warning.
        .level_for("tao", log::LevelFilter::Warn)
        .level_for("wry", log::LevelFilter::Warn)
        .level_for("tiny_http", log::LevelFilter::Warn)
        .max_file_size(MAX_FILE_SIZE)
        .rotation_strategy(RotationStrategy::KeepSome(KEPT_FILES))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .format(|out, message, record| {
            let now = TimezoneStrategy::UseLocal.get_now();
            out.finish(format_args!(
                "[{}-{:02}-{:02} {:02}:{:02}:{:02}][{}][{}] {}",
                now.year(),
                u8::from(now.month()),
                now.day(),
                now.hour(),
                now.minute(),
                now.second(),
                record.level(),
                record.target(),
                redact(&message.to_string())
            ))
        })
        .build()
}

/// A panic is written to the log before the default report (the release
/// build has no console to show it).
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .map(|text| text.to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "?".into());
        let location = info.location().map(|at| (at.file(), at.line()));
        let thread = std::thread::current();
        log::error!("{}", panic_line(&message, location, thread.name()));
        previous(info);
    }));
}

fn panic_line(message: &str, location: Option<(&str, u32)>, thread: Option<&str>) -> String {
    let place = location.map_or("?".into(), |(file, line)| format!("{file}:{line}"));
    format!(
        "panic in thread {} at {place}: {message}",
        thread.unwrap_or("?")
    )
}

/// The local server's token travels as `?t=` / `&t=` and the MCP one as a
/// bearer: both are cut from whatever reaches the file.
pub fn redact(text: &str) -> String {
    let query = cut_after(text, &["?t=", "&t="], |c| {
        c == '&' || c == '\'' || c == '"' || c.is_whitespace()
    });
    cut_after(&query, &["Bearer "], |c| {
        c == '\'' || c == '"' || c == ',' || c.is_whitespace()
    })
}

/// Replaces what follows each marker, up to a character `ends` accepts, with `…`.
fn cut_after(text: &str, markers: &[&str], ends: impl Fn(char) -> bool) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        let next = markers
            .iter()
            .filter_map(|marker| rest.find(marker).map(|at| (at, marker.len())))
            .min();
        let Some((at, len)) = next else {
            out.push_str(rest);
            return out;
        };
        out.push_str(&rest[..at + len]);
        out.push('…');
        let after = &rest[at + len..];
        rest = &after[after.find(&ends).unwrap_or(after.len())..];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_never_reach_the_log() {
        let line =
            "POST http://127.0.0.1:5000/status/n1?t=abc-123 failed; Authorization: Bearer xyz.789";
        let clean = redact(line);
        assert!(!clean.contains("abc-123"), "{clean}");
        assert!(!clean.contains("xyz.789"), "{clean}");
        assert!(clean.contains("/status/n1"), "{clean}");
    }

    #[test]
    fn a_token_between_other_parameters_is_cut_too() {
        assert_eq!(
            redact("/hook/claude/n?x=1&t=secret&y=2"),
            "/hook/claude/n?x=1&t=…&y=2"
        );
        assert_eq!(redact("'http://h/s?t=secret'"), "'http://h/s?t=…'");
        assert_eq!(
            redact("nothing to hide: t is fine"),
            "nothing to hide: t is fine"
        );
    }

    #[test]
    fn a_panic_message_names_its_place() {
        let text = panic_line("boom", Some(("src/x.rs", 12)), Some("reader"));
        assert_eq!(text, "panic in thread reader at src/x.rs:12: boom");
        assert_eq!(
            panic_line("boom", None, None),
            "panic in thread ? at ?: boom"
        );
    }
}
