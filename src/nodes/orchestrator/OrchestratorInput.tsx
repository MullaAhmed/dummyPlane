import { useMemo, useRef } from "react";
import { ChevronUp } from "lucide-react";
import { useCanvas } from "@/canvas/canvasStore";
import { Button } from "@/components/ui/button";
import { AGENTS } from "@/fleet/catalog";
import { CommandInput } from "@/fleet/CommandInput";
import { agentsText } from "@/fleet/groupSummary";
import { targetAgents } from "@/fleet/targets";
import { linkedAgents, NO_LINKS } from "@/fleet/wires";
import { useMessages } from "@/i18n";
import { useNativeKeyDown } from "@/lib/useNativeKeyDown";
import { cn } from "@/lib/utils";
import { nodesStore, terminalOf, useNodes } from "@/store/nodes";
import { nodesMessages } from "../messages";

/**
 * The foot of an orchestrator: one folded line, "Message agents…". Opened, it
 * is the command bar's field in its compact form, aimed at the agents wired to
 * this orchestrator. Whether it is open is kept on the node.
 */
export function OrchestratorInput({ nodeId, open }: { nodeId: string; open: boolean }) {
  const t = useMessages(nodesMessages).orchestrator.input;
  const toggle = useRef<HTMLButtonElement>(null);
  // Keys on the line never reach the canvas: Backspace there would delete the node.
  useNativeKeyDown(toggle, () => undefined);
  return (
    <footer data-orchestrator-input={nodeId} className="shrink-0 border-t border-dp-line">
      <Button
        ref={toggle}
        type="button"
        variant="ghost"
        aria-expanded={open}
        onClick={() => nodesStore.getState().update(nodeId, { inputOpen: !open })}
        className="h-7 w-full justify-between rounded-none px-3 text-xs font-normal text-dp-text-2 hover:text-dp-text"
      >
        {t.toggle}
        <ChevronUp className={cn("size-3.5 transition-transform duration-150 ease-out motion-reduce:transition-none", open && "rotate-180")} />
      </Button>
      {open && <OrchestratorField nodeId={nodeId} />}
    </footer>
  );
}

/** Mounted while open: the field takes the keyboard, and sends to the wired agents when no `@` is typed. */
function OrchestratorField({ nodeId }: { nodeId: string }) {
  const t = useMessages(nodesMessages).orchestrator.input;
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
    <div className="px-2 pb-2">
      <CommandInput
        compact
        autoFocus
        agents={agents}
        groups={linked.groups}
        fallback={linked.agentIds}
        placeholder={t.placeholder(agentsText(agents.length))}
        emptyHint={t.emptyHint}
      />
    </div>
  );
}
