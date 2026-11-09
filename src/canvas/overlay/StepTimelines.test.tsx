// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { nodesStore } from "@/store/nodes";
import { subagentsStore } from "@/store/subagents";
import { StepTimelines } from "./StepTimelines";

vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("draws each terminal's steps under it, following the view, with its running subagents", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("isis", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "", name: "Isis", agent: "claude", cwd: "C:/code", shell: "default", command: "", steps: [{ title: "Plan", state: "fait" }, { title: "Code", state: "en_cours" }] },
  });
  await nodesStore.getState().create("thot", { workspaceId: "w1", kind: "terminal", payload: { title: "", name: "Thoth", agent: "claude", cwd: "C:/code", shell: "default", command: "" } });
  canvasStore.setState({
    view: { ...EMPTY_VIEW, zoom: 0.5, scrollX: 100, scrollY: 0 },
    nodeRects: { isis: { x: 0, y: 0, width: 800, height: 400 }, thot: { x: 900, y: 0, width: 800, height: 400 } },
  });
  subagentsStore.getState().set("isis", 3);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<StepTimelines />));
  const friezes = host.querySelectorAll<HTMLElement>("[data-steps]");
  expect([...friezes].map((f) => f.dataset.steps)).toEqual(["isis"]);
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
