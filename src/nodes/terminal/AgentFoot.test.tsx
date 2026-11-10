// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { sendCommand } from "@/agents/broadcast";
import type { Links } from "@/agents/wires";
import type { TerminalPayload } from "@/nodes/types";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { uiStore } from "@/store/ui";
import { TerminalNode } from "./TerminalNode";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./useTerminalHost", () => ({ useTerminalHost: () => undefined }));
vi.mock("./registry", () => ({ relaunchTerminal: vi.fn(), stopTerminal: vi.fn(), layoutTerminal: vi.fn(), xtermOf: vi.fn(), terminalText: vi.fn(() => "") }));
vi.mock("./minimize", () => ({ expandTerminal: vi.fn(() => true), minimizeTerminal: vi.fn(() => true), settleMinimizedSize: vi.fn() }));
vi.mock("@/agents/broadcast", async (original) => ({
  ...(await original<typeof import("@/agents/broadcast")>()),
  sendCommand: vi.fn(() => Promise.resolve()),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const isis: TerminalPayload = { title: "Fix the login form", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" };

let canvas: HTMLDivElement;
let host: HTMLDivElement;
let root: Root;

async function show(payload: TerminalPayload = isis, links: Record<string, Links> = {}) {
  await nodesStore.getState().create("isis", { workspaceId: "w1", kind: "terminal", payload });
  await nodesStore.getState().create("atlas", { workspaceId: "w1", kind: "fleet", payload: { name: "Atlas" } });
  await nodesStore.getState().create("hermes", { workspaceId: "w1", kind: "fleet", payload: { name: "Hermes" } });
  canvasStore.setState({ nodeIds: ["isis", "atlas", "hermes"], frames: [], view: EMPTY_VIEW, links });
  canvas = document.createElement("div");
  canvas.className = "excalidraw";
  host = document.createElement("div");
  canvas.append(host);
  document.body.append(canvas);
  root = createRoot(host);
  await act(async () => root.render(<TerminalNode nodeId="isis" />));
}

beforeEach(() => {
  mockIPC(() => undefined);
  vi.mocked(sendCommand).mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  canvasStore.setState({ nodeIds: [], frames: [], links: {} });
  terminalStatusStore.setState({ statuses: {} });
  agentActivityStore.setState({ activities: {} });
  uiStore.setState({ linking: null });
  clearMocks();
  document.body.replaceChildren();
});

const foot = () => host.querySelector<HTMLElement>("[data-agent-foot]");
const statusLine = () => foot()!.querySelector<HTMLElement>("[data-status-line]")!;
const toggle = () => foot()!.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
const field = () => foot()!.querySelector<HTMLTextAreaElement>("textarea");
const linkButton = () => foot()!.querySelector<HTMLButtonElement>("[data-link-toggle]");

describe("the status line under an agent's terminal", () => {
  it("says where the agent stands, for how long, and which fleet commands it", async () => {
    terminalStatusStore.setState({ statuses: { isis: { state: "running" } } });
    agentActivityStore.setState({ activities: { isis: { activity: "working", since: Date.now() - 4 * 60_000 } } });
    await show(isis, { atlas: { nodeIds: ["isis"], groupIds: [] }, hermes: { nodeIds: [], groupIds: [] } });
    expect(statusLine().textContent).toContain("Working · 4 min · from Atlas");
    expect(statusLine().querySelector("[data-status]")!.getAttribute("data-status")).toBe("working");
  });

  it("says Done, not Ready, once the agent reported done and rests, its dot the ok ring", async () => {
    terminalStatusStore.setState({ statuses: { isis: { state: "running" } } });
    agentActivityStore.setState({ activities: { isis: { activity: "idle", since: Date.now() - 4 * 60_000 } } });
    await show({ ...isis, lastReport: { status: "done", summary: "Login fixed" } });
    expect(statusLine().textContent).toContain("Done · 4 min");
    expect(statusLine().textContent).not.toContain("Ready");
    expect(statusLine().querySelector("[data-status]")!.getAttribute("data-status")).toBe("done");
  });

  it("says Blocked or Failed likewise, and Working as soon as the agent works again", async () => {
    terminalStatusStore.setState({ statuses: { isis: { state: "running" } } });
    agentActivityStore.setState({ activities: { isis: { activity: "idle", since: Date.now() } } });
    await show({ ...isis, lastReport: { status: "blocked", summary: "Needs a key" } });
    expect(statusLine().textContent).toContain("Blocked");
    expect(statusLine().querySelector("[data-status]")!.getAttribute("data-status")).toBe("waiting");
    await act(async () => nodesStore.getState().update("isis", { lastReport: { status: "failed", summary: "Broke" } }));
    expect(statusLine().textContent).toContain("Failed");
    expect(statusLine().querySelector("[data-status]")!.getAttribute("data-status")).toBe("error");
    await act(async () => agentActivityStore.setState({ activities: { isis: { activity: "working", since: Date.now() } } }));
    expect(statusLine().textContent).toContain("Working");
    expect(statusLine().querySelector("[data-status]")!.getAttribute("data-status")).toBe("working");
  });

  it("tells no time it does not know: a stopped process is not dated", async () => {
    await show();
    // Only its state, then Link, always at the end of the line.
    expect(statusLine().textContent).toBe("StoppedLink");
    expect(linkButton()!.textContent).toBe("Link");
    expect(statusLine().querySelector("[data-status]")!.getAttribute("data-status")).toBe("stopped");
  });

  it("is the agent's one status: the header no longer repeats it", async () => {
    terminalStatusStore.setState({ statuses: { isis: { state: "running" } } });
    agentActivityStore.setState({ activities: { isis: { activity: "waiting", since: Date.now() } } });
    await show();
    expect(host.querySelectorAll("[data-terminal] [data-status]")).toHaveLength(1);
    expect(host.querySelector("header [data-status]")).toBeNull();
    expect(statusLine().querySelector("[data-status]")!.getAttribute("data-status")).toBe("waiting");
  });

  it("is not there for a plain shell or a custom command: their header keeps their status", async () => {
    await show({ ...isis, agent: "shell" });
    expect(foot()).toBeNull();
    expect(host.querySelector("header [data-status]")).not.toBeNull();
    await act(async () => root.unmount());
    document.body.replaceChildren();
    await show({ ...isis, agent: "custom", command: "make" });
    expect(foot()).toBeNull();
  });

  it("is not there while the terminal is minimized: the card says it", async () => {
    await show({ ...isis, minimized: true });
    expect(foot()).toBeNull();
    expect(host.querySelector("[data-minimized]")).not.toBeNull();
  });
});

describe("Link from the agent's end", () => {
  it("starts the link mode for this agent, and ends it with Done", async () => {
    await show(isis, { atlas: { nodeIds: [], groupIds: [] } });
    expect(linkButton()!.textContent).toBe("Link");
    await act(async () => linkButton()!.click());
    expect(uiStore.getState().linking).toBe("isis");
    expect(linkButton()!.textContent).toBe("Done");
    expect(linkButton()!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => linkButton()!.click());
    expect(uiStore.getState().linking).toBeNull();
  });

  it("is always offered: two agents link without any fleet, and one already commanding it does not hide it", async () => {
    await show(isis, {});
    expect(linkButton()).not.toBeNull();
    await act(async () => canvasStore.setState({ links: { atlas: { nodeIds: ["isis"], groupIds: [] } } }));
    expect(linkButton()).not.toBeNull();
  });
});

describe("the message bar under an agent's terminal", () => {
  it("is folded by default: one line naming the agent, no field", async () => {
    await show();
    expect(toggle().textContent).toBe("Message Isis");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(field()).toBeNull();
  });

  it("opens on a click, takes the keyboard, and keeps it open on the node", async () => {
    await show();
    await act(async () => toggle().click());
    expect(field()).not.toBeNull();
    expect(document.activeElement).toBe(field());
    expect(terminalOf(nodesStore.getState().nodes.isis)?.inputOpen).toBe(true);
    await act(async () => toggle().click());
    expect(field()).toBeNull();
    expect(terminalOf(nodesStore.getState().nodes.isis)?.inputOpen).toBe(false);
  });

  it("is open when the node was left open, without taking the keyboard", async () => {
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    elsewhere.focus();
    await show({ ...isis, inputOpen: true });
    expect(field()).not.toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("sends to this agent alone, the way the command bar sends to a target", async () => {
    await show({ ...isis, inputOpen: true });
    expect(field()!.placeholder).toBe("Message Isis");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field(), "run the tests");
      field()!.setSelectionRange(13, 13);
      field()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => void field()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(sendCommand).toHaveBeenCalledWith(["isis"], "run the tests");
    expect(field()!.value).toBe("");
  });

  it("keeps every key typed in the foot from the canvas: Backspace there would delete the node", async () => {
    await show({ ...isis, inputOpen: true }, { atlas: { nodeIds: [], groupIds: [] } });
    const seen = vi.fn();
    canvas.addEventListener("keydown", seen);
    for (const target of [toggle(), field()!, linkButton()!]) {
      for (const key of ["Backspace", "Delete", "Escape", "a"]) {
        await act(async () => void target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
      }
    }
    expect(seen).not.toHaveBeenCalled();
  });

  it("keeps the wheel over its field from the canvas, which would pan", async () => {
    await show({ ...isis, inputOpen: true });
    const reached = vi.fn();
    canvas.addEventListener("wheel", reached);
    field()!.dispatchEvent(new Event("wheel", { bubbles: true, cancelable: true }));
    expect(reached).not.toHaveBeenCalled();
  });
});
