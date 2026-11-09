import type { ReactNode } from "react";
import { useWorkspaceAgentCounts } from "@/fleet/agentCounts";
import { showAgents } from "@/fleet/agentsPanelState";
import type { FleetFilter } from "@/fleet/fleetView";
import { useMessages } from "@/i18n";
import { useRunningCount } from "@/store/running";
import { useWorkspaces } from "@/store/workspaces";
import { shellMessages } from "./messages";

function Count({ label, color, filter, children }: { label: string; color: string; filter: FleetFilter; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => showAgents(filter)}
      className="flex h-6 items-center gap-1.5 rounded-[6px] px-1.5 font-mono text-[11.5px] text-dp-text-2 hover:bg-dp-hover hover:text-dp-text"
    >
      <span className="size-[7px] rounded-full" style={{ backgroundColor: color }} />
      {children}
    </button>
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
        <Count label={t.working} color="var(--dp-accent)" filter="working">
          {working}
        </Count>
      )}
      {waiting > 0 && (
        <Count label={t.waiting} color="var(--dp-wait)" filter="waiting">
          {waiting}
        </Count>
      )}
      <Count label={t.active} color="var(--dp-ok)" filter="all">
        {t.activeCount(running)}
      </Count>
    </div>
  );
}
