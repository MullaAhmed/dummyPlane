import { useState } from "react";
import { ChevronDown, Ellipsis, Layers, Network, Pause, Play, Plus, SquareTerminal, X } from "lucide-react";
import { useStore } from "zustand";
import { useCanvas } from "@/canvas/canvasStore";
import { focusNode } from "@/canvas/focusNode";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMessages } from "@/i18n";
import { formatDuration } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { readOrchestratorPayload } from "@/nodes/types";
import { IconButton } from "@/shell/buttons";
import { BOTTOM_BAR_HEIGHT, TOP_ROW_HEIGHT } from "@/shell/layout";
import { useActivities } from "@/store/agentActivity";
import { terminalOf, useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { AgentMenu } from "./AgentMenu";
import { AgentRow } from "./AgentRow";
import { setAgentsFilter, setAgentsPanel, useAgentsPanel } from "./agentsPanelState";
import { pauseAll, resumeAll, workspaceTerminalIds } from "./broadcast";
import { AGENTS } from "./catalog";
import { ComposeGroup } from "./ComposeGroup";
import { FLEET_FILTERS, filterCounts, fleetSections, fleetStateOf, type FleetAgent } from "./fleetView";
import { GroupMenu } from "./GroupMenu";
import { countsText } from "./groupSummary";
import { fleetMessages } from "./messages";
import { newConsole } from "./quickActions";
import { RESUME_OFFER_ROOM, resumeOfferStore } from "./ResumeAllToast";

const OUTSIDE = "outside";

/** The agents of the workspace on screen, by group (spec identity §5.6); it replaces the fleet panel. */
export function AgentsPanel() {
  const t = useMessages(fleetMessages).panel;
  const filter = useAgentsPanel((s) => s.filter);
  const offer = useStore(resumeOfferStore, (s) => s.open);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const now = useNow(15_000);
  const nodeIds = useCanvas((s) => s.nodeIds);
  const frames = useCanvas((s) => s.frames);
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const activities = useActivities();

  const agents: FleetAgent[] = nodeIds.flatMap((id) => {
    const payload = terminalOf(nodes[id]);
    if (!payload) return [];
    const status = statuses[id] ?? { state: "stopped" as const };
    const state = fleetStateOf(status, activities[id]);
    return [
      {
        id,
        name: payload.name || AGENTS[payload.agent].label,
        agent: payload.agent,
        state,
        since: state === "stopped" ? undefined : activities[id]?.since,
      },
    ];
  });
  const orchestrators = nodeIds.flatMap((id) =>
    nodes[id]?.kind === "orchestrator" ? [{ id, name: readOrchestratorPayload(nodes[id]?.payload).name }] : [],
  );
  const counts = filterCounts(agents);
  const sections = fleetSections(agents, frames, filter);
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
      className="dp-glass-strong absolute right-[72px] z-30 flex w-[318px] flex-col overflow-hidden rounded-lg"
      style={{ top: TOP_ROW_HEIGHT + 14, maxHeight: `calc(100% - ${TOP_ROW_HEIGHT + 14 + (offer ? RESUME_OFFER_ROOM : BOTTOM_BAR_HEIGHT) + 14}px)` }}
    >
      <header className="flex h-9 shrink-0 items-center border-b border-dp-line pl-3 pr-1.5">
        <span className="dp-label">{t.title}</span>
        <div className="ml-auto flex items-center">
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
              <DropdownMenuItem onSelect={() => setFolded(new Set([...sections.map((s) => keyOf(s.id)), "orchestrators"]))}>
                {t.foldAll}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setFolded(new Set())}>{t.unfoldAll}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton label={t.closePanel} onClick={() => setAgentsPanel(false)}>
            <X />
          </IconButton>
        </div>
      </header>
      <div className="flex shrink-0 flex-wrap gap-px px-2 pb-1.5 pt-2">
        {FLEET_FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            data-filter={id}
            data-on={id === filter}
            onClick={() => setAgentsFilter(id)}
            className={cn(
              "whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs transition-[background-color,color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97] motion-reduce:transition-none",
              id === filter ? "bg-dp-accent-soft text-dp-accent-ink" : "text-dp-text-2 hover:bg-dp-hover hover:text-dp-text",
            )}
          >
            {label}
            <span className="ml-1 font-mono text-[11px]">{counts[id]}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {sections.length === 0 && orchestrators.length === 0 && (
          <p className="py-4 text-center text-xs text-dp-text-2">
            {agents.length > 0 ? t.noneInFilter : t.none}
          </p>
        )}
        {sections.map((section) => {
          const key = keyOf(section.id);
          const open = !folded.has(key);
          return (
            <section key={key}>
              <div data-group-header className="group/section flex h-7 items-center rounded-md pr-0.5 transition-[background-color] duration-150 ease-out hover:bg-dp-hover motion-reduce:transition-none">
                <button
                  type="button"
                  data-section={key}
                  onClick={() => fold(key)}
                  className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50"
                >
                  <ChevronDown className={cn("size-3.5 text-dp-text-2 transition-[transform] duration-150 ease-out motion-reduce:transition-none", !open && "-rotate-90")} />
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: section.color ?? "var(--dp-text-3)" }} />
                  <span className="truncate font-semibold tracking-[0.03em] text-dp-text uppercase">{section.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-dp-text-2">
                    {countsText(section.agents.length, section.agents.filter((a) => a.state === "working").length)}
                  </span>
                </button>
                {section.id && (
                  <GroupMenu
                    groupId={section.id}
                    answersRequests
                    trigger={
                      <IconButton
                        label={t.groupMenu}
                        className="size-[22px] opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
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
                      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-dp-text-2">
                        {a.since !== undefined ? formatDuration(now - a.since) : ""}
                      </span>
                    }
                  />
                ))}
            </section>
          );
        })}
        {orchestrators.length > 0 && (
          <section>
            <button
              type="button"
              data-section="orchestrators"
              onClick={() => fold("orchestrators")}
              className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-xs transition-[background-color] duration-150 ease-out hover:bg-dp-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 motion-reduce:transition-none"
            >
              <ChevronDown
                className={cn("size-3.5 text-dp-text-2 transition-[transform] duration-150 ease-out motion-reduce:transition-none", folded.has("orchestrators") && "-rotate-90")}
              />
              <span className="font-semibold tracking-[0.03em] text-dp-text uppercase">{t.orchestrators}</span>
              <span className="ml-auto font-mono text-[11px] text-dp-text-2">{orchestrators.length}</span>
            </button>
            {!folded.has("orchestrators") &&
              orchestrators.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => focusNode(o.id)}
                  className="flex h-7 w-full items-center gap-2 rounded-md pl-6 pr-2 text-left text-[13px] transition-[background-color] duration-150 ease-out hover:bg-dp-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 motion-reduce:transition-none"
                >
                  <Network className="size-3.5 text-dp-accent-ink" />
                  <span className="truncate font-semibold text-dp-text">{o.name}</span>
                </button>
              ))}
          </section>
        )}
      </div>
    </aside>
  );
}
