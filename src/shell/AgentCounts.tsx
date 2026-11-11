import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspaceAgentCounts } from "@/agents/agentCounts";
import { showAgents } from "@/agents/agentsPanelState";
import type { PanelFilter } from "@/agents/agentsView";
import { useMessages } from "@/i18n";
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

/**
 * The title bar's counters: each opens the agents panel on what it counts. All three count
 * the agents of the workspace on screen, the ones the panel lists: "active" once counted every running process of
 * every tab, shells included, and could read "16 active" beside "1 working" (retours 2026-11-11).
 */
export function AgentCounts() {
  const t = useMessages(shellMessages).agentCounts;
  const { working, waiting, active: running } = useWorkspaceAgentCounts();
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
      <Count label={t.active} name={t.activeName(running)} color="var(--dp-ok)" filter="active">
        {t.activeCount(running)}
      </Count>
    </div>
  );
}
