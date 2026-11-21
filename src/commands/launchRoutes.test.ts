import { expect, it, vi } from "vitest";
import { messages } from "@/i18n";
import { canvasMessages } from "@/canvas/messages";
import { homeMessages } from "@/home/messages";
import type { CommandContext } from "./command";
import { functionSections } from "./functions";
import { COMMANDS } from "./registry";
import { FUNCTIONS_SHORTCUT, shortcutOf, type KeyLike } from "./shortcuts";

vi.mock("@excalidraw/excalidraw", () => ({}));

const keydown = (key: string, init: Partial<KeyLike> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  repeat: false,
  isComposing: false,
  ...init,
});
const empty: CommandContext = { project: true, workspaceId: "w1", terminalCount: 0, terminalId: null };

// The Home guide's third step and the empty canvas promise a way to launch an agent: each key they name must work (card 8).
it("names, in the guide and on the empty canvas, the key that opens the palette's functions", () => {
  const functions = COMMANDS.find((c) => c.id === "palette.functions")!;
  expect(functions.shortcut).toBe(FUNCTIONS_SHORTCUT);
  expect(shortcutOf(keydown("P", { ctrlKey: true, shiftKey: true }))).toBe(FUNCTIONS_SHORTCUT);
  expect(messages(homeMessages).start.launchHint(FUNCTIONS_SHORTCUT)).toContain(FUNCTIONS_SHORTCUT);
  expect(messages(canvasMessages).empty.palette(FUNCTIONS_SHORTCUT)).toContain(FUNCTIONS_SHORTCUT);
});

it("has no Ctrl+K: it is a shell's own, kill to the end of the line, and no command is promised on it", () => {
  expect(shortcutOf(keydown("k", { ctrlKey: true }))).toBeNull();
  expect(COMMANDS.flatMap((c) => (c.shortcut ? [c.shortcut] : []))).not.toContain("Ctrl+K");
  expect(messages(homeMessages).start.launchHint("")).not.toContain("Ctrl+K");
});

it("finds the launches by the word the guide says to type, on a canvas with no terminal", () => {
  const found = functionSections(COMMANDS, empty, "launch").flatMap((section) => section.items.map((line) => line.command.id));
  expect(found).toEqual(expect.arrayContaining(["agent.launch.claude", "agent.launch.codex"]));
});
