import { useEffect, useRef, useState } from "react";
import { Network, X } from "lucide-react";
import { useCanvas } from "@/canvas/canvasStore";
import { useUiRequest } from "@/commands/uiRequests";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { pauseAll, resumeAll } from "@/agents/broadcast";
import { AGENTS, INDIGO } from "@/agents/catalog";
import { RemoteButton } from "@/agents/RemoteButton";
import { setRemoteControlAll } from "@/agents/remoteControl";
import { defaultLaunchOptions } from "@/agents/launchAgent";
import { renameFleet, requestCloseFleet } from "@/fleet/fleets";
import { linkedAgents, NO_LINKS } from "@/agents/wires";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/useNow";
import { clockText } from "@/mission/mission";
import { MissionPanel } from "@/mission/MissionPanel";
import { useActivity, type AgentActivity } from "@/store/agentActivity";
import { nodesStore, useNodes } from "@/store/nodes";
import { useTerminalStatus, type TerminalStatus } from "@/store/terminalStatus";
import { frameStyle, NODE_FRAME, TERMINAL_BODY } from "../terminal/frame";
import { fleetAgent } from "@/fleet/fleetAgent";
import { fleetSession } from "../terminal/launch";
import { markForAutostart, xtermOf } from "../terminal/registry";
import { keepTerminalWheel } from "../terminal/terminalWheel";
import { MissingNode } from "../terminal/MissingNode";
import { NameField } from "../terminal/NameField";
import { HeaderButton, HeaderMenu, keepFocusAfterMenu, NodeHeader, NodeHeaderEnd, WIDE_ONLY } from "../terminal/NodeHeader";
import { noteMessages } from "../note/messages";
import { quickNote } from "../note/quickNote";
import { ResumeCard } from "../terminal/ResumeCard";
import { StatusPill } from "../terminal/StatusPill";
import { keepFieldWheel } from "./keepWheel";
import { useTerminalHost } from "../terminal/useTerminalHost";
import { FleetInput } from "./FleetInput";
import { ToolsUnavailable } from "./ToolsUnavailable";
import { useMessages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";
import type { TerminalPayload } from "@/nodes/types";

/** The manager of a team, the Fleet: its Claude session, then its mission (spec orchestrateur §6). */
export function FleetNode({ nodeId }: { nodeId: string }) {
  const t = useMessages(nodesMessages).fleet;
  const record = useNodes((s) => s.nodes[nodeId]);
  const links = useCanvas((s) => s.links[nodeId] ?? NO_LINKS);
  const frames = useCanvas((s) => s.frames);
  const selected = useCanvas((s) => s.view.selectedIds.includes(nodeId));
  const status = useTerminalStatus(nodeId);
  const activity = useActivity(nodeId);
  const hostRef = useRef<HTMLDivElement>(null);
  const session = record?.kind === "fleet" ? record.payload.session : undefined;
  const now = useNow(15_000);
  const clock = record?.kind === "fleet" && record.payload.mission ? clockText(record.payload.mission, now) : null;

  useEffect(() => {
    const current = nodesStore.getState().nodes[nodeId];
    // A Fleet of before gets its session when first shown (spec orchestrateur §6).
    if (current?.kind !== "fleet" || current.payload.session) return;
    nodesStore.getState().update(nodeId, { session: fleetSession(current.payload.name, defaultLaunchOptions(current.workspaceId), fleetAgent()) });
    markForAutostart(nodeId);
  }, [nodeId]);
  useTerminalHost(nodeId, hostRef, session !== undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = record?.kind === "fleet";
  useEffect(() => (rootRef.current ? keepFieldWheel(rootRef.current) : undefined), [shown]);
  // Over its session, the wheel scrolls the terminal rather than panning the canvas (terminalWheel.ts),
  // like a terminal node; the mission and the field below keep theirs.
  const sessionAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const area = sessionAreaRef.current;
    const canvas = area?.closest<HTMLElement>(".excalidraw");
    if (!area || !canvas) return;
    return keepTerminalWheel(area, canvas, () => xtermOf(nodeId));
  }, [nodeId, shown]);

  if (record?.kind !== "fleet") {
    return <MissingNode text={t.notFound} />;
  }

  const linked = linkedAgents(links, frames);
  const waiting = status.state === "running" && activity?.activity === "waiting";
  return (
    <div
      ref={rootRef}
      data-fleet={nodeId}
      // The head's colour all the way down, the mission and the field included: they inherit it.
      className={cn(NODE_FRAME, "bg-dp-terminal-head text-dp-text")}
      style={frameStyle(selected, waiting)}
    >
      <FleetHeader
        nodeId={nodeId}
        name={record.payload.name}
        session={session}
        status={status}
        activity={activity}
        clock={clock}
        agentIds={linked.agentIds}
      />
      <div ref={sessionAreaRef} className={cn(TERMINAL_BODY, "min-h-30 bg-dp-terminal")}>
        <div ref={hostRef} className="relative h-full w-full overflow-hidden" />
        {session && <ResumeCard nodeId={nodeId} payload={session} status={status} />}
        {status.state === "error" && status.kind === "toolsUnavailable" && <ToolsUnavailable nodeId={nodeId} message={status.message} />}
      </div>
      <MissionPanel nodeId={nodeId} />
      <FleetInput nodeId={nodeId} />
    </div>
  );
}

