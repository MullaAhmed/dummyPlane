import { useEffect, useRef } from "react";
import { Copy, X } from "lucide-react";
import { toast } from "sonner";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { duplicateTerminal, requestClose } from "@/fleet/terminals";
import { cn } from "@/lib/utils";
import { useActivity } from "@/store/agentActivity";
import { terminalOf, useNodes } from "@/store/nodes";
import { useTerminalStatus } from "@/store/terminalStatus";
import { AgentFoot, hasAgentFoot } from "./AgentFoot";
import { ArrivalFlash } from "./ArrivalFlash";
import { frameStyle } from "./frame";
import { MinimizedCard } from "./MinimizedCard";
import { MissingNode } from "./MissingNode";
import { ResumeCard } from "./ResumeCard";
import { HeaderButton, TerminalHeader } from "./TerminalHeader";
import { useTerminalHost } from "./useTerminalHost";
import { layoutTerminal, xtermOf } from "./registry";
import { keepTerminalWheel } from "./terminalWheel";
import { useMessages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";

export function TerminalNode({ nodeId }: { nodeId: string }) {
  const payload = useNodes((s) => terminalOf(s.nodes[nodeId]));
  const status = useTerminalStatus(nodeId);
  const activity = useActivity(nodeId);
  const workspaceId = useNodes((s) => s.nodes[nodeId]?.workspaceId);
  const selected = useCanvas((s) => s.view.selectedIds.includes(nodeId));
  const hostRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const hasPayload = payload !== undefined;
  const minimized = payload?.minimized === true;
  const foot = payload !== undefined && hasAgentFoot(payload.agent);
  const t = useMessages(nodesMessages).terminal;

  // Minimized, its xterm stays mounted under the card, hidden (a hidden host is never laid out): its process goes on.
  useTerminalHost(nodeId, hostRef, hasPayload);

  // Expanded again: its grid takes the size back once, a frame later, when the host has it.
  const wasMinimized = useRef(minimized);
  useEffect(() => {
    const expanded = wasMinimized.current && !minimized;
    wasMinimized.current = minimized;
    if (!expanded) return;
    const frame = requestAnimationFrame(() => {
      if (hostRef.current) layoutTerminal(nodeId, hostRef.current, canvasStore.getState().view.zoom);
    });
    return () => cancelAnimationFrame(frame);
  }, [nodeId, minimized]);

  // Excalidraw would pan the canvas on a wheel over this terminal (terminalWheel.ts). Only over its
  // body, as an orchestrator's: the foot's field keeps its own wheel, and a minimized card's hidden body takes none.
  useEffect(() => {
    const body = bodyRef.current;
    const canvas = body?.closest<HTMLElement>(".excalidraw");
    if (!body || !canvas) return;
    return keepTerminalWheel(body, canvas, () => xtermOf(nodeId));
  }, [nodeId, hasPayload]);

  if (!payload) {
    return <MissingNode text={t.notFound} />;
  }

  const waiting = status.state === "running" && activity?.activity === "waiting";
  return (
    <div
      data-terminal={nodeId}
      className="relative flex h-full flex-col overflow-hidden rounded-xl bg-dp-terminal"
      style={frameStyle(selected, waiting)}
    >
      {minimized ? (
        <MinimizedCard nodeId={nodeId} payload={payload} status={status} activity={activity} />
      ) : (
        <TerminalHeader
          nodeId={nodeId}
          payload={payload}
          status={status}
          activity={activity}
          showStatus={!foot}
          actions={
            <>
              <HeaderButton
                label={t.duplicate}
                onClick={() =>
                  workspaceId &&
                  void duplicateTerminal(workspaceId, nodeId).catch((error: unknown) =>
                    toast.error(t.duplicateFailed(String(error))),
                  )
                }
              >
                <Copy />
              </HeaderButton>
              <HeaderButton label={t.close} onClick={() => requestClose(nodeId)}>
                <X />
              </HeaderButton>
            </>
          }
        />
      )}
      {/* The padding sits on a wrapper: the grid is sized from the host's
          client size, which would include padding set on the host itself. */}
      <div ref={bodyRef} className={cn("relative min-h-0 flex-1 px-1 pt-1", minimized && "hidden")}>
        <div ref={hostRef} className="relative h-full w-full overflow-hidden" />
        <ResumeCard nodeId={nodeId} payload={payload} status={status} />
      </div>
      {/* Under the body, which gives up its height to it: the host's ResizeObserver fits the grid again. */}
      {foot && !minimized && <AgentFoot nodeId={nodeId} payload={payload} status={status} activity={activity} />}
      <ArrivalFlash nodeId={nodeId} />
    </div>
  );
}
