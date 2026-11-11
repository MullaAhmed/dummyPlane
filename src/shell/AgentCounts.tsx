import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspaceAgentCounts } from "@/agents/agentCounts";
import { showAgents } from "@/agents/agentsPanelState";
import type { PanelFilter } from "@/agents/agentsView";
import { useMessages } from "@/i18n";
import { useRunningCount } from "@/store/running";
import { useWorkspaces } from "@/store/workspaces";
import { Hint } from "./buttons";
import { shellMessages } from "./messages";

/**
 * A count with its status dot: the number alone says nothing, so its hint names what it counts. Its
 * accessible name (`name`) starts with the number it shows, "3 agents working" (WCAG 2.5.3 label in name).
 */
function Count({ label, name, color, filter, children }: { label: string; name: string; color: string; filter: PanelFilter; children: ReactNode }) {
  return (
    <Hint label={label} side="bottom">
      <Button
        variant="ghost"
        size="xs"
        aria-label={name}
        onClick={() => showAgents(filter)}
        className="gap-1.5 rounded-md px-1.5 font-mono font-normal tabular-nums text-dp-text-2 hover:text-dp-text"
      >
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
        {children}
      </Button>
    </Hint>
  );
}

/** The title bar's counters (spec identité §5.1): each opens the agents panel on what it counts. */
export function AgentCounts() {
  const t = useMessages(shellMessages).agentCounts;
  const { working, waiting } = useWorkspaceAgentCounts();
  const workspaces = useWorkspaces((s) => s.workspaces);
  const running = useRunningCount(workspaces.map((w) => w.id));
  return (
    <div className="flex items-center gap-0.5">
      {working > 0 && (
        <Count label={t.working} name={t.workingName(working)} color="var(--dp-accent)" filter="working">
          {working}
        </Count>
      )}
      {waiting > 0 && (
        <Count label={t.waiting} name={t.waitingName(waiting)} color="var(--dp-wait)" filter="waiting">
          {waiting}
        </Count>
      )}
      <Count label={t.active} name={t.activeName(running)} color="var(--dp-ok)" filter="all">
        {t.activeCount(running)}
      </Count>
    </div>
  );
}
