import { messages } from "@/i18n";
import type { AgentId, Permission } from "@/ipc/pty";
import { agentMessages } from "@/mcp/messages";
import { dialogBody, dialogOf, guardedDialog, type ScreenDialog } from "./dialogScreen";

/**
 * What a parent may do in its own sub-agent's terminal without the user (`@/mcp/subAgentTools`): run one of Claude
 * Code's commands from a fixed list, and answer a dialog the sub-agent waits on by picking one of its options, never
 * by typing. Here: what may be sent, the one policy on dialogs, and the keys. Who is whose parent, and the checks on
 * the terminal (at its prompt, the user not typing in it), are the tools'.
 */

const t = () => messages(agentMessages).parent;

/** Characters that are no text: an Escape or a newline in a command's words would leave the prompt, or send it early. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** /compact's instructions are cut there: a line for its summary, not a brief. */
export const MAX_COMMAND_TEXT = 500;

/**
 * Claude Code's commands a parent may run in its sub-agent, and why each is safe there (`text`: it takes words after
 * it; `changes`: it changes the sub-agent's conversation, so the user is shown it). Both are Claude Code's "local"
 * commands (v2.1): they run and give the prompt back, with no panel left open on its screen.
 * - compact: summarises its conversation to free its context, its task kept; the words say what to keep;
 * - clear: starts a new session with an empty context (the old one stays on disk), its task lost unless sent again
 *   (the tool says so). Its optional name is not taken: a parent has no use for it.
 * Not /context nor /cost (now /usage's alias): they draw a panel ("local-jsx"), which may hold the sub-agent until a
 * key closes it, and dummyPlane's lines would land in it; each is one row here once seen to give the prompt back.
 * Not /model: Claude Code saves the model it sets as the user's default for new sessions ("Set model to … and saved
 * as your default for new sessions"), a setting of theirs. Nor a command that opens a menu (/status, /config,
 * /permissions, /mcp, /resume), starts work of its own (/init, /review), or touches the user's account or settings
 * (/login, /logout, /exit, /memory, /hooks…).
 */
const COMMANDS: Record<string, { text: boolean; changes: boolean }> = {
  compact: { text: true, changes: true },
  clear: { text: false, changes: true },
};
export const PARENT_COMMANDS: readonly string[] = Object.keys(COMMANDS).map((name) => `/${name}`);

export interface ParentCommand {
  /** Its name, with no slash. */
  name: string;
  /** What is typed, on one line. */
  line: string;
  /** Whether it changes the sub-agent's conversation. */
  changes: boolean;
}

/** The command line to type for `raw`, or why it is refused: one of `COMMANDS`, never plain text nor a shell's `!`. */
export function parentCommand(raw: unknown): ParentCommand | string {
  const p = t();
  const text = typeof raw === "string" ? raw.replace(CONTROL, " ").trim() : "";
  if (!text) return p.noCommand(PARENT_COMMANDS);
  if (!text.startsWith("/")) return p.notCommand(PARENT_COMMANDS);
  const [word, ...rest] = text.slice(1).split(/\s+/);
  const name = word.toLowerCase();
  const command = Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!command) return p.notAllowed(`/${word}`, PARENT_COMMANDS);
  const words = rest.join(" ").slice(0, MAX_COMMAND_TEXT).trim();
  if (words && !command.text) return p.noWords(`/${name}`);
  return { name, line: words ? `/${name} ${words}` : `/${name}`, changes: command.changes };
}

/** An option's words, its number taken off ("2. No" → "No"). */
export const optionWords = (option: string) => option.replace(/^\d+\.\s*/, "").trim();

/** A permission granted this once: Claude's "Yes", Codex's "Yes, proceed (y)". */
const YES_ONCE = /^yes(,? (proceed|just this once))?(\s*\(\w+\))?$/i;
/** A refusal: "No", "No, and tell Claude what to do differently (esc)". */
const NO = /^no\b/i;
/** A choice that grants more than this one request, or changes the session's permission mode (a plan's approval). */
const BEYOND_ONCE = /don'?t ask|do not ask|always|this session|all future|allow all|bypass|auto[- ]?(mode|accept)|accept edits|ultraplan|clear context/i;
/** A choice that opens a text box: a parent picks, it never types an answer. */
const FREE_TEXT = /^(type something|other|tell claude what to change|chat about this)\b/i;
/** A choice among several ticked ones (Space to select): Enter would send whatever is ticked. */
const TICKBOX = /^\[[ x✔✓]?\]|^[☐☑☒◯◉○●]/;
/** Claude Code's question on a project's new MCP servers: going on without them. */
const WITHOUT = /continue without|without using/i;

/** What is known of a dialog besides its screen's words. */
export interface DialogContext {
  /** It bears dummyPlane's guard marker (`guardedDialog`). */
  guard?: boolean;
  /** It holds the session from opening (`@/agents/dialogs` `heldByDialog`): its CLI's own setup, no request of a task. */
  held?: boolean;
  /**
   * The parent answers as a mission's Fleet or Manager: the permission mode its mission's agents run in (none: a
   * daytime mission, the user's usual Ask). Unset for an ordinary parent (an agent and the sub-agents it opened).
   */
  mission?: { mode?: Permission };
}

