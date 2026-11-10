import { useMemo } from "react";
import { useCanvas } from "@/canvas/canvasStore";
import { AGENTS } from "@/agents/catalog";
import { CommandInput } from "@/agents/CommandInput";
import { agentsText } from "@/agents/groupSummary";
import { targetAgents } from "@/agents/targets";
import { linkedAgents, NO_LINKS } from "@/agents/wires";
import { useMessages } from "@/i18n";
import { nodesStore, terminalOf, useNodes } from "@/store/nodes";
import { MessageBar } from "../foot/MessageBar";
import { nodesMessages } from "../messages";

/**
 * The foot of a Fleet: one folded line, "Message agents". Opened, it is the
 * command bar's field in its compact form, aimed at the agents wired to this
 * Fleet. Whether it is open is kept on the node. An agent's foot ends with the
 * same line (../terminal/AgentFoot.tsx).
 */
export function FleetInput({ nodeId, open }: { nodeId: string; open: boolean }) {
  const t = useMessages(nodesMessages).fleet.input;
  return (
    <footer data-fleet-input={nodeId} className="shrink-0 border-t border-dp-line">
      <MessageBar
        label={t.toggle}
        open={open}
        onOpenChange={(next) => nodesStore.getState().update(nodeId, { inputOpen: next })}
        field={(autoFocus) => <FleetField nodeId={nodeId} autoFocus={autoFocus} />}
      />
    </footer>
  );
}

/** Mounted while open: sends to the wired agents when no `@` is typed. */
function FleetField({ nodeId, autoFocus }: { nodeId: string; autoFocus: boolean }) {
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
      autoFocus={autoFocus}
      agents={agents}
      groups={linked.groups}
      fallback={linked.agentIds}
      placeholder={t.placeholder(agentsText(agents.length))}
      emptyHint={t.emptyHint}
    />
  );
}
