// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { mockIPC } from "@tauri-apps/api/mocks";
import { removeNode } from "@/agents/terminals";
import { TooltipProvider } from "@/components/ui/tooltip";
import { notify } from "@/mission/events";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { OutputNode } from "./OutputNode";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/agents/terminals", () => ({ removeNode: vi.fn() }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;


// OpenUI loads on demand; its first load (zod, the parser) is slow under the full suite's load: warmed here, not in a test.
beforeAll(async () => {
  await Promise.all([import("@/openui/plainText"), import("@/openui/OpenUIView")]);
}, 60_000);
const writeText = vi.fn(() => Promise.resolve());
Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

const UI = ['root = Stack([t, next])', 't = Table(["Test", "Result"], [["saves", "ok"]])', 'next = Button("Fix it", "Fix the failing test")'].join("\n");

let unmount: (() => void) | null = null;

const settle = () =>
  act(async () => {
    await vi.dynamicImportSettled();
  });

beforeEach(async () => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  nodesStore.setState({ nodes: {} });
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: { title: "B", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" } });
  await nodesStore.getState().create("o1", { workspaceId: "w1", kind: "output", payload: { title: "Test run", source: "batman", ui: UI, updatedAt: Date.now() } });
  terminalStatusStore.getState().set("batman", { state: "running" });
});

afterEach(() => {
  unmount?.();
  unmount = null;
});

async function render(nodeId: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <TooltipProvider>
        <OutputNode nodeId={nodeId} />
      </TooltipProvider>,
    ),
  );
  // OpenUI loads on demand, the first time a text is OpenUI Lang.
  await settle();
  unmount = () => {
    act(() => root.unmount());
    host.remove();
  };
  return host;
}

const button = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!;

it("shows its title over who showed it, the same header as a terminal, and its content drawn by the library", async () => {
  const host = await render("o1");
  const node = host.querySelector<HTMLElement>("[data-output='o1']")!;
  expect(node.className).toContain("bg-dp-surface");
  const header = node.querySelector("header")!;
  expect(header.className).toContain("bg-dp-terminal-head");
  expect(header.querySelector("[data-node-title]")?.textContent).toBe("Test runFrom Batman");
  for (const label of ["Copy as text", "More", "Close"]) expect(button(host, label), label).toBeDefined();
  expect([...node.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["saves", "ok"]);
  // Its body scrolls, apart from the canvas.
  expect(node.querySelector("[data-openui]")?.parentElement?.className).toContain("overflow-auto");
});

it("types a Button's message into the agent that showed it, on a click, and only while that agent runs", async () => {
  const host = await render("o1");
  expect(notify).not.toHaveBeenCalled();
  await act(async () => button(host, "Fix it").click());
  expect(notify).toHaveBeenCalledWith("batman", "The user clicked “Fix it” in your output “Test run”: Fix the failing test");
  vi.mocked(notify).mockClear();
  terminalStatusStore.getState().remove("batman");
  await act(async () => button(host, "Fix it").click());
  expect(notify).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith("Batman is not running: nothing was sent");
});

it("disables its Buttons once the agent that showed it is gone from the canvas", async () => {
  nodesStore.setState((s) => ({ nodes: Object.fromEntries(Object.entries(s.nodes).filter(([id]) => id !== "batman")) }));
  const host = await render("o1");
  expect(host.querySelector("header")?.textContent).toContain("From an agent no longer on the canvas");
  expect(button(host, "Fix it").disabled).toBe(true);
});

it("copies its content as Markdown text, and closes like any node", async () => {
  const host = await render("o1");
  await act(async () => button(host, "Copy as text").click());
  await settle();
  expect(writeText).toHaveBeenCalledWith("| Test | Result |\n| --- | --- |\n| saves | ok |");
  await act(async () => button(host, "Close").click());
  expect(removeNode).toHaveBeenCalledWith("o1");
});

it("says so when its record is missing, instead of drawing nothing", async () => {
  vi.useFakeTimers();
  try {
    const host = await render("nope");
    await act(async () => vi.advanceTimersByTime(1000));
    expect(host.textContent).toBe("This output is gone");
  } finally {
    vi.useRealTimers();
  }
});
