import { describe, expect, it, vi } from "vitest";
import { readSource } from "@/theme/cssBlocks";
import { API_KEY, CODEX_TRUST, GUARDED, LOGIN, MCP_MANY, MCP_ONE, PERMISSION, PERMISSION_EDITS, PERMISSION_FOR_GOOD, PLAN, QUESTION, TRUST } from "./dialogFixtures";
import { GUARD_MARKER, guardedDialog } from "./dialogScreen";
import { dialogId, MAX_COMMAND_TEXT, optionIndex, parentCommand, parentMayPick, pickOption, readDialog, type ParentCommand } from "./parentControl";

const read = (screen: string, agent: "claude" | "codex" = "claude") => readDialog(screen, agent)!;
/** Each option of a screen's dialog, and whether a parent may pick it. */
const allowed = (screen: string, held = false) => {
  const { dialog, guard } = read(screen);
  return Object.fromEntries(dialog.options.map((option) => [option, parentMayPick(dialog, option, { guard, held }) === null]));
};

describe("the commands a parent may run", () => {
  it("takes Claude Code's /compact with what to keep, and /clear", () => {
    expect(parentCommand("/compact")).toEqual({ name: "compact", line: "/compact", changes: true });
    expect(parentCommand("  /compact keep the API decisions  ")).toEqual({ name: "compact", line: "/compact keep the API decisions", changes: true });
    expect(parentCommand("/CLEAR")).toEqual({ name: "clear", line: "/clear", changes: true });
  });

  it("refuses every other command: those that touch the user's settings or account, /model, which saves their default, and those that open a panel", () => {
    for (const command of ["/model sonnet", "/context", "/cost", "/usage", "/login", "/logout", "/mcp", "/permissions", "/config", "/exit", "/status", "/init", "/memory", "/hooks"]) {
      const refused = parentCommand(command);
      expect(typeof refused, command).toBe("string");
      expect(refused).toContain("not one a parent may run");
      expect(refused).toContain("may run: /compact, /clear.");
    }
  });

  it("refuses plain text, a shell command and an empty one: a command, never text", () => {
    expect(parentCommand("please stop")).toContain("Only one of Claude Code's commands");
    expect(parentCommand("!rm -rf /")).toContain("Only one of Claude Code's commands");
    expect(parentCommand("")).toContain("Which command");
    expect(parentCommand(42)).toContain("Which command");
  });

  it("keeps a command on one line: no word after one that takes none, no control key, /compact's words cut", () => {
    expect(parentCommand("/clear everything")).toBe("/clear takes nothing after it.");
    // A newline or an Escape in its words would send it early or leave the prompt.
    const line = (parentCommand("/compact keep\nthis\r\x1b[Aand that") as ParentCommand).line;
    expect(line).toBe("/compact keep this [Aand that");
    expect(line).not.toMatch(/[\n\r\x1b]/);
    expect((parentCommand(`/compact ${"x".repeat(2000)}`) as ParentCommand).line.length).toBe("/compact ".length + MAX_COMMAND_TEXT);
  });
});

