import { useEffect, useRef } from "react";
import { Maximize2 } from "lucide-react";
import { agentInk, AGENTS, INDIGO } from "@/fleet/catalog";
import { memberOf } from "@/mission/store";
import type { TerminalPayload, TerminalReportStatus } from "@/nodes/types";
import type { AgentActivity } from "@/store/agentActivity";
import { useNodes } from "@/store/nodes";
import type { TerminalStatus } from "@/store/terminalStatus";
import { useMessages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";
import { expandTerminal, settleMinimizedSize } from "./minimize";
import { StatusDot, type DotState } from "./StatusDot";
import { StatusPill } from "./StatusPill";
import { HeaderButton } from "./TerminalHeader";

/** A report reads like a status: done rests, blocked waits for the user, failed is an error. */
const REPORT_DOTS: Record<TerminalReportStatus, DotState> = {
  done: "done",
  blocked: "waiting",
  failed: "error",
};

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

/** What the card says under the name: its last report, else its mission task, else the step under way, else its title. */
export function cardLine(payload: TerminalPayload, task?: string): string {
  if (payload.lastReport?.summary) return firstLine(payload.lastReport.summary);
  if (task) return firstLine(task);
  const step = payload.steps?.find((s) => s.state === "en_cours")?.title;
  return step ?? firstLine(payload.title);
}

/**
 * A minimized terminal (./minimize.ts): its agent and name, where it stands,
 * one line of what it did, and the way back to full size. A double-click
 * anywhere on it expands it, even before Excalidraw has made it active (an
 * inactive node gets no pointer events: the canvas hears the double-click).
 */
export function MinimizedCard(props: { nodeId: string; payload: TerminalPayload; status: TerminalStatus; activity?: AgentActivity }) {
  const { nodeId, payload, status, activity } = props;
  const t = useMessages(nodesMessages).minimized;
  const task = useNodes(() => memberOf(nodeId, { evenClosed: true })?.member.task);
  const ref = useRef<HTMLDivElement>(null);
  const meta = AGENTS[payload.agent];
  const report = payload.lastReport;
  const line = cardLine(payload, task);

  // Minimized while its scene was not on screen: its element takes the card's height now.
  useEffect(() => {
    const frame = requestAnimationFrame(() => settleMinimizedSize(nodeId));
    return () => cancelAnimationFrame(frame);
  }, [nodeId]);

  useEffect(() => {
    const card = ref.current;
    const canvas = card?.closest<HTMLElement>(".excalidraw");
    if (!card || !canvas) return;
    const onDoubleClick = (event: MouseEvent) => {
      const box = card.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) return;
      event.preventDefault();
      event.stopPropagation();
      expandTerminal(nodeId);
    };
    canvas.addEventListener("dblclick", onDoubleClick, true);
    return () => canvas.removeEventListener("dblclick", onDoubleClick, true);
  }, [nodeId]);

  return (
    <div ref={ref} data-minimized={nodeId} title={t.doubleClickExpand} className="flex h-full min-h-0 flex-col justify-center bg-dp-terminal-head px-3 text-xs">
      <div className="flex h-8 shrink-0 items-center gap-2">
        <meta.Icon aria-hidden className="size-4 shrink-0" style={{ color: agentInk(meta.tint) }} />
        <span className="truncate font-medium text-dp-text">{payload.name || meta.label}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {report ? (
            <span data-report={report.status} className="flex shrink-0 items-center gap-2 text-xs text-dp-text-2">
              <StatusDot state={REPORT_DOTS[report.status]} />
              {t.report[report.status]}
            </span>
          ) : (
            <StatusPill status={status} activity={activity} indigo={meta.tint === INDIGO} />
          )}
          <HeaderButton label={t.expand} onClick={() => expandTerminal(nodeId)}>
            <Maximize2 />
          </HeaderButton>
        </div>
      </div>
      {/* Under the name: the 16px icon and its 8px gap. */}
      {line && (
        <p title={report?.summary ?? line} className="truncate pl-6 text-xs leading-5 text-dp-text-2">
          {line}
        </p>
      )}
    </div>
  );
}