/**
 * The Fleet's header, built like a terminal's (../terminal/TerminalHeader.tsx):
 * its icon, its name, where its session stands, Remote Control's state, "⋯"
 * for the rest, Close. The clock of its mission joins them from 28rem on.
 */
function FleetHeader(props: {
  nodeId: string;
  name: string;
  session?: TerminalPayload;
  status: TerminalStatus;
  activity?: AgentActivity;
  clock: string | null;
  agentIds: readonly string[];
}) {
  const { nodeId, name, session, status, activity, clock, agentIds } = props;
  const t = useMessages(nodesMessages).fleet;
  const quickNoteLabel = useMessages(noteMessages).add;
  const [editing, setEditing] = useState(false);
  // "Rename" of the Fleet's radial menu.
  useUiRequest("renameFleet", (request) => {
    if (request.id !== nodeId) return false;
    setEditing(true);
    return true;
  });
  const running = status.state === "running";
  return (
    <NodeHeader>
      <Network className="size-4 shrink-0 text-dp-accent" />
      <NameField value={name} editing={editing} onEditingChange={setEditing} onCommit={(next) => renameFleet(nodeId, next)} />
      <NodeHeaderEnd>
        {clock && (
          <span title={t.clockTitle} className={cn(WIDE_ONLY, "font-mono text-dp-text-2 tabular-nums")}>
            {clock}
          </span>
        )}
        <StatusPill status={status} activity={activity} indigo={AGENTS.claude.tint === INDIGO} labelClassName="@max-xs/head:sr-only" />
        {session && <RemoteButton nodeId={nodeId} wanted={session.remoteControl === true} running={running} />}
        <HeaderMenu label={t.menu}>
          <DropdownMenuItem onSelect={() => void pauseAll(agentIds)}>{t.pauseAll}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void resumeAll(agentIds)}>{t.resumeAll}</DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Spec maj §2: the Fleet and its team, followed from the phone. */}
          <DropdownMenuItem onSelect={() => void setRemoteControlAll([nodeId, ...agentIds], true)}>{t.remoteTeam}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void setRemoteControlAll([nodeId, ...agentIds], false)}>{t.remoteOff}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              keepFocusAfterMenu();
              void quickNote(nodeId);
            }}
          >
            {quickNoteLabel}
          </DropdownMenuItem>
        </HeaderMenu>
        <HeaderButton label={t.close} onClick={() => requestCloseFleet(nodeId)}>
          <X />
        </HeaderButton>
      </NodeHeaderEnd>
    </NodeHeader>
  );
}
