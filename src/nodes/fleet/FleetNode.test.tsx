// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { requestUi } from "@/commands/uiRequests";
import { sendCommand } from "@/agents/broadcast";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, sessionOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { markForAutostart, mountTerminal } from "../terminal/registry";
import { MISSING_GRACE_MS } from "../terminal/MissingNode";
import { FleetNode } from "./FleetNode";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/agents/broadcast", async (original) => ({
  ...(await original<typeof import("@/agents/broadcast")>()),
  sendCommand: vi.fn(() => Promise.resolve()),
}));
vi.mock("../terminal/registry", () => ({ mountTerminal: vi.fn(), layoutTerminal: vi.fn(), markForAutostart: vi.fn(), relaunchTerminal: vi.fn(), focusTerminal: vi.fn() }));
// happy-dom may lack it; the node observes its terminal's host.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("opens its name editor on request (« Rename » of its radial menu)", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "chef de backend" } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<FleetNode nodeId="chef" />));
  expect(host.querySelector("header input")).toBeNull();
  await act(async () => requestUi({ kind: "renameFleet", id: "chef" }));
  const field = host.querySelector<HTMLInputElement>("header input")!;
  expect(field.value).toBe("chef de backend");
  expect(document.activeElement).toBe(field);
  await act(async () => root.unmount());
  host.remove();
});

it("gives a fleet of before its Claude session, and shows its terminal (spec orchestrateur §6)", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("ancien", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<FleetNode nodeId="ancien" />));
  const session = sessionOf(nodesStore.getState().nodes.ancien)!;
  expect(session).toMatchObject({ name: "Chef", agent: "claude", role: "orchestrator" });
  expect(session.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(markForAutostart).toHaveBeenCalledWith("ancien");
  expect(mountTerminal).toHaveBeenCalledWith("ancien", expect.any(HTMLElement), session, 1);
  // Its one field is the message line of its foot: the session area has none of its own.
  expect([...host.querySelectorAll('[data-fleet="ancien"] textarea')].every((field) => field.closest("[data-message-line]"))).toBe(true);
  expect(host.querySelector('[data-mission="ancien"]')).not.toBeNull();
  await act(async () => root.unmount());
  host.remove();
});

it("does not flash « not found » while a copy's record is on its way", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<FleetNode nodeId="copie-fantome" />));
  expect(host.textContent).toBe("");
  await act(async () => void vi.advanceTimersByTime(MISSING_GRACE_MS + 1));
  expect(host.textContent).not.toBe("");
  vi.useRealTimers();
  await act(async () => root.unmount());
});

describe("its message field", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    mockIPC(() => undefined);
    vi.mocked(sendCommand).mockClear();
    const terminal = (name: string) => ({
      workspaceId: "w1",
      kind: "terminal" as const,
      payload: { title: name, name, agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "" },
    });
    await nodesStore.getState().create("t1", terminal("Cyborg"));
    await nodesStore.getState().create("t2", terminal("Deadpool"));
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
    // Wired to Cyborg only: Deadpool is not its agent.
    canvasStore.setState({ nodeIds: ["t1", "t2", "chef"], frames: [], view: EMPTY_VIEW, links: { chef: { nodeIds: ["t1"], groupIds: [] } } });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<FleetNode nodeId="chef" />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    canvasStore.setState({ nodeIds: [], frames: [], links: {} });
  });

  const sendButton = () => host.querySelector<HTMLButtonElement>('[data-fleet-input] button[aria-label="Send"]')!;
  const field = () => host.querySelector<HTMLTextAreaElement>("[data-fleet-input] textarea");

  async function type(value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(field(), value);
      field()!.setSelectionRange(value.length, value.length);
      field()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("is the field itself, one line: a click and you type to the linked agents", () => {
    expect(host.querySelector("[data-fleet-input] button[aria-expanded]")).toBeNull();
    expect(field()).not.toBeNull();
    expect(field()!.closest("[data-message-line]")).not.toBeNull();
  });

  it("never takes the keyboard by itself", async () => {
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    elsewhere.focus();
    await act(async () => nodesStore.getState().update("chef", { inputOpen: true }));
    expect(field()).not.toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("names its agents in the placeholder and sends to them on Enter", async () => {
    expect(field()!.placeholder).toContain("1 agent");
    await type("run tests");
    await act(async () => void field()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(sendCommand).toHaveBeenCalledWith(["t1"], "run tests");
    expect(field()!.value).toBe("");
  });

  it("targets with @ and sends with the button", async () => {
    await type("@cyborg run tests");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-fleet-input] button[aria-label="Send"]')!.click());
    expect(sendCommand).toHaveBeenCalledWith(["t1"], "run tests");
  });

  it("keeps its keys from the canvas", async () => {
    const seen = vi.fn();
    host.addEventListener("keydown", seen);
    for (const key of ["a", "Enter", "ArrowUp", "Escape", "Backspace"]) {
      await act(async () => void field()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    }
    await act(async () => void sendButton().dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })));
    expect(seen).not.toHaveBeenCalled();
  });

  it("keeps a Backspace on Send from the canvas: Tab can bring the keyboard there", async () => {
    await type("run tests");
    const send = host.querySelector<HTMLButtonElement>('[data-fleet-input] button[aria-label="Send"]')!;
    send.focus();
    expect(document.activeElement).toBe(send);
    const seen = vi.fn();
    host.addEventListener("keydown", seen);
    await act(async () => void send.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })));
    expect(seen).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
  });
});

