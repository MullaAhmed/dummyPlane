// @vitest-environment happy-dom
import { RESUME_OFFER_ROOM, resumeOfferStore } from "./ResumeAllToast";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { BOTTOM_BAR_HEIGHT, TOP_ROW_HEIGHT } from "@/shell/layout";
import type { Activity } from "@/ipc/activity";
import type { TerminalPayload } from "@/nodes/types";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore, type TerminalStatus } from "@/store/terminalStatus";
import { requestUi } from "@/commands/uiRequests";
import { agentsPanelStore } from "./agentsPanelState";
import { AgentsPanel } from "./AgentsPanel";
import { newConsole } from "./quickActions";

// Excalidraw does not load under Vitest (roughjs); the panel only reaches it through menu actions.
vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./quickActions", () => ({ newConsole: vi.fn(), placeFleet: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  // The composer loads the agents and shells when it opens.
  mockIPC((cmd) => (cmd.startsWith("list_") ? [] : undefined));
  agentsPanelStore.setState({ open: true, filter: "all" });
  await nodesStore.getState().create("ada", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Ada", name: "Ada", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  terminalStatusStore.getState().set("ada", { state: "stopped" });
  canvasStore.getState().setNodeIds(["ada"]);
  canvasStore.setState({ frames: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<AgentsPanel />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
});

const byLabel = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);

it("floats under the tabs, down to the command bar at most, with the chips' actions (spec identité §5.6)", () => {
  const panel = host.firstElementChild as HTMLElement;
  expect(panel.style.top).toBe(`${TOP_ROW_HEIGHT + 14}px`);
  expect(panel.style.maxHeight).toBe(`calc(100% - ${TOP_ROW_HEIGHT + 14 + BOTTOM_BAR_HEIGHT + 14}px)`);
  for (const label of ["Launch an agent", "New console", "Compose a group", "Pause all", "Resume all", "More actions", "Close the panel"]) {
    expect(byLabel(label), label).not.toBeNull();
  }
});

it("starts New console at the center of the view, the click not taken for a point", async () => {
  await act(async () => byLabel("New console")!.click());
  expect(newConsole).toHaveBeenCalledWith();
});

it("filters on the store's filter: All, Waiting, Working and Done, in that order", async () => {
  const filters = [...host.querySelectorAll<HTMLButtonElement>("[data-filter]")];
  expect(filters.map((f) => f.textContent?.replace(/\d+$/, ""))).toEqual(["All", "Waiting", "Working", "Done"]);
  await act(async () => filters[3].click());
  expect(agentsPanelStore.getState().filter).toBe("done");
  expect(filters[3].dataset.on).toBe("true");
  // One filter is always on: pressing it again keeps it.
  await act(async () => filters[3].click());
  expect(agentsPanelStore.getState().filter).toBe("done");
});

it("counts and lists the agents by Waiting, Working and Done; one whose activity is unknown, or that starts, shows under All only", async () => {
  const claude = (name: string, extra: Partial<TerminalPayload> = {}): TerminalPayload => ({
    title: name,
    name,
    agent: "claude",
    cwd: "C:/code",
    shell: "default",
    command: "",
    ...extra,
  });
  const states: [string, string, TerminalStatus, Activity | null, Partial<TerminalPayload>?][] = [
    ["bob", "Bob", { state: "running" }, "working"],
    ["cy", "Cy", { state: "running" }, "waiting"],
    ["dee", "Dee", { state: "running" }, "idle"],
    // Reported done, its activity not known: finished all the same.
    ["eve", "Eve", { state: "running" }, null, { lastReport: { status: "done", summary: "Shipped" } }],
    // Reported done but at work again: Working.
    ["fay", "Fay", { state: "running" }, "working", { lastReport: { status: "done", summary: "Shipped" } }],
    ["gus", "Gus", { state: "running" }, null],
    ["hal", "Hal", { state: "starting" }, null],
  ];
  for (const [id, name, status, activity, extra] of states) {
    await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: claude(name, extra) });
    terminalStatusStore.getState().set(id, status);
    if (activity) agentActivityStore.getState().apply({ nodeId: id, activity, since: 1 });
  }
  await act(async () => canvasStore.getState().setNodeIds(["ada", ...states.map(([id]) => id)]));
  const counts = () => [...host.querySelectorAll<HTMLButtonElement>("[data-filter]")].map((f) => f.textContent);
  // Ada (stopped), Dee (Ready) and Eve (Done) are done; Gus and Hal are in All alone.
  expect(counts()).toEqual(["All8", "Waiting1", "Working2", "Done3"]);
  const shown = async (filter: string) => {
    await act(async () => agentsPanelStore.setState({ filter: filter as "all" }));
    return ["Ada", "Bob", "Cy", "Dee", "Eve", "Fay", "Gus", "Hal"].filter((name) => host.textContent?.includes(name));
  };
  expect(await shown("waiting")).toEqual(["Cy"]);
  expect(await shown("working")).toEqual(["Bob", "Fay"]);
  expect(await shown("done")).toEqual(["Ada", "Dee", "Eve"]);
  expect(await shown("all")).toHaveLength(8);
  // The rows say the same: Eve is Done, Dee Ready, Fay Working again.
  const row = (name: string) => [...host.querySelectorAll("[data-status]")].find((dot) => dot.closest(".group")?.textContent?.includes(name))?.parentElement?.textContent;
  expect(row("Eve")).toBe("Done");
  expect(row("Dee")).toBe("Ready");
  expect(row("Fay")).toBe("Working");
  agentActivityStore.setState({ activities: {} });
});

