// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ptyResize } from "@/ipc/pty";
import type { TerminalPayload } from "@/nodes/types";
import { terminalStatusStore } from "@/store/terminalStatus";
import { disposeTerminal, markForAutostart, mountTerminal, startUnseen, xtermOf } from "./registry";
import { reattachSession, restoreSession, startSession } from "./session";

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    unicode = { activeVersion: "" };
    loadAddon() {}
    open() {}
    write() {}
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
    }
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
vi.mock("@/app/theme", () => ({ currentPalette: () => "calm", themeStore: { subscribe: vi.fn() } }));
vi.mock("./terminalTheme", () => ({ followPalette: vi.fn(), terminalThemeFor: vi.fn(() => ({})) }));
vi.mock("./dprWatch", () => ({ watchDevicePixelRatio: vi.fn() }));
vi.mock("./minimize", () => ({ onNewWork: vi.fn() }));
vi.mock("@/ipc/pty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/pty")>()),
  ptyResize: vi.fn(() => Promise.resolve()),
  ptyKill: vi.fn(() => Promise.resolve()),
  ptyWrite: vi.fn(() => Promise.resolve()),
}));
vi.mock("./session", () => ({
  acceptsInput: vi.fn(() => true),
  reattachSession: vi.fn(),
  relaunchSession: vi.fn(),
  restoreSession: vi.fn(),
  // Like the real one, it says the terminal runs before its process is up.
  startSession: vi.fn(async (nodeId: string) => terminalStatusStore.getState().set(nodeId, { state: "running" })),
}));

const payload: TerminalPayload = { title: "T", name: "Storm", agent: "claude", cwd: "C:/code", shell: "default", command: "" };
const host = () => document.body.appendChild(document.createElement("div"));
let id = 0;
let node: string;

beforeEach(() => {
  vi.clearAllMocks();
  node = `node${++id}`;
});

afterEach(() => {
  disposeTerminal(node);
  document.body.replaceChildren();
});

it("starts a terminal nothing mounts, and its first mount later shows it without starting nor restoring it", () => {
  markForAutostart(node);
  startUnseen(node, payload);
  expect(startSession).toHaveBeenCalledTimes(1);
  expect(startSession).toHaveBeenCalledWith(node, xtermOf(node), payload, "new");
  mountTerminal(node, host(), payload, 1);
  expect(startSession).toHaveBeenCalledTimes(1);
  expect(restoreSession).not.toHaveBeenCalled();
  expect(reattachSession).not.toHaveBeenCalled();
});

it("starts it once when the canvas mounted it first: the start that follows finds nothing to do", () => {
  markForAutostart(node);
  mountTerminal(node, host(), payload, 1);
  expect(startSession).toHaveBeenCalledTimes(1);
  startUnseen(node, payload);
  expect(startSession).toHaveBeenCalledTimes(1);
  expect(restoreSession).not.toHaveBeenCalled();
});

// Real timers: the registry's autostart took the clock that was there when it loaded.
it("keeps the stagger it was marked with, whichever comes first", async () => {
  markForAutostart(node, 40);
  startUnseen(node, payload);
  expect(startSession).not.toHaveBeenCalled();
  // Mounted while it waits for its turn: it neither starts at once nor a second time.
  mountTerminal(node, host(), payload, 1);
  expect(startSession).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(startSession).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(startSession).toHaveBeenCalledTimes(1);
  expect(restoreSession).not.toHaveBeenCalled();
});

it("starts nothing for a node closed before its turn, and leaves no xterm behind", () => {
  markForAutostart(node);
  disposeTerminal(node);
  startUnseen(node, payload);
  expect(startSession).not.toHaveBeenCalled();
  expect(xtermOf(node)).toBeUndefined();
});

it("tells the process the grid its xterm has once it runs: a resize during the spawn had nothing to resize", async () => {
  markForAutostart(node);
  startUnseen(node, payload);
  await vi.waitFor(() => expect(ptyResize).toHaveBeenCalledWith(node, 80, 24));
});
