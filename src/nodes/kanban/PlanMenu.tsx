import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { useMessages } from "@/i18n";
import { planWithFleet } from "@/kanban/fleetBoards";
import { isFleetClosed } from "@/mission/store";
import { useNodes } from "@/store/nodes";
import { labelFleets } from "./fleetLabels";
import { kanbanNodeMessages } from "./messages";

/** Between two fleets, and between a fleet's id and its name, in the one string the selector returns. */
const FLEET_SEP = "\u0001";
const FIELD_SEP = "\u0000";

/**
 * "Plan with the fleet" of a column's menu: a fleet of the board's workspace, or a new one. A column with no
 * card has nothing to plan: the entry is greyed and says so, instead of offering fleets that can only refuse.
 */
export function PlanMenu({ boardId, columnId }: { boardId: string; columnId: string }) {
  const t = useMessages(kanbanNodeMessages).fleet;
  // One string: a stable selection, re-rendered only when a fleet comes, goes or is renamed. A Fleet deleted from the
  // canvas keeps its record for an undo: offered here, it would take the plan and never read it.
  const listed = useNodes((s) => {
    const workspaceId = s.nodes[boardId]?.workspaceId;
    return Object.entries(s.nodes)
      .flatMap(([nodeId, record]) =>
        record.kind === "fleet" && record.workspaceId === workspaceId && !isFleetClosed(nodeId) ? [`${nodeId}${FIELD_SEP}${record.payload.name}`] : [],
      )
      .join(FLEET_SEP);
  });
  const fleets = (listed ? listed.split(FLEET_SEP) : []).map((entry) => {
    const [nodeId, name] = entry.split(FIELD_SEP);
    return { nodeId, name };
  });
  const labels = labelFleets(
    fleets.map((fleet) => fleet.name),
    t.numbered,
  );
  const linked = useNodes((s) => {
    const record = s.nodes[boardId];
    return record?.kind === "kanban" && record.payload.orchestrator?.columnId === columnId ? record.payload.orchestrator.nodeId : null;
  });
  const cards = useNodes((s) => {
    const record = s.nodes[boardId];
    return record?.kind === "kanban" ? (record.payload.columns.find((column) => column.id === columnId)?.cardIds.length ?? 0) : 0;
  });
  if (cards === 0) {
    return (
      <DropdownMenuItem disabled>
        {t.plan}
        <span className="ml-auto text-xs text-dp-text-3">{t.noCards}</span>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{t.plan}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-52">
        {fleets.map(({ nodeId }, i) => (
          <DropdownMenuItem key={nodeId} onSelect={() => void planWithFleet(boardId, columnId, nodeId)}>
            {nodeId === linked ? t.linked(labels[i]) : labels[i]}
          </DropdownMenuItem>
        ))}
        {fleets.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={() => void planWithFleet(boardId, columnId, null)}>{t.create}</DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
