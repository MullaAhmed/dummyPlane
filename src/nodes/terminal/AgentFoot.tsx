import { useEffect, useMemo, useRef } from "react";
import { Plus } from "lucide-react";
import type { SceneFrame } from "@/canvas/groups";
import { useCanvas } from "@/canvas/canvasStore";
import { Button } from "@/components/ui/button";
import { AGENTS, INDIGO } from "@/fleet/catalog";
import { CommandInput } from "@/fleet/CommandInput";
import { takesCommands } from "@/fleet/slashCommands";
import type { TargetAgent } from "@/fleet/targets";
import { orchestratorsOf } from "@/fleet/wires";
import { useMessages } from "@/i18n";
import type { AgentId } from "@/ipc/pty";
import { formatDuration } from "@/lib/format";
import { useNativeKeyDown } from "@/lib/useNativeKeyDown";
import { useNow } from "@/lib/useNow";
import type { TerminalPayload } from "@/nodes/types";
import type { AgentActivity } from "@/store/agentActivity";
import { nodesStore, useNodes } from "@/store/nodes";
import type { TerminalStatus } from "@/store/terminalStatus";
import { uiStore, useUi } from "@/store/ui";
import { MessageBar } from "../foot/MessageBar";
import { StatusLine } from "../foot/StatusLine";
import { nodesMessages } from "../messages";
import { keepFieldWheel } from "../orchestrator/keepWheel";
import { pillOf } from "./pill";
import { DOT_OF_TONE } from "./StatusDot";

/** The terminals that get a foot: the AI agents, the ones that take instructions (not a plain shell, not a custom command). */
export function hasAgentFoot(agent: AgentId): boolean {
  return takesCommands(agent);
}

const NO_GROUPS: SceneFrame[] = [];

/**
 * Under an agent's terminal, the same foot as an orchestrator's: a status line
 * (its dot, where it stands and for how long, the orchestrators that command
 * it, Link), then "Message <name>", folded until opened. The status lives
 * here rather than in the header: one dot per agent, beside the question it
 * may be asking at the bottom of its terminal.
 */
export function AgentFoot(props: { nodeId: string; payload: TerminalPayload; status: TerminalStatus; activity?: AgentActivity }) {
  const { nodeId, payload, status, activity } = props;
  const t = useMessages(nodesMessages).foot;
  const foot = useRef<HTMLElement>(null);
  const name = payload.name || AGENTS[payload.agent].label;
  // No key typed in the foot reaches the canvas: Backspace there would delete the node.
  useNativeKeyDown(foot, () => undefined);
  // The wheel over the field scrolls the field, not the canvas; the terminal's own wheel stops at its body.
  useEffect(() => (foot.current ? keepFieldWheel(foot.current) : undefined), []);
  return (
    <footer ref={foot} data-agent-foot={nodeId} className="shrink-0 border-t border-dp-line bg-dp-terminal-head">
      <AgentStatus nodeId={nodeId} payload={payload} status={status} activity={activity} />
      <MessageBar
        label={t.message(name)}
        open={payload.inputOpen === true}
        onOpenChange={(open) => nodesStore.getState().update(nodeId, { inputOpen: open })}
        field={(autoFocus) => <AgentField nodeId={nodeId} name={name} autoFocus={autoFocus} />}
      />
    </footer>
  );
}

/** "● Working · 4 min · from Atlas", in the words of its header pill and minimized card (pillOf). */
function AgentStatus(props: { nodeId: string; payload: TerminalPayload; status: TerminalStatus; activity?: AgentActivity }) {
  const { nodeId, payload, status, activity } = props;
  const t = useMessages(nodesMessages).foot;
  const now = useNow(15_000);
  const links = useCanvas((s) => s.links);
  const frames = useCanvas((s) => s.frames);
  const commanders = useMemo(() => orchestratorsOf(nodeId, links, frames), [nodeId, links, frames]);
  // A string, so the line renders again only when a name changes, not on every node's change.
  const from = useNodes((s) =>
    commanders
      .map((id) => {
        const record = s.nodes[id];
        return record?.kind === "orchestrator" ? record.payload.name : "";
      })
      .filter(Boolean)
      .join(", "),
  );
  const running = status.state === "running";
  const pill = pillOf(status, running ? activity?.activity : undefined, AGENTS[payload.agent].tint === INDIGO);
  // How long only when the activity store dates it: a process's start or stop is not dated.
  const since = running && activity ? formatDuration(now - activity.since) : null;
  return (
    <StatusLine
      dot={DOT_OF_TONE[pill.tone]}
      label={pill.label}
      title={status.state === "error" ? status.message : undefined}
      facts={[since, from && t.from(from)]}
      end={<AgentLink nodeId={nodeId} />}
    />
  );
}

/**
 * Link from the agent's end: the link mode, waiting for a click on another
 * agent or an orchestrator (fleet/LinkMode.tsx). Always there: two agents
 * link without any orchestrator on the canvas.
 */
function AgentLink({ nodeId }: { nodeId: string }) {
  const t = useMessages(nodesMessages).foot;
  const linking = useUi((s) => s.linking === nodeId);
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      // Whose Link it is: the link layer passes a click on to the linker's own "Done" only (fleet/LinkMode.tsx).
      data-link-toggle={nodeId}
      aria-pressed={linking}
      title={linking ? undefined : t.linkTitle}
      onClick={() => uiStore.getState().setLinking(linking ? null : nodeId)}
      // Its words end where the line's chevron does, 12px from the edge: the button's own padding sits in the line's.
      className="-mr-2 font-normal text-dp-text-2 hover:text-dp-text"
    >
      {!linking && <Plus aria-hidden />}
      {linking ? t.done : t.link}
    </Button>
  );
}

/** Mounted while open: sends to this agent alone, the way the command bar sends to a target. */
function AgentField({ nodeId, name, autoFocus }: { nodeId: string; name: string; autoFocus: boolean }) {
  const t = useMessages(nodesMessages).foot;
  const groupName = useCanvas((s) => s.frames.find((f) => f.group !== null && f.memberIds.includes(nodeId))?.name ?? null);
  const agents = useMemo<TargetAgent[]>(() => [{ id: nodeId, name, groupName }], [nodeId, name, groupName]);
  const fallback = useMemo(() => [nodeId], [nodeId]);
  return <CommandInput compact autoFocus={autoFocus} agents={agents} groups={NO_GROUPS} fallback={fallback} placeholder={t.message(name)} emptyHint="" />;
}
