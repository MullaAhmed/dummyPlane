import { useRef, useState } from "react";
import { ChevronDown, Ellipsis, Layers, Network, Pause, Play, Plus, SquareTerminal, Users, X } from "lucide-react";
import { useStore } from "zustand";
import { useCanvas } from "@/canvas/canvasStore";
import { focusNode } from "@/canvas/focusNode";
import { RoleMark } from "@/components/marks";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMessages } from "@/i18n";
import { formatDuration } from "@/lib/format";
import { returnFocus, useOpener } from "@/lib/focusReturn";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/nodes/terminal/StatusPill";
import { readFleetPayload } from "@/nodes/types";
import { IconButton } from "@/shell/buttons";
import { FLOAT_INSET, LANE_BOTTOM, LANE_RIGHT, LANE_TOP } from "@/shell/layout";
import { useLaneOccupant } from "@/shell/lane";
import { useActivities, useActivity } from "@/store/agentActivity";
import { terminalOf, useNodes } from "@/store/nodes";
import { terminalStatusStore, useTerminalStatus } from "@/store/terminalStatus";
import { AgentMenu } from "./AgentMenu";
import { AgentRow } from "./AgentRow";
import { setAgentsFilter, setAgentsPanel, useAgentsPanel } from "./agentsPanelState";
import { pauseAll, resumeAll, workspaceTerminalIds } from "./broadcast";
import { AGENTS, INDIGO } from "./catalog";
import { ComposeGroup } from "./ComposeGroup";
import { isAgentNode } from "./agentState";
import { PANEL_FILTERS, filterCounts, inFilter, panelSections, panelStateOf, type PanelAgent, type PanelFilter } from "./agentsView";
import { GroupMenu } from "./GroupMenu";
import { countsText } from "./groupSummary";
import { agentsMessages } from "./messages";
import { OutsideNamesMenu } from "./NamesMenu";
import { newConsole } from "./quickActions";
import { resumeOfferRoom, resumeOfferStore } from "./ResumeAllToast";

const OUTSIDE = "outside";

/** A section's header row: a disclosure, so no press scale, and its label in sentence case. */
const SECTION_ROW =
  "h-8 justify-start gap-2 rounded-md px-2 text-left text-xs font-normal active:scale-100 aria-expanded:bg-transparent aria-expanded:hover:bg-dp-hover";
// `-rotate-90` sets the `rotate` property: a list naming `transform` would never ease it.
const CHEVRON = "size-3.5 text-dp-text-2 transition-[rotate] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none";

/**
 * The agents of the workspace on screen, by group. It stands in the right lane (shell/layout.ts), on its edge and its
 * top, the lane's width: the lane's occupant, which a work window folds (panelFold.ts).
 */
