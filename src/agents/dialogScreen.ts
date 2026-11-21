import type { AgentId } from "@/ipc/pty";

/**
 * What a dialog that waits for the user asks, as its CLI draws it:
 * - `permission`: Claude Code asks to run a tool ("Do you want to proceed?"), Codex to run a command;
 * - `mcp`: Claude Code's "New MCP server(s) found in this project", before its session opens;
 * - `login`: its login screen;
 * - `trust`: whether to trust its folder;
 * - `question`: any other menu or question (Claude's AskUserQuestion, an MCP server's elicitation…).
 */
export type DialogKind = "permission" | "mcp" | "login" | "trust" | "question";

/** A dialog read on an agent's screen. Its text is the agent's terminal's: untrusted, one line each. */
export interface ScreenDialog {
  kind: DialogKind;
  /** Its first line ("Bash command", "8 new MCP servers found in this project"). */
  title: string;
  /** The line under its title, if it is neither its question nor a choice (what a permission request is for). */
  detail?: string;
  /** The question it asks, when apart from its title ("Do you want to proceed?"). */
  question?: string;
  /** Its choices, top to bottom, as drawn without the cursor; `selected`, the one under the cursor. */
  options: string[];
  selected?: number;
  /** An unattended session's request, which Claude Code refuses by itself this long after the screen was read. */
  blocksInMs?: number;
}

/** A rule Claude draws above its dialogs; the one under them carries its session's name, so is no rule here. */
const RULE = /^[─━]{8,}$/;
/** A permission request's dashed rules around its command. */
const DASHED = /^[╌┄-]{8,}$/;
/**
 * The keys a dialog's last line names: Claude's "Enter to confirm · Esc to cancel", "Space to select · Esc to reject
 * all", "Esc to cancel · Tab to amend", Codex's "enter continue · esc back". Never a turn's "esc to interrupt".
 */
const FOOTER = /enter to (confirm|continue|select)|esc to (cancel|reject|exit|go back)|space to select|tab to amend|enter continue · esc back/i;
/** Lines a dialog's footer may have under it: Claude's rule with its session's name, its mode line. */
const UNDER_FOOTER = 4;
/** How far above its footer a dialog's first line may be. */
const MAX_DIALOG_LINES = 30;
const CURSOR = /^[❯›]\s*/;
const SCROLL = /^[↑↓]\s*/;
const MCP = /new MCP servers? found in this project/i;
const LOGIN = /select login method|paste code here|(log|sign) ?in (with|to) /i;
/** Claude Code's login screens, which name no keys. */
const LOGIN_SCREEN = /select login method|paste code here/i;
const PERMISSION: Partial<Record<AgentId, RegExp>> = {
  claude: /^do you want to /i,
  codex: /^(would you like to (run|make|apply)|allow )/i,
};
const BLOCKS = /automatically block this request in (\d+):(\d\d)/i;
/** Each text is cut there: it is typed into another agent's terminal. */
const MAX_TEXT = 160;

