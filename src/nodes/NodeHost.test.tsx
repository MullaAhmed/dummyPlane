// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ExcalidrawEmbeddableElement, NonDeleted } from "@excalidraw/excalidraw/element/types";
import { canvasStore } from "@/canvas/canvasStore";
import { NodeHost } from "./NodeHost";

vi.mock("@excalidraw/excalidraw", () => ({}));
// A terminal's header button and its xterm field: two stops of the Tab order.
vi.mock("./terminal/TerminalNode", () => ({
  TerminalNode: ({ nodeId }: { nodeId: string }) => (
    <div data-shown={nodeId}>
      <button type="button">Close</button>
      <textarea />
    </div>
  ),
}));
vi.mock("./fleet/FleetNode", () => ({ FleetNode: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const element = { id: "a", type: "embeddable", customData: { kind: "terminal" } } as unknown as NonDeleted<ExcalidrawEmbeddableElement>;
const frame = (folded: boolean) => ({ id: "g", name: "G", x: 0, y: 0, width: 1, height: 1, group: { role: "general", pantheon: "greek", ...(folded ? { folded } : {}) }, memberIds: ["a"] });

it("shows nothing of a terminal whose group is folded, and brings it back when unfolded", async () => {
  canvasStore.setState({ frames: [frame(true)] as never });
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<NodeHost element={element} />));
  expect(host.querySelector("[data-shown]")).toBeNull();
  await act(async () => canvasStore.setState({ frames: [frame(false)] as never }));
  expect(host.querySelector("[data-shown='a']")).not.toBeNull();
  await act(async () => root.unmount());
});

it("keeps a node out of the Tab order while it is not the active one, and puts it back once it is", async () => {
  canvasStore.setState({ frames: [], activeNode: null });
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<NodeHost element={element} />));
  // Its id, for what a press on its controls activates (canvas/liveControls.ts).
  expect(host.querySelector("[data-node-id='a']")).not.toBeNull();
  const stops = () => [...host.querySelectorAll<HTMLElement>("button, textarea")].map((e) => e.tabIndex);
  expect(stops()).toEqual([-1, -1]);
  await act(async () => canvasStore.setState({ activeNode: "a" }));
  expect(stops()).toEqual([0, 0]);
  await act(async () => canvasStore.setState({ activeNode: "b" }));
  expect(stops()).toEqual([-1, -1]);
  await act(async () => root.unmount());
  canvasStore.setState({ activeNode: null });
});