describe("its header, the same chrome as a terminal's", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    mockIPC(() => undefined);
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
    canvasStore.setState({ nodeIds: ["chef"], frames: [], view: EMPTY_VIEW, links: {} });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<FleetNode nodeId="chef" />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = "";
    terminalStatusStore.getState().remove("chef");
    canvasStore.setState({ nodeIds: [], frames: [], links: {} });
    clearMocks();
  });

  const nameOf = () => (nodesStore.getState().nodes.chef?.payload as { name: string }).name;
  const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const typeInto = (field: HTMLInputElement, text: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  async function startRename() {
    const seen = vi.fn();
    host.addEventListener("keydown", seen);
    await act(async () => requestUi({ kind: "renameFleet", id: "chef" }));
    return { seen, field: host.querySelector<HTMLInputElement>("header input")! };
  }

  it("is built from the pieces a terminal's header is: its row, its name, its status, its menu, its Close", () => {
    const header = host.querySelector("header")!;
    expect(header.className).toContain("h-9");
    expect(header.className).toContain("bg-dp-terminal-head");
    expect(header.className).toContain("@container/head");
    expect(header.querySelector("span[title]")!.getAttribute("title")).toBe("Double-click to rename");
    expect(header.querySelector("[data-status]")).not.toBeNull();
    expect(header.querySelector('button[aria-label="Fleet menu"]')).not.toBeNull();
    expect(header.querySelector('button[aria-label="Close the fleet"]')).not.toBeNull();
  });

  it("says where its session stands in the words of an agent's status", async () => {
    const word = () => host.querySelector("header [data-status]")!.parentElement!.textContent;
    expect(word()).toBe("Stopped");
    await act(async () => terminalStatusStore.getState().set("chef", { state: "starting" }));
    expect(word()).toBe("Starting");
    await act(async () => terminalStatusStore.getState().set("chef", { state: "running" }));
    expect(word()).toBe("Active");
    await act(async () => agentActivityStore.getState().apply({ nodeId: "chef", activity: "working", since: Date.now() }));
    expect(word()).toBe("Working");
    await act(async () => terminalStatusStore.getState().set("chef", { state: "error", message: "no tools", kind: "toolsUnavailable" }));
    expect(word()).toBe("Tools unavailable");
  });

  it("opens its menu on « Fleet menu »: pause, resume and Remote Control for the team", async () => {
    const menu = host.querySelector<HTMLButtonElement>('button[aria-label="Fleet menu"]')!;
    await act(async () => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(items).toEqual(["Pause all", "Resume all", "Remote Control for the team", "Turn off Remote Control", "Quick note"]);
  });

  it("renames on Enter, as a terminal does; an empty name falls back to « Fleet »", async () => {
    const { seen, field } = await startRename();
    expect(document.activeElement).toBe(field);
    typeInto(field, " Quartz ");
    await act(async () => void press(field, "Enter"));
    expect(host.querySelector("header input")).toBeNull();
    expect(nameOf()).toBe("Quartz");
    const again = (await startRename()).field;
    typeInto(again, "  ");
    await act(async () => void press(again, "Enter"));
    expect(nameOf()).toBe("Fleet");
    expect(seen).not.toHaveBeenCalled();
  });

  it("cancels a rename on Escape and keeps Backspace and Delete from the canvas", async () => {
    const { seen, field } = await startRename();
    for (const key of ["Backspace", "Delete"]) await act(async () => void press(field, key));
    typeInto(field, "Quartz");
    await act(async () => void press(field, "Escape"));
    expect(host.querySelector("header input")).toBeNull();
    expect(nameOf()).toBe("Chef");
    expect(seen).not.toHaveBeenCalled();
  });
});
