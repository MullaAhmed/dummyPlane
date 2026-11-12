// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { accountsStore } from "@/accounts/store";
import { TerminalOptionsDialog } from "@/nodes/terminal/TerminalOptionsDialog";
import { disposeTerminal, resumeTerminal } from "@/nodes/terminal/registry";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { TerminalEdit } from "./TerminalEdit";

// The real registry and session: a restart kills the process, waits for its exit and spawns the new one through IPC.
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    unicode = { activeVersion: "" };
    loadAddon() {}
    open() {}
    write(_data: unknown, callback?: () => void) {
      callback?.();
    }
    registerMarker() {
      return { line: 0, isDisposed: false, dispose() {} };
    }
    resize() {}
    dispose() {}
    onWriteParsed() {}
    onData() {}
    onKey() {}
    onResize() {}
    attachCustomKeyEventHandler() {}
  },
}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class {} }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "immediately" }, mutateElement: vi.fn() }));
// The native folder picker.
const { open } = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const claudeIn = (cwd: string, patch: Partial<TerminalPayload> = {}): TerminalPayload => ({
  title: "Batman",
  name: "Batman",
  agent: "claude",
  cwd,
  shell: "default",
  command: "",
  claudeSessionId: "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10",
  ...patch,
});

type Spec = { cwd: string; claude?: { sessionId: string } };
let spawns: Spec[];
let host: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  spawns = [];
  open.mockReset();
  mockIPC((cmd, args) => {
    const a = args as Record<string, unknown>;
    if (cmd === "pty_spawn") {
      spawns.push(a.spec as Spec);
      return 1;
    }
    // The process ends a moment after it is killed, as the PTY's exit event says.
    if (cmd === "pty_kill") setTimeout(() => terminalStatusStore.getState().set(a.nodeId as string, { state: "exited", code: 0 }), 1);
    if (cmd === "accounts_list") return { profiles: accountsStore.getState().profiles, active: accountsStore.getState().active };
    return null;
  });
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  disposeTerminal("t1");
  // The kill's exit lands now, not in the next test.
  await new Promise((resolve) => setTimeout(resolve, 10));
  clearMocks();
  vi.restoreAllMocks();
  nodesStore.setState({ nodes: {} });
  terminalStatusStore.setState({ statuses: {} });
  accountsStore.setState({ profiles: [], active: null, loaded: false, unread: false });
  document.body.replaceChildren();
});

/** Waits, inside act, until `done` holds: a restart runs over several IPC answers. */
async function until(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  expect(done(), JSON.stringify({ spawns, statuses: terminalStatusStore.getState().statuses })).toBe(true);
}

/** A terminal in `cwd`, started as the app starts one: its process runs in that folder. */
async function startedIn(cwd: string, patch: Partial<TerminalPayload> = {}) {
  await nodesStore.getState().create("t1", { workspaceId: "w", kind: "terminal", payload: claudeIn(cwd, patch) });
  resumeTerminal("t1");
  await until(() => spawns.length === 1 && terminalStatusStore.getState().statuses.t1?.state === "running");
}

async function showEdit() {
  root = createRoot(host);
  await act(async () => root!.render(<TerminalEdit nodeId="t1" onFold={() => undefined} />));
}

/** Presses "Change…" and lets the picker answer. */
async function pickFolder(answer: string) {
  open.mockResolvedValue(answer);
  const change = host.querySelector<HTMLButtonElement>('button[aria-label="Change the folder"]')!;
  await act(async () => change.click());
}

const stored = () => terminalOf(nodesStore.getState().nodes.t1)!;
const buttonNamed = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const notice = () => host.querySelector("[data-folder-move]");

it("says a running terminal stays in its old folder until it restarts, and offers the restart in the toast", async () => {
  const info = vi.spyOn(toast, "info");
  await startedIn("D:/work/api");
  await showEdit();
  await pickFolder("D:/work/web");
  expect(stored().cwd).toBe("D:/work/web");
  // Nothing is killed without a click: the process still runs where it started.
  expect(spawns).toHaveLength(1);
  expect(terminalStatusStore.getState().statuses.t1?.state).toBe("running");
  expect(info).toHaveBeenCalledTimes(1);
  const [title, options] = info.mock.calls[0] as [string, { description?: string; action?: { label: string; onClick: (event: unknown) => void } }];
  expect(title).toBe("Still running in api until it restarts");
  expect(options.description).toBe("It starts in web on a new conversation: Claude keeps each conversation with its folder");
  expect(options.action?.label).toBe("Restart in web");

  // The action restarts it there, on the conversation the move gave it.
  await act(async () => options.action!.onClick(new MouseEvent("click")));
  await until(() => spawns.length === 2);
  expect(spawns[1].cwd).toBe("D:/work/web");
  expect(spawns[1].claude?.sessionId).toBe(stored().claudeSessionId);
  expect(spawns[1].claude?.sessionId).not.toBe(spawns[0].claude?.sessionId);
});

it("keeps the toast short for a stopped terminal: its next launch is already in the new folder", async () => {
  const info = vi.spyOn(toast, "info");
  await nodesStore.getState().create("t1", { workspaceId: "w", kind: "terminal", payload: claudeIn("D:/work/api") });
  await showEdit();
  await pickFolder("D:/work/web");
  expect(stored().cwd).toBe("D:/work/web");
  expect(info.mock.calls).toEqual([["New folder, new conversation: Claude keeps each conversation with its folder"]]);
  expect(notice()).toBeNull();
  expect(spawns).toHaveLength(0);
});

