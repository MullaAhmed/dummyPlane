import { expect, it } from "vitest";
import { canvasMessages } from "@/canvas/messages";
import { agentsMessages } from "@/agents/messages";
import { notesMessages } from "@/notes/messages";
import { presetsMessages } from "@/presets/messages";
import { shellMessages } from "@/shell/messages";
import { studioMessages } from "@/studio/messages";
import { messages } from "./index";

it("Code studio", () => {
  expect(messages(studioMessages).save).toBe("Save (Ctrl+S)");
  expect(messages(studioMessages).unsaved.title("a.ts")).toBe("Save a.ts?");
});

it("Notes", () => {
  expect([1, 4].map((n) => messages(notesMessages).searchPlaceholder(n))).toEqual(["Search 1 note…", "Search 4 notes…"]);
  expect(messages(notesMessages).tabGraph).toBe("Graph");
});

it("Team presets", () => {
  expect([1, 3].map((n) => messages(presetsMessages).deploy("Dev HQ", n))).toEqual(["Deploy team: Dev HQ (1 agent)", "Deploy team: Dev HQ (3 agents)"]);
  expect(messages(presetsMessages).save).toBe("Save the team as a preset…");
});

it("Agent install", () => {
  expect(messages(agentsMessages).install.installAgent("Codex")).toBe("Install Codex");
  expect(messages(agentsMessages).install.installed("Codex")).toBe("Codex is installed");
});

it("The notice of an agent that waits", () => {
  expect(messages(shellMessages).waitingNotice.question("Isis")).toBe("Isis has a question");
  expect([1, 3].map((n) => messages(shellMessages).waitingNotice.others(n))).toEqual(["+ 1 more", "+ 3 more"]);
});

it("Group folding and tab moves", () => {
  expect(messages(agentsMessages).groupMenu.fold).toBe("Fold the group");
  expect(messages(agentsMessages).groupMenu.unfold).toBe("Unfold the group");
  expect(messages(canvasMessages).foldGroup).toBe("Fold the group");
  expect(messages(agentsMessages).foldWaiting).toContain("Wait for the group's agents");
  expect(messages(shellMessages).tabs.moveLeft).toBe("Move left");
});

it("Tokens", () => {
  expect([1, 3].map((n) => messages(shellMessages).usage.tokensFiles(n))).toEqual(["1 file read", "3 files read"]);
});