/**
 * The one policy of what a parent may pick for its sub-agent (`answer_dialog`): null when it may pick `option` of
 * `dialog`, else why not.
 * - before its session opens, nothing is a task's request: its CLI asks about its own setup (an API key to use, a
 *   permission mode to accept), the user's, but for going on without a project's new MCP servers;
 * - a guard's prompt (a recursive delete outside the agent's folder, any guard after it): No only, Yes is the user's;
 * - a permission request: Yes for this once, or No; never what approves for the session or for good. A mission's Fleet
 *   or Manager says Yes only in a mission run in Work (Edit files and run commands): in any other mode the user chose
 *   to approve its commands themselves, and the parent says No or tells them;
 * - Claude Code's new MCP servers: only going on without them, approving a repository's own server stays the user's;
 * - a login: the user's alone; trust: dummyPlane answers it itself;
 * - a question (Claude's AskUserQuestion, a plan to approve): any choice but one that grants more than once or
 *   changes the permission mode, opens a text box, or ticks among several.
 */
export function parentMayPick(dialog: ScreenDialog, option: string, { guard = false, held = false, mission }: DialogContext = {}): string | null {
  const p = t();
  const words = optionWords(option);
  if (guard) return NO.test(words) ? null : p.guardNoOnly;
  switch (dialog.kind) {
    case "login":
      return p.loginUsers;
    case "trust":
      return p.trustOwn;
    case "mcp":
      return WITHOUT.test(words) ? null : p.mcpWithoutOnly;
    case "permission":
      if (held) return p.beforeSession;
      if (NO.test(words)) return null;
      if (!YES_ONCE.test(words)) return p.onceOnly;
      return mission && mission.mode !== "work" ? p.notWork(p.modes[mission.mode ?? "ask"]) : null;
    case "question":
      if (held) return p.beforeSession;
      if (TICKBOX.test(words)) return p.tickboxes;
      if (FREE_TEXT.test(words)) return p.freeText;
      return BEYOND_ONCE.test(words) ? p.onceOnly : null;
  }
}

/**
 * The index of the option `raw` names among `options`: the number it is drawn with ("2" for "2. No"), its place
 * when none is numbered (1 for the first), or its words, whole, case aside. Null when it names none.
 */
export function optionIndex(options: readonly string[], raw: unknown): number | null {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const drawn = options.findIndex((option) => option.startsWith(`${text}.`));
    if (drawn !== -1) return drawn;
    const n = Number(text);
    return options.some((option) => /^\d+\./.test(option)) || n < 1 || n > options.length ? null : n - 1;
  }
  const wanted = optionWords(text).toLowerCase();
  const found = options.findIndex((option) => option.toLowerCase() === text.toLowerCase() || optionWords(option).toLowerCase() === wanted);
  return found === -1 ? null : found;
}

/**
 * A dialog's id: its kind and lines hashed, without its cursor nor an unattended request's countdown, which move
 * while it stays the same dialog. An answer goes to the dialog its parent read, not to one that followed with the
 * same choices (the user answered the first, the next asks to run another command).
 */
export function dialogId(kind: string, lines: readonly string[]): string {
  let hash = 0x811c9dc5;
  const text = [kind, ...lines.map((line) => line.replace(/^[❯›]\s*/, "").replace(/\d+:\d\d/g, ""))].join("\n");
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** A dialog a parent may answer, as read on its sub-agent's screen now. */
export interface ReadDialog {
  dialog: ScreenDialog;
  /** Its lines, the command a permission asks to run and a guard's reason among them (`dialogBody`). */
  lines: string[];
  /** It bears dummyPlane's guard marker: only No is the parent's. */
  guard: boolean;
  id: string;
}

/** The dialog at the bottom of `screen`, with all a parent needs to answer it; null when none (`dialogOf`). */
export function readDialog(screen: string, agent: AgentId): ReadDialog | null {
  const dialog = dialogOf(screen, agent);
  const lines = dialogBody(screen, agent);
  if (!dialog || !lines) return null;
  return { dialog, lines, guard: guardedDialog(screen, agent), id: dialogId(dialog.kind, lines) };
}

/** A sub-agent's screen as `pickOption` reads it and its keys. */
export interface DialogKeys {
  /** The dialog on its screen now, read again at each call. */
  read(): ReadDialog | null;
  press(keys: string): Promise<void>;
  wait(ms: number): Promise<void>;
}

const DOWN = "\x1b[B";
const UP = "\x1b[A";
/** How often the screen is read after a key, and how many times before the key is sent again (one sent too early is lost). */
const KEY_WAIT_MS = 100;
const KEY_TRIES = 15;

/**
 * Picks option `index` of the dialog `id`: the cursor moved to it a key at a time, each move seen on the screen, then
 * Enter, sent only right after a read that shows the same dialog with its cursor on that option. Arrows, not the
 * option's digit: a digit picks at once in some menus and only moves in others, an arrow never picks. Null once
 * picked, else why not (nothing was picked; the cursor may have moved).
 */
export async function pickOption(keys: DialogKeys, id: string, index: number): Promise<string | null> {
  const p = t();
  const most = (keys.read()?.dialog.options.length ?? 0) * 2 + 4;
  for (let moves = 0; moves <= most; moves++) {
    const now = keys.read();
    if (now?.id !== id) return moves === 0 ? p.changed : p.changedMidway;
    const at = now.dialog.selected;
    if (at === undefined) return p.noCursor;
    if (at === index) {
      await keys.press("\r");
      return null;
    }
    await keys.press(at < index ? DOWN : UP);
    for (let tries = 0; tries < KEY_TRIES; tries++) {
      const after = keys.read();
      if (after?.id !== id || after.dialog.selected !== at) break;
      await keys.wait(KEY_WAIT_MS);
    }
  }
  return p.cursorStuck;
}
