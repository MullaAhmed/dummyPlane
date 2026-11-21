import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { useMessages } from "@/i18n";
import type { AgentId } from "@/ipc/pty";
import { agentInk, AGENTS, DELETES_NOT_BLOCKED } from "./catalog";
import { agentsMessages } from "./messages";
import { POINT_MENU_ROW } from "./PointMenu";

/**
 * The rows of an agent list that opens at a point (the "Other agent…" list, the "Add an agent" list of a group), in a
 * PointMenu: one radio row per agent, `selected` (the default agent) ticked. A pick, by click or Enter, calls `onPick`.
 */
export function AgentPickRows({ ids, selected, onPick }: { ids: readonly AgentId[]; selected: AgentId; onPick: (agent: AgentId) => void }) {
  const text = useMessages(agentsMessages);
  return (
    <DropdownMenuRadioGroup value={selected}>
      {ids.map((id) => {
        const meta = AGENTS[id];
        return (
          <DropdownMenuRadioItem key={id} value={id} data-agent-pick={id} className={POINT_MENU_ROW} onSelect={() => onPick(id)}>
            <meta.Icon className="size-4" style={{ color: agentInk(meta.tint) }} />
            <span className="min-w-0 flex-1">
              <span className="block">{meta.label}</span>
              {DELETES_NOT_BLOCKED.has(id) && (
                <span data-deletes-not-blocked={id} className="block text-xs whitespace-normal text-dp-text-2">
                  {text.agentMenu.deletesNotBlocked}
                </span>
              )}
            </span>
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}
