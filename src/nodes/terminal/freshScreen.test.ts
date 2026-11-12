// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { freshScreen, textSince } from "./freshScreen";

const write = (term: Terminal, data: string) => new Promise<void>((resolve) => term.write(data, resolve));

it("keeps a relaunched Claude's banner, painted from the top of the screen, and drops the previous session's (final review H2)", async () => {
  const term = new Terminal({ rows: 6, cols: 60 });
  // The previous session: its banner on top, its prompt near the bottom.
  await write(term, " Claude Code v1.0.0\r\n> old work\r\n\r\n\r\n  ⏵⏵ auto mode on\x1b[1A");
  const marker = await freshScreen(term);
  await write(term, "── relance ──\r\nPS C:\\demo> claude\r\n");
  expect(textSince(term, marker, 50)).not.toContain("Claude Code v1");
  // ConPTY paints the new session from the top of the screen, line by line (seen in the app).
  await write(term, "\x1b[H Claude Code v2.1.304\x1b[K\r\n> \x1b[K");
  const fresh = textSince(term, marker, 50);
  expect(fresh).toContain("Claude Code v2.1.304");
  expect(fresh).not.toContain("old work");
  term.dispose();
});

it("reads a new session drawn on the alternate screen, though the previous one was killed there (final review H2)", async () => {
  const term = new Terminal({ rows: 6, cols: 60 });
  await write(term, "PS C:\\demo> claude\r\n\x1b[?1049h\x1b[H Claude Code v1.0.0\r\n> old work");
  const marker = await freshScreen(term);
  await write(term, "── relance ──\r\nPS C:\\demo> claude\r\n");
  expect(textSince(term, marker, 50)).not.toContain("Claude Code v1");
  // Claude draws on the alternate screen (seen in the app).
  await write(term, "\x1b[?1049h\x1b[H Claude Code v2.1.304\x1b[K\r\n> \x1b[K");
  const fresh = textSince(term, marker, 50);
  expect(fresh).toContain("Claude Code v2.1.304");
  expect(fresh).not.toContain("old work");
  term.dispose();
});

it("reads a new session that moves to the alternate screen after a previous one on the normal screen (final review H2)", async () => {
  const term = new Terminal({ rows: 6, cols: 60 });
  await write(term, "a\r\nb\r\nc\r\n Claude Code v1.0.0\r\n> old work\r\n");
  const marker = await freshScreen(term);
  await write(term, "── relance ──\r\nPS C:\\demo> claude\r\n");
  await write(term, "\x1b[?1049h\x1b[H Claude Code v2.1.304\x1b[K\r\n> \x1b[K");
  const fresh = textSince(term, marker, 50);
  expect(fresh).toContain("Claude Code v2.1.304");
  expect(fresh).not.toContain("old work");
  term.dispose();
});

/** The modes a program switches, as xterm holds them; the cursor's visibility and the mouse encoding are not in its API. */
function modesOf(term: Terminal) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no public reading of these two
  const core = (term as any)._core;
  return {
    screen: term.buffer.active.type,
    mouse: term.modes.mouseTrackingMode,
    mouseEncoding: core.coreMouseService.activeEncoding as string,
    bracketedPaste: term.modes.bracketedPasteMode,
    focusEvents: term.modes.sendFocusMode,
    cursorKeys: term.modes.applicationCursorKeysMode,
    keypad: term.modes.applicationKeypadMode,
    origin: term.modes.originMode,
    insert: term.modes.insertMode,
    wraparound: term.modes.wraparoundMode,
    cursorHidden: core.coreService.isCursorHidden as boolean,
  };
}

it("leaves the modes of a program killed fullscreen: a relaunched shell gets no mouse reports typed in", async () => {
  const killed = new Terminal({ rows: 6, cols: 60 });
  const fresh = modesOf(killed);
  expect(fresh).toMatchObject({ screen: "normal", mouse: "none", mouseEncoding: "DEFAULT", bracketedPaste: false, cursorHidden: false });
  // Claude Code fullscreen, as its output sets it up; then what other programs leave on.
  await write(killed, "PS C:\\demo> claude\r\n\x1b[?1049h\x1b[?1004h\x1b[?2004h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?25l\x1b[H Claude Code");
  await write(killed, "\x1b[?1h\x1b=\x1b[?6h\x1b[4h\x1b[?7l");
  expect(modesOf(killed)).toMatchObject({ screen: "alternate", mouse: "any", mouseEncoding: "SGR", bracketedPaste: true, focusEvents: true, cursorHidden: true });
  expect(modesOf(killed)).toMatchObject({ cursorKeys: true, keypad: true, origin: true, insert: true, wraparound: false });
  await freshScreen(killed);
  expect(modesOf(killed)).toEqual(fresh);
  killed.dispose();

  // Each mouse protocol and encoding xterm has.
  for (const left of ["\x1b[?9h", "\x1b[?1000h", "\x1b[?1002h\x1b[?1016h", "\x1b[?1003h\x1b[?1006h"]) {
    const term = new Terminal({ rows: 6, cols: 60 });
    await write(term, left);
    expect(modesOf(term).mouse, left).not.toBe("none");
    await freshScreen(term);
    expect(modesOf(term), left).toEqual(fresh);
    term.dispose();
  }
});

it("sends the screen up into the scrollback though a scroll region was left on", async () => {
  const term = new Terminal({ rows: 6, cols: 60 });
  // A region of rows 2 to 4, never taken back: below it, a line feed scrolls nothing.
  await write(term, "top\r\n\x1b[2;4r\x1b[2;1Hold work\r\nmore old work\x1b[6;1Hstatus line");
  const marker = await freshScreen(term);
  expect(term.buffer.active.cursorY).toBe(0);
  expect(term.buffer.active.cursorX).toBe(0);
  expect(textSince(term, marker, 50)).toBe("");
  // The whole screen scrolls again.
  await write(term, "1\r\n2\r\n3\r\n4\r\n5\r\n6\r\n7");
  expect(textSince(term, marker, 50)).toBe("1\n2\n3\n4\n5\n6\n7");
  expect(bufferLines(term)).toContain("status line");
  term.dispose();
});

it("starts the new session in the default colours and character set", async () => {
  const term = new Terminal({ rows: 6, cols: 60 });
  // Red on blue and the line-drawing set, saved with the cursor (ESC 7): leaving the alternate screen restores them.
  await write(term, "\x1b[31;44m\x1b(0\x1b7\x1b[?1049hqqq");
  const marker = await freshScreen(term);
  await write(term, "PS C:\\demo> q");
  expect(textSince(term, marker, 50)).toBe("PS C:\\demo> q");
  const cell = term.buffer.active.getLine(marker!.line)!.getCell(0)!;
  expect(cell.isFgDefault() && cell.isBgDefault()).toBe(true);
  // The lines sent up are blank ones, not blue.
  const above = term.buffer.active.getLine(marker!.line - 1)!.getCell(0)!;
  expect(above.isBgDefault()).toBe(true);
  term.dispose();
});

/** Every line of the buffer, scrollback included. */
function bufferLines(term: Terminal): string {
  const buffer = term.buffer.active;
  return Array.from({ length: buffer.length }, (_, y) => buffer.getLine(y)?.translateToString(true) ?? "").join("\n");
}

it("reads the whole buffer without a marker", async () => {
  const term = new Terminal({ rows: 5, cols: 40 });
  await write(term, "un\r\ndeux");
  expect(textSince(term, undefined, 50)).toBe("un\ndeux");
  term.dispose();
});
