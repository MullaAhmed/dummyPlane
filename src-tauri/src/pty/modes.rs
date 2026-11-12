//! The terminal modes a program's output switches (alternate screen, mouse,
//! cursor, scroll margins…), followed byte by byte: a replay that lost the
//! bytes that set them can set them again (`Scrollback`). Modelled on xterm.js
//! 6, the terminal the replay is written into: one mouse protocol and one mouse
//! encoding at a time, scroll margins per buffer, DECSTR a partial reset.

use std::io::Write;

/// Parameters kept per sequence, as in xterm.js: later ones are ignored.
const MAX_PARAMS: usize = 32;
/// A parameter grows no further: no mode followed here comes near it.
const MAX_PARAM: u32 = 99_999;
/// Stands for a sequence with several intermediate bytes, none of which we follow.
const SEVERAL: u8 = 0xff;

const ESC: u8 = 0x1b;
const CAN: u8 = 0x18;
const SUB: u8 = 0x1a;

/// Which mouse events the terminal reports (`?9`, `?1000`, `?1002`, `?1003`):
/// the last one set wins, resetting any of them turns reporting off.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MouseProtocol {
    #[default]
    None,
    X10,
    Vt200,
    Drag,
    Any,
}

/// How mouse reports are encoded (`?1006`, `?1016`). xterm.js ignores `?1005`
/// and `?1015`, so they are not followed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MouseEncoding {
    #[default]
    Default,
    Sgr,
    SgrPixels,
}

/// A scroll region (DECSTBM) narrower than the screen, as the program sent it:
/// `top` from 1, `bottom` 0 for the last row, whose number only the terminal knows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Margins {
    pub top: u32,
    pub bottom: u32,
}

/// The modes as the output so far left them; `Default` is a fresh terminal's.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Modes {
    pub alt_screen: bool,
    pub mouse: MouseProtocol,
    pub encoding: MouseEncoding,
    pub focus_events: bool,
    pub cursor_hidden: bool,
    pub bracketed_paste: bool,
    pub app_cursor_keys: bool,
    /// Each buffer has its own; leaving the alternate screen clears its margins.
    pub normal_margins: Option<Margins>,
    pub alt_margins: Option<Margins>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum State {
    /// Text, and the bodies of strings (OSC, DCS, SOS, PM, APC): in both, only an
    /// escape starts what could change a mode.
    #[default]
    Ground,
    Escape,
    EscapeIntermediate,
    /// Right after `ESC [`: a private marker (`?`) may only come here.
    CsiEntry,
    CsiParam,
    CsiIntermediate,
    /// A malformed sequence, skipped up to its final byte.
    CsiIgnore,
}

/// Follows `Modes` across any split of the output into chunks: a sequence cut
/// between two `feed`s is read whole. Its memory is fixed, whatever it is fed.
#[derive(Clone, Debug, Default)]
pub struct ModeTracker {
    modes: Modes,
    /// The bytes fed so far, and that count when each buffer's margins were
    /// last set: `[normal, alternate]`.
    fed: u64,
    margins_at: [u64; 2],
    state: State,
    prefix: u8,
    intermediate: u8,
    params: [u32; MAX_PARAMS],
    len: usize,
    /// Digits after a `:` belong to a subparameter, which no mode followed here has.
    in_sub: bool,
    /// Parameters past `MAX_PARAMS` are dropped.
    full: bool,
}

impl ModeTracker {
    pub fn feed(&mut self, bytes: &[u8]) {
        let mut i = 0;
        while i < bytes.len() {
            if self.state == State::Ground {
                // Most output is text: skip straight to the next escape.
                match bytes[i..].iter().position(|&b| b == ESC) {
                    Some(at) => {
                        i += at + 1;
                        self.state = State::Escape;
                    }
                    None => break,
                }
                continue;
            }
            let byte = bytes[i];
            i += 1;
            self.step(byte, self.fed + i as u64);
        }
        self.fed += bytes.len() as u64;
    }

    #[cfg(test)]
    pub fn modes(&self) -> Modes {
        self.modes
    }

