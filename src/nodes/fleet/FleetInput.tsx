import { useMemo } from "react";
import { useCanvas } from "@/canvas/canvasStore";
import { AGENTS } from "@/agents/catalog";
import { CommandInput } from "@/agents/CommandInput";
import { agentsText } from "@/agents/groupSummary";
import { targetAgents } from "@/agents/targets";
import { linkedAgents, NO_LINKS } from "@/agents/wires";
import { useMessages } from "@/i18n";
import { terminalOf, useNodes } from "@/store/nodes";
import { focusTerminal } from "../terminal/registry";
import { MessageBar } from "../foot/MessageBar";
import { nodesMessages } from "../messages";

/**
 * The foot of a Fleet: the command bar's field in its compact form, one line,
 * aimed at the agents wired to this Fleet. An agent's foot ends with the same
 * line (../terminal/AgentFoot.tsx).
 */
export function FleetInput({ nodeId }: { nodeId: string }) {
  return (
    <footer data-fleet-input={nodeId} className="shrink-0 border-t border-dp-line">
      <MessageBar>
        <FleetField nodeId={nodeId} />
      </MessageBar>
    </footer>
  );
}

/** Sends to the wired agents when no `@` is typed; Escape gives the keyboard back to the Fleet's session. */
function FleetField({ nodeId }: { nodeId: string }) {
  const t = useMessages(nodesMessages).fleet.input;
  const links = useCanvas((s) => s.links[nodeId] ?? NO_LINKS);
  const frames = useCanvas((s) => s.frames);
  const nodes = useNodes((s) => s.nodes);
  const linked = useMemo(() => linkedAgents(links, frames), [links, frames]);
  const agents = useMemo(
    () =>
      targetAgents(
        linked.agentIds,
        (id) => {
          const payload = terminalOf(nodes[id]);
          return payload ? payload.name || AGENTS[payload.agent].label : undefined;
        },
        frames,
      ),
    [linked, nodes, frames],
  );
  return (
    <CommandInput
      compact
      agents={agents}
      groups={linked.groups}
      fallback={linked.agentIds}
      placeholder={t.placeholder(agentsText(agents.length))}
      emptyHint={t.emptyHint}
      onEscape={() => focusTerminal(nodeId)}
    />
  );
}
