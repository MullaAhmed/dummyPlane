import { useEffect, useRef, useState } from "react";
import { toastError } from "@/lib/errorToast";
import { canvasStore, useCanvas, type CanvasView } from "@/canvas/canvasStore";
import { groupAt } from "@/canvas/groups";
import { messages, useMessages } from "@/i18n";
import { TOP_ROW_HEIGHT } from "@/shell/layout";
import { uiStore, useUi, type Placement } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { agentsMessages } from "./messages";
import { freeCell } from "./groupLayout";
import { launchAgent } from "./launchAgent";
import { addFleet } from "@/fleet/fleets";
import { forwardWheel } from "./linkOverlay";
import { clientRectOf, ghostRect, sceneOf } from "./placement";
import type { Point } from "./terminals";

/** Where a key typed into goes: Enter there is the field's (or the terminal's), not the placement's. */
const TYPED_INTO = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .xterm';

/** The middle of the canvas, in window coordinates: where the ghost waits until the pointer moves over the canvas. */
function canvasMiddle(view: CanvasView): Point | null {
  if (view.width === 0 || view.height === 0) return null;
  return { x: view.offsetLeft + view.width / 2, y: view.offsetTop + view.height / 2 };
}

/** Places what is being placed at a window point, as a click there does. */
function placeAt(placing: Placement, client: Point) {
  uiStore.getState().setPlacing(null);
  const center = sceneOf(client, canvasStore.getState().view);
  const workspaceId = workspacesStore.getState().activeId;
  const placed =
    "fleet" in placing ? (workspaceId ? addFleet(workspaceId, center) : Promise.resolve()) : launchAgent(placing.agent, placing.options, center);
  void placed.catch((error: unknown) => toastError(messages(agentsMessages).launchFailed, { error, next: messages(agentsMessages).launchNext }));
}

/**
 * Dashed outline that follows the pointer until a click places the agent.
 * Enter places it where the ghost is: under the pointer, or, before the pointer has moved
 * over the canvas (a launch from the keyboard), in its middle. Escape cancels.
 */
export function PlacementGhost() {
  const t = useMessages(agentsMessages);
  const placing = useUi((s) => s.placing);
  const view = useCanvas((s) => s.view);
  const frames = useCanvas((s) => s.frames);
  const [pointer, setPointer] = useState<Point | null>(null);
  // The pointer as Enter reads it, between renders.
  const pointerRef = useRef<Point | null>(null);
  const movePointer = (point: Point | null) => {
    pointerRef.current = point;
    setPointer(point);
  };

  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") uiStore.getState().setPlacing(null);
    };
    // Captured before anything else hears it: Enter on the button the menu gave the focus back to would open the menu again,
    // and Excalidraw would act on the selection.
    const onEnter = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.target instanceof Element && e.target.closest(TYPED_INTO)) return;
      const at = pointerRef.current ?? canvasMiddle(canvasStore.getState().view);
      if (!at) return;
      e.preventDefault();
      e.stopPropagation();
      placeAt(placing, at);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onEnter, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onEnter, true);
      // The next placement starts from the middle again, wherever this one ended.
      movePointer(null);
    };
  }, [placing]);

  if (!placing) return null;
  // Over a group the ghost shows the cell the agent will take.
  const fleet = "fleet" in placing;
  const at = pointer ?? canvasMiddle(view);
  // A fleet is placed freely; an agent over a group takes the group's next cell.
  const group = at && !fleet ? groupAt(frames, sceneOf(at, view)) : null;
  const members = group ? (canvasStore.getState().api?.getSceneElements().filter((e) => e.frameId === group.id) ?? []) : [];
  const rect = group ? clientRectOf(freeCell(group, members).cell, view) : at ? ghostRect(at, view.zoom, fleet ? "fleet" : "terminal") : null;

  return (
    <div
      // Starts under the bars: the title bar's buttons and drag area keep working while placing or linking.
      className="fixed inset-x-0 bottom-0 z-40 cursor-crosshair"
      style={{ top: TOP_ROW_HEIGHT }}
      onPointerMove={(e) => movePointer({ x: e.clientX, y: e.clientY })}
      // The layer covers the canvas, not the gesture: the wheel still pans and zooms it, as in link mode.
      onWheel={forwardWheel}
      onContextMenu={(e) => {
        e.preventDefault();
        uiStore.getState().setPlacing(null);
      }}
      onClick={(e) => placeAt(placing, { x: e.clientX, y: e.clientY })}
    >
      {rect && (
        <div data-ghost className="pointer-events-none fixed rounded-lg border-2 border-dashed border-dp-accent/80 bg-dp-accent/5" style={rect} />
      )}
      {/* Said, not only shown: a launch from the keyboard lands here with nothing under the pointer to look at. */}
      <div
        role="status"
        className="dp-glass-strong pointer-events-none fixed left-1/2 -translate-x-1/2 rounded-md px-3 py-1 text-xs text-dp-text-2"
        style={{ top: TOP_ROW_HEIGHT + 14 }}
      >
        {group ? t.placement.addToGroup(group.name) : fleet ? t.placement.placeFleet : t.placement.placeAgent}
      </div>
    </div>
  );
}
