// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { canvasStore, EMPTY_VIEW, useCanvasPlace } from "./canvasStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => canvasStore.setState({ view: EMPTY_VIEW }));

it("re-renders an overlay when the view scrolls or zooms, not when the selection, the tool or the mode changes (P2 #58)", async () => {
  let renders = 0;
  let seen: ReturnType<typeof useCanvasPlace> | null = null;
  function Overlay() {
    renders++;
    seen = useCanvasPlace();
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<Overlay />));
  expect(renders).toBe(1);
  const view = () => canvasStore.getState().view;
  await act(async () => canvasStore.setState({ view: { ...view(), selectedIds: ["a"] } }));
  await act(async () => canvasStore.setState({ view: { ...view(), tool: "freedraw" } }));
  await act(async () => canvasStore.setState({ view: { ...view(), mode: "reading", editingFrame: "f1" } }));
  expect(renders).toBe(1);
  await act(async () => canvasStore.setState({ view: { ...view(), scrollX: 40 } }));
  await act(async () => canvasStore.setState({ view: { ...view(), zoom: 2 } }));
  expect(renders).toBe(3);
  expect(seen).toEqual({ scrollX: 40, scrollY: 0, zoom: 2, offsetLeft: 0, offsetTop: 0 });
  await act(async () => root.unmount());
});