describe("the dialogs a parent may answer", () => {
  it("lets it answer a permission request Yes for this once or No, never for the session or for good", () => {
    expect(allowed(PERMISSION)).toEqual({ "1. Yes": true, "2. No": true });
    expect(allowed(PERMISSION_FOR_GOOD)).toEqual({
      "1. Yes": true,
      "2. Yes, and don't ask again for npm run build commands in D:/Projects/app": false,
      "3. No, and tell Claude what to do differently (esc)": true,
    });
    expect(allowed(PERMISSION_EDITS)).toEqual({
      "1. Yes": true,
      "2. Yes, allow all edits during this session (shift+tab)": false,
      "3. No, and tell Claude what to do differently (esc)": true,
    });
    const { dialog } = read(PERMISSION_FOR_GOOD);
    expect(parentMayPick(dialog, dialog.options[1])).toContain("approves more than this one request");
  });

  it("lets a mission's Fleet or Manager say Yes once only in a mission run in Work, and No in any mode", () => {
    const { dialog } = read(PERMISSION);
    const yes = (mode?: "ask" | "edits" | "work") => parentMayPick(dialog, "1. Yes", { mission: { mode } });
    expect(yes("edits")).toBe("This mission runs in Edit files: only the user approves a command there (a Fleet's or a Manager's Yes once is for missions in Edit files and run commands). Answer No, or tell the user.");
    expect(yes("ask")).toContain("This mission runs in Ask:");
    // A mission by day sets no mode: the user's usual Ask.
    expect(yes(undefined)).toContain("This mission runs in Ask:");
    expect(yes("work")).toBeNull();
    for (const mode of ["ask", "edits", "work", undefined] as const) expect(parentMayPick(dialog, "2. No", { mission: { mode } }), mode).toBeNull();
    // An ordinary parent, to the sub-agents it opened: Yes once.
    expect(parentMayPick(dialog, "1. Yes")).toBeNull();
    // Never more than once, whatever the mode.
    const forGood = read(PERMISSION_FOR_GOOD).dialog;
    expect(parentMayPick(forGood, forGood.options[1], { mission: { mode: "work" } })).toContain("approves more than this one request");
  });

  it("leaves the Yes of a prompt dummyPlane's guard raised to the user: a parent may only say No", () => {
    const guarded = read(GUARDED);
    expect(guarded.guard).toBe(true);
    expect(guarded.dialog.kind).toBe("permission");
    expect(allowed(GUARDED)).toEqual({ "1. Yes": false, "2. No": true });
    expect(parentMayPick(guarded.dialog, "1. Yes", { guard: true })).toContain("dummyPlane's guard raised this prompt");
    // Claude Code's own warning on a delete is no guard of dummyPlane's.
    expect(read(PERMISSION).guard).toBe(false);
    // Wherever the width wraps it, a border in between included; text above the dialog does not count.
    expect(guardedDialog(GUARDED.replace("[dummyPlane-", "│ [dummy").replace(" guard]", "│ Plane-guard]"))).toBe(true);
    expect(guardedDialog(`${GUARD_MARKER}\n\n${PERMISSION}`)).toBe(false);
  });

  it("lets it go on without a project's new MCP servers, never approve one", () => {
    expect(allowed(MCP_ONE)).toEqual({
      "Use this MCP server": false,
      "Use this and all future MCP servers in this project": false,
      "Continue without using this MCP server": true,
    });
    // The list of several: only "Enable selected" is drawn, and Esc rejects them all, which is the user's to press.
    expect(allowed(MCP_MANY)).toEqual({ "Enable selected": false });
    const { dialog } = read(MCP_ONE);
    expect(parentMayPick(dialog, dialog.options[0])).toContain("Approving a project's own MCP servers is the user's");
  });

  it("leaves a login to the user and the trust question to dummyPlane", () => {
    const login = read(LOGIN);
    expect(login.dialog.options.every((option) => parentMayPick(login.dialog, option) === "A login is the user's alone: tell them.")).toBe(true);
    expect(Object.values(allowed(TRUST))).toEqual([false, false]);
    const codex = read(CODEX_TRUST, "codex");
    expect(parentMayPick(codex.dialog, codex.dialog.options[0])).toContain("trust a folder itself");
  });

  it("lets it pick a question's answer, but neither one that changes the permission mode nor one that opens a text box", () => {
    expect(allowed(QUESTION)).toEqual({ "1. SQLite": true, "2. Postgres": true, "3. Type something.": false });
    expect(allowed(PLAN)).toEqual({
      "1. Yes, and use auto mode": false,
      "2. Yes, and auto-accept edits": false,
      "3. Yes, manually approve edits": true,
      "4. No, keep planning": true,
    });
  });

  it("leaves what a CLI asks before its session opens to the user, but going on without new MCP servers", () => {
    // Asked about its own setup, never a task's request: Yes and No alike are the user's.
    expect(allowed(API_KEY, true)).toEqual({ "1. Yes": false, "2. No (recommended)": false });
    expect(parentMayPick(read(API_KEY).dialog, "2. No (recommended)", { held: true })).toContain("before its session opens");
    expect(allowed(MCP_ONE, true)).toEqual(allowed(MCP_ONE));
  });
});

