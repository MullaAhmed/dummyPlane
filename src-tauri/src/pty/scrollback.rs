use std::collections::VecDeque;
use std::sync::atomic::{AtomicI64, Ordering};

use super::modes::ModeTracker;

/// Per-terminal cap on retained output.
pub const SCROLLBACK_CAPACITY: usize = 512 * 1024;

/// SGR reset, prepended when replaying a truncated buffer so colors left open by
/// dropped output don't bleed into the restored screen. The modes dropped output
/// left on follow it.
const RESET_ATTRIBUTES: &[u8] = b"\x1b[0m";

/// A scrollback and when it was taken: of two saves of a terminal, the later
/// capture wins, whatever order they reach SQLite in.
pub struct Capture {
    pub at: i64,
    pub data: Vec<u8>,
}

static LAST_CAPTURE: AtomicI64 = AtomicI64::new(0);

/// Capture times only grow, even within one millisecond.
pub fn capture_time() -> i64 {
    let now = crate::db::now_ms();
    let mut last = LAST_CAPTURE.load(Ordering::Relaxed);
    loop {
        let next = now.max(last + 1);
        match LAST_CAPTURE.compare_exchange_weak(last, next, Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => return next,
            Err(seen) => last = seen,
        }
    }
}

/// Ring buffer of the most recent raw PTY output, replayed when a terminal is
/// re-attached or restored after a restart.
pub struct Scrollback {
    buf: VecDeque<u8>,
    capacity: usize,
    truncated: bool,
    dirty: bool,
    /// The modes (alternate screen, mouse…) as the dropped output left them: the
    /// state at the cut, which the bytes kept carry on from.
    cut: ModeTracker,
    /// Bytes pushed so far, and that count when the terminal last changed size.
    pushed: u64,
    resized_at: u64,
}

impl Scrollback {
    pub fn new(capacity: usize) -> Self {
        Self {
            buf: VecDeque::new(),
            capacity,
            truncated: false,
            dirty: false,
            cut: ModeTracker::default(),
            pushed: 0,
            resized_at: 0,
        }
    }

    /// A buffer that starts with the output a previous run of the terminal left
    /// in the database: the relaunch's first save then keeps it, as the screen does.
    /// Not dirty until the new process prints something. Its modes carry on into
    /// the new run's, as they do when the whole buffer is replayed.
    pub fn with_history(capacity: usize, history: &[u8]) -> Self {
        let mut buffer = Self::new(capacity);
        buffer.push(history);
        buffer.dirty = false;
        buffer
    }

    pub fn push(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        self.dirty = true;
        self.pushed += bytes.len() as u64;
        if bytes.len() >= self.capacity {
            self.evict(self.buf.len());
            let dropped = bytes.len() - self.capacity;
            self.cut.feed(&bytes[..dropped]);
            self.buf.extend(&bytes[dropped..]);
            self.truncated = true;
            return;
        }
        let overflow = (self.buf.len() + bytes.len()).saturating_sub(self.capacity);
        if overflow > 0 {
            self.evict(overflow);
            self.truncated = true;
        }
        self.buf.extend(bytes);
    }

    /// The terminal changed size: xterm.js then clears its scroll margins, so
    /// margins set by the output so far are not restored.
    pub fn resized(&mut self) {
        self.resized_at = self.pushed;
    }

    /// Drops the oldest `count` bytes, through the modes they set.
    fn evict(&mut self, count: usize) {
        let (front, back) = self.buf.as_slices();
        let from_front = count.min(front.len());
        self.cut.feed(&front[..from_front]);
        self.cut.feed(&back[..count - from_front]);
        self.buf.drain(..count);
    }

    /// Bytes that are safe to write into a fresh terminal. Once old output has been
    /// dropped the buffer may begin in the middle of an escape sequence, so we skip
    /// to the first newline (or, in a screen redrawn without newlines, to the first
    /// escape sequence), reset attributes and set again the modes the dropped and
    /// skipped output left on (alternate screen, mouse…) before the rest. An
    /// untruncated buffer is replayed as it is.
    pub fn snapshot(&self) -> Vec<u8> {
        let data: Vec<u8> = self.buf.iter().copied().collect();
        if !self.truncated {
            return data;
        }
        let start = match data.iter().position(|&b| b == b'\n') {
            Some(newline) => newline + 1,
            None => data.iter().position(|&b| b == 0x1b).unwrap_or(0),
        };
        // A copy: the skipped bytes are still in the buffer, to be dropped later.
        let mut at_cut = self.cut.clone();
        at_cut.feed(&data[..start]);
        let modes = at_cut.restore(self.resized_at);
        let mut out = Vec::with_capacity(RESET_ATTRIBUTES.len() + modes.len() + data.len() - start);
        out.extend_from_slice(RESET_ATTRIBUTES);
        out.extend_from_slice(&modes);
        out.extend_from_slice(&data[start..]);
        out
    }

