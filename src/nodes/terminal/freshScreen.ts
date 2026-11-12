import type { IMarker, Terminal } from "@xterm/xterm";
import { bufferText } from "./bufferText";

/**
 * What a session killed in the middle of a fullscreen program leaves on, switched
 * off: the new process starts on a new PTY and knows none of it. In this order:
 * - `?1049l` leaves the alternate screen (and restores the cursor saved on entering it);
 * - `!p` (DECSTR) is xterm.js's soft reset: the scroll region, a hidden cursor,
 *   application cursor keys and keypad, origin, insert and no-wrap modes, the
 *   character set and the colours, all back to a fresh terminal's, without
 *   moving the cursor. A scroll region left on would keep the lines below from
 *   going up into the scrollback;
 * - the mouse, which DECSTR leaves alone: a shell would get its reports typed as
 *   text. Bracketed paste and focus events too, by name: other terminals' DECSTR
 *   keeps them. ConPTY asks for focus events again when it starts.
 * The backend replays the same after a relaunch (`ModeTracker::leave`).
 */
const FRESH_MODES = "\x1b[?1049l\x1b[!p\x1b[?9;1000;1002;1003;1006;1016;2004;1004l";

/**
 * A clean screen for a new session (final review H2, checked in the app):
 * back on the normal screen and in a fresh terminal's modes (the previous
 * session may have been killed on the alternate one, the mouse on), its lines
 * go up into the scrollback, the cursor to the top, and the marker there.
 * ConPTY paints a new session from the top of the screen, so its banner lands
 * at or below the marker.
 */
export function freshScreen(term: Pick<Terminal, "write" | "rows" | "registerMarker">): Promise<IMarker | undefined> {
  return new Promise((resolve) => {
    term.write(`${FRESH_MODES}\x1b[${term.rows};1H${"\r\n".repeat(term.rows)}\x1b[H`, () => resolve(term.registerMarker(0)));
  });
}

/**
 * The last `lines` lines the session wrote since `marker`. The alternate
 * screen is only ever the current session's (Claude draws there): it is read
 * whole, like the buffer without a marker or once the marker is gone.
 */
export function textSince(term: Pick<Terminal, "buffer">, marker: IMarker | undefined, lines: number): string {
  const buffer = term.buffer.active;
  const from = buffer.type === "normal" && marker && !marker.isDisposed ? marker.line : 0;
  return bufferText(buffer, lines, from);
}
