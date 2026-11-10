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

const isis: TerminalPayload = { title: "Fix the login form", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "" };

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
  expect(cardLine({ ...isis, lastReport: { status: "done", summary: "\n  Login fixed, tests green\nDetails…" } })).toBe("Login fixed, tests green");
  expect(cardLine(isis, "Fix the login form\nbrief")).toBe("Fix the login form");
  expect(cardLine({ ...isis, steps: [{ title: "Plan", state: "fait" }, { title: "Tests", state: "en_cours" }] })).toBe("Tests");
  expect(cardLine(isis)).toBe("Fix the login form");
});

it("shows the agent, its name, its report in the functional colors and one line of summary", async () => {
  const view = await render(
    <MinimizedCard nodeId="isis" payload={{ ...isis, lastReport: { status: "done", summary: "Login fixed" } }} status={{ state: "running" }} />,
  );
  const card = view.host.querySelector("[data-minimized]")!;
  expect(card.textContent).toContain("Isis");
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
  const view = await render(<MinimizedCard nodeId="isis" payload={{ ...isis, lastReport: { status, summary: "Needs a key" } }} status={{ state: "running" }} />);
  const badge = view.host.querySelector("[data-report]")!;
  const dot = badge.querySelector("[data-status]")!;
  expect(dot.getAttribute("data-status")).toBe(state);
  expect(dot.className).toContain(tone);
  expect(badge.textContent).toBe(label);
  await view.unmount();
});

it("shows the live status when no report was made", async () => {
  const view = await render(<MinimizedCard nodeId="isis" payload={isis} status={{ state: "stopped" }} />);
  expect(view.host.querySelector("[data-report]")).toBeNull();
  expect(view.host.textContent).toContain("Stopped");
  expect(view.host.querySelector("[data-status]")!.getAttribute("data-status")).toBe("stopped");
  await view.unmount();
});

it("expands from its button, and from a double-click on it even while inactive (the canvas hears it)", async () => {
  const view = await render(<MinimizedCard nodeId="isis" payload={isis} status={{ state: "running" }} />);
  await act(async () => view.host.querySelector<HTMLButtonElement>("button[aria-label='Expand']")!.click());
  expect(expandTerminal).toHaveBeenCalledWith("isis");
  vi.mocked(expandTerminal).mockClear();
  const card = view.host.querySelector<HTMLElement>("[data-minimized]")!;
  card.getBoundingClientRect = () => ({ left: 10, top: 10, right: 210, bottom: 78, width: 200, height: 68, x: 10, y: 10, toJSON: () => ({}) });
  view.canvas.dispatchEvent(new MouseEvent("dblclick", { clientX: 500, clientY: 500, bubbles: true }));
  expect(expandTerminal).not.toHaveBeenCalled();
  view.canvas.dispatchEvent(new MouseEvent("dblclick", { clientX: 50, clientY: 40, bubbles: true }));
  expect(expandTerminal).toHaveBeenCalledWith("isis");
  await view.unmount();
});

it("puts its element at the card's height once shown", async () => {
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => setTimeout(() => run(0), 0));
  const view = await render(<MinimizedCard nodeId="isis" payload={isis} status={{ state: "running" }} />);
  await vi.waitFor(() => expect(settleMinimizedSize).toHaveBeenCalledWith("isis"));
  await view.unmount();
  vi.unstubAllGlobals();
});

it("replaces the header by the card, its xterm kept mounted underneath, hidden", async () => {
  await nodesStore.getState().create("isis", { workspaceId: "w1", kind: "terminal", payload: { ...isis, minimized: true, expandedHeight: 440 } });
  const view = await render(<TerminalNode nodeId="isis" />);
  expect(view.host.querySelector("[data-minimized]")).not.toBeNull();
  expect(view.host.querySelector("header")).toBeNull();
  const body = view.host.querySelector("[data-terminal] > div.hidden");
  expect(body).not.toBeNull();
  await act(async () => nodesStore.getState().update("isis", { minimized: undefined, expandedHeight: undefined }));
  expect(view.host.querySelector("[data-minimized]")).toBeNull();
  expect(view.host.querySelector("header")).not.toBeNull();
  expect(view.host.querySelector("[data-terminal] > div.hidden")).toBeNull();
  expect(view.host.querySelector("button[aria-label='Minimize']")).not.toBeNull();
  await view.unmount();
  clearMocks();
});
