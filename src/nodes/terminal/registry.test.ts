// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { ptyResize } from "@/ipc/pty";
import type { TerminalPayload } from "@/nodes/types";
import { terminalStatusStore } from "@/store/terminalStatus";
import {
  disposeTerminal,
  hasFocus,
  layoutTerminal,
  markForAutostart,
  mountTerminal,
  startUnseen,
  touchedAgo,
  unmountTerminal,
  webglHolders,
  xtermOf,
} from "./registry";
import { reattachSession, relaunchSession, restoreSession, startSession } from "./session";
import { nodesStore, sessionOf } from "@/store/nodes";
import { NEXT_GRANT_MS, WEBGL_CAP, WEBGL_SETTLE_MS } from "./webglPool";

/** Each xterm's key listener (`onKey`), for a test to type in it. */
const keyListeners = vi.hoisted(() => new WeakMap<object, (event: { key: string; domEvent: KeyboardEvent }) => void>());
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
    onKey(listener: (event: { key: string; domEvent: KeyboardEvent }) => void) {
      keyListeners.set(this, listener);
    }
    onResize() {}
    attachCustomKeyEventHandler() {}
  },
}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
// Each WebGL renderer made, with what xterm's would do: dispose, lose its context, report the loss.
const webglAddons = vi.hoisted(
  () => [] as { disposed: boolean; contextLost: boolean; loseContext: () => void; fireContextLoss: () => void }[],
);
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    disposed = false;
    contextLost = false;
    loseContext = vi.fn();
    private onLoss = () => {};
    _renderer = {
      _gl: { isContextLost: () => this.contextLost, getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: this.loseContext } : null) },
    };
    constructor() {
      webglAddons.push(this);
    }
    onContextLoss(listener: () => void) {
      this.onLoss = listener;
    }
    fireContextLoss() {
      this.contextLost = true;
      this.onLoss();
    }
    dispose() {
      this.disposed = true;
    }
  },
}));
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

it("starts a stopped terminal again on a keystroke, but not while it is being started already (review 12 Nov)", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create(node, { workspaceId: "w1", kind: "terminal", payload: { ...payload, claudeSessionId: "s-old" } });
  mountTerminal(node, host(), payload, 1);
  terminalStatusStore.getState().set(node, { state: "exited", code: 0 });
  const press = () => keyListeners.get(xtermOf(node)!)!({ key: "a", domEvent: new KeyboardEvent("keydown", { key: "a" }) });
  // Its menu restarted it: the old process's exit makes it look stopped until the new one spawns.
  terminalStatusStore.getState().restart(node, 1);
  try {
    press();
    await Promise.resolve();
    expect(relaunchSession).not.toHaveBeenCalled();
    // No new conversation stored for a start that did not happen.
    expect(sessionOf(nodesStore.getState().nodes[node])?.claudeSessionId).toBe("s-old");
  } finally {
    terminalStatusStore.getState().restart(node, -1);
  }
  try {
    press();
    await vi.waitFor(() => expect(relaunchSession).toHaveBeenCalledTimes(1));
    expect(sessionOf(nodesStore.getState().nodes[node])?.claudeSessionId).not.toBe("s-old");
  } finally {
    clearMocks();
  }
});

it("tells how long since the user pressed a key in it or focused it, and whether it has the keyboard now", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create(node, { workspaceId: "w1", kind: "terminal", payload });
  const shown = host();
  mountTerminal(node, shown, payload, 1);
  terminalStatusStore.getState().set(node, { state: "running" });
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(10_000);
    expect(touchedAgo(node)).toBe(Infinity);
    expect(hasFocus(node)).toBe(false);
    keyListeners.get(xtermOf(node)!)!({ key: "Escape", domEvent: new KeyboardEvent("keydown", { key: "Escape" }) });
    vi.setSystemTime(15_000);
    expect(touchedAgo(node)).toBe(5000);
    // xterm's textarea, inside the screen the registry gave the host.
    const field = (shown.firstElementChild as HTMLElement).appendChild(document.createElement("textarea"));
    field.focus();
    expect(hasFocus(node)).toBe(true);
    expect(touchedAgo(node)).toBe(0);
    field.blur();
    expect(hasFocus(node)).toBe(false);
  } finally {
    vi.useRealTimers();
    clearMocks();
  }
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

// Pins what a restart already does: only a node marked at its creation starts on its own.
it("after a restart, a finished sub-agent's first mount shows its saved screen and starts nothing", () => {
  const finished: TerminalPayload = { ...payload, spawnedBy: "top", lastReport: { status: "done", summary: "Fixed." } };
  mountTerminal(node, host(), finished, 1);
  startUnseen(node, finished);
  expect(restoreSession).toHaveBeenCalledTimes(1);
  expect(startSession).not.toHaveBeenCalled();
  expect(reattachSession).not.toHaveBeenCalled();
});

