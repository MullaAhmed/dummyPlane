import { talk } from "@/agents/talkWires";
import { AGENTS } from "@/agents/catalog";
import { sceneAccess } from "@/agents/sceneAccess";
import { fleetLinks, fleetsOf } from "@/agents/wires";
import { framesFromScene } from "@/canvas/groups";
import { messages } from "@/i18n";
import { missionBoard } from "@/kanban/fleetBoards";
import { notify } from "@/mission/events";
import { fleetNameOf } from "@/mission/manager";
import { nightMin, oneLine, sameName, type Mission } from "@/mission/mission";
import { pumpQueue } from "@/mission/queue";
import { readLevel } from "@/mission/router";
import { agentState, isFleetClosed, missionOf } from "@/mission/store";
import { isManagerNode, nodesStore, sessionOf, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { refused, said, type ToolResult } from "./agentTools";
import { enqueueTasks } from "./fleetTools";
import { agentMessages } from "./messages";
import { outAgentState, outLevel } from "./protocol";

/**
 * An agent the user wired to a Fleet hands it a task: `hand_off`. While the Fleet's mission runs, the task joins the
 * mission's queue as `add_tasks` does (a card in the board's to-do column, a new agent when a seat frees up);
 * otherwise it is typed to the Fleet, which plans it. The Fleet is told once. A mission's team never reaches its
 * Fleet this way: the Fleet hears nothing of it but the mission's end.
 */

const t = () => messages(agentMessages);

const MAX_TITLE = 60;
/** The minutes of a handed-off task whose agent gave none. */
const DEFAULT_BUDGET_MIN = 30;

const nameOf = (nodeId: string) => {
  const payload = terminalOf(nodesStore.getState().nodes[nodeId]);
  return payload ? payload.name || AGENTS[payload.agent].label : "An agent";
};

/** Whether `nodeId` works for a mission that is under way: its Manager, or an agent of its team. Such an agent is not the user's to hand tasks off. */
function onMissionTeam(nodeId: string): boolean {
  if (isManagerNode(nodeId)) return true;
  return Object.values(nodesStore.getState().nodes).some((record) => {
    const mission = missionOf(record);
    return (mission?.state === "en_cours" || mission?.state === "lancement") && mission.members.some((m) => m.nodeId === nodeId);
  });
}

/**
 * The Fleets the user wired `nodeId` to, directly or through a group: read from its workspace's scene, on screen or
 * stored. Empty for a mission's team; null when that scene was never read.
 */
export function commandingFleets(nodeId: string): string[] | null {
  const nodes = nodesStore.getState().nodes;
  const record = nodes[nodeId];
  const scene = record?.kind === "terminal" ? sceneAccess(record.workspaceId) : null;
  if (!scene) return null;
  if (onMissionTeam(nodeId)) return [];
  const elements = scene.elements();
  return fleetsOf(nodeId, fleetLinks(elements), framesFromScene(elements)).filter((id) => nodes[id]?.kind === "fleet");
}

/**
 * hand_off's spec: listed to an agent wired to a Fleet when its session starts (tools/list is read once per session).
 * An agent wired later reaches its Fleet with message_agent, which linked_agents names.
 */
export function handOffTools(nodeId: string) {
  if (!commandingFleets(nodeId)?.length) return [];
  const d = t().tools;
  return [
    {
      name: "hand_off",
      description: d.handOff,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: MAX_TITLE },
          brief: { type: "string", description: d.handOffBrief },
          budget_min: { type: "integer", minimum: 1, description: d.handOffBudget },
          level: { type: "string", enum: ["low", "medium", "high", "extreme"], description: d.handOffLevel },
          fleet: { type: "string", description: d.handOffFleet },
        },
        required: ["title", "brief"],
      },
    },
  ];
}

/** The Fleets that command `nodeId`, as `linked_agents` lists them: relation "fleet". */
export function fleetPeers(nodeId: string): { name: string; id: string; state: string; relation: "fleet" }[] {
  return (commandingFleets(nodeId) ?? []).map((id) => ({ name: fleetNameOf(id), id, state: outAgentState(agentState(id)), relation: "fleet" }));
}

/** The Fleet that commands `nodeId` and that `raw` names, by id or by name; undefined when none. */
export function fleetNamed(nodeId: string, raw: unknown): string | undefined {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return undefined;
  const fleets = commandingFleets(nodeId) ?? [];
  return fleets.find((id) => id === name) ?? fleets.find((id) => sameName(fleetNameOf(id), name));
}

/** `message_agent` to the Fleet that commands the caller: typed into the Fleet's terminal, with no answer to wait for. */
export function messageFleet(nodeId: string, fleetId: string, raw: unknown): ToolResult {
  const h = t().handOff;
  const text = typeof raw === "string" ? oneLine(raw) : "";
  if (!text) return refused(h.nothingToSend);
  const fleet = fleetNameOf(fleetId);
  if (!sessionOf(nodesStore.getState().nodes[fleetId]) || !isRunning(fleetId)) return refused(h.stopped(fleet));
  notify(fleetId, h.messageLine(nameOf(nodeId), text));
  talk(nodeId, fleetId);
  return said(h.messageSent(fleet));
}

