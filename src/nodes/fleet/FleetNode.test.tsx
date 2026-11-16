// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { requestUi } from "@/commands/uiRequests";
import { agentActivityStore } from "@/store/agentActivity";
import { NEW_MISSION } from "@/mission/mission";
import type { FleetPayload } from "@/nodes/types";
import { nodesStore, sessionOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { markForAutostart, mountTerminal } from "../terminal/registry";
import { MISSING_GRACE_MS } from "../terminal/MissingNode";
import { FleetNode } from "./FleetNode";
import { modelRouterStore } from "@/app/modelRouterSetting";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("../terminal/registry", () => ({
  mountTerminal: vi.fn(),
  unmountTerminal: vi.fn(),
  layoutTerminal: vi.fn(),
  canvasMoved: vi.fn(),
  markForAutostart: vi.fn(),
  relaunchTerminal: vi.fn(),
  focusTerminal: vi.fn(),
}));
// happy-dom may lack it; the node observes its terminal's host.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  // The router as before Settings had one: only a switch set on routes. The global setting has its own tests.
  modelRouterStore.setState({ on: false, levels: {} });
});

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

it("gives a fleet of before its Claude session, and shows its terminal", async () => {
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
  // No field of its own: the session's terminal is where it is written to, and the command bar.
  expect(host.querySelector('[data-fleet="ancien"] textarea')).toBeNull();
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

it("has no message field of its own: its agents, and the Fleet itself, are written to from the command bar", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
  canvasStore.setState({ nodeIds: ["chef"], frames: [], view: EMPTY_VIEW, links: {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<FleetNode nodeId="chef" />));
  expect(host.querySelector("[data-fleet-input], [data-message-line]")).toBeNull();
  expect(host.querySelector("textarea")).toBeNull();
  await act(async () => root.unmount());
  host.remove();
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
    expect(word()).toBe("Starting");
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

  it("offers « Remove from group » once it is dragged into a group's frame", async () => {
    await act(async () =>
      canvasStore.setState({
        api: { getSceneElements: () => [{ id: "chef", frameId: "g1" }] } as never,
        frames: [{ id: "g1", name: "Serveurs", x: 0, y: 0, width: 10, height: 10, group: { role: "backend", pantheon: "egypt" }, memberIds: [] }],
      }),
    );
    try {
      const menu = host.querySelector<HTMLButtonElement>('button[aria-label="Fleet menu"]')!;
      await act(async () => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
      const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
      expect(items[items.length - 1]).toBe("Remove from group");
    } finally {
      canvasStore.setState({ api: null });
    }
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

  describe("its model router, back where the Fleet's chrome has room", () => {
    const routerButton = () => host.querySelector<HTMLButtonElement>('[data-fleet] > header button[aria-label="Model router"]');
    const missionRouter = () => (nodesStore.getState().nodes.chef?.payload as FleetPayload).mission?.router;

    it("is a sticky switch: pressed is on, it writes the mission's router and the panel's own row agrees", async () => {
      const sw = routerButton()!;
      expect(sw).not.toBeNull();
      expect(sw.getAttribute("aria-pressed")).toBe("false");
      // With the clock, from 28rem of header on: a narrower node has the same switch in its Edit tab.
      expect(sw.parentElement!.className).toContain("@md/head:flex");
      await act(async () => sw.click());
      expect(missionRouter()).toBe(true);
      expect(routerButton()!.getAttribute("aria-pressed")).toBe("true");
      expect(host.querySelector('[data-mission] [aria-label="Model router"]')?.getAttribute("aria-checked")).toBe("true");
      await act(async () => routerButton()!.click());
      expect(missionRouter()).toBe(false);
      expect(routerButton()!.getAttribute("aria-pressed")).toBe("false");
    });

    it("is in its ⋯ menu too, at any width, a checked entry that writes the mission's router", async () => {
      await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Fleet menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
      const entry = () => document.querySelector<HTMLElement>('[role="menuitemcheckbox"]');
      expect(entry()?.textContent).toBe("Model router");
      expect(entry()?.getAttribute("aria-checked")).toBe("false");
      await act(async () => entry()!.click());
      expect(missionRouter()).toBe(true);
    });

    it("is there once the team is at work, and on a Fleet whose session runs Codex, whose team Settings' map routes", async () => {
      const mission = (nodesStore.getState().nodes.chef?.payload as FleetPayload).mission ?? NEW_MISSION;
      await act(async () => nodesStore.getState().update("chef", { mission: { ...mission, state: "en_cours", router: true } }));
      expect(routerButton()!.getAttribute("aria-pressed")).toBe("true");
      const session = sessionOf(nodesStore.getState().nodes.chef)!;
      await act(async () => nodesStore.getState().update("chef", { session: { ...session, agent: "codex" } }));
      expect(routerButton()!.getAttribute("aria-pressed")).toBe("true");
    });

    it("shows Settings' router while the Fleet's switch is unset, and an off it sets vetoes it for the mission", async () => {
      await act(async () => modelRouterStore.setState({ on: true }));
      expect(routerButton()!.getAttribute("aria-pressed")).toBe("true");
      expect(missionRouter()).toBeUndefined();
      await act(async () => routerButton()!.click());
      expect(missionRouter()).toBe(false);
      expect(routerButton()!.getAttribute("aria-pressed")).toBe("false");
      // Settings turned off and on again: the Fleet's own off holds.
      await act(async () => modelRouterStore.setState({ on: false }));
      await act(async () => modelRouterStore.setState({ on: true }));
      expect(routerButton()!.getAttribute("aria-pressed")).toBe("false");
      // On again is stored as set too; Follow Settings, in its ⋯ menu, unsets it.
      await act(async () => routerButton()!.click());
      expect(missionRouter()).toBe(true);
      await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Fleet menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
      const follow = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "Follow Settings")!;
      await act(async () => follow.click());
      expect(missionRouter()).toBeUndefined();
      expect(routerButton()!.getAttribute("aria-pressed")).toBe("true");
    });
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
