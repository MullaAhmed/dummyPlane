// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { STEP_LOOK } from "@/components/marks";
import { NEW_MISSION } from "@/mission/mission";
import { nodesStore } from "@/store/nodes";
import { subagentsStore, useSubagents } from "@/store/subagents";
import { StepTimelines } from "./StepTimelines";

vi.mock("@excalidraw/excalidraw", () => ({}));

// Each frieze reads its running subagents once per render: the count of its renders.
vi.mock("@/store/subagents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/subagents")>();
  return { ...actual, useSubagents: vi.fn(actual.useSubagents) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** How many times a terminal's frieze was drawn so far. */
const renders = (nodeId: string) => vi.mocked(useSubagents).mock.calls.filter(([id]) => id === nodeId).length;

/** Where a frieze shows on screen: its scene place through its layer's scale and scroll. */
function onScreen(frieze: HTMLElement) {
  const layer = frieze.parentElement!;
  const [, scale, scrollX, scrollY] = layer.style.transform.match(/^scale\(([-\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)$/)!.map(Number);
  return { left: (parseFloat(frieze.style.left) + scrollX) * scale, top: (parseFloat(frieze.style.top) + scrollY) * scale, scale };
}

it("draws each terminal's steps under it, following the view, with its running subagents", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "", steps: [{ title: "Plan", state: "fait" }, { title: "Code", state: "en_cours" }] },
  });
  await nodesStore.getState().create("cyborg", { workspaceId: "w1", kind: "terminal", payload: { title: "", name: "Cyborg", agent: "claude", cwd: "C:/code", shell: "default", command: "" } });
  canvasStore.setState({
    view: { ...EMPTY_VIEW, zoom: 0.5, scrollX: 100, scrollY: 0 },
    nodeRects: { batman: { x: 0, y: 0, width: 800, height: 400 }, cyborg: { x: 900, y: 0, width: 800, height: 400 } },
  });
  subagentsStore.getState().set("batman", 3);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<StepTimelines />));
  const friezes = host.querySelectorAll<HTMLElement>("[data-steps]");
  expect([...friezes].map((f) => f.dataset.steps)).toEqual(["batman"]);
  // Placed in scene units (400 + 3 gap below the top), in a layer scrolled and scaled like the nodes:
  // (0 + 100) * 0.5 = 50; (400 + 3) * 0.5 = 201.5. Drawn at the scene's size (800 wide) and scaled like the nodes (final review H1).
  expect([friezes[0].style.left, friezes[0].style.top, friezes[0].style.width]).toEqual(["0px", "403px", "800px"]);
  expect(onScreen(friezes[0])).toEqual({ left: 50, top: 201.5, scale: 0.5 });
  // Under the nodes, never in the way of a header below it: no layer above them, no click taken.
  const layer = host.firstElementChild as HTMLElement;
  expect(layer.className).not.toMatch(/z-/);
  expect(host.querySelector(".pointer-events-auto")).toBeNull();
  expect(friezes[0].textContent).toContain("Plan");
  expect(friezes[0].textContent).toContain("×3");
  // Each step a segment named with its state, never a dot: the round dot is the agent's mark.
  const marks = [...friezes[0].querySelectorAll<HTMLElement>("[data-step]")];
  expect(marks.map((mark) => [mark.getAttribute("role"), mark.getAttribute("aria-label")])).toEqual([
    ["img", "Plan, done"],
    ["img", "Code, in progress"],
  ]);
  expect(marks.map((mark) => mark.style.color)).toEqual(["var(--dp-ok)", "var(--dp-accent)"]);
  expect(friezes[0].querySelector(".rounded-full")).toBeNull();
  await act(async () => root.unmount());
  host.remove();
});

