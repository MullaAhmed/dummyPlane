import { useEffect, useState } from "react";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { findTerminalAt } from "@/canvas/hitTest";
import { nodeKindOf } from "@/canvas/nodeElement";
import { useMessages } from "@/i18n";
import { TOP_ROW_HEIGHT } from "@/shell/layout";
import { useNodes } from "@/store/nodes";
import { uiStore, useUi } from "@/store/ui";
import { linkAgents, linkableAgent } from "./agentLinks";
import { fleetMessages } from "./messages";
import { finishButtonAt, forwardWheel } from "./linkOverlay";
import { linkOrchestrator } from "./orchestrators";
import { clientRectOf, sceneOf } from "./placement";
import type { Point } from "./terminals";
import { linkTargetAt, orchestratorAt, orchestratorsOf } from "./wires";

/**
 * "Link" (spec theme §13): each click wires a group or a terminal; Escape or a click in the void ends it.
 * Started from an agent's foot, it runs the other way: a click on an orchestrator wires the agent to it,
 * the same wire as from the orchestrator's end; a click on another agent links the two (fleet/agentLinks.ts).
 * Either way the mode ends.
 */
export function LinkMode() {
  const t = useMessages(fleetMessages);
  const linking = useUi((s) => s.linking);
  const fromAgent = useNodes((s) => (linking ? s.nodes[linking]?.kind === "terminal" : false));
  const view = useCanvas((s) => s.view);
  const frames = useCanvas((s) => s.frames);
  const links = useCanvas((s) => s.links);
  const [pointer, setPointer] = useState<Point | null>(null);

  useEffect(() => {
    if (!linking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") uiStore.getState().setLinking(null);
    };
    // Captured: the Link button keeps the focus after its click, and the foot it sits in stops every key
    // on its way up (useNativeKeyDown), so Escape would never bubble here.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [linking]);

  if (!linking) return null;
  const elements = canvasStore.getState().api?.getSceneElements() ?? [];
  const targetAt = (client: Point) => {
    const point = sceneOf(client, view);
    if (!fromAgent) return linkTargetAt(elements, frames, point);
    // From an agent: an orchestrator, else another agent (itself and a plain shell designate nothing).
    const orchestrator = orchestratorAt(elements, point);
    if (orchestrator) return orchestrator;
    const terminal = findTerminalAt(elements, point.x, point.y);
    return terminal && terminal.id !== linking && linkableAgent(terminal.id) ? terminal.id : null;
  };
  const hovered = pointer ? targetAt(pointer) : null;
  const rect = hovered ? (frames.find((f) => f.id === hovered) ?? elements.find((e) => e.id === hovered)) : undefined;

  const link = (target: string) => {
    if (!fromAgent) return linkOrchestrator(linking, target);
    const element = elements.find((e) => e.id === target);
    const orchestrator = element !== undefined && nodeKindOf(element) === "orchestrator";
    // An orchestrator that already commands the agent, through its group too, gets no second wire.
    if (!orchestrator) linkAgents(linking, target);
    else if (!orchestratorsOf(linking, links, frames).includes(target)) linkOrchestrator(target, linking);
    uiStore.getState().setLinking(null);
  };

  return (
    <div
      // Starts under the bars: the title bar's buttons and drag area keep working while placing or linking.
      className="fixed inset-x-0 bottom-0 z-40 cursor-crosshair"
      style={{ top: TOP_ROW_HEIGHT }}
      onPointerMove={(e) => setPointer({ x: e.clientX, y: e.clientY })}
      onWheel={forwardWheel}
      onContextMenu={(e) => {
        e.preventDefault();
        uiStore.getState().setLinking(null);
      }}
      onClick={(e) => {
        // The layer covers the linker's own "Done": the click goes on to it. Another node's Link is
        // only a place on that node: from an agent's end, the orchestrator's "+ Link" designates it.
        const finish = finishButtonAt(e.clientX, e.clientY);
        if (finish && finish.getAttribute("data-link-toggle") === linking) return finish.click();
        const target = targetAt({ x: e.clientX, y: e.clientY });
        if (target) link(target);
        else uiStore.getState().setLinking(null);
      }}
    >
      {rect && (
        <div
          className="pointer-events-none fixed rounded-lg border-2 border-dashed border-dp-accent/80 bg-dp-accent/5"
          style={clientRectOf(rect, view)}
        />
      )}
      <div
        className="dp-glass-strong pointer-events-none fixed left-1/2 -translate-x-1/2 rounded-md px-3 py-1 text-xs text-dp-text-2"
        style={{ top: TOP_ROW_HEIGHT + 14 }}
      >
        {fromAgent ? t.link.agentHint : t.link.hint}
      </div>
    </div>
  );
}