    /// The sequences that bring a fresh terminal to these modes, nothing when it
    /// is already there. Margins set at or before `resized_at` (a count of bytes
    /// fed) are left out: xterm.js clears them when the terminal changes size.
    pub fn restore(&self, resized_at: u64) -> Vec<u8> {
        let modes = &self.modes;
        let fresh = |margins: Option<Margins>, buffer: usize| {
            margins.filter(|_| self.margins_at[buffer] > resized_at)
        };
        let mut out = Vec::new();
        // Margins are the buffer's own: the normal one's are set before leaving it.
        if let Some(margins) = fresh(modes.normal_margins, 0) {
            write_margins(&mut out, margins);
        }
        if modes.alt_screen {
            out.extend_from_slice(b"\x1b[?1049h");
            if let Some(margins) = fresh(modes.alt_margins, 1) {
                write_margins(&mut out, margins);
            }
        }
        if modes.app_cursor_keys {
            out.extend_from_slice(b"\x1b[?1h");
        }
        if modes.cursor_hidden {
            out.extend_from_slice(b"\x1b[?25l");
        }
        if modes.bracketed_paste {
            out.extend_from_slice(b"\x1b[?2004h");
        }
        if modes.focus_events {
            out.extend_from_slice(b"\x1b[?1004h");
        }
        out.extend_from_slice(match modes.mouse {
            MouseProtocol::None => b"",
            MouseProtocol::X10 => b"\x1b[?9h",
            MouseProtocol::Vt200 => b"\x1b[?1000h",
            MouseProtocol::Drag => b"\x1b[?1002h",
            MouseProtocol::Any => b"\x1b[?1003h",
        });
        out.extend_from_slice(match modes.encoding {
            MouseEncoding::Default => b"",
            MouseEncoding::Sgr => b"\x1b[?1006h",
            MouseEncoding::SgrPixels => b"\x1b[?1016h",
        });
        out
    }

    /// One byte outside the ground state; `at` counts the bytes fed up to it, included.
    fn step(&mut self, byte: u8, at: u64) {
        match byte {
            // Any sequence in progress is abandoned for the new one, or cancelled.
            ESC => {
                self.state = State::Escape;
                return;
            }
            CAN | SUB => {
                self.state = State::Ground;
                return;
            }
            // Other controls are executed without ending the sequence, DEL is ignored.
            0x00..=0x1f | 0x7f => return,
            // Not C1 controls (the output is UTF-8): no sequence has them.
            0x80.. => {
                self.state = State::Ground;
                return;
            }
            _ => {}
        }
        match self.state {
            State::Ground => {}
            State::Escape => match byte {
                b'[' => {
                    self.state = State::CsiEntry;
                    self.prefix = 0;
                    self.intermediate = 0;
                    self.params[0] = 0;
                    self.len = 1;
                    self.in_sub = false;
                    self.full = false;
                }
                0x20..=0x2f => self.state = State::EscapeIntermediate,
                // RIS.
                b'c' => {
                    self.modes = Modes::default();
                    self.state = State::Ground;
                }
                // Another escape, or a string whose body is read as text.
                _ => self.state = State::Ground,
            },
            State::EscapeIntermediate => {
                if byte >= 0x30 {
                    self.state = State::Ground;
                }
            }
            State::CsiEntry | State::CsiParam => match byte {
                b'0'..=b'9' => {
                    if !self.in_sub && !self.full {
                        let param = &mut self.params[self.len - 1];
                        *param = (*param * 10 + u32::from(byte - b'0')).min(MAX_PARAM);
                    }
                    self.state = State::CsiParam;
                }
                b';' => {
                    self.in_sub = false;
                    if self.len < MAX_PARAMS {
                        self.params[self.len] = 0;
                        self.len += 1;
                    } else {
                        self.full = true;
                    }
                    self.state = State::CsiParam;
                }
                b':' => {
                    self.in_sub = true;
                    self.state = State::CsiParam;
                }
                b'<'..=b'?' => {
                    if self.state == State::CsiEntry {
                        self.prefix = byte;
                        self.state = State::CsiParam;
                    } else {
                        self.state = State::CsiIgnore;
                    }
                }
                0x20..=0x2f => {
                    self.intermediate = byte;
                    self.state = State::CsiIntermediate;
                }
                _ => self.dispatch(byte, at),
            },
            State::CsiIntermediate => match byte {
                0x20..=0x2f => self.intermediate = SEVERAL,
                0x30..=0x3f => self.state = State::CsiIgnore,
                _ => self.dispatch(byte, at),
            },
            State::CsiIgnore => {
                if byte >= 0x40 {
                    self.state = State::Ground;
                }
            }
        }
    }

