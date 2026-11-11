import { openUrl } from "@tauri-apps/plugin-opener";
import type { ILinkHandler } from "@xterm/xterm";

/**
 * Every link a terminal opens, through one door. A terminal finds links two
 * ways: the web-links addon matches an address in the text, and xterm reads
 * the OSC 8 hyperlinks a program writes (Claude Code marks its links so).
 * Without a `linkHandler`, xterm answers an OSC 8 click with the browser's own
 * `confirm("Do you want to navigate to …? This link could potentially be
 * dangerous")` and `window.open`, while the addon has already opened the same
 * address: the prompt stood over a link already open. Both now go to the
 * system browser through the opener, once per click, with no prompt, like
 * every other link in the app.
 */

/** A click reaches both finders: the same address within this window is one click. */
const SAME_CLICK_MS = 500;

let last: { uri: string; at: number } | null = null;

/** Only web addresses open: a terminal's text is a program's, not the user's. */
export function isWebLink(uri: string): boolean {
  try {
    const { protocol } = new URL(uri);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Opens `uri` in the system browser, unless it is not a web address or the same click already opened it. */
export function openTerminalLink(uri: string, now: number = Date.now()): void {
  if (!isWebLink(uri)) return;
  if (last && last.uri === uri && now - last.at < SAME_CLICK_MS) return;
  last = { uri, at: now };
  void openUrl(uri).catch((error: unknown) => console.warn("link not opened", error));
}

/** xterm's handler for OSC 8 hyperlinks: the opener, never `confirm` and `window.open`. */
export const terminalLinkHandler: ILinkHandler = {
  activate: (_event, uri) => openTerminalLink(uri),
  allowNonHttpProtocols: false,
};

/** Tests only: forget the last click. */
export function resetTerminalLinks(): void {
  last = null;
}
