import type { AgentId } from "@/ipc/pty";

/** What readiness reads of an agent's terminal, and how it answers it (spec orchestrateur §7.3). */
export interface ReadyProbe {
  running(): boolean;
  quietMs(): number;
  screen(): string;
  press(keys: string): Promise<void>;
  /** The CLI it runs: each draws its prompt and its trust question its own way. Claude when unsaid. */
  agent?: AgentId;
}

export const READY_QUIET_MS = 2000;
export const READY_TIMEOUT_MS = 60_000;
/** How long the trust prompt stays still before a key: Claude draws its menu before it takes keys. */
export const TRUST_QUIET_MS = 500;
/** Between two keys to the trust prompt: a Down the menu missed is sent again after this. */
const TRUST_RETRY_MS = 1000;
const TRUST_MAX_DOWNS = 4;
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
 * and quiet for 2 s. False after 60 s. `acceptTrust`: false outside those
 * worktrees — the prompt then waits for the user.
 */
export async function whenReady(probe: ReadyProbe, wait: (ms: number) => Promise<void> = sleep, acceptTrust = true): Promise<boolean> {
  const agent = probe.agent ?? "claude";
  let trusted = !acceptTrust;
  let downs = 0;
  let keyAt = -Infinity;
  for (let waited = 0; waited < READY_TIMEOUT_MS; waited += TICK_MS) {
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
      } else if (promptUp(agent, screen) && probe.quietMs() >= READY_QUIET_MS) {
        return true;
      }
    }
    await wait(TICK_MS);
  }
  return false;
}
