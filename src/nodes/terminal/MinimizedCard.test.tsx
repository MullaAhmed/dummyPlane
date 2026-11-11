// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { cardLine, MinimizedCard } from "./MinimizedCard";
import { expandTerminal, settleMinimizedSize } from "./minimize";
import { TerminalNode } from "./TerminalNode";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./useTerminalHost", () => ({ useTerminalHost: () => undefined }));
vi.mock("./registry", () => ({ relaunchTerminal: vi.fn(), stopTerminal: vi.fn(), layoutTerminal: vi.fn(), xtermOf: vi.fn() }));
vi.mock("./minimize", () => ({ expandTerminal: vi.fn(() => true), minimizeTerminal: vi.fn(() => true), settleMinimizedSize: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const batman: TerminalPayload = { title: "Fix the login form", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" };

beforeAll(() => mockIPC(() => undefined));
afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

async function render(node: React.ReactNode) {
  const canvas = document.createElement("div");
  canvas.className = "excalidraw";
  const host = document.createElement("div");
  canvas.append(host);
  document.body.append(canvas);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { canvas, host, unmount: () => act(async () => root.unmount()) };
}

it("says the last report's first line, else the mission task, the step under way or the title", () => {
  expect(cardLine({ ...batman, lastReport: { status: "done", summary: "\n  Login fixed, tests green\nDetails…" } })).toBe("Login fixed, tests green");
  expect(cardLine(batman, "Fix the login form\nbrief")).toBe("Fix the login form");
  expect(cardLine({ ...batman, steps: [{ title: "Plan", state: "fait" }, { title: "Tests", state: "en_cours" }] })).toBe("Tests");
  expect(cardLine(batman)).toBe("Fix the login form");
});

it("says a sub-agent's task in a line, not its brief's raw start, and its excerpt on hover", async () => {
  // Spawned before tasks were kept: its title was the brief's first 60 characters.
  const old = { ...batman, title: "You are fixing a readability problem in dummyPlane (Tauri…", spawnedBy: "superman" };
  expect(cardLine(old)).toBe("Fixing a readability problem in dummyPlane");
  const task = "You are fixing the header.\n\nThe line under the name must be readable.\n\n## Setup\n- run the tests";
  const robin = { ...batman, title: "Header fix", spawnedBy: "superman", task, minimized: true };
  expect(cardLine(robin)).toBe("Header fix");
  // A step under way, a report still say more than what it was asked.
  expect(cardLine({ ...robin, steps: [{ title: "Tests", state: "en_cours" }] })).toBe("Tests");
  const view = await render(<MinimizedCard nodeId="robin" payload={robin} status={{ state: "running" }} />);
  const line = view.host.querySelector<HTMLElement>("[data-minimized] p")!;
  expect(line.textContent).toBe("Header fix");
  expect(line.title).toBe("You are fixing the header.\nThe line under the name must be readable.");
  expect(line.className).toContain("text-dp-text-2");
  await view.unmount();
});

it("shows the agent, its name, its report in the functional colors and one line of summary", async () => {
  const view = await render(
    <MinimizedCard nodeId="batman" payload={{ ...batman, lastReport: { status: "done", summary: "Login fixed" } }} status={{ state: "running" }} />,
  );
  const card = view.host.querySelector("[data-minimized]")!;
  expect(card.textContent).toContain("Batman");
  expect(card.textContent).toContain("Login fixed");
  const badge = card.querySelector("[data-report]")!;
  expect(badge.getAttribute("data-report")).toBe("done");
  // Quiet text and the status dot, not a pill: the functional colour is the dot's.
  expect(badge.className).not.toContain("rounded");
  const dot = badge.querySelector("[data-status]")!;
  expect(dot.getAttribute("data-status")).toBe("done");
  expect(dot.className).toContain("border-dp-ok");
  await view.unmount();
});

it.each([
  ["blocked", "waiting", "bg-dp-wait", "Blocked"],
  ["failed", "error", "bg-dp-danger", "Failed"],
] as const)("marks a %s report in its own color", async (status, state, tone, label) => {
  const view = await render(<MinimizedCard nodeId="batman" payload={{ ...batman, lastReport: { status, summary: "Needs a key" } }} status={{ state: "running" }} />);
  const badge = view.host.querySelector("[data-report]")!;
  const dot = badge.querySelector("[data-status]")!;
  expect(dot.getAttribute("data-status")).toBe(state);
  expect(dot.className).toContain(tone);
  expect(badge.textContent).toBe(label);
  await view.unmount();
});

it("reads its report only while the agent rests: Working as soon as it works again", async () => {
  const reported = { ...batman, lastReport: { status: "done" as const, summary: "Login fixed" } };
  const view = await render(<MinimizedCard nodeId="batman" payload={reported} status={{ state: "running" }} activity={{ activity: "idle", since: 1 }} />);
  expect(view.host.querySelector("[data-report]")!.textContent).toBe("Done");
  await view.unmount();
  const again = await render(<MinimizedCard nodeId="batman" payload={reported} status={{ state: "running" }} activity={{ activity: "working", since: 2 }} />);
  expect(again.host.querySelector("[data-report]")).toBeNull();
  expect(again.host.textContent).toContain("Working");
  // Its last report is still what the line says.
  expect(again.host.textContent).toContain("Login fixed");
  await again.unmount();
});

it("shows the live status when no report was made", async () => {
  const view = await render(<MinimizedCard nodeId="batman" payload={batman} status={{ state: "stopped" }} />);
  expect(view.host.querySelector("[data-report]")).toBeNull();
  expect(view.host.textContent).toContain("Stopped");
  expect(view.host.querySelector("[data-status]")!.getAttribute("data-status")).toBe("stopped");
  await view.unmount();
});

it("expands from its button, and from a double-click on it even while inactive (the canvas hears it)", async () => {
  const view = await render(<MinimizedCard nodeId="batman" payload={batman} status={{ state: "running" }} />);
  await act(async () => view.host.querySelector<HTMLButtonElement>("button[aria-label='Expand']")!.click());
  expect(expandTerminal).toHaveBeenCalledWith("batman");
  vi.mocked(expandTerminal).mockClear();
  const card = view.host.querySelector<HTMLElement>("[data-minimized]")!;
  card.getBoundingClientRect = () => ({ left: 10, top: 10, right: 210, bottom: 78, width: 200, height: 68, x: 10, y: 10, toJSON: () => ({}) });
  view.canvas.dispatchEvent(new MouseEvent("dblclick", { clientX: 500, clientY: 500, bubbles: true }));
  expect(expandTerminal).not.toHaveBeenCalled();
  view.canvas.dispatchEvent(new MouseEvent("dblclick", { clientX: 50, clientY: 40, bubbles: true }));
  expect(expandTerminal).toHaveBeenCalledWith("batman");
  await view.unmount();
});

it("puts its element at the card's height once shown", async () => {
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => setTimeout(() => run(0), 0));
  const view = await render(<MinimizedCard nodeId="batman" payload={batman} status={{ state: "running" }} />);
  await vi.waitFor(() => expect(settleMinimizedSize).toHaveBeenCalledWith("batman"));
  await view.unmount();
  vi.unstubAllGlobals();
});

it("replaces the header by the card, its xterm kept mounted underneath, hidden", async () => {
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: { ...batman, minimized: true, expandedHeight: 440 } });
  const view = await render(<TerminalNode nodeId="batman" />);
  expect(view.host.querySelector("[data-minimized]")).not.toBeNull();
  expect(view.host.querySelector("header")).toBeNull();
  const body = view.host.querySelector("[data-terminal] > div.hidden");
  expect(body).not.toBeNull();
  await act(async () => nodesStore.getState().update("batman", { minimized: undefined, expandedHeight: undefined }));
  expect(view.host.querySelector("[data-minimized]")).toBeNull();
  expect(view.host.querySelector("header")).not.toBeNull();
  expect(view.host.querySelector("[data-terminal] > div.hidden")).toBeNull();
  // Minimize is one of the header's menu entries now.
  expect(view.host.querySelector("button[aria-label='More actions']")).not.toBeNull();
  await view.unmount();
  clearMocks();
});
