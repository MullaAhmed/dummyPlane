// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { TerminalOptionsDialog } from "./TerminalOptionsDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const terminal = (patch: Partial<TerminalPayload> = {}): TerminalPayload => ({
  title: "Batman",
  name: "Batman",
  agent: "claude",
  cwd: "C:/code",
  shell: "powershell",
  command: "",
  ...patch,
});

let root: Root;
const onClose = vi.fn();

beforeEach(() => {
  onClose.mockClear();
  mockIPC(() => undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  clearMocks();
  nodesStore.setState({ nodes: {} });
  document.body.replaceChildren();
});

async function openFor(payload: TerminalPayload) {
  nodesStore.setState({ nodes: { batman: { workspaceId: "w1", kind: "terminal", payload } } });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<TerminalOptionsDialog nodeId="batman" payload={payload} onClose={onClose} />));
}

/** The field a label names, through its `for`. */
const field = (label: string) => {
  const tag = [...document.body.querySelectorAll("label")].find((l) => l.textContent === label);
  return tag ? (document.getElementById(tag.htmlFor) as HTMLInputElement | null) : null;
};
const labels = () => [...document.body.querySelectorAll("label")].map((l) => l.textContent);
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const apply = async () => {
  const button = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Apply at next launch")!;
  await act(async () => button.click());
};
const stored = () => terminalOf(nodesStore.getState().nodes.batman)!;

it("shows no command for a Claude terminal, which never runs one, and leaves its stored command alone", async () => {
  // A terminal switched from Custom to Claude keeps the command it had.
  await openFor(terminal({ command: "npm run dev" }));
  expect(field("Folder")!.value).toBe("C:/code");
  expect(field("Command to run")).toBeNull();
  expect(labels()).toEqual(["Folder", "Shell", "Title"]);
  expect(document.body.querySelector('input[placeholder="npm run dev"]')).toBeNull();
  const update = vi.spyOn(nodesStore.getState(), "update");
  await type(field("Title")!, "  Batman · api  ");
  await apply();
  expect(update).toHaveBeenCalledWith("batman", expect.not.objectContaining({ command: expect.anything() }));
  expect(stored()).toMatchObject({ title: "Batman · api", command: "npm run dev" });
  expect(onClose).toHaveBeenCalled();
});

it("shows a Custom terminal's command first, says what runs it, and saves it trimmed", async () => {
  await openFor(terminal({ agent: "custom", title: "Dev server", command: "npm run dev" }));
  const command = field("Command to run")!;
  expect(command.value).toBe("npm run dev");
  expect(document.getElementById(command.getAttribute("aria-describedby")!)!.textContent).toBe("A Custom terminal runs it in its shell when it starts.");
  expect(labels()).toEqual(["Command to run", "Folder", "Shell", "Title"]);
  await type(command, "  pnpm dev --port 3000 ");
  await apply();
  expect(stored()).toMatchObject({ agent: "custom", command: "pnpm dev --port 3000", cwd: "C:/code", title: "Dev server" });
});

it("changes nothing on Cancel", async () => {
  await openFor(terminal({ agent: "custom", command: "npm run dev" }));
  await type(field("Command to run")!, "rm -rf dist");
  const cancel = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!;
  await act(async () => cancel.click());
  expect(stored().command).toBe("npm run dev");
  expect(onClose).toHaveBeenCalled();
});