it("tells the steps apart by their shape, not their colour alone: four segments, none of them a dot", () => {
  const looks = Object.values(STEP_LOOK);
  expect(new Set(looks).size).toBe(4);
  for (const look of looks) {
    expect(look).toContain("w-3");
    expect(look).not.toMatch(/rounded-full|size-|bg-dp-|border-dp-/);
  }
  // Done thin and solid; under way thicker; to come dashed; failed ends on a stop.
  expect([STEP_LOOK.fait, STEP_LOOK.en_cours]).toEqual(["h-0.5 w-3 bg-current", "h-1 w-3 bg-current"]);
  expect(STEP_LOOK.a_venir).toContain("border-dashed");
  expect(STEP_LOOK.echec).toContain("after:h-2");
});

describe("the frieze and the bar of an agent that reported", () => {
  const min = 60_000;
  const claude = { title: "", name: "Robin", agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "" };
  const stale = [
    { title: "Plan", state: "fait" as const },
    { title: "Commit and report", state: "en_cours" as const },
    { title: "Ship", state: "a_venir" as const },
  ];

  async function show(report: "termine" | "bloque" | "echec", lastReport: "done" | "blocked" | "failed") {
    mockIPC(() => undefined);
    // Its payload still holds the steps it left when it reported (an older saved one, or an agent that never marked its last).
    await nodesStore.getState().create("robin", { workspaceId: "w1", kind: "terminal", payload: { ...claude, steps: stale, lastReport: { status: lastReport, summary: "s" } } });
    await nodesStore.getState().create("chef", {
      workspaceId: "w1",
      kind: "fleet",
      payload: {
        name: "Chef",
        mission: {
          ...NEW_MISSION,
          state: "en_cours",
          members: [{ nodeId: "robin", name: "Robin", task: "t", budgetMin: 50, linked: false, branch: "b", worktree: "w", sentAt: 0, report: { summary: "s", status: report, at: 22 * min } }],
        },
      },
    });
    canvasStore.setState({ view: { ...EMPTY_VIEW }, nodeRects: { robin: { x: 0, y: 0, width: 800, height: 400 } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<StepTimelines />));
    return {
      host,
      states: [...host.querySelectorAll("[data-step]")].map((dot) => dot.getAttribute("data-step")),
      bar: host.querySelector<HTMLElement>("[data-steps] [aria-label]")!,
      unmount: async () => {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  it("reads as finished: every step done, a full bar in the ok tone, titled Done in 22 min of 50", async () => {
    const view = await show("termine", "done");
    expect(view.states).toEqual(["fait", "fait", "fait"]);
    expect(view.bar.getAttribute("aria-label")).toBe("Done in 22 min of 50");
    const fill = view.bar.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("100%");
    expect(fill.style.backgroundColor).toBe("var(--dp-ok)");
    await view.unmount();
  });

  it.each([
    ["bloque", "blocked", "Blocked after 22 min of 50", "var(--dp-wait)"],
    ["echec", "failed", "Failed after 22 min of 50", "var(--dp-danger)"],
  ] as const)("fails the step under way and fills the bar in its own tone when it reported %s", async (report, lastReport, title, color) => {
    const view = await show(report, lastReport);
    expect(view.states).toEqual(["fait", "echec", "a_venir"]);
    expect(view.bar.getAttribute("aria-label")).toBe(title);
    const fill = view.bar.firstElementChild as HTMLElement;
    expect([fill.style.width, fill.style.backgroundColor]).toEqual(["100%", color]);
    await view.unmount();
  });
});

describe("what draws a frieze again", () => {
  const min = 60_000;
  const claude = { title: "", agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "" };
  const steps = [
    { title: "Plan", state: "fait" as const },
    { title: "Code", state: "en_cours" as const },
  ];
  const rect = (x: number) => ({ x, y: 0, width: 800, height: 400 });

  /**
   * Flash, a terminal with its steps; Nightwing, a mission's agent that reported with a step still under way and
   * a budget (its frieze settled and its bar made anew on every pass of the list); Raven, a terminal with none.
   */
  async function show() {
    mockIPC(() => undefined);
    await nodesStore.getState().create("flash", { workspaceId: "w1", kind: "terminal", payload: { ...claude, name: "Flash", steps } });
    await nodesStore.getState().create("nightwing", { workspaceId: "w1", kind: "terminal", payload: { ...claude, name: "Nightwing", steps, lastReport: { status: "done", summary: "s" } } });
    await nodesStore.getState().create("raven", { workspaceId: "w1", kind: "terminal", payload: { ...claude, name: "Raven" } });
    await nodesStore.getState().create("oracle", {
      workspaceId: "w1",
      kind: "fleet",
      payload: {
        name: "Oracle",
        mission: {
          ...NEW_MISSION,
          state: "en_cours",
          members: [{ nodeId: "nightwing", name: "Nightwing", task: "t", budgetMin: 50, linked: false, branch: "b", worktree: "w", sentAt: 0, report: { summary: "s", status: "termine", at: 22 * min } }],
        },
      },
    });
    canvasStore.setState({ view: { ...EMPTY_VIEW, zoom: 0.5, scrollX: 100 }, nodeRects: { flash: rect(0), nightwing: rect(900), raven: rect(1800) } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<StepTimelines />));
    vi.mocked(useSubagents).mockClear();
    return {
      frieze: (id: string) => host.querySelector<HTMLElement>(`[data-steps="${id}"]`)!,
      unmount: async () => {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  it("a pan or a zoom moves their one layer, and draws no frieze again", async () => {
    const view = await show();
    for (let frame = 1; frame <= 30; frame++) {
      await act(async () => canvasStore.setState((s) => ({ view: { ...s.view, scrollX: 100 - frame * 10, scrollY: frame * 4, zoom: 0.5 + frame / 100 } })));
    }
    expect([renders("flash"), renders("nightwing")]).toEqual([0, 0]);
    // Each frieze still shows under its terminal: (x + scrollX) * zoom, (400 + 3 + scrollY) * zoom.
    expect(onScreen(view.frieze("flash"))).toEqual({ left: (0 - 200) * 0.8, top: (403 + 120) * 0.8, scale: 0.8 });
    expect(onScreen(view.frieze("nightwing"))).toEqual({ left: (900 - 200) * 0.8, top: (403 + 120) * 0.8, scale: 0.8 });
    await view.unmount();
  });

  it("a change to another node, or to what a frieze does not show, draws none again; a change to its steps draws that one alone", async () => {
    const view = await show();
    await act(async () => nodesStore.getState().update("raven", { title: "Another task" }));
    await act(async () => nodesStore.getState().update("flash", { title: "Its title, not its steps" }));
    expect([renders("flash"), renders("nightwing")]).toEqual([0, 0]);
    await act(async () => nodesStore.getState().update("flash", { steps: [...steps, { title: "Ship", state: "a_venir" }] }));
    expect([renders("flash"), renders("nightwing")]).toEqual([1, 0]);
    expect(view.frieze("flash").textContent).toContain("Ship");
    // Nightwing's frieze and bar, as they were: settled, and done in 22 min of 50.
    expect([...view.frieze("nightwing").querySelectorAll("[data-step]")].map((dot) => dot.getAttribute("data-step"))).toEqual(["fait", "fait"]);
    expect(view.frieze("nightwing").querySelector("[aria-label]")!.getAttribute("aria-label")).toBe("Done in 22 min of 50");
    await view.unmount();
  });

  it("a node dragged draws its own frieze again, not the others'", async () => {
    const view = await show();
    // As setNodeRects hands them: every rectangle a new object, one of them moved.
    await act(async () => canvasStore.setState({ nodeRects: { flash: { ...rect(0), y: 50 }, nightwing: rect(900), raven: rect(1800) } }));
    expect([renders("flash"), renders("nightwing")]).toEqual([1, 0]);
    expect(onScreen(view.frieze("flash")).top).toBe((50 + 403 + 0) * 0.5);
    await view.unmount();
  });
});
