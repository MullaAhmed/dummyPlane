import { dialogOf, type ScreenDialog } from "@/agents/dialogScreen";
import type { AgentId } from "@/ipc/pty";

/** What readiness reads of an agent's terminal, and how it answers it. */
export interface ReadyProbe {
  running(): boolean;
  quietMs(): number;
  screen(): string;
  press(keys: string): Promise<void>;
  /** The CLI it runs: each draws its prompt and its trust question its own way. Claude when unsaid. */
  agent?: AgentId;
  /**
   * Past the minute, whether to wait on: a startup question only the user may answer (a project's new MCP server)
   * holds Claude's prompt for as long as they take. Unsaid, the minute is all.
   */
  waitLonger?(): boolean;
  /** Told once, when the minute is over and `waitLonger` keeps it waiting. */
  slow?(): void;
  /**
   * How long its prompt stays still before it counts as up: `READY_QUIET_MS` for a task about to be typed into it; none
   * for a probe that types nothing (`@/agents/firstQuestion`), which the user may type into at once.
   */
  readyQuietMs?: number;
  /**
   * A dialog only the user answers holds it (a project's new MCP servers, a login, a trust question it may not
   * answer), read on its still screen; null once it is gone. Told on each change, and null on the way out.
   */
  held?(dialog: ScreenDialog | null): void;
}

export const READY_QUIET_MS = 2000;
export const READY_TIMEOUT_MS = 60_000;
/** How long the trust prompt stays still before a key: Claude draws its menu before it takes keys. */
export const TRUST_QUIET_MS = 500;
/** Between two keys to the trust prompt: a Down the menu missed is sent again after this. */
const TRUST_RETRY_MS = 1000;
const TRUST_MAX_DOWNS = 4;
/** After the Enter it gave the trust prompt, how long its menu may stand before Claude redraws (a loaded machine). */
const TRUST_SETTLE_MS = 5000;
const TICK_MS = 250;
/**
 * Claude's prompt is up: the last `❯` line on screen is its input box, under a
 * rule (final review H2: a resumed conversation pushes the welcome banner off
 * the screen). A trust prompt's `❯` sits under no rule.
 */
export function claudeUp(screen: string): boolean {
  const lines = screen.split("\n").map((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("❯")) return i > 0 && lines[i - 1].startsWith("──");
  }
  return false;
}

/**
 * Codex's prompt is up and idle (checked on Codex 0.167): its input line `›`, with
 * the "? for shortcuts" hint under it, which it shows only while nothing is typed
 * there, and no "esc to interrupt": during a turn the prompt stays drawn under its
 * "Working" line. Its trust question has `›` options but no hint.
 */
export function codexUp(screen: string): boolean {
  const lines = screen.split("\n").map((line) => line.trim());
  if (lines.some((line) => line.includes("esc to interrupt"))) return false;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("›")) return lines.slice(i + 1).some((line) => line.includes("for shortcuts"));
  }
  return false;
}

/** The CLI's prompt is up; a CLI dummyPlane cannot read is taken at its word. */
export function promptUp(agent: AgentId, screen: string): boolean {
  if (agent === "claude") return claudeUp(screen);
  if (agent === "codex") return codexUp(screen);
  return true;
}

/**
 * The next key for Claude's "trust this folder" prompt, or null while it does
 * not show its options: Down while "No, exit" is selected, Enter only on
 * "Yes" (mission README: Claude Code lists "No, exit" first, and a Down
 * sent before its menu takes keys is lost, so Enter would quit Claude).
 * Codex's ("Trust this folder?") lists "Trust and continue" first: Enter on it, Up otherwise.
 */
export function trustKey(screen: string, agent: AgentId = "claude"): string | null {
  if (agent === "codex") {
    if (!/trust this folder\?/i.test(screen)) return null;
    const selected = screen.split("\n").find((line) => line.trimStart().startsWith("›"));
    if (!selected) return null;
    return /trust and continue/i.test(selected) ? "\r" : "\x1b[A";
  }
  if (!/trust/i.test(screen) || !/folder/i.test(screen)) return null;
  const selected = screen.split("\n").find((line) => line.trimStart().startsWith("❯"));
  if (!selected) return null;
  return /yes/i.test(selected) ? "\r" : "\x1b[B";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * True once the agent can take its sub-task: it runs, its trust prompt was
 * accepted (once — only dummyPlane's fresh worktrees ask), Claude's prompt is up
 * and quiet for 2 s. False after 60 s, unless `waitLonger` keeps it waiting:
 * then false once it says no more, `slow` told once at the minute. A dialog
 * that holds it meanwhile is told to `held`, which hears null when it is gone.
 * `acceptTrust`: false outside those worktrees — the prompt then waits for the user.
 */
export async function whenReady(probe: ReadyProbe, wait: (ms: number) => Promise<void> = sleep, acceptTrust = true): Promise<boolean> {
  const agent = probe.agent ?? "claude";
  let trusted = !acceptTrust;
  let downs = 0;
  let keyAt = -Infinity;
  let warned = false;
  // The dialog last told to `held`, by kind and title: a redraw of the same one is no news.
  let shown: string | null = null;
  const show = (dialog: ScreenDialog | null) => {
    const seen = dialog && `${dialog.kind}:${dialog.title}`;
    if (seen === shown) return;
    shown = seen;
    probe.held?.(dialog);
  };
  try {
    for (let waited = 0; ; waited += TICK_MS) {
      if (waited >= READY_TIMEOUT_MS) {
        if (!probe.waitLonger?.()) return false;
        if (!warned) {
          warned = true;
          probe.slow?.();
        }
      }
      if (probe.running()) {
        const screen = probe.screen();
        const key = trusted ? null : trustKey(screen, agent);
        if (key) {
          // One key at a time, on a still menu; the screen tells whether it took.
          if (probe.quietMs() >= TRUST_QUIET_MS && waited - keyAt >= TRUST_RETRY_MS && (key === "\r" || downs < TRUST_MAX_DOWNS)) {
            keyAt = waited;
            if (key === "\r") trusted = true;
            else downs++;
            await probe.press(key);
          }
        } else if (promptUp(agent, screen)) {
          if (probe.quietMs() >= (probe.readyQuietMs ?? READY_QUIET_MS)) return true;
        } else if (probe.held && probe.quietMs() >= TRUST_QUIET_MS) {
          // Its trust prompt, when answered here, is none of the user's: `key` took it above, and its menu may stand
          // a while after the Enter before Claude redraws. Still there past that, the Enter was lost: the user's.
          const dialog = dialogOf(screen, agent);
          if (!(dialog?.kind === "trust" && acceptTrust && waited - keyAt < TRUST_SETTLE_MS)) show(dialog);
        }
      }
      await wait(TICK_MS);
    }
  } finally {
    if (shown !== null) probe.held?.(null);
  }
}
