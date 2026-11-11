import { useMemo, useRef } from "react";
import { Plus } from "lucide-react";
import { useCanvas } from "@/canvas/canvasStore";
import { Button } from "@/components/ui/button";
import { AGENTS, INDIGO } from "@/agents/catalog";
import { takesCommands } from "@/agents/slashCommands";
import { fleetsOf } from "@/agents/wires";
import { useMessages } from "@/i18n";
import type { AgentId } from "@/ipc/pty";
import { formatDuration } from "@/lib/format";
import { useNativeKeyDown } from "@/lib/useNativeKeyDown";
import { useNow } from "@/lib/useNow";
import { Hint } from "@/shell/buttons";
import type { TerminalPayload } from "@/nodes/types";
import type { AgentActivity } from "@/store/agentActivity";
import { useNodes } from "@/store/nodes";
import type { TerminalStatus } from "@/store/terminalStatus";
import { uiStore, useUi } from "@/store/ui";
import { StatusLine } from "../foot/StatusLine";
import { nodesMessages } from "../messages";
import { pillOf } from "./pill";
import { DOT_OF_TONE } from "./StatusDot";

/** The terminals that get a foot: the AI agents, the ones that take instructions (not a plain shell, not a custom command). */
export function hasAgentFoot(agent: AgentId): boolean {
  return takesCommands(agent);
}

/**
 * Under an agent's terminal, one status line: its dot, where it stands and for
 * how long, the Fleets that command it, and Link. The status lives here rather
 * than in the header: one dot per agent, beside the question it may be asking
 * at the bottom of its terminal. An agent is messaged from the command bar at
 * the bottom of the canvas (shell/CommandBar.tsx), where selecting it puts its
 * `@` chip, not from a field of its own.
 */
export function AgentFoot(props: { nodeId: string; payload: TerminalPayload; status: TerminalStatus; activity?: AgentActivity }) {
  const { nodeId, payload, status, activity } = props;
  const foot = useRef<HTMLElement>(null);
  // No key typed in the foot reaches the canvas: Backspace on Link would delete the node.
  useNativeKeyDown(foot, () => undefined);
  return (
    <footer ref={foot} data-agent-foot={nodeId} className="shrink-0 border-t border-dp-line bg-dp-terminal-head">
      <AgentStatus nodeId={nodeId} payload={payload} status={status} activity={activity} />
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
  const commanders = useMemo(() => fleetsOf(nodeId, links, frames), [nodeId, links, frames]);
  // A string, so the line renders again only when a name changes, not on every node's change.
  const from = useNodes((s) =>
    commanders
      .map((id) => {
        const record = s.nodes[id];
        return record?.kind === "fleet" ? record.payload.name : "";
      })
      .filter(Boolean)
      .join(", "),
  );
  const running = status.state === "running";
  const pill = pillOf(status, running ? activity?.activity : undefined, AGENTS[payload.agent].tint === INDIGO, payload.lastReport?.status);
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
 * agent or a fleet (agents/LinkMode.tsx). Always there: two agents
 * link without any fleet on the canvas.
 */
function AgentLink({ nodeId }: { nodeId: string }) {
  const t = useMessages(nodesMessages).foot;
  const linking = useUi((s) => s.linking === nodeId);
  return (
    // The app's hint, not a native title: it says what Link does, and stays shut while linking ("Done" says it all).
    // The same button either way, so the keyboard stays on it.
    <Hint label={t.linkTitle} expanded={linking}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        // Whose Link it is: the link layer passes a click on to the linker's own "Done" only (agents/LinkMode.tsx).
        data-link-toggle={nodeId}
        aria-pressed={linking}
        onClick={() => uiStore.getState().setLinking(linking ? null : nodeId)}
        // Its words end where the line's chevron does, 12px from the edge: the button's own padding sits in the line's.
        className="-mr-2 font-normal text-dp-text-2 hover:text-dp-text"
      >
        {!linking && <Plus aria-hidden />}
        {linking ? t.done : t.link}
      </Button>
    </Hint>
  );
}