describe("naming an option", () => {
  const options = ["1. Yes", "2. Yes, and don't ask again", "3. No, and tell Claude what to do differently (esc)"];

  it("takes its number as drawn, its words or its whole label, case aside", () => {
    expect(optionIndex(options, "3")).toBe(2);
    expect(optionIndex(options, 1)).toBe(0);
    expect(optionIndex(options, "yes")).toBe(0);
    expect(optionIndex(options, "1. Yes")).toBe(0);
    expect(optionIndex(["Use this MCP server", "Continue without using this MCP server"], "2")).toBe(1);
    expect(optionIndex(["Use this MCP server", "Continue without using this MCP server"], "continue without using this MCP server")).toBe(1);
  });

  it("names none for a number not drawn, a part of its words, or nothing", () => {
    expect(optionIndex(options, "4")).toBeNull();
    expect(optionIndex(options, "0")).toBeNull();
    expect(optionIndex(options, "No")).toBeNull();
    expect(optionIndex(options, "")).toBeNull();
    expect(optionIndex(options, undefined)).toBeNull();
  });
});

describe("a dialog's id", () => {
  it("stays while its cursor moves and its countdown runs, and changes with its lines", () => {
    const first = read(PERMISSION);
    const moved = read(PERMISSION.replace(" ❯ 1. Yes", "   1. Yes").replace("   2. No", " ❯ 2. No").replace("in 1:50", "in 1:12"));
    expect(moved.dialog.selected).toBe(1);
    expect(moved.id).toBe(first.id);
    // The next request with the same choices, to run another command, is another dialog.
    expect(read(PERMISSION.replace(/tempT11/g, "tempT12")).id).not.toBe(first.id);
    expect(dialogId("permission", ["a"])).not.toBe(dialogId("question", ["a"]));
  });
});

describe("picking an option", () => {
  /** A screen whose permission request's cursor follows the arrows it is sent, and goes away on Enter. */
  function screen(start = PERMISSION) {
    let cursor = 0;
    let shown: string | null = start;
    const mark = (at: number) => (cursor === at ? "❯" : " ");
    const draw = () =>
      shown === null
        ? "❯ "
        : shown
            .split("\n")
            .map((line) => (/^ [❯ ] 1\. Yes/.test(line) ? ` ${mark(0)} 1. Yes` : /^ [❯ ] 2\. No$/.test(line) ? ` ${mark(1)} 2. No` : line))
            .join("\n");
    const pressed: string[] = [];
    const keys = {
      read: () => readDialog(draw(), "claude"),
      press: vi.fn(async (key: string) => {
        pressed.push(key);
        if (key === "\x1b[B") cursor = Math.min(1, cursor + 1);
        else if (key === "\x1b[A") cursor = Math.max(0, cursor - 1);
        else if (key === "\r") shown = null;
      }),
      wait: () => Promise.resolve(),
      swap: (next: string) => {
        shown = next;
      },
    };
    return { keys, pressed };
  }

  it("moves the cursor a key at a time, each move seen, then Enter on the option", async () => {
    const { keys, pressed } = screen();
    const { id } = read(PERMISSION);
    expect(await pickOption(keys, id, 1)).toBeNull();
    expect(pressed).toEqual(["\x1b[B", "\r"]);
  });

  it("sends only Enter when the cursor is on it already", async () => {
    const { keys, pressed } = screen();
    expect(await pickOption(keys, read(PERMISSION).id, 0)).toBeNull();
    expect(pressed).toEqual(["\r"]);
  });

  it("reads the screen again before any key: another dialog there, nothing is sent", async () => {
    const { keys, pressed } = screen();
    const { id } = read(PERMISSION);
    // The user answered the request the parent read; the next one asks to run another command, with the same choices.
    keys.swap(PERMISSION.replace(/tempT11/g, "tempT12"));
    expect(await pickOption(keys, id, 1)).toContain("not the one you read");
    expect(pressed).toEqual([]);
  });

  it("sends no Enter when the dialog changed while its cursor moved", async () => {
    const { keys, pressed } = screen();
    const { id } = read(PERMISSION);
    keys.press.mockImplementationOnce(async (key: string) => {
      pressed.push(key);
      keys.swap(MCP_ONE);
    });
    expect(await pickOption(keys, id, 1)).toContain("changed while its cursor moved");
    expect(pressed).toEqual(["\x1b[B"]);
  });

  it("gives up with no Enter when its cursor does not move", async () => {
    const { keys, pressed } = screen();
    keys.press.mockImplementation(async (key: string) => void pressed.push(key));
    expect(await pickOption(keys, read(PERMISSION).id, 1)).toContain("did not reach that option");
    expect(pressed).not.toContain("\r");
  });
});

it("reads the same guard marker the Rust guard writes", () => {
  expect(readSource("../src-tauri/src/agents/delete_guard.rs")).toContain(`pub const GUARD_MARKER: &str = "${GUARD_MARKER}";`);
});