    fn dispatch(&mut self, final_byte: u8, at: u64) {
        self.state = State::Ground;
        match (self.prefix, self.intermediate, final_byte) {
            // DECSET, DECRST.
            (b'?', 0, b'h' | b'l') => {
                for i in 0..self.len {
                    self.set_mode(self.params[i], final_byte == b'h');
                }
            }
            // DECSTBM.
            (0, 0, b'r') => {
                let bottom = if self.len > 1 { self.params[1] } else { 0 };
                self.set_margins(self.params[0], bottom, at);
            }
            // DECSTR, as xterm.js: neither the screen nor the mouse.
            (0, b'!', b'p') => {
                let modes = &mut self.modes;
                modes.cursor_hidden = false;
                modes.app_cursor_keys = false;
                modes.bracketed_paste = false;
                modes.focus_events = false;
                *self.active_margins() = None;
            }
            _ => {}
        }
    }

    fn set_mode(&mut self, mode: u32, on: bool) {
        let modes = &mut self.modes;
        match mode {
            1 => modes.app_cursor_keys = on,
            25 => modes.cursor_hidden = !on,
            47 | 1047 | 1049 => {
                if !on {
                    modes.alt_margins = None;
                }
                modes.alt_screen = on;
            }
            9 | 1000 | 1002 | 1003 => {
                modes.mouse = match (on, mode) {
                    (false, _) => MouseProtocol::None,
                    (true, 9) => MouseProtocol::X10,
                    (true, 1000) => MouseProtocol::Vt200,
                    (true, 1002) => MouseProtocol::Drag,
                    (true, _) => MouseProtocol::Any,
                }
            }
            1004 => modes.focus_events = on,
            1006 if on => modes.encoding = MouseEncoding::Sgr,
            1016 if on => modes.encoding = MouseEncoding::SgrPixels,
            1006 | 1016 => modes.encoding = MouseEncoding::Default,
            2004 => modes.bracketed_paste = on,
            _ => {}
        }
    }

    /// As xterm.js, which also ignores a region of less than two rows.
    fn set_margins(&mut self, top: u32, bottom: u32, at: u64) {
        let top = top.max(1);
        if bottom != 0 && bottom <= top {
            return;
        }
        let margins = (top > 1 || bottom != 0).then_some(Margins { top, bottom });
        self.margins_at[usize::from(self.modes.alt_screen)] = at;
        *self.active_margins() = margins;
    }

    fn active_margins(&mut self) -> &mut Option<Margins> {
        if self.modes.alt_screen {
            &mut self.modes.alt_margins
        } else {
            &mut self.modes.normal_margins
        }
    }
}