const tidy = (line: string) => line.replace(/^[│┃]\s?/, "").replace(/\s+/g, " ").trim();
const cut = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1).trimEnd()}…` : text);

/** Its lines, from its first one to its footer (included), or null when the screen ends on no dialog. */
function dialogLines(lines: readonly string[]): string[] | null {
  let footer = -1;
  for (let i = lines.length - 1, seen = 0; i >= 0 && seen <= UNDER_FOOTER; i--) {
    if (!lines[i]) continue;
    if (FOOTER.test(lines[i])) {
      footer = i;
      break;
    }
    // Claude's input box under it (its `❯` under a rule): what is above is its conversation.
    if (CURSOR.test(lines[i]) && lines[i - 1]?.startsWith("──")) return null;
    seen++;
  }
  if (footer === -1) {
    // A login screen names no keys: its line among the last ones.
    const tail = lines.slice(-20);
    const at = tail.findIndex((line) => LOGIN_SCREEN.test(line));
    return at === -1 ? null : tail.slice(at);
  }
  let start = Math.max(0, footer - MAX_DIALOG_LINES);
  for (let i = footer - 1; i >= start; i--) {
    if (RULE.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  return lines.slice(start, footer + 1);
}

/** Its own lines first: a command it asks to run may well quote another dialog's words. */
function kindOf(content: readonly string[], agent: AgentId): DialogKind {
  if (content.some((line) => PERMISSION[agent]?.test(line))) return "permission";
  const text = content.join(" ");
  if (MCP.test(text)) return "mcp";
  if (LOGIN.test(text)) return "login";
  const trust = agent === "codex" ? /trust this folder\?/i.test(text) : /trust/i.test(text) && /folder/i.test(text);
  return trust ? "trust" : "question";
}

/** Its lines but for its footer and dashed rules, blank lines kept (they part its choices from the rest), none at its end. */
function bodyOf(screen: string, agent: AgentId): string[] | null {
  if (agent !== "claude" && agent !== "codex") return null;
  const found = dialogLines(screen.split("\n").map(tidy));
  if (!found) return null;
  const hasFooter = FOOTER.test(found[found.length - 1]);
  const body = (hasFooter ? found.slice(0, -1) : found).filter((line) => !DASHED.test(line));
  while (body.length > 0 && !body[body.length - 1]) body.pop();
  return body;
}

/**
 * The text dummyPlane's own guards start their "ask" with (a recursive delete outside the agent's folder:
 * `src-tauri/src/agents/delete_guard.rs`, `GUARD_MARKER`, the same text): Claude Code shows it in its permission
 * request, and a prompt that bears it is the user's to approve, never a parent's (`@/agents/parentControl`).
 */
export const GUARD_MARKER = "[dummyPlane-guard]";

/**
 * Whether the dialog at the bottom of the screen bears `GUARD_MARKER`, wherever the terminal's width wrapped it (or a
 * border split it). Its lines whole: a wide terminal's line is longer than `dialogBody` keeps.
 */
export function guardedDialog(screen: string, agent: AgentId = "claude"): boolean {
  const body = bodyOf(screen, agent);
  return body !== null && body.join("").replace(/[\s│┃]/g, "").includes(GUARD_MARKER);
}

/**
 * The lines of the dialog `dialogOf` reads, its footer and rules left out, each tidied and cut: what a parent reads
 * before it answers one (the command a permission asks to run, a guard's reason), not only its title. Null when
 * the screen ends on none. Untrusted: the agent's terminal's text.
 */
export function dialogBody(screen: string, agent: AgentId = "claude"): string[] | null {
  const body = bodyOf(screen, agent);
  return body && body.filter(Boolean).map(cut);
}

/**
 * The dialog that holds an agent's screen at its bottom, or null: one whose footer names its keys, under a rule
 * (Claude) or not (Codex), or Claude's login screen. Text quoting a dialog higher up (a teammate's screen read
 * aloud, a grep of this file) is no dialog; callers read it only while the CLI's prompt is not up.
 */
export function dialogOf(screen: string, agent: AgentId = "claude"): ScreenDialog | null {
  const body = bodyOf(screen, agent);
  if (!body) return null;
  const content = body.filter(Boolean);
  if (content.length === 0) return null;
  const kind = kindOf(content, agent);
  const title = content[0];
  // Its permission question, else the first line that asks one: a command quoted above it may hold a "?".
  const rest = content.slice(1);
  const asks = rest.find((line) => PERMISSION[agent]?.test(line)) ?? rest.find((line) => line.endsWith("?")) ?? rest.find((line) => line.includes("?"));
  const question = asks?.slice(0, asks.lastIndexOf("?") + 1);
  // Its choices: its last paragraph, but for its question.
  const last = body.lastIndexOf("");
  const paragraph = body.slice(last + 1).filter((line) => line !== asks && line !== title);
  let selected: number | undefined;
  const options = paragraph.map((line, i) => {
    if (CURSOR.test(line)) selected = i;
    return cut(line.replace(CURSOR, "").replace(SCROLL, ""));
  });
  const detail = content.slice(1).find((line) => line !== asks && !paragraph.includes(line));
  const blocks = BLOCKS.exec(content.join(" "));
  return {
    kind,
    title: cut(title),
    ...(detail ? { detail: cut(detail) } : {}),
    ...(question ? { question: cut(question) } : {}),
    options,
    ...(selected !== undefined ? { selected } : {}),
    ...(blocks ? { blocksInMs: (Number(blocks[1]) * 60 + Number(blocks[2])) * 1000 } : {}),
  };
}
