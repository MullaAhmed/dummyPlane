import { Route } from "lucide-react";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { DropdownMenuCheckboxItem, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/shell/buttons";
import { missionMessages } from "./messages";
import { followRouter, setRouter, useRouterFollow, useRouterOn } from "./routerState";

/**
 * The model router as a sticky switch in a node's header, a terminal's or a Fleet's: the same 28px icon button as
 * the header's others, on until it is turned off. Its name stays "Model router" and its state is `aria-pressed`'s
 * (one name, never "Turn the router off"); on, it takes the accent's tint, which the icon's ink keeps legible in
 * every palette (as the rails' active button). A header shows it from 28rem of node on (`WIDE_ONLY`): a narrower
 * node reaches the same switch in its Edit tab.
 */
export function RouterToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const t = useMessages(missionMessages);
  return (
    <IconButton
      label={t.routerSwitch}
      aria-pressed={on}
      data-router={on ? "on" : "off"}
      onClick={() => onChange(!on)}
      className={cn(on && "bg-dp-accent-soft text-dp-accent-ink hover:bg-dp-accent-soft hover:text-dp-accent-ink")}
    >
      <Route />
    </IconButton>
  );
}

/**
 * A node's switch as the router stands there (`@/mission/routerState`): on or off, set at the node or inherited from
 * the Fleet or agent above it, else Settings. Turning it stores the node's own state, which holds until "Follow".
 */
export function NodeRouterToggle({ nodeId }: { nodeId: string }) {
  const on = useRouterOn(nodeId);
  return <RouterToggle on={on} onChange={(next) => setRouter(nodeId, next)} />;
}

/**
 * The same switch in a node's "⋯" menu, at any width, and while it is set, "Follow Settings" (or "Follow the switch
 * above") under it, which unsets it.
 */
export function RouterMenuItem({ nodeId }: { nodeId: string }) {
  const t = useMessages(missionMessages);
  const on = useRouterOn(nodeId);
  const follow = useRouterFollow(nodeId);
  return (
    <>
      <DropdownMenuCheckboxItem checked={on} onCheckedChange={(next) => setRouter(nodeId, next === true)}>
        {t.routerSwitch}
      </DropdownMenuCheckboxItem>
      {follow && <DropdownMenuItem onSelect={() => followRouter(nodeId)}>{t.routerFollow[follow]}</DropdownMenuItem>}
    </>
  );
}