it("offers the restart in the toast of any agent, without a conversation to speak of", async () => {
  const info = vi.spyOn(toast, "info");
  await startedIn("D:/work/api", { agent: "codex", claudeSessionId: undefined });
  await showEdit();
  await pickFolder("D:/work/web");
  expect(info).toHaveBeenCalledTimes(1);
  const [title, options] = info.mock.calls[0] as [string, { description?: string; action?: { label: string } }];
  expect(title).toBe("Still running in api until it restarts");
  expect(options.description).toBe("It starts in web when it restarts");
  expect(options.action?.label).toBe("Restart in web");
});

it("shows at the top of the Folder row where it still runs, with a real restart button, until it restarts there", async () => {
  await startedIn("D:/work/api");
  await showEdit();
  expect(notice()).toBeNull();
  await pickFolder("D:/work/web");
  expect(notice()).not.toBeNull();
  expect(notice()!.textContent).toContain("Still running in api");
  // One offer: the Folder row's, not a second "Restart now" at the bottom of the page.
  expect(buttonNamed("Restart in web")).toBeDefined();
  expect(buttonNamed("Restart now")).toBeUndefined();
  // Above the path, inside the Folder row.
  const path = host.querySelector("[data-folder]")!;
  expect(notice()!.compareDocumentPosition(path) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await act(async () => buttonNamed("Restart in web")!.click());
  await until(() => spawns.length === 2 && terminalStatusStore.getState().statuses.t1?.state === "running");
  expect(spawns[1].cwd).toBe("D:/work/web");
  expect(notice()).toBeNull();
  expect(buttonNamed("Restart in web")).toBeUndefined();
});

it("offers nothing after a start that gave its new conversation the profile in use", async () => {
  accountsStore.setState({ profiles: [{ id: "work", name: "Work", configDir: "C:/claude-work" }], active: "work", loaded: true });
  // No conversation yet: it starts a new one, on the profile in use, which its node keeps.
  await startedIn("D:/work/api", { claudeSessionId: undefined });
  await showEdit();
  expect(stored().accountId).toBe("work");
  expect(stored().launched).toMatchObject({ cwd: "D:/work/api", accountId: "work" });
  expect(buttonNamed("Restart now")).toBeUndefined();
  expect(notice()).toBeNull();
});

it("hides the offer once the terminal exits: its next start is in the new folder anyway", async () => {
  await startedIn("D:/work/api");
  await showEdit();
  await pickFolder("D:/work/web");
  expect(notice()).not.toBeNull();
  await act(async () => terminalStatusStore.getState().set("t1", { state: "exited", code: 0 }));
  expect(notice()).toBeNull();
  expect(buttonNamed("Restart in web")).toBeUndefined();
});

it("hides the offer when the folder is changed back to the one it runs in", async () => {
  const dismiss = vi.spyOn(toast, "dismiss");
  await startedIn("D:/work/api");
  await showEdit();
  await pickFolder("D:/work/web");
  expect(notice()).not.toBeNull();
  await pickFolder("D:\\work\\api");
  expect(notice()).toBeNull();
  expect(buttonNamed("Restart in web")).toBeUndefined();
  // The toast that offered "Restart in web" goes too.
  expect(dismiss).toHaveBeenCalled();
});

it("makes the same offer when the folder changes in the options dialog", async () => {
  const info = vi.spyOn(toast, "info");
  await startedIn("D:/work/api");
  root = createRoot(host);
  await act(async () => root!.render(<TerminalOptionsDialog nodeId="t1" payload={stored()} onClose={() => undefined} />));
  const label = [...document.body.querySelectorAll("label")].find((l) => l.textContent === "Folder")!;
  const input = document.getElementById(label.htmlFor) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "D:/work/web");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Apply at next launch")!.click());
  expect(stored().cwd).toBe("D:/work/web");
  const [title, options] = info.mock.calls[0] as [string, { action?: { label: string } }];
  expect(title).toBe("Still running in api until it restarts");
  expect(options.action?.label).toBe("Restart in web");
});

it("offers the restart again after a webview reload, while its process still runs in the old folder", async () => {
  await startedIn("D:/work/api");
  await showEdit();
  await pickFolder("D:/work/web");
  expect(notice()).not.toBeNull();
  // What the database holds: the payload as the store saves it.
  const payloadJson = JSON.stringify(nodesStore.getState().nodes.t1.payload);
  await act(async () => root!.unmount());
  root = undefined;

  // The webview reloads: every module starts afresh, from the database; the process goes on in Rust.
  vi.resetModules();
  const React = await import("react");
  const { createRoot: freshRoot } = await import("react-dom/client");
  const fresh = {
    nodes: (await import("@/store/nodes")).nodesStore,
    statuses: (await import("@/store/terminalStatus")).terminalStatusStore,
    TerminalEdit: (await import("./TerminalEdit")).TerminalEdit,
  };
  fresh.nodes.getState().hydrate("w", [{ id: "t1", kind: "terminal", payloadJson }]);
  // Re-attached to the live process (`reattachSession`): it runs.
  fresh.statuses.getState().set("t1", { state: "running" });
  const reloaded = freshRoot(host);
  await React.act(async () => reloaded.render(React.createElement(fresh.TerminalEdit, { nodeId: "t1", onFold: () => undefined })));
  expect(notice()?.textContent).toContain("Still running in api");
  expect(buttonNamed("Restart in web")).toBeDefined();
  // Once it no longer runs, nothing is offered.
  await React.act(async () => fresh.statuses.getState().set("t1", { state: "exited", code: 0 }));
  expect(notice()).toBeNull();
  await React.act(async () => reloaded.unmount());
});
