// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { NEW_MISSION } from "@/mission/mission";
import { nodesStore } from "@/store/nodes";
import { subagentsStore } from "@/store/subagents";
import { StepTimelines } from "./StepTimelines";

vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  // (0 + 100) * 0.5 = 50; 400 * 0.5 = 200 below the top, then the gap at the view's scale;
  // drawn at the scene's size (800 wide) and scaled like the nodes (final review H1).
  expect([friezes[0].style.left, friezes[0].style.top, friezes[0].style.width, friezes[0].style.transform]).toEqual(["50px", "201.5px", "800px", "scale(0.5)"]);
  // Under the nodes, never in the way of a header below it: no layer above them, no click taken.
  const layer = host.firstElementChild as HTMLElement;
  expect(layer.className).not.toMatch(/z-/);
  expect(host.querySelector(".pointer-events-auto")).toBeNull();
  expect(friezes[0].textContent).toContain("Plan");
  expect(friezes[0].textContent).toContain("×3");
  await act(async () => root.unmount());
  host.remove();
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