describe("WebGL", () => {
  /** A host as the canvas lays it out: hidden (0 × 0) when Excalidraw scrolled its node out of the view. */
  const sized = (element: HTMLElement, width: number, height: number) => {
    Object.defineProperty(element, "clientWidth", { value: width, configurable: true });
    Object.defineProperty(element, "clientHeight", { value: height, configurable: true });
    return element;
  };
  const settle = () => vi.advanceTimersByTime(WEBGL_SETTLE_MS + (WEBGL_CAP + 1) * NEXT_GRANT_MS);
  const live = () => webglAddons.filter((addon) => !addon.disposed);
  let ids: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    webglAddons.length = 0;
    ids = [];
  });

  afterEach(() => {
    ids.forEach(disposeTerminal);
    vi.useRealTimers();
  });

  const mount = (count: number, first = 0) =>
    Array.from({ length: count }, (_, i) => {
      const id = `${node}-${first + i}`;
      ids.push(id);
      const element = sized(host(), 400, 300);
      mountTerminal(id, element, payload, 1);
      return { id, element };
    });

  it("draws a terminal on screen with WebGL once the view is still, not as it mounts", () => {
    const [{ id }] = mount(1);
    expect(webglAddons).toHaveLength(0);
    settle();
    expect(live()).toHaveLength(1);
    expect(webglHolders()).toEqual([id]);
  });

  it("gives no context to a terminal whose host is hidden", () => {
    const [{ id, element }] = mount(1);
    sized(element, 0, 0);
    layoutTerminal(id, element, 1);
    settle();
    expect(webglAddons).toHaveLength(0);
  });

  it("never keeps more contexts than the browser allows, however many terminals were shown", () => {
    // Forty terminals, each shown in turn, then scrolled out of the view: they all used to keep a context.
    for (let i = 0; i < 40; i++) {
      const [{ id, element }] = mount(1, i);
      settle();
      sized(element, 0, 0);
      layoutTerminal(id, element, 1);
    }
    expect(live()).toHaveLength(WEBGL_CAP);
    // A renderer given back frees its context at once, without waiting for the garbage collector.
    const released = webglAddons.filter((addon) => addon.disposed);
    expect(released).toHaveLength(40 - WEBGL_CAP);
    for (const addon of released) expect(addon.loseContext).toHaveBeenCalledTimes(1);
  });

  it("keeps the context of a terminal whose canvas left (another workspace), until one on screen needs it", () => {
    const [{ id, element }] = mount(1);
    settle();
    unmountTerminal(id, element);
    settle();
    expect(webglHolders()).toEqual([id]);
    expect(live()).toHaveLength(1);
  });

  it("frees the context of a closed terminal", () => {
    const [{ id }] = mount(1);
    settle();
    const [addon] = webglAddons;
    disposeTerminal(id);
    expect(addon.disposed).toBe(true);
    expect(addon.loseContext).toHaveBeenCalledTimes(1);
    expect(webglHolders()).toEqual([]);
  });

  it("falls back to the DOM renderer for a context lost all the same, and frees its slot", () => {
    const [{ id }] = mount(1);
    settle();
    const [addon] = webglAddons;
    addon.fireContextLoss();
    expect(addon.disposed).toBe(true);
    // Already lost: nothing more to free.
    expect(addon.loseContext).not.toHaveBeenCalled();
    expect(webglHolders()).not.toContain(id);
  });
});

it("writes no row back for a node closed on the canvas, whatever changes it later, and saves it again once an undo brings it back", async () => {
  const saves: string[] = [];
  mockIPC((cmd, args) => {
    // This node's: an earlier test's late save may land meanwhile.
    if (cmd === "save_node" && (args as { id: string }).id === node) saves.push(node);
  });
  await nodesStore.getState().create(node, { workspaceId: "w1", kind: "terminal", payload });
  saves.length = 0;
  // Closed: the scene's next save purges its row.
  disposeTerminal(node);
  // A late change: its start noting its account, an agent's step or report on its way when it closed.
  nodesStore.getState().update(node, { title: "late" });
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(saves).toEqual([]);
  // Ctrl+Z brings it back: the canvas saves it again (`onNodesAdded`), as it is now, and its changes are saved from then on.
  await nodesStore.getState().persist(node);
  nodesStore.getState().update(node, { title: "back" });
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(saves).toEqual([node, node]);
});