it("wraps its filters rather than clipping one, and says when a filter hides every agent", async () => {
  const row = host.querySelector("[data-filter]")!.parentElement!;
  expect(row.className).toContain("flex-wrap");
  await act(async () => agentsPanelStore.setState({ filter: "working" }));
  expect(host.textContent).toContain("No agent in this filter");
  await act(async () => canvasStore.getState().setNodeIds([]));
  await act(async () => agentsPanelStore.setState({ filter: "all" }));
  expect(host.textContent).toContain("No agent");
  expect(host.textContent).not.toContain("dans ce filtre");
});

it("offers a group's menu on its header, on hover; No group has none (spec identité §5.6)", async () => {
  expect(host.querySelector('[aria-label="Group menu"]')).toBeNull();
  await act(async () =>
    canvasStore.setState({
      frames: [{ id: "g1", name: "Backend", x: 0, y: 0, width: 10, height: 10, group: { role: "general", pantheon: "egypt" }, memberIds: ["ada"] }],
    }),
  );
  const menu = host.querySelector<HTMLButtonElement>('[aria-label="Group menu"]')!;
  expect(menu.closest("[data-group-header]")!.querySelector("[data-section]")!.textContent).toContain("Backend");
  expect(menu.className).toContain("group-hover/section:opacity-100");
  await act(async () => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect([...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toContain("Rename");
});

it("folds a group and closes", async () => {
  expect(host.textContent).toContain("Ada");
  await act(async () => host.querySelector<HTMLButtonElement>("[data-section]")!.click());
  expect(host.textContent).not.toContain("Ada");
  await act(async () => byLabel("Close the panel")!.click());
  expect(agentsPanelStore.getState().open).toBe(false);
});

it("opens Compose a group and a group's menu on request", async () => {
  await act(async () => requestUi({ kind: "composeGroup" }));
  expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () =>
    canvasStore.setState({
      frames: [{ id: "g1", name: "Backend", x: 0, y: 0, width: 10, height: 10, group: { role: "general", pantheon: "egypt" }, memberIds: ["ada"] }],
    }),
  );
  await act(async () => requestUi({ kind: "groupMenu", id: "g1" }));
  expect([...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toContain("Rename");
});

it("stops above the Resume offer instead of sitting under it", async () => {
  const panel = host.firstElementChild as HTMLElement;
  const before = panel.style.maxHeight;
  await act(async () => resumeOfferStore.setState({ open: true }));
  expect(panel.style.maxHeight).toBe(`calc(100% - ${TOP_ROW_HEIGHT + 14 + RESUME_OFFER_ROOM + 14}px)`);
  expect(panel.style.maxHeight).not.toBe(before);
  await act(async () => resumeOfferStore.setState({ open: false }));
  expect(panel.style.maxHeight).toBe(before);
});

it("gives each agent row Center and Close on hover and on keyboard focus (spec identité §5.6)", () => {
  const row = host.querySelector("[data-filter]")!.closest("aside")!.querySelector<HTMLElement>(".group.flex.items-center.gap-2")!;
  const labels = [...row.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label"));
  expect(labels.some((l) => /^Center /.test(l!))).toBe(true);
  expect(labels.some((l) => /^Close /.test(l!))).toBe(true);
  const actions = row.querySelector<HTMLElement>("[data-row-actions]")!;
  expect(actions.className.split(/\s+/)).toEqual(expect.arrayContaining(["opacity-0", "group-hover:opacity-100", "group-focus-within:opacity-100", "group-focus-within:transition-none"]));
});

it("swaps an agent row's status for its actions in one cell on hover: the name never moves (no display change)", () => {
  const row = host.querySelector("[data-filter]")!.closest("aside")!.querySelector<HTMLElement>(".group.flex.items-center.gap-2")!;
  const actions = row.querySelector<HTMLElement>("[data-row-actions]")!;
  const status = actions.previousElementSibling as HTMLElement;
  const cell = actions.parentElement!;
  expect(cell.className.split(/\s+/)).toContain("grid");
  expect(status.parentElement).toBe(cell);
  for (const layer of [status, actions]) {
    expect(layer.className.split(/\s+/), "both layers in the cell's one area").toContain("[grid-area:1/1]");
    // A fade on the pointer's hover, never a display or width change.
    expect(layer.className).not.toMatch(/\b(hidden|group-hover:flex|group-hover:hidden)\b/);
    expect(layer.className).toContain("transition-[opacity]");
  }
  expect(status.className).toContain("group-hover:opacity-0");
});
