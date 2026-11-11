import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/useNow";
import { remainingGlobal, type Mission } from "./mission";
import { missionMessages } from "./messages";
import { OvernightDialog } from "./OvernightDialog";
import { cancelOvernight } from "./overnight";
import type { TicketSource } from "./tickets";

/** A quiet action at the end of a line: its words end on the line's 12px edge, its padding in the line's. */
const LINE_ACTION = "font-normal text-dp-text-2 hover:text-dp-text";

/**
 * The night as it was set, in the Fleet's panel: what the dialog chose stays
 * in view, and until the team is formed it can be changed (the dialog, prefilled) or called off.
 */
export function NightSummary({ nodeId, mission }: { nodeId: string; mission: Mission }) {
  const t = useMessages(missionMessages);
  const n = t.night;
  const [editing, setEditing] = useState(false);
  const now = useNow(60_000);
  const editable = mission.state === "redaction" || mission.state === "plan";
  const away = mission.budgetMin ?? 0;
  const left = mission.state === "en_cours" ? remainingGlobal(mission, now) : undefined;
  const rows: [string, string][] = [
    [n.away, left === undefined ? n.awayValue(away) : `${n.awayValue(away)} · ${n.left(left)}`],
    [n.agents, n.agentsValue(mission.maxAgents)],
    [n.tickets, mission.tickets ? sourceText(n, mission.tickets) : "—"],
    [n.permission, t.overnight.permissions[mission.permission ?? "ask"]],
    [n.start, mission.autoLaunch ? t.overnight.starts.auto : t.overnight.starts.wait],
  ];
  return (
    <section data-night aria-label={n.title} className="flex flex-col">
      <div className="flex h-7 items-center gap-1">
        <span className="font-medium text-dp-text">{n.title}</span>
        {editable && (
          <>
            <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(true)} className={cn("ml-auto", LINE_ACTION)}>
              {n.edit}
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={() => void cancelOvernight(nodeId)} className={cn("-mr-2", LINE_ACTION)}>
              {n.cancel}
            </Button>
          </>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="flex h-6 items-center">{label}</dt>
            <dd className="flex h-6 min-w-0 items-center text-dp-text">
              <span className="truncate tabular-nums">{value}</span>
            </dd>
          </div>
        ))}
      </dl>
      {editing && <OvernightDialog nodeId={nodeId} open onOpenChange={setEditing} />}
    </section>
  );
}

function sourceText(n: (typeof missionMessages)["night"], source: TicketSource): string {
  if (source.kind === "backlog") return n.backlog;
  return source.kind === "linear" ? n.linear(source.team, source.label) : n.github(source.label);
}