fn write_margins(out: &mut Vec<u8>, Margins { top, bottom }: Margins) {
    // Writing into a Vec cannot fail.
    let _ = if bottom == 0 {
        write!(out, "\x1b[{top}r")
    } else {
        write!(out, "\x1b[{top};{bottom}r")
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    fn modes_of(bytes: &[u8]) -> Modes {
        let mut tracker = ModeTracker::default();
        tracker.feed(bytes);
        tracker.modes()
    }

    #[test]
    fn a_fresh_terminal_has_nothing_to_restore() {
        assert_eq!(modes_of(b""), Modes::default());
        assert!(ModeTracker::default().restore(0).is_empty());
        assert_eq!(
            modes_of(b"plain text\r\n\x1b[31mred\x1b[0m\x1b[2J\x1b[H"),
            Modes::default()
        );
    }

    #[test]
    fn follows_each_mode_on_and_off() {
        let on =
            modes_of(b"\x1b[?1h\x1b[?25l\x1b[?1049h\x1b[?1004h\x1b[?2004h\x1b[?1000h\x1b[?1006h");
        assert_eq!(
            on,
            Modes {
                alt_screen: true,
                mouse: MouseProtocol::Vt200,
                encoding: MouseEncoding::Sgr,
                focus_events: true,
                cursor_hidden: true,
                bracketed_paste: true,
                app_cursor_keys: true,
                normal_margins: None,
                alt_margins: None,
            }
        );
        let off = modes_of(
            b"\x1b[?1h\x1b[?25l\x1b[?1049h\x1b[?1004h\x1b[?2004h\x1b[?1000h\x1b[?1006h\
              \x1b[?1l\x1b[?25h\x1b[?1049l\x1b[?1004l\x1b[?2004l\x1b[?1000l\x1b[?1006l",
        );
        assert_eq!(off, Modes::default());
        for alt in [&b"\x1b[?47h"[..], b"\x1b[?1047h", b"\x1b[?1049h"] {
            assert!(modes_of(alt).alt_screen);
        }
        assert!(!modes_of(b"\x1b[?1049h\x1b[?47l").alt_screen);
    }

    #[test]
    fn keeps_one_mouse_protocol_and_one_encoding_as_xterm_js() {
        assert_eq!(modes_of(b"\x1b[?1000;1002h").mouse, MouseProtocol::Drag);
        assert_eq!(
            modes_of(b"\x1b[?1003h\x1b[?1000h").mouse,
            MouseProtocol::Vt200
        );
        assert_eq!(modes_of(b"\x1b[?9h").mouse, MouseProtocol::X10);
        // Resetting any of them turns reporting off.
        assert_eq!(
            modes_of(b"\x1b[?1003h\x1b[?1000l").mouse,
            MouseProtocol::None
        );
        assert_eq!(
            modes_of(b"\x1b[?1006h\x1b[?1016h").encoding,
            MouseEncoding::SgrPixels
        );
        assert_eq!(
            modes_of(b"\x1b[?1016h\x1b[?1006l").encoding,
            MouseEncoding::Default
        );
        // xterm.js dropped the UTF-8 and urxvt encodings.
        assert_eq!(
            modes_of(b"\x1b[?1006h\x1b[?1005h\x1b[?1015h").encoding,
            MouseEncoding::Sgr
        );
        assert_eq!(modes_of(b"\x1b[?1005h\x1b[?1015h"), Modes::default());
    }

    #[test]
    fn reads_several_modes_in_one_sequence_and_ignores_unknown_ones() {
        let modes = modes_of(b"\x1b[?1049;12345;0;1000;;1006h");
        assert!(modes.alt_screen);
        assert_eq!(modes.mouse, MouseProtocol::Vt200);
        assert_eq!(modes.encoding, MouseEncoding::Sgr);
        assert_eq!(
            modes_of(b"\x1b[?7l\x1b[?12h\x1b[?2026h\x1b[?9001h\x1b[?h"),
            Modes::default()
        );
        // A subparameter is not a mode.
        assert!(!modes_of(b"\x1b[?1:1049h").alt_screen);
        assert!(modes_of(b"\x1b[?1049:5h").alt_screen);
    }

    #[test]
    fn follows_only_dec_private_modes() {
        // ANSI modes, other markers, intermediates, a misplaced marker.
        for bytes in [
            &b"\x1b[1049h\x1b[2004h"[..],
            b"\x1b[>1049h",
            b"\x1b[=2004h",
            b"\x1b[?1049$h",
            b"\x1b[?1049 h",
            b"\x1b[1?049h",
            b"\x1b[?10?49h",
        ] {
            assert_eq!(
                modes_of(bytes),
                Modes::default(),
                "{:?}",
                String::from_utf8_lossy(bytes)
            );
        }
        // What follows a skipped sequence is read again.
        assert!(modes_of(b"\x1b[?10?49h\x1b[?1049h").alt_screen);
    }

    #[test]
    fn reads_a_sequence_split_anywhere() {
        let stream = b"a\x1b[?1049h\x1b[?1000;1006hb\x1b[3;20rc\x1b[?2004h\x1b[?25ld";
        let whole = modes_of(stream);
        assert!(whole.alt_screen && whole.bracketed_paste && whole.cursor_hidden);
        let mut bytewise = ModeTracker::default();
        for byte in stream {
            bytewise.feed(std::slice::from_ref(byte));
        }
        assert_eq!(bytewise.modes(), whole);
        for split in 0..=stream.len() {
            let mut tracker = ModeTracker::default();
            tracker.feed(&stream[..split]);
            tracker.feed(&stream[split..]);
            assert_eq!(tracker.modes(), whole, "split at {split}");
        }
    }

    #[test]
    fn controls_inside_a_sequence_do_not_end_it_but_cancel_and_escape_do() {
        // xterm.js executes a line feed inside a sequence and carries on with it.
        assert!(modes_of(b"\x1b[?10\n49h").alt_screen);
        assert!(modes_of(b"\x1b\r[?1049h").alt_screen);
        assert!(!modes_of(b"\x1b[?10\x1849h").alt_screen);
        assert!(!modes_of(b"\x1b[?10\x1a49h").alt_screen);
        assert!(modes_of(b"\x1b[?10\x1b[?1049h").alt_screen);
        // A UTF-8 byte is not part of any sequence.
        assert!(!modes_of(b"\x1b[?10\xc3\xa949h").alt_screen);
    }

    #[test]
    fn string_bodies_are_not_read_as_sequences() {
        // A window title with the text of a sequence in it.
        assert_eq!(modes_of(b"\x1b]0;[?1049h\x07"), Modes::default());
        assert_eq!(modes_of(b"\x1bP[?1049h\x1b\\"), Modes::default());
        assert_eq!(modes_of(b"\x1b_[?2004h\x1b\\"), Modes::default());
        // An escape ends the string and starts a sequence, as in xterm.js.
        assert!(modes_of(b"\x1b]0;title\x1b[?1049h").alt_screen);
        assert!(modes_of(b"\x1b]0;title\x07\x1b[?1049h").alt_screen);
        assert!(modes_of(b"\x1bPq#0;1\x1b\\\x1b[?2004h").bracketed_paste);
    }

    #[test]
    fn ris_resets_everything() {
        let modes = modes_of(b"\x1b[?1049h\x1b[3;9r\x1b[?1003;1006;1004;2004;1h\x1b[?25l\x1bc");
        assert_eq!(modes, Modes::default());
        // Not RIS: `c` after an intermediate.
        assert!(modes_of(b"\x1b[?1049h\x1b(c").alt_screen);
    }

    #[test]
    fn decstr_resets_what_xterm_js_resets_only() {
        let modes =
            modes_of(b"\x1b[2;30r\x1b[?1049h\x1b[3;9r\x1b[?1002;1006;1004;2004;1h\x1b[?25l\x1b[!p");
        assert_eq!(
            modes,
            Modes {
                alt_screen: true,
                mouse: MouseProtocol::Drag,
                encoding: MouseEncoding::Sgr,
                // The inactive buffer keeps its margins.
                normal_margins: Some(Margins { top: 2, bottom: 30 }),
                ..Modes::default()
            }
        );
        // Not DECSTR.
        assert!(modes_of(b"\x1b[?2004h\x1b[p\x1b[?!p\x1b[!!p").bracketed_paste);
    }

    #[test]
    fn follows_the_margins_of_each_buffer() {
        let margins = |top, bottom| Some(Margins { top, bottom });
        assert_eq!(modes_of(b"\x1b[2;20r").normal_margins, margins(2, 20));
        assert_eq!(modes_of(b"\x1b[5r").normal_margins, margins(5, 0));
        assert_eq!(modes_of(b"\x1b[0;20r").normal_margins, margins(1, 20));
        // The whole screen.
        for full in [
            &b"\x1b[r"[..],
            b"\x1b[;r",
            b"\x1b[1r",
            b"\x1b[0;0r",
            b"\x1b[1;0r",
        ] {
            assert_eq!(
                modes_of(&[b"\x1b[2;20r", full].concat()).normal_margins,
                None
            );
        }
        // A region of less than two rows is ignored, as in xterm.js.
        assert_eq!(
            modes_of(b"\x1b[2;20r\x1b[5;3r\x1b[4;4r").normal_margins,
            margins(2, 20)
        );
        // Not DECSTBM.
        assert_eq!(
            modes_of(b"\x1b[?2;20r\x1b[2;20$r\x1b[>2;20r").normal_margins,
            None
        );
        // Per buffer, and leaving the alternate screen clears its own.
        let modes = modes_of(b"\x1b[2;20r\x1b[?1049h\x1b[3;9r");
        assert_eq!(
            (modes.normal_margins, modes.alt_margins),
            (margins(2, 20), margins(3, 9))
        );
        let modes = modes_of(b"\x1b[2;20r\x1b[?1049h\x1b[3;9r\x1b[?1049l");
        assert_eq!(
            (modes.normal_margins, modes.alt_margins),
            (margins(2, 20), None)
        );
        assert_eq!(
            modes_of(b"\x1b[?1049h\x1b[3;9r\x1b[?1049l\x1b[?1049h").alt_margins,
            None
        );
    }

    #[test]
    fn restores_the_alternate_screen_between_the_margins_of_each_buffer() {
        let mut tracker = ModeTracker::default();
        tracker.feed(
            b"\x1b[2;20r\x1b[?1049h\x1b[3r\x1b[?1h\x1b[?25l\x1b[?2004h\x1b[?1004h\x1b[?1003h\x1b[?1016h",
        );
        assert_eq!(
            String::from_utf8_lossy(&tracker.restore(0)),
            "\x1b[2;20r\x1b[?1049h\x1b[3r\x1b[?1h\x1b[?25l\x1b[?2004h\x1b[?1004h\x1b[?1003h\x1b[?1016h"
        );
        let mut restored = ModeTracker::default();
        restored.feed(&tracker.restore(0));
        assert_eq!(restored.modes(), tracker.modes());
        let mut x10 = ModeTracker::default();
        x10.feed(b"\x1b[?9h");
        assert_eq!(x10.restore(0), b"\x1b[?9h");
    }

    #[test]
    fn leaves_out_margins_set_before_a_resize() {
        let mut tracker = ModeTracker::default();
        tracker.feed(b"\x1b[2;20r");
        let set_at = 7;
        tracker.feed(b"\x1b[?1049h\x1b[3;9r");
        assert_eq!(
            tracker.restore(set_at - 1),
            b"\x1b[2;20r\x1b[?1049h\x1b[3;9r"
        );
        // Resized after the normal buffer's margins, before the alternate one's.
        assert_eq!(tracker.restore(set_at), b"\x1b[?1049h\x1b[3;9r");
        assert_eq!(tracker.restore(u64::MAX), b"\x1b[?1049h");
    }

    #[test]
    fn its_memory_stays_bounded_whatever_it_is_fed() {
        // Mode 1049 as the 41st parameter: past what is kept.
        let many = [&b"\x1b[?"[..], &b"1;".repeat(40), b"1049h"].concat();
        assert!(!modes_of(&many).alt_screen);
        let mut first = [&b"\x1b[?1049"[..], &b";1".repeat(100), b"h"].concat();
        assert!(modes_of(&first).alt_screen);
        // An endless number neither overflows nor becomes a mode.
        first = [&b"\x1b[?"[..], &b"9".repeat(10_000), b"h\x1b[?2004h"].concat();
        assert_eq!(
            modes_of(&first),
            Modes {
                bracketed_paste: true,
                ..Modes::default()
            }
        );
        // A sequence that never ends, then a real one.
        let endless = [&b"\x1b[?1049"[..], &b"$".repeat(100_000), b"h\x1b[?1000h"].concat();
        assert_eq!(modes_of(&endless).mouse, MouseProtocol::Vt200);
        assert!(!modes_of(&endless).alt_screen);
        assert!(std::mem::size_of::<ModeTracker>() < 512);
    }
}
