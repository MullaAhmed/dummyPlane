import { Button } from "@/components/ui/button";
import { useWorkspaceAgentCounts } from "@/agents/agentCounts";
import { showAgents } from "@/agents/agentsPanelState";
import { useMessages } from "@/i18n";
import { StatusDot } from "@/nodes/terminal/StatusDot";
import { Hint } from "./buttons";
import { shellMessages } from "./messages";

/**
 * The title bar's one status count: the agents at work on the canvas on screen, the ones the agents panel's
 * Working filter lists and counts (both read `agentStateOf`, Fleets in, plain shells never), so the bar and the
 * panel never disagree. It opens the panel on that filter. Nothing shows while no agent works.
 * Its accessible name starts with the number it shows, "3 agents working" (WCAG 2.5.3 label in name); the
 * hint names what it counts.
 */
export function WorkingCount() {
  const t = useMessages(shellMessages).workingCount;
  const { working } = useWorkspaceAgentCounts();
  if (working === 0) return null;
  return (
    <Hint label={t.hint} side="bottom">
      <Button
        variant="ghost"
        size="xs"
        data-working-count
        aria-label={t.name(working)}
        onClick={() => showAgents("working")}
        className="gap-1.5 rounded-md px-1.5 font-mono font-normal tabular-nums text-dp-text-2 hover:text-dp-text"
      >
        <StatusDot state="working" />
        {working}
      </Button>
    </Hint>
  );
}
