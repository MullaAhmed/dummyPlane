import { useId } from "react";
import { Route } from "lucide-react";
import { AGENTS } from "@/agents/catalog";
import { messages, useMessages } from "@/i18n";
import type { AgentId } from "@/ipc/pty";
import { cn } from "@/lib/utils";
import { DropdownMenuCheckboxItem, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/shell/buttons";
import { missionMessages } from "./messages";
import { followRouter, routerInert, setRouter, useRouterFollow, useRouterOn } from "./routerState";

/**
 * Why a terminal's switch has nothing to route (`routerInert`), in plain words; undefined while it acts. The words of
 * its hint, its menu entry's title and the line under it in its Edit tab.
 */
export function routerInertText(payload: { agent: AgentId; role?: string }): string | undefined {
  const t = messages(missionMessages);
  const why = routerInert(payload);
  if (why === "manager") return t.routerInert.manager;
  if (why === "agent") return t.routerInert.agent(payload.agent === "shell" || payload.agent === "custom" ? t.routerInertWho[payload.agent] : AGENTS[payload.agent].label);
  return undefined;
}

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
 * The switch of a terminal that has nothing to route (`routerInert`), as inert as it can be while still telling why:
 * off (nothing is routed there, whatever Settings say), greyed out like a disabled control, and it changes nothing
 * when pressed. `aria-disabled`, not `disabled`: it stays in the tab order and keeps the pointer, so its hint, which
 * says why, opens on hover and on keyboard focus, and a line a screen reader reads is always there (`hidden`, as
 * what describes it).
 */
function InertRouterToggle({ reason }: { reason: string }) {
  const t = useMessages(missionMessages);
  const noteId = useId();
  return (
    <>
      <IconButton
        label={t.routerSwitch}
        hint={reason}
        aria-pressed={false}
        aria-disabled
        aria-describedby={noteId}
        data-router="off"
        onClick={(event) => event.preventDefault()}
        className="cursor-not-allowed opacity-50 hover:bg-transparent hover:text-dp-text-2 active:scale-100"
      >
        <Route />
      </IconButton>
      <span id={noteId} hidden>
        {reason}
      </span>
    </>
  );
}

/**
 * A node's switch as the router stands there (`@/mission/routerState`): on or off, set at the node or inherited from
 * the Fleet or agent above it, else Settings. Turning it stores the node's own state, which holds until "Follow".
 * `inert`, the reason a terminal's switch has nothing to route (`routerInertText`), shows it greyed out, off and
 * unwritten instead.
 */
export function NodeRouterToggle({ nodeId, inert }: { nodeId: string; inert?: string }) {
  return inert ? <InertRouterToggle reason={inert} /> : <ActiveRouterToggle nodeId={nodeId} />;
}

function ActiveRouterToggle({ nodeId }: { nodeId: string }) {
  const on = useRouterOn(nodeId);
  return <RouterToggle on={on} onChange={(next) => setRouter(nodeId, next)} />;
}

/**
 * The same switch in a node's "⋯" menu, at any width, and while it is set, "Follow Settings" (or "Follow the switch
 * above") under it, which unsets it. `inert`: as `NodeRouterToggle`'s, an entry greyed out and unchecked, no Follow,
 * its title says why, and it does nothing: it stays in the menu's keyboard order, which a disabled entry leaves, so
 * a keyboard user hears why too.
 */
export function RouterMenuItem({ nodeId, inert }: { nodeId: string; inert?: string }) {
  return inert ? <InertRouterMenuItem reason={inert} /> : <ActiveRouterMenuItem nodeId={nodeId} />;
}

function ActiveRouterMenuItem({ nodeId }: { nodeId: string }) {
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

function InertRouterMenuItem({ reason }: { reason: string }) {
  const t = useMessages(missionMessages);
  return (
    // Radix calls onCheckedChange even after a prevented select: both do nothing, and the menu stays open.
    <DropdownMenuCheckboxItem
      checked={false}
      aria-disabled
      aria-description={reason}
      title={reason}
      onSelect={(event) => event.preventDefault()}
      onCheckedChange={() => undefined}
      className="cursor-not-allowed opacity-50"
    >
      {t.routerSwitch}
    </DropdownMenuCheckboxItem>
  );
}