/** The Fleet `hand_off` goes to: the only one, or the one `raw` names; else why none. */
function fleetOf(nodeId: string, raw: unknown): string | ToolResult {
  const h = t().handOff;
  const fleets = commandingFleets(nodeId);
  if (fleets === null) return refused(h.noCanvas);
  if (onMissionTeam(nodeId)) return refused(h.team);
  if (fleets.length === 0) return refused(h.notLinked);
  const names = fleets.map(fleetNameOf).join(", ");
  const named = typeof raw === "string" ? raw.trim() : "";
  if (!named) return fleets.length === 1 ? fleets[0] : refused(h.whichFleet(names));
  return fleetNamed(nodeId, named) ?? refused(h.noSuchFleet(named, names));
}

/** The note a handed-off task's card gets besides its brief: who handed it over. */
function noteCard(fleetId: string, cardId: string, from: string) {
  const found = missionBoard(fleetId);
  const card = found?.board.cards[cardId];
  if (!found || !card) return;
  const notes = [card.notes, t().handOff.cardNote(from)].filter(Boolean).join("\n\n");
  nodesStore.getState().update(found.nodeId, { cards: { ...found.board.cards, [cardId]: { ...card, notes } } });
}

/** The task as `add_tasks` reads it: a budget and, with the model router on, a level, both by default. */
function queuedItem(mission: Mission, args: Record<string, unknown>) {
  const night = nightMin(mission);
  const budget = args.budget_min ?? Math.max(1, Math.min(DEFAULT_BUDGET_MIN, night ?? DEFAULT_BUDGET_MIN));
  const level = args.niveau ?? (mission.router ? "moyen" : undefined);
  return { titre: args.titre, consigne: args.consigne, budget_min: budget, ...(level === undefined ? {} : { niveau: level }) };
}

/**
 * `hand_off`: a task for the Fleet the caller is wired to. The caller learns where it went, or why it was not taken.
 * Its arguments are as `./protocol.ts` hands them: titre, consigne, budget_min, niveau, fleet.
 */
export function handOffTool(nodeId: string, args: Record<string, unknown>): ToolResult {
  const h = t().handOff;
  const target = fleetOf(nodeId, args.fleet);
  if (typeof target !== "string") return target;
  const fleetId = target;
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (!mission || isFleetClosed(fleetId)) return refused(h.gone(fleetNameOf(fleetId)));
  const title = typeof args.titre === "string" ? oneLine(args.titre) : "";
  if (!title || title.length > MAX_TITLE) return refused(h.titleMissing(MAX_TITLE));
  const brief = typeof args.consigne === "string" ? args.consigne.trim() : "";
  if (!brief) return refused(h.briefMissing);
  const fleet = fleetNameOf(fleetId);
  const from = nameOf(nodeId);
  if (mission.state === "terminee") return refused(h.finished(fleet));
  if (mission.state === "en_cours" || mission.state === "lancement") {
    // Its own queue, as the Fleet's add_tasks: the title, the brief, a budget and a level; it becomes a card, and a seat frees up for it.
    const added = enqueueTasks(fleetId, mission, { tasks: [queuedItem(mission, { ...args, titre: title, consigne: brief })] }, from);
    if (typeof added === "string") return refused(added);
    const task = added.tasks[0];
    if (task.card) noteCard(fleetId, task.card, from);
    talk(nodeId, fleetId);
    notify(fleetId, h.queuedLine(from, task.title, task.card, added.queue.length));
    const { latest } = added;
    // Told as the Fleet's own add_tasks tells it: the board runs under its Manager.
    if (latest.state === "en_cours" && latest.manager && latest.board) {
      talk(fleetId, latest.board);
      talk(latest.board, latest.manager);
      notify(latest.manager, h.cardLine(from, fleet, task.title));
    }
    void pumpQueue(fleetId);
    return said(h.queued(task.title, task.card, added.queue.length) + (isRunning(fleetId) ? "" : h.queuedStopped(fleet)));
  }
  // No mission yet: the Fleet plans it.
  if (!sessionOf(nodesStore.getState().nodes[fleetId]) || !isRunning(fleetId)) return refused(h.stopped(fleet));
  const level = readLevel(args.niveau);
  const extra = [typeof args.budget_min === "number" ? ` Budget: ${args.budget_min} min.` : "", level ? ` Level: ${outLevel(level)}.` : ""].join("");
  notify(fleetId, h.planLine(from, title, oneLine(brief), extra));
  talk(nodeId, fleetId);
  return said(h.sent(fleet));
}