it("starts a new conversation for a Claude terminal moved to another folder, as the edit panel does", async () => {
  await openFor(terminal({ claudeSessionId: "old-conversation", model: "claude-haiku-5-5" }));
  await type(field("Folder")!, "D:/other");
  await apply();
  expect(stored().cwd).toBe("D:/other");
  expect(stored().claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(stored().claudeSessionId).not.toBe("old-conversation");
  // Only the folder and its conversation move: the model stays.
  expect(stored().model).toBe("claude-haiku-5-5");
});

it("keeps the conversation when the folder is only written another way", async () => {
  await openFor(terminal({ claudeSessionId: "old-conversation" }));
  await type(field("Folder")!, "c:\\CODE\\");
  await apply();
  expect(stored().cwd).toBe("C:/code");
  expect(stored().claudeSessionId).toBe("old-conversation");
});

it("moves another agent by its folder alone, and an empty folder changes nothing", async () => {
  await openFor(terminal({ agent: "codex" }));
  await type(field("Folder")!, "D:/other");
  await apply();
  expect(stored().cwd).toBe("D:/other");
  expect("claudeSessionId" in stored()).toBe(false);
  nodesStore.setState({ nodes: { batman: { workspaceId: "w1", kind: "terminal", payload: terminal() } } });
  await act(async () => root.unmount());
  await openFor(terminal());
  await type(field("Folder")!, "   ");
  await apply();
  expect(stored().cwd).toBe("C:/code");
});

/** A Fleet whose running mission has put the terminal "batman" in its own worktree. */
const missionOf = (worktree: string) => ({
  workspaceId: "w1",
  kind: "fleet" as const,
  payload: {
    name: "Fleet",
    mission: {
      state: "en_cours" as const,
      maxAgents: 3,
      members: [{ nodeId: "batman", name: "Batman", task: "", budgetMin: 10, linked: false, branch: "m/batman", worktree }],
    },
  },
});
const WORKTREE_REASON = "Fixed while its mission runs: this agent works in its own worktree";
const browse = () => document.body.querySelector('[aria-label="Browse"]');
const hintOf = (input: HTMLInputElement) => document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent;

it("shows the folder of a mission's agent read-only, with the reason and no Browse, and applies the shell and title as usual", async () => {
  const payload = terminal({ cwd: "D:/wt/batman", claudeSessionId: "old-conversation" });
  nodesStore.setState({ nodes: { fleet: missionOf("D:/wt/batman"), batman: { workspaceId: "w1", kind: "terminal", payload } } });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<TerminalOptionsDialog nodeId="batman" payload={payload} onClose={onClose} />));
  const folder = field("Folder")!;
  expect(folder.value).toBe("D:/wt/batman");
  expect(folder.readOnly).toBe(true);
  expect(hintOf(folder)).toBe(WORKTREE_REASON);
  expect(browse()).toBeNull();
  // Nothing typed into it counts: the field keeps showing the worktree, and the apply leaves it, without a word.
  const info = vi.spyOn(toast, "info");
  await type(folder, "D:/elsewhere");
  expect(folder.value).toBe("D:/wt/batman");
  await type(field("Title")!, "Review");
  await apply();
  expect(stored()).toMatchObject({ cwd: "D:/wt/batman", claudeSessionId: "old-conversation", title: "Review" });
  expect(info).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

it("lets a free terminal's folder be edited and browsed, and locks it as soon as a mission takes the terminal", async () => {
  await openFor(terminal());
  const folder = field("Folder")!;
  expect(folder.readOnly).toBe(false);
  expect(folder.hasAttribute("aria-describedby")).toBe(false);
  expect(browse()).not.toBeNull();
  // A mission starting while the dialog is open: the folder follows the lock, as the edit panel's does.
  await act(async () => nodesStore.setState({ nodes: { ...nodesStore.getState().nodes, fleet: missionOf("C:/code") } }));
  expect(field("Folder")!.readOnly).toBe(true);
  expect(hintOf(field("Folder")!)).toBe(WORKTREE_REASON);
  expect(browse()).toBeNull();
});

it("tells a Claude terminal moved to another folder that it starts a new conversation", async () => {
  await openFor(terminal());
  const info = vi.spyOn(toast, "info");
  await type(field("Folder")!, "D:/other");
  await apply();
  expect(info).toHaveBeenCalledWith("New folder, new conversation: Claude keeps each conversation with its folder");
});
