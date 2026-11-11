import { messages } from "@/i18n";
import type { SceneFrame } from "@/canvas/groups";
import type { AgentId } from "@/ipc/pty";
import type { TerminalReportStatus } from "@/nodes/types";
import type { AgentActivity } from "@/store/agentActivity";
import type { TerminalStatus } from "@/store/terminalStatus";
import { agentStateOf } from "./agentState";
import { agentsMessages } from "./messages";
import { ROLES } from "./roles";

/**
 * What the agents panel tells about an agent (spec theme §5.5).
 * `active`: the process starts, or runs and its activity is not known (the pill says Active).
 */
export type PanelState = "working" | "waiting" | "active" | "idle" | "stopped";

/**
 * What the panel's filters show, in their order. `done`: not working and not
 * waiting: reported done, finished its turn (idle) or its process ended
 * (stopped). An `active` agent has no filter of its own: it shows under `all`.
 */
export type PanelFilter = "all" | "waiting" | "working" | "done";

export const PANEL_FILTERS: readonly { id: PanelFilter; label: string }[] = (["all", "waiting", "working", "done"] as const).map((id) => ({
  id,
  get label() {
    return messages(agentsMessages).filters[id];
  },
}));

/** Whether an agent in `state` shows under `filter` (the Fleets' section filters with the agents). */
export const inFilter =(state: PanelState, filter: PanelFilter): boolean =>
  filter === "all" || (filter === "done" ? state === "idle" || state === "stopped" : state === filter);

export interface PanelAgent {
  id: string;
  name: string;
  agent: AgentId;
  state: PanelState;
  /** Since when the agent is in its state (running agents only). */
  since?: number;
}

export interface PanelSection {
  /** The group's frame, or null for the agents outside groups. */
  id: string | null;
  name: string;
  color: string | null;
  agents: PanelAgent[];
  /** The section's agents and those at work whatever the filter: its header says what the group's canvas label says. */
  members: number;
  working: number;
}

/**
 * The panel's word for an agent's state (`agentStateOf`, the reading every count shares): a running agent
 * takes its activity, rests once its turn is over or its last report stands, and is active while its activity
 * is unknown or its process starts. An agent that exited ("Agent exited") is stopped, like an ended process.
 * A plain shell console (`agent` false) is never at work nor waiting: it is active while it runs.
 */
export function panelStateOf(status: TerminalStatus, activity?: AgentActivity, report?: TerminalReportStatus, agent = true): PanelState {
  const state = agentStateOf(status, activity, report);
  switch (state) {
    case "working":
    case "waiting":
      return agent ? state : "active";
    case "ready":
    case "done":
      return "idle";
    case "left":
    case "stopped":
      return "stopped";
    case "starting":
    case "active":
      return "active";
  }
}

/** Each group in scene order, then "Outside a group"; only the agents of `filter`, no empty section. */
export function panelSections(
  agents: readonly PanelAgent[],
  frames: readonly SceneFrame[],
  filter: PanelFilter,
): PanelSection[] {
  const shown = (all: readonly PanelAgent[]) => all.filter((a) => inFilter(a.state, filter));
  const totals = (all: readonly PanelAgent[]) => ({ members: all.length, working: all.filter((a) => a.state === "working").length });
  const inGroups = new Set<string>();
  const sections: PanelSection[] = [];
  for (const frame of frames) {
    if (!frame.group) continue;
    frame.memberIds.forEach((id) => inGroups.add(id));
    const members = agents.filter((a) => frame.memberIds.includes(a.id));
    const listed = shown(members);
    if (listed.length > 0) {
      sections.push({ id: frame.id, name: frame.name, color: ROLES[frame.group.role].color, agents: listed, ...totals(members) });
    }
  }
  const outside = agents.filter((a) => !inGroups.has(a.id));
  const listed = shown(outside);
  if (listed.length > 0) {
    sections.push({ id: null, name: messages(agentsMessages).outsideGroup, color: null, agents: listed, ...totals(outside) });
  }
  return sections;
}

export function filterCounts(agents: readonly Pick<PanelAgent, "state">[]): Record<PanelFilter, number> {
  const counts: Record<PanelFilter, number> = { all: agents.length, waiting: 0, working: 0, done: 0 };
  for (const a of agents) {
    for (const filter of ["waiting", "working", "done"] as const) if (inFilter(a.state, filter)) counts[filter]++;
  }
  return counts;
}
