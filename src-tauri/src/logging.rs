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

/// The local server's token travels as `?t=` / `&t=` and in its own header
/// (`X-dummyPlane-Token`, curl's config), the MCP one as a bearer: each is cut
/// from whatever reaches the file, the webview's lines included. A header's
/// name and its scheme are matched whatever their case, as HTTP reads them.
/// Then its control characters are written as escapes (`one_line`).
pub fn redact(text: &str) -> String {
    let query = cut_after(text, &["?t=", "&t="], |c| {
        c == '&' || c == '\'' || c == '"' || c.is_whitespace()
    });
    one_line(&cut_after(
        &query,
        &["bearer ", "x-dummyplane-token: "],
        |c| c == '\'' || c == '"' || c == ',' || c.is_whitespace(),
    ))
}

/// A message on its own line, whatever it carries (a node id from the interface, what a program printed): a line
/// break or an escape sequence is written as `\n`, `\u{1b}`, so it can neither forge the next line nor reach the
/// terminal the log is read in. A tab stays.
fn one_line(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_control() && c != '\t' {
            out.extend(c.escape_default());
        } else {
            out.push(c);
        }
    }
    out
}

/// Replaces what follows each marker (lowercase ASCII, found whatever the
/// text's case), up to a character `ends` accepts, with `…`.
fn cut_after(text: &str, markers: &[&str], ends: impl Fn(char) -> bool) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        // ASCII lowercase keeps every byte where it was: a place found in it is the same in `rest`.
        let lower = rest.to_ascii_lowercase();
        let next = markers
            .iter()
            .filter_map(|marker| lower.find(marker).map(|at| (at, marker.len())))
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

    /// A node id comes from the interface, and an error may carry what a program printed: neither may start a
    /// line of its own in the log, nor send the terminal a log is read in a sequence of its own.
    #[test]
    fn a_message_never_writes_more_than_its_own_line() {
        let node = "n1\r\n[2026-11-14 10:00:00][INFO][dummyplane] forged";
        let clean = redact(&format!("terminal {node} exited\n\u{1b}[2Jcleared"));
        assert!(!clean.contains(['\n', '\r', '\u{1b}']), "{clean}");
        assert_eq!(
            clean,
            "terminal n1\\r\\n[2026-11-14 10:00:00][INFO][dummyplane] forged exited\\n\\u{1b}[2Jcleared"
        );
        // A tab is no line, and stays.
        assert_eq!(redact("a\tb"), "a\tb");
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
    fn a_token_is_cut_whatever_the_case_of_its_header_or_scheme() {
        // HTTP ignores the case of a header's name and of its scheme: a library may write either.
        for line in [
            "authorization: bearer xyz.789",
            "AUTHORIZATION: BEARER xyz.789",
            "{\"Authorization\":\"bEaReR xyz.789\"}",
        ] {
            let clean = redact(line);
            assert!(!clean.contains("xyz.789"), "{clean}");
        }
        // The local server's token in its own header, as curl's config and a request carry it.
        for line in [
            "header = \"X-dummyPlane-Token: tok-123\"",
            "x-dummyplane-token: tok-123, other",
        ] {
            let clean = redact(line);
            assert!(!clean.contains("tok-123"), "{clean}");
        }
        assert_eq!(
            redact("x-dummyplane-token: tok-123, other"),
            "x-dummyplane-token: …, other"
        );
        // The cost of ignoring case: one word of prose after "bearer " goes too, never more.
        assert_eq!(redact("a bearer of news"), "a bearer … news");
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
