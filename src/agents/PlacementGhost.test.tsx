// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { uiStore } from "@/store/ui";
import { PlacementGhost } from "./PlacementGhost";

vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("lets the wheel through to the canvas while an agent is being placed: the layer covers the canvas, not the gesture", async () => {
  document.body.innerHTML = '<div class="excalidraw"><canvas class="interactive"></canvas></div>';
  const seen: WheelEvent[] = [];
  document.querySelector("canvas")!.addEventListener("wheel", (e) => seen.push(e));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  uiStore.getState().setPlacing({ agent: "shell", options: { cwd: "C:/", shell: "default", command: "" } } as never);
  await act(async () => root.render(<PlacementGhost />));
  const layer = host.querySelector<HTMLElement>(".cursor-crosshair")!;
  expect(layer).not.toBeNull();
  await act(async () => {
    layer.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, ctrlKey: true, clientX: 10, clientY: 20, bubbles: true, cancelable: true }));
  });
  expect(seen).toHaveLength(1);
  expect(seen[0].deltaY).toBe(-40);
  uiStore.getState().setPlacing(null);
  await act(async () => root.unmount());
  document.body.replaceChildren();
});
