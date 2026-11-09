import { useEffect, useRef } from "react";
import { Copy, X } from "lucide-react";
import { toast } from "sonner";
import { canvasStore, useCanvas } from "@/canvas/canvasStore";
import { AGENTS } from "@/fleet/catalog";
import { duplicateTerminal, requestClose } from "@/fleet/terminals";
import { cn } from "@/lib/utils";
import { useActivity } from "@/store/agentActivity";
import { terminalOf, useNodes } from "@/store/nodes";
import { useTerminalStatus } from "@/store/terminalStatus";
import { ArrivalFlash } from "./ArrivalFlash";
import { frameStyle, WAITING_GLOW } from "./frame";
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
  const rootRef = useRef<HTMLDivElement>(null);
  const hasPayload = payload !== undefined;
  const minimized = payload?.minimized === true;
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

  // Excalidraw would pan the canvas on a wheel over this terminal (terminalWheel.ts).
  useEffect(() => {
    const root = rootRef.current;
    const canvas = root?.closest<HTMLElement>(".excalidraw");
    if (!root || !canvas) return;
    return keepTerminalWheel(root, canvas, () => xtermOf(nodeId));
  }, [nodeId, hasPayload]);

  if (!payload) {
    return <MissingNode text={t.notFound} />;
  }

  const waiting = status.state === "running" && activity?.activity === "waiting";
  return (
    <div
      ref={rootRef}
      data-terminal={nodeId}
      className="relative flex h-full flex-col overflow-hidden rounded-lg bg-dp-terminal"
      style={frameStyle(AGENTS[payload.agent].tint, selected, waiting)}
    >
      {minimized ? (
        <MinimizedCard nodeId={nodeId} payload={payload} status={status} activity={activity} />
      ) : (
        <TerminalHeader
          nodeId={nodeId}
          payload={payload}
          status={status}
          activity={activity}
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
      <div className={cn("relative min-h-0 flex-1 px-1 pt-1", minimized && "hidden")}>
        <div ref={hostRef} className="relative h-full w-full overflow-hidden" />
        <ResumeCard nodeId={nodeId} payload={payload} status={status} />
      </div>
      {waiting && <div className="pointer-events-none absolute inset-0 z-20 rounded-lg" style={{ boxShadow: WAITING_GLOW }} />}
      <ArrivalFlash nodeId={nodeId} />
    </div>
  );
}