    /// True once per batch of new output; lets the periodic flusher skip idle terminals.
    pub fn take_dirty(&mut self) -> bool {
        std::mem::replace(&mut self.dirty, false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::modes::Modes;

    #[test]
    fn capture_times_always_grow() {
        let times: Vec<i64> = (0..1000).map(|_| capture_time()).collect();
        assert!(times.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn a_relaunch_starts_from_the_saved_history_and_is_not_dirty_for_it() {
        let mut sb = Scrollback::with_history(64, b"old\n");
        assert!(!sb.take_dirty());
        sb.push(b"new");
        assert!(sb.take_dirty());
        assert_eq!(sb.snapshot(), b"old\nnew");
    }

    #[test]
    fn keeps_everything_below_capacity() {
        let mut sb = Scrollback::new(16);
        sb.push(b"hello ");
        sb.push(b"world");
        assert_eq!(sb.snapshot(), b"hello world");
    }

    #[test]
    fn drops_oldest_bytes_and_replays_from_first_newline() {
        let mut sb = Scrollback::new(10);
        sb.push(b"\x1b[31mred\nline2\n");
        // 15 bytes into 10: the color escape is dropped, "red\nline2\n" is kept.
        assert_eq!(sb.snapshot(), b"\x1b[0mline2\n");
    }

    #[test]
    fn keeps_the_tail_of_a_chunk_larger_than_capacity() {
        let mut sb = Scrollback::new(4);
        sb.push(b"abcdef\ngh");
        assert_eq!(sb.snapshot(), b"\x1b[0mgh");
    }

    #[test]
    fn replays_whole_buffer_when_truncated_without_newline_or_escape() {
        let mut sb = Scrollback::new(4);
        sb.push(b"abcdefgh");
        assert_eq!(sb.snapshot(), b"\x1b[0mefgh");
    }

    #[test]
    fn skips_a_cut_escape_sequence_when_there_is_no_newline() {
        let mut sb = Scrollback::new(10);
        // The kept tail is "1mcd\x1b[0mef": "1m" is the end of a cut "\x1b[31m".
        sb.push(b"ab\x1b[31mcd\x1b[0mef");
        assert_eq!(sb.snapshot(), b"\x1b[0m\x1b[0mef");
    }

    fn text(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).into_owned()
    }

    fn modes_of(bytes: &[u8]) -> Modes {
        let mut tracker = ModeTracker::default();
        tracker.feed(bytes);
        tracker.modes()
    }

    #[test]
    fn a_cut_buffer_replays_the_modes_its_dropped_output_set() {
        let mut sb = Scrollback::new(64);
        sb.push(b"\x1b[?1049h\x1b[?1000;1002;1006hfullscreen\n");
        sb.push(b"some more output pushed to wrap the ring\n");
        let kept = b"line one of the screen\nline two of the screen\nline three\n";
        sb.push(kept);
        // xterm.js keeps one mouse protocol: 1002 replaced 1000.
        let expected = [&b"\x1b[0m\x1b[?1049h\x1b[?1002h\x1b[?1006h"[..], kept].concat();
        assert_eq!(text(&sb.snapshot()), text(&expected));
    }

    #[test]
    fn modes_switched_off_before_the_cut_are_not_replayed() {
        let mut sb = Scrollback::new(32);
        sb.push(b"\x1b[?1049h\x1b[?1000;1006h\x1b[?25l\x1b[2;9rapp\n");
        sb.push(b"\x1b[r\x1b[?25h\x1b[?1000l\x1b[?1006l\x1b[?1049lbye\n");
        sb.push(b"$ prompt\n$ next prompt\n");
        // As before the modes were followed.
        assert_eq!(sb.snapshot(), b"\x1b[0m$ prompt\n$ next prompt\n");
    }

    #[test]
    fn a_mode_switched_after_the_cut_is_left_to_the_bytes_kept() {
        let mut sb = Scrollback::new(40);
        sb.push(b"\x1b[?1049h\x1b[?1000h\n");
        sb.push(b"cut here........\n\x1b[?1000l\x1b[?2004hkept\n\x1b[?1049l$ \n");
        let snapshot = sb.snapshot();
        // The state at the cut only: mouse and screen as they were there.
        assert!(snapshot.starts_with(b"\x1b[0m\x1b[?1049h\x1b[?1000h\x1b[?1000l"));
        // And the bytes kept switch them, once.
        assert_eq!(
            modes_of(&snapshot),
            Modes {
                bracketed_paste: true,
                ..Modes::default()
            }
        );
    }

    #[test]
    fn reads_a_sequence_cut_by_the_ring_or_split_between_writes() {
        // The ring drops `\x1b[?10` and keeps `49h`: the skipped head completes it.
        let mut sb = Scrollback::new(16);
        sb.push(b"\x1b[?10");
        sb.push(b"49hscreen\nkept\n");
        assert_eq!(sb.snapshot(), b"\x1b[0m\x1b[?1049hkept\n");
        // The dropped bytes end the sequence, written over two pushes.
        let mut sb = Scrollback::new(16);
        sb.push(b"\x1b[?20");
        sb.push(b"04h");
        sb.push(b"\x1b[?10");
        sb.push(b"00h\n0123456789abcdef\n");
        assert_eq!(sb.snapshot(), b"\x1b[0m\x1b[?2004h\x1b[?1000h");
        // Without a newline, the head up to the first escape is skipped, and read.
        let mut sb = Scrollback::new(12);
        sb.push(b"\x1b[?1049h\x1b[2J\x1b[Hscreen");
        assert_eq!(sb.snapshot(), b"\x1b[0m\x1b[?1049h\x1b[Hscreen");
    }

    #[test]
    fn a_reset_clears_the_modes_to_replay() {
        let mut sb = Scrollback::new(24);
        sb.push(b"\x1b[?1049h\x1b[?1003;1006;2004h\x1b[3;9r\x1bc\n");
        sb.push(b"after the reset\n$ prompt\n");
        assert_eq!(sb.snapshot(), b"\x1b[0m$ prompt\n");
    }

    #[test]
    fn margins_are_replayed_only_when_narrower_than_the_screen() {
        let mut sb = Scrollback::new(16);
        sb.push(b"\x1b[2;20r\x1b[?1049h\x1b[3r\n");
        sb.push(b"0123456789\nkept\n");
        assert_eq!(sb.snapshot(), b"\x1b[0m\x1b[2;20r\x1b[?1049h\x1b[3rkept\n");
        let mut sb = Scrollback::new(16);
        sb.push(b"\x1b[2;20r\x1b[?1049h\x1b[3r\x1b[;r\x1b[?1049l\x1b[1;0r\n");
        sb.push(b"0123456789\nkept\n");
        assert_eq!(sb.snapshot(), b"\x1b[0mkept\n");
    }

    #[test]
    fn margins_set_before_a_resize_are_not_replayed() {
        let mut sb = Scrollback::new(16);
        sb.push(b"\x1b[2;20r\x1b[?1049h\n");
        sb.resized();
        sb.push(b"\x1b[?1049l\x1b[?1049h\x1b[3;9r\n");
        sb.push(b"0123456789\nkept\n");
        // The alternate screen's were set again after it.
        assert_eq!(sb.snapshot(), b"\x1b[0m\x1b[?1049h\x1b[3;9rkept\n");
        sb.resized();
        assert_eq!(sb.snapshot(), b"\x1b[0m\x1b[?1049hkept\n");
    }

    #[test]
    fn an_uncut_buffer_is_replayed_byte_for_byte() {
        let stream: &[u8] = b"\x1b[?1049h\x1b[?1000;1006h\x1b[2;9r\x1b[?25lapp\n\x1b[?10";
        let mut sb = Scrollback::new(64);
        sb.push(stream);
        assert_eq!(sb.snapshot(), stream);
        // Full to the byte, still not cut.
        let mut sb = Scrollback::new(stream.len());
        sb.push(&stream[..5]);
        sb.push(&stream[5..]);
        assert_eq!(sb.snapshot(), stream);
    }

    #[test]
    fn a_relaunch_carries_the_modes_of_its_history_on() {
        let mut sb = Scrollback::with_history(32, b"\x1b[?1049h\x1b[?1002hold run\n");
        assert!(!sb.take_dirty());
        assert_eq!(sb.snapshot(), b"\x1b[?1049h\x1b[?1002hold run\n");
        sb.push(b"new run, past the history\n$ \n");
        assert_eq!(
            sb.snapshot(),
            b"\x1b[0m\x1b[?1049h\x1b[?1002hnew run, past the history\n$ \n"
        );
    }

    #[test]
    fn a_history_saved_from_a_cut_buffer_keeps_its_modes() {
        let mut first = Scrollback::new(32);
        first.push(b"\x1b[?1049h\x1b[?1000;1006h\n");
        first.push(b"0123456789012345678901234567\nscreen line\n");
        let saved = first.snapshot();
        assert_eq!(
            saved,
            b"\x1b[0m\x1b[?1049h\x1b[?1000h\x1b[?1006hscreen line\n"
        );
        // Larger than the buffer: the history is cut as it is loaded.
        let mut sb = Scrollback::with_history(24, &saved);
        assert!(!sb.take_dirty());
        assert_eq!(sb.snapshot(), b"\x1b[0m\x1b[?1049h\x1b[?1000h\x1b[?1006h");
        sb.push(b"\x1b[?1006lnew\n");
        assert_eq!(
            modes_of(&sb.snapshot()),
            modes_of(&[&saved[..], b"\x1b[?1006lnew\n"].concat())
        );
    }

    #[test]
    fn a_snapshot_leaves_the_buffer_as_it_was() {
        let mut sb = Scrollback::new(16);
        sb.push(b"\x1b[?10");
        sb.push(b"49hscreen\nkept\n");
        let first = sb.snapshot();
        assert_eq!(sb.snapshot(), first);
        // The skipped head, read for each snapshot, is read for good once dropped.
        sb.push(b"\x1b[?1049lmore output\n");
        assert_eq!(modes_of(&sb.snapshot()), Modes::default());
    }

    /// Replaying any cut of the output, written in any chunks, leaves a terminal in
    /// the modes the whole output left it in.
    #[test]
    fn a_replay_ends_in_the_modes_of_the_whole_output_wherever_the_cut() {
        let stream: Vec<u8> = [
            &b"$ claude\n\x1b[?1004h\x1b[?2004h"[..],
            b"\x1b[?1049h\x1b[?1000;1002;1006h\x1b[?25lscreen\n",
            b"\x1b]0;title with [?1049l in it\x07row\n",
            b"\x1b[2;30r\x1b[?1hscroll region\n\x1b[r\x1b[?25h\n",
            b"\x1b[?1049l\x1b[1;20r\x1b[?1049h\x1b[3;9rboth\n",
            b"\x1b[!psoft reset\n\x1b[?1003h\x1b[?1016hagain\n",
            b"\x1bcreset\n\x1b[?1049h\x1b[?1002;1006h\x1b[5;9r\x1b[?2004hend\n",
            b"\x1b[?1049l\x1b[?2004l\x1b[?1049h\x1b[?1000h\x1b[?1h\x1b[?25ldone\n",
        ]
        .concat();
        for capacity in 40..stream.len() {
            for chunk in [1, 2, 5, 13, stream.len()] {
                let mut sb = Scrollback::new(capacity);
                let mut whole = ModeTracker::default();
                for piece in stream.chunks(chunk) {
                    sb.push(piece);
                    whole.feed(piece);
                    // At every point of the output, not only at its end.
                    assert_eq!(
                        modes_of(&sb.snapshot()),
                        whole.modes(),
                        "capacity {capacity}, chunks of {chunk}"
                    );
                }
            }
        }
    }

    #[test]
    fn empty_buffer_snapshot_is_empty() {
        let mut sb = Scrollback::new(4);
        sb.push(b"");
        assert!(sb.snapshot().is_empty());
    }

    #[test]
    fn dirty_flag_is_set_by_output_and_cleared_on_take() {
        let mut sb = Scrollback::new(8);
        assert!(!sb.take_dirty());
        sb.push(b"");
        assert!(!sb.take_dirty());
        sb.push(b"x");
        assert!(sb.take_dirty());
        assert!(!sb.take_dirty());
    }
}
