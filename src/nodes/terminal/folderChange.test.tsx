// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { folderAdoption, folderChange } from "./folder";
import { buildSpawnSpec, defaultTitle, launchSettingsOf } from "./launch";
import { TerminalOptionsDialog } from "./TerminalOptionsDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A terminal named after its folder, as one made without a title is ("Claude · api").
const claudeIn = (cwd: string, patch: Partial<TerminalPayload> = {}): TerminalPayload => ({
  title: defaultTitle("claude", cwd),
  name: "Batman",
  agent: "claude",
  cwd,
  shell: "powershell",
  command: "",
  claudeSessionId: "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10",
  ...patch,
});

it("renames a terminal still named after its old folder, so its new conversation is named after the new one", () => {
  const before = claudeIn("D:/work/api");
  expect(before.title).toBe("Claude · api");
  const change = folderChange(before, "D:\\work\\web");
  expect(change?.title).toBe("Claude · web");
  // The moved terminal's conversation is new: Claude gets the title with `-n`, and prints it on its prompt's rule.
  const spec = buildSpawnSpec({ ...before, ...change }, "new");
  expect(spec.cwd).toBe("D:\\work\\web");
  expect(spec.claude?.title).toBe("Claude · web");
});

// The folder a `claude` started by hand runs in, made the terminal's: its conversation goes with it, nothing new starts.
const HAND_STARTED = "6c1f0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

it("takes the folder Claude runs in by hand with the conversation it runs, and keeps the steps and the report", () => {
  const before = claudeIn("D:/work/api", { steps: [{ title: "Plan", state: "fait" }], lastReport: { status: "done", summary: "Done" } });
  const running = { ...before, launched: launchSettingsOf(before) };
  // As Claude's status line names it on Windows.
  const adoption = folderAdoption(running, "D:\\work\\upload", HAND_STARTED);
  expect(adoption).toEqual({
    cwd: "D:\\work\\upload",
    title: "Claude · upload",
    claudeSessionId: HAND_STARTED,
    launched: { ...launchSettingsOf(before), cwd: "D:\\work\\upload" },
  });
  // Its next launch resumes that conversation there.
  const spec = buildSpawnSpec({ ...running, ...adoption }, "resume");
  expect(spec.cwd).toBe("D:\\work\\upload");
  expect(spec.claude).toMatchObject({ mode: "resume", sessionId: HAND_STARTED });
});

it("keeps the terminal's own conversation, writes no launch it never had, and changes nothing in its own folder", () => {
  const before = claudeIn("D:/work/api", { title: "Fix login" });
  expect(folderAdoption(before, "D:/work/upload", before.claudeSessionId!)).toEqual({ cwd: "D:/work/upload" });
  expect(folderAdoption(before, "d:\\Work\\API\\", HAND_STARTED)).toBeNull();
});

it("gives a fresh id rather than one no launch could take", () => {
  const adoption = folderAdoption(claudeIn("D:/work/api"), "D:/work/upload", "not-an-id; rm -rf /");
  expect(adoption?.claudeSessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(adoption?.claudeSessionId).not.toBe(claudeIn("D:/work/api").claudeSessionId);
});

it("renames another agent named after its folder the same way", () => {
  const codex = claudeIn("D:/work/api", { agent: "codex", title: defaultTitle("codex", "D:/work/api"), claudeSessionId: undefined });
  expect(folderChange(codex, "D:/work/web")).toEqual({ cwd: "D:/work/web", title: defaultTitle("codex", "D:/work/web") });
});

it("keeps a title the user gave, even one that names a folder", () => {
  for (const title of ["Batman", "Claude · web", "API work"]) {
    const change = folderChange(claudeIn("D:/work/api", { title }), "D:/work/docs");
    expect(change).not.toHaveProperty("title");
  }
});

// The options dialog applies its own Title field with the folder: left as it was, it must not undo the rename.
let root: Root | undefined;
beforeEach(() => {
  mockIPC(() => undefined);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  clearMocks();
  vi.restoreAllMocks();
  nodesStore.setState({ nodes: {} });
  document.body.replaceChildren();
});

async function openFor(payload: TerminalPayload) {
  nodesStore.setState({ nodes: { batman: { workspaceId: "w1", kind: "terminal", payload } } });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<TerminalOptionsDialog nodeId="batman" payload={payload} onClose={() => undefined} />));
}
const field = (label: string) => {
  const tag = [...document.body.querySelectorAll("label")].find((l) => l.textContent === label);
  return document.getElementById(tag!.htmlFor) as HTMLInputElement;
};
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

it("renames the terminal moved from the options dialog when its Title field is left as it was", async () => {
  await openFor(claudeIn("C:/code/api"));
  await type(field("Folder"), "C:/code/web");
  await apply();
  expect(stored()).toMatchObject({ cwd: "C:/code/web", title: "Claude · web" });
});

it("keeps the title typed in the options dialog over the folder's", async () => {
  await openFor(claudeIn("C:/code/api"));
  await type(field("Folder"), "C:/code/web");
  await type(field("Title"), "Frontend");
  await apply();
  expect(stored()).toMatchObject({ cwd: "C:/code/web", title: "Frontend" });
});