export function AgentsPanel() {
  const t = useMessages(agentsMessages).panel;
  // On screen, it holds the lane: the work area, the work windows and the camera keep clear of it.
  useLaneOccupant("agents");
  const filter = useAgentsPanel((s) => s.filter);
  // The room the Resume offer takes, a line more when it names the finished sub-agents it leaves stopped.
  const offerRoom = useStore(resumeOfferStore, resumeOfferRoom);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  // Its Close gives the keyboard back to what opened it (the rail's Agents button, or what had it before the palette), else to that button.
  const opener = useOpener();
  const panel = useRef<HTMLElement>(null);
  const closePanel = () => {
    returnFocus(opener, panel.current) || returnFocus(document.querySelector<HTMLElement>("[data-agents-toggle]"), panel.current);
    setAgentsPanel(false);
  };
  const now = useNow(15_000);
  const nodeIds = useCanvas((s) => s.nodeIds);
  const frames = useCanvas((s) => s.frames);
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const activities = useActivities();

  const agents: PanelAgent[] = nodeIds.flatMap((id) => {
    const payload = terminalOf(nodes[id]);
    if (!payload) return [];
    const status = statuses[id] ?? { state: "stopped" as const };
    // The reading the rail's pip, the filters, the title bar's Working count and the tab badges share (agentState): a plain shell is never at work nor waiting.
    const isAgent = isAgentNode(nodes[id]);
    const state = panelStateOf(status, activities[id], payload.lastReport?.status, isAgent);
    return [
      {
        id,
        name: payload.name || AGENTS[payload.agent].label,
        agent: payload.agent,
        state,
        since: status.state === "running" ? activities[id]?.since : undefined,
      },
    ];
  });
  // The Fleets are agents too: the filters count them, as the rail's pip and the title bar's Working count do, and their section filters.
  const allFleets = nodeIds.flatMap((id) => {
    const record = nodes[id];
    if (record?.kind !== "fleet") return [];
    const status = statuses[id] ?? { state: "stopped" as const };
    const report = record.payload.session?.lastReport?.status;
    const state = panelStateOf(status, activities[id], report);
    return [{ id, name: readFleetPayload(record.payload).name, state }];
  });
  const fleets = allFleets.filter((f) => inFilter(f, filter));
  const counts = filterCounts([...agents, ...allFleets]);
  const sections = panelSections(agents, frames, filter);
  const keyOf = (id: string | null) => id ?? OUTSIDE;
  const fold = (key: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <aside
      ref={panel}
      className="dp-glass-strong absolute z-30 flex w-84 flex-col overflow-hidden rounded-xl"
      // Its foot: the lane's, or one gap above the Resume offer.
      style={{ right: LANE_RIGHT, top: LANE_TOP, maxHeight: `calc(100% - ${LANE_TOP + (offerRoom === null ? LANE_BOTTOM : offerRoom + FLOAT_INSET)}px)` }}
    >
      {/* The header of the other panels (Git, Review): icon, title, then the actions, the close last. */}
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-dp-line px-3">
        <Users className="size-4 shrink-0 text-dp-text-2" />
        <span className="shrink-0 text-sm font-medium">{t.title}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <AgentMenu
            side="left"
            trigger={() => (
              <IconButton label={t.launchAgent}>
                <Plus />
              </IconButton>
            )}
          />
          <IconButton label={t.newConsole} onClick={() => newConsole()}>
            <SquareTerminal />
          </IconButton>
          <ComposeGroup
            side="left"
            answersRequests
            trigger={
              <IconButton label={t.composeGroup}>
                <Layers />
              </IconButton>
            }
          />
          <IconButton label={t.pauseAll} onClick={() => void pauseAll(workspaceTerminalIds())}>
            <Pause />
          </IconButton>
          <IconButton label={t.resumeAll} onClick={() => void resumeAll(workspaceTerminalIds())}>
            <Play />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={t.moreActions}>
                <Ellipsis />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setFolded(new Set([...sections.map((s) => keyOf(s.id)), "fleets"]))}>
                {t.foldAll}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setFolded(new Set())}>{t.unfoldAll}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton label={t.closePanel} onClick={closePanel}>
            <X />
          </IconButton>
        </div>
      </header>
      <ToggleGroup
        type="single"
        aria-label={t.filters}
        value={filter}
        // One filter is always on: pressing it again keeps it.
        onValueChange={(id) => id && setAgentsFilter(id as PanelFilter)}
        spacing={0.5}
        className="w-full shrink-0 flex-wrap px-2 pt-2 pb-2"
      >
        {PANEL_FILTERS.map(({ id, label }) => (
          <ToggleGroupItem
            key={id}
            value={id}
            data-filter={id}
            data-on={id === filter}
            variant="choice"
            size="sm"
            className="gap-1 px-2 data-[state=on]:dp-on-soft"
          >
            {label}
            <span className="font-mono text-xs text-dp-text-3 tabular-nums">{counts[id]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {/* A native scroller: the panel has only a max-height, and a ScrollArea's viewport needs a definite one. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sections.length === 0 && fleets.length === 0 && (
          <p className="py-4 text-center text-xs text-dp-text-2">
            {agents.length + allFleets.length > 0 ? t.noneInFilter : t.none}
          </p>
        )}
        {sections.map((section) => {
          const key = keyOf(section.id);
          const open = !folded.has(key);
          return (
            <section key={key} className="not-first:mt-2">
              <div data-group-header className="group/section flex h-8 items-center rounded-md pr-1 transition-[background-color] duration-(--dp-dur-fast) ease-(--dp-ease-out) hover:bg-dp-hover motion-reduce:transition-none">
                <Button
                  type="button"
                  variant="ghost"
                  data-section={key}
                  aria-expanded={open}
                  onClick={() => fold(key)}
                  // The header row around it takes the hover.
                  className={cn(SECTION_ROW, "min-w-0 flex-1 hover:bg-transparent aria-expanded:hover:bg-transparent")}
                >
                  <ChevronDown className={cn(CHEVRON, !open && "-rotate-90")} />
                  {/* The group's colour as the terminal header draws its role: a bar, the round dot is each agent's below. */}
                  <RoleMark color={section.color ?? "var(--dp-text-3)"} />
                  <span className="truncate font-medium text-dp-text">{section.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-xs text-dp-text-2 tabular-nums">
                    {countsText(section)}
                  </span>
                </Button>
                {section.id === null && <OutsideNamesMenu />}
                {section.id && (
                  <GroupMenu
                    groupId={section.id}
                    trigger={
                      <IconButton
                        label={t.groupMenu}
                        className="size-6 opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                      >
                        <Ellipsis />
                      </IconButton>
                    }
                  />
                )}
              </div>
              {open &&
                section.agents.map((a) => (
                  <AgentRow
                    key={a.id}
                    id={a.id}
                    onOpen={() => focusNode(a.id)}
                    trailing={
                      <span className="w-10 shrink-0 text-right font-mono text-xs text-dp-text-2 tabular-nums">
                        {a.since !== undefined ? formatDuration(now - a.since) : ""}
                      </span>
                    }
                  />
                ))}
            </section>
          );
        })}
        {fleets.length > 0 && (
          <section className="not-first:mt-2">
            <Button
              type="button"
              variant="ghost"
              data-section="fleets"
              aria-expanded={!folded.has("fleets")}
              onClick={() => fold("fleets")}
              className={cn(SECTION_ROW, "w-full")}
            >
              <ChevronDown className={cn(CHEVRON, folded.has("fleets") && "-rotate-90")} />
              <span className="font-medium text-dp-text">{t.fleets}</span>
              <span className="ml-auto font-mono text-xs text-dp-text-2 tabular-nums">{allFleets.length}</span>
            </Button>
            {!folded.has("fleets") &&
              fleets.map((o) => (
                <Button
                  key={o.id}
                  type="button"
                  variant="ghost"
                  onClick={() => focusNode(o.id)}
                  className="h-9 w-full justify-start gap-2 rounded-md pr-2 pl-6 text-left text-(length:--text-ui) font-normal active:scale-100"
                >
                  <Network className="size-4 text-dp-text-2" />
                  <span className="truncate text-dp-text">{o.name}</span>
                  <FleetStatus id={o.id} />
                </Button>
              ))}
          </section>
        )}
      </div>
    </aside>
  );
}

/** A Fleet's status at the end of its row: the dot and word its node's header shows (FleetNode), as an agent's row does. */
function FleetStatus({ id }: { id: string }) {
  const status = useTerminalStatus(id);
  const activity = useActivity(id);
  return (
    <span className="ml-auto">
      <StatusPill status={status} activity={activity} indigo={AGENTS.claude.tint === INDIGO} />
    </span>
  );
}
