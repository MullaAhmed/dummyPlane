// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { requestUi } from "@/commands/uiRequests";
import { sendCommand } from "@/fleet/broadcast";
import { nodesStore, sessionOf } from "@/store/nodes";
import { markForAutostart, mountTerminal } from "../terminal/registry";
import { MISSING_GRACE_MS } from "../terminal/MissingNode";
import { OrchestratorNode } from "./OrchestratorNode";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/fleet/broadcast", async (original) => ({
  ...(await original<typeof import("@/fleet/broadcast")>()),
  sendCommand: vi.fn(() => Promise.resolve()),
}));
vi.mock("../terminal/registry", () => ({ mountTerminal: vi.fn(), layoutTerminal: vi.fn(), markForAutostart: vi.fn(), relaunchTerminal: vi.fn() }));
// happy-dom may lack it; the node observes its terminal's host.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("opens its name editor on request (« Rename » of its radial menu)", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "orchestrator", payload: { name: "chef de backend" } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<OrchestratorNode nodeId="chef" />));
  expect(host.querySelector("header input")).toBeNull();
  await act(async () => requestUi({ kind: "renameOrchestrator", id: "chef" }));
  const field = host.querySelector<HTMLInputElement>("header input")!;
  expect(field.value).toBe("chef de backend");
  expect(document.activeElement).toBe(field);
  await act(async () => root.unmount());
  host.remove();
});

it("gives an orchestrator of before its Claude session, and shows its terminal (spec orchestrateur §6)", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("ancien", { workspaceId: "w1", kind: "orchestrator", payload: { name: "Chef" } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<OrchestratorNode nodeId="ancien" />));
  const session = sessionOf(nodesStore.getState().nodes.ancien)!;
  expect(session).toMatchObject({ name: "Chef", agent: "claude", role: "orchestrator" });
  expect(session.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(markForAutostart).toHaveBeenCalledWith("ancien");
  expect(mountTerminal).toHaveBeenCalledWith("ancien", expect.any(HTMLElement), session, 1);
  expect(host.querySelector('[data-orchestrator="ancien"] textarea')).toBeNull();
  expect(host.querySelector('[data-mission="ancien"]')).not.toBeNull();
  await act(async () => root.unmount());
  host.remove();
});

it("does not flash « not found » while a copy's record is on its way", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<OrchestratorNode nodeId="copie-fantome" />));
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
    await nodesStore.getState().create("t1", terminal("Thoth"));
    await nodesStore.getState().create("t2", terminal("Zeus"));
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "orchestrator", payload: { name: "Chef" } });
    // Wired to Thoth only: Zeus is not its agent.
    canvasStore.setState({ nodeIds: ["t1", "t2", "chef"], frames: [], view: EMPTY_VIEW, links: { chef: { nodeIds: ["t1"], groupIds: [] } } });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<OrchestratorNode nodeId="chef" />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    canvasStore.setState({ nodeIds: [], frames: [], links: {} });
  });

  const toggle = () => host.querySelector<HTMLButtonElement>("[data-orchestrator-input] button")!;
  const field = () => host.querySelector<HTMLTextAreaElement>("[data-orchestrator-input] textarea");

  async function type(value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(field(), value);
      field()!.setSelectionRange(value.length, value.length);
      field()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("is folded by default: one line, no field", () => {
    expect(toggle().textContent).toBe("Message agents…");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(field()).toBeNull();
  });

  it("opens on a click, takes the keyboard, and remembers it is open", async () => {
    await act(async () => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(field()).not.toBeNull();
    expect(document.activeElement).toBe(field());
    const record = nodesStore.getState().nodes.chef;
    expect(record.kind === "orchestrator" && record.payload.inputOpen).toBe(true);
  });

  it("is open when the node was left open, and folds again on a second click", async () => {
    await act(async () => nodesStore.getState().update("chef", { inputOpen: true }));
    expect(field()).not.toBeNull();
    await act(async () => toggle().click());
    expect(field()).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    const record = nodesStore.getState().nodes.chef;
    expect(record.kind === "orchestrator" && record.payload.inputOpen).toBe(false);
  });

  it("names its agents in the placeholder and sends to them on Enter", async () => {
    await act(async () => toggle().click());
    expect(field()!.placeholder).toContain("1 agent");
    await type("run tests");
    await act(async () => void field()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(sendCommand).toHaveBeenCalledWith(["t1"], "run tests");
    expect(field()!.value).toBe("");
  });

  it("targets with @ and sends with the button", async () => {
    await act(async () => toggle().click());
    await type("@thoth run tests");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-orchestrator-input] button[aria-label="Send"]')!.click());
    expect(sendCommand).toHaveBeenCalledWith(["t1"], "run tests");
  });

  it("keeps its keys from the canvas", async () => {
    await act(async () => toggle().click());
    const seen = vi.fn();
    host.addEventListener("keydown", seen);
    for (const key of ["a", "Enter", "ArrowUp", "Escape", "Backspace"]) {
      await act(async () => void field()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    }
    await act(async () => void toggle().dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })));
    expect(seen).not.toHaveBeenCalled();
  });
});
