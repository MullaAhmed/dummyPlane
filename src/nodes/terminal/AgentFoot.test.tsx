// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import type { Links } from "@/agents/wires";
import type { TerminalPayload } from "@/nodes/types";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { uiStore } from "@/store/ui";
import { TerminalNode } from "./TerminalNode";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./useTerminalHost", () => ({ useTerminalHost: () => undefined }));
vi.mock("./registry", () => ({ relaunchTerminal: vi.fn(), stopTerminal: vi.fn(), layoutTerminal: vi.fn(), xtermOf: vi.fn(), terminalText: vi.fn(() => ""), focusTerminal: vi.fn() }));
vi.mock("./minimize", () => ({ expandTerminal: vi.fn(() => true), minimizeTerminal: vi.fn(() => true), settleMinimizedSize: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const batman: TerminalPayload = { title: "Fix the login form", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" };

let canvas: HTMLDivElement;
let host: HTMLDivElement;
let root: Root;

async function show(payload: TerminalPayload = batman, links: Record<string, Links> = {}) {
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload });
  await nodesStore.getState().create("atlas", { workspaceId: "w1", kind: "fleet", payload: { name: "Atlas" } });
  await nodesStore.getState().create("cyclops", { workspaceId: "w1", kind: "fleet", payload: { name: "Cyclops" } });
  canvasStore.setState({ nodeIds: ["batman", "atlas", "cyclops"], frames: [], view: EMPTY_VIEW, links });
  canvas = document.createElement("div");
  canvas.className = "excalidraw";
  host = document.createElement("div");
  canvas.append(host);
  document.body.append(canvas);
  root = createRoot(host);
  await act(async () => root.render(<TerminalNode nodeId="batman" />));
}

beforeEach(() => {
  mockIPC(() => undefined);
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
const field = () => foot()!.querySelector<HTMLTextAreaElement>("textarea");
const linkButton = () => foot()!.querySelector<HTMLButtonElement>("[data-link-toggle]");

describe("the status line under an agent's terminal", () => {
  it("says where the agent stands, for how long, and which fleet commands it", async () => {
    terminalStatusStore.setState({ statuses: { batman: { state: "running" } } });
    agentActivityStore.setState({ activities: { batman: { activity: "working", since: Date.now() - 4 * 60_000 } } });
    await show(batman, { atlas: { nodeIds: ["batman"], groupIds: [] }, cyclops: { nodeIds: [], groupIds: [] } });
    expect(statusLine().textContent).toContain("Working · 4 min · from Atlas");
    expect(statusLine().querySelector("[data-status]")!.getAttribute("data-status")).toBe("working");
  });

  it("says Done, not Ready, once the agent reported done and rests, its dot the ok ring", async () => {
    terminalStatusStore.setState({ statuses: { batman: { state: "running" } } });
    agentActivityStore.setState({ activities: { batman: { activity: "idle", since: Date.now() - 4 * 60_000 } } });
    await show({ ...batman, lastReport: { status: "done", summary: "Login fixed" } });
    expect(statusLine().textContent).toContain("Done · 4 min");
    expect(statusLine().textContent).not.toContain("Ready");
    expect(statusLine().querySelector("[data-status]")!.getAttribute("data-status")).toBe("done");
  });

  it("says Blocked or Failed likewise, and Working as soon as the agent works again", async () => {
    terminalStatusStore.setState({ statuses: { batman: { state: "running" } } });
    agentActivityStore.setState({ activities: { batman: { activity: "idle", since: Date.now() } } });
    await show({ ...batman, lastReport: { status: "blocked", summary: "Needs a key" } });
    expect(statusLine().textContent).toContain("Blocked");
    expect(statusLine().querySelector("[data-status]")!.getAttribute("data-status")).toBe("waiting");
    await act(async () => nodesStore.getState().update("batman", { lastReport: { status: "failed", summary: "Broke" } }));
    expect(statusLine().textContent).toContain("Failed");
    expect(statusLine().querySelector("[data-status]")!.getAttribute("data-status")).toBe("error");
    await act(async () => agentActivityStore.setState({ activities: { batman: { activity: "working", since: Date.now() } } }));
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
    terminalStatusStore.setState({ statuses: { batman: { state: "running" } } });
    agentActivityStore.setState({ activities: { batman: { activity: "waiting", since: Date.now() } } });
    await show();
    expect(host.querySelectorAll("[data-terminal] [data-status]")).toHaveLength(1);
    expect(host.querySelector("header [data-status]")).toBeNull();
    expect(statusLine().querySelector("[data-status]")!.getAttribute("data-status")).toBe("waiting");
  });

  it("is not there for a plain shell or a custom command: their header keeps their status", async () => {
    await show({ ...batman, agent: "shell" });
    expect(foot()).toBeNull();
    expect(host.querySelector("header [data-status]")).not.toBeNull();
    await act(async () => root.unmount());
    document.body.replaceChildren();
    await show({ ...batman, agent: "custom", command: "make" });
    expect(foot()).toBeNull();
  });

  it("is not there while the terminal is minimized: the card says it", async () => {
    await show({ ...batman, minimized: true });
    expect(foot()).toBeNull();
    expect(host.querySelector("[data-minimized]")).not.toBeNull();
  });
});

describe("Link from the agent's end", () => {
  it("starts the link mode for this agent, and ends it with Done", async () => {
    await show(batman, { atlas: { nodeIds: [], groupIds: [] } });
    expect(linkButton()!.textContent).toBe("Link");
    await act(async () => linkButton()!.click());
    expect(uiStore.getState().linking).toBe("batman");
    expect(linkButton()!.textContent).toBe("Done");
    expect(linkButton()!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => linkButton()!.click());
    expect(uiStore.getState().linking).toBeNull();
  });

  it("says what it does in the app's hint, never a native title, and keeps it shut while linking (P2 #20)", async () => {
    await show(batman, {});
    const tooltip = () => document.querySelector('[role="tooltip"]')?.textContent ?? null;
    const later = () => act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(linkButton()!.hasAttribute("title")).toBe(false);
    await act(async () => linkButton()!.focus());
    await later();
    expect(tooltip()).toBe("Link this agent to another agent or to a fleet");
    const button = linkButton();
    await act(async () => linkButton()!.click());
    await later();
    // The same button, still focused: "Done" says it, no hint over it.
    expect(linkButton()).toBe(button);
    expect(linkButton()!.hasAttribute("title")).toBe(false);
    expect(tooltip()).toBeNull();
  });

  it("is always offered: two agents link without any fleet, and one already commanding it does not hide it", async () => {
    await show(batman, {});
    expect(linkButton()).not.toBeNull();
    await act(async () => canvasStore.setState({ links: { atlas: { nodeIds: ["batman"], groupIds: [] } } }));
    expect(linkButton()).not.toBeNull();
  });
});

describe("the foot of an agent's terminal", () => {
  it("holds no message field: an agent is messaged from the command bar, where selecting it puts its @ chip", async () => {
    await show();
    expect(field()).toBeNull();
    expect(foot()!.querySelector('button[aria-label="Send"]')).toBeNull();
    expect(foot()!.querySelector("[data-message-line]")).toBeNull();
    // Its one line: the status, then Link.
    expect(foot()!.children).toHaveLength(1);
    expect(foot()!.firstElementChild).toBe(statusLine());
  });

  it("keeps every key typed in the foot from the canvas: Backspace there would delete the node", async () => {
    await show(batman, { atlas: { nodeIds: [], groupIds: [] } });
    const seen = vi.fn();
    canvas.addEventListener("keydown", seen);
    for (const key of ["Backspace", "Delete", "Escape", "a"]) {
      await act(async () => void linkButton()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    }
    expect(seen).not.toHaveBeenCalled();
  });
});
