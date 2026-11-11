import { toast } from "sonner";
import { toastError } from "@/lib/errorToast";
import { messages } from "@/i18n";
import { missionCleanupUnsaved } from "@/ipc/mission";
import { columnOf } from "@/kanban/board";
import { linkedBoards, missionBoard } from "@/kanban/fleetBoards";
import { doneColumn } from "@/kanban/githubSync";
import { agentMessages } from "@/mcp/messages";
import { nodesStore } from "@/store/nodes";
import { cleanMission } from "./launch";
import { managerNameOf } from "./manager";
import { missionMessages } from "./messages";
import type { Mission } from "./mission";
import { agentState, missionOf } from "./store";

/**
 * A Fleet cleaning its finished mission up itself (`clean_up_mission`, and `propose_plan` on a finished mission):
 * the panel's own cleanup (`cleanMission`) after the checks that keep it from dropping anything unsaved. The panel
 * does not check: the user who clicks it has looked.
 */

const t = () => messages(agentMessages).fleet;

/** The most of a summary handed back to the Fleet, in characters. */
const MAX_SUMMARY = 1500;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Cleaned, with what to tell the Fleet; or not, with the reason, which names what blocks it. */
export type FleetCleanup = { cleaned: true; text: string } | { cleaned: false; reason: string };

/**
 * The mission's own tasks that are not done: a card its plan or its queue gave a task, still outside its board's
 * done column, and every task still waiting in the queue. Cards the user keeps on a board for other work are
 * none of the mission's: they stay on the board anyway.
 */
export function openTasks(fleetId: string, mission: Mission): string[] {
  const boards = new Map(linkedBoards(fleetId).map(({ nodeId, board }) => [nodeId, board]));
  const own = missionBoard(fleetId);
  if (own) boards.set(own.nodeId, own.board);
  const titles = new Set<string>();
  for (const task of [...(mission.plan ?? []), ...(mission.queue ?? [])]) {
    const card = task.card;
    if (!card) continue;
    const board = [...boards.values()].find((b) => b.cards[card]);
    if (board && columnOf(board, card)?.id !== doneColumn(board)?.id) titles.add(task.title);
  }
  for (const task of mission.queue ?? []) titles.add(task.title);
  return [...titles];
}

/** The agents made for the mission, and its Manager, that are at work now: a linked agent went back to the user's work. */
function atWork(fleetId: string, mission: Mission): string[] {
  const names = mission.members.filter((m) => !m.linked && m.nodeId && agentState(m.nodeId) === "travaille").map((m) => m.name);
  if (mission.manager && agentState(mission.manager) === "travaille") names.push(managerNameOf(fleetId));
  return names;
}

/**
 * Cleans the Fleet's finished mission up, as the panel's "Clean up the mission" does (`cleanMission`), unless it is
 * not finished, was an overnight run (its report is the user's, and the cleanup would restart this very session),
 * has agents at work, or would leave something unsaved: tasks not done, a branch not merged into the mission's,
 * uncommitted work in a worktree. Every check comes before the cleanup, which cannot be taken back.
 */
export async function cleanUpFinished(fleetId: string): Promise<FleetCleanup> {
  const f = t();
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (!mission) return { cleaned: false, reason: f.gone };
  if (mission.state === "lancement" || mission.state === "en_cours") return { cleaned: false, reason: f.cleanRunning };
  if (mission.state !== "terminee") return { cleaned: false, reason: f.cleanNothing };
  if (mission.overnight) return { cleaned: false, reason: f.cleanOvernight };
  const working = atWork(fleetId, mission);
  if (working.length > 0) return { cleaned: false, reason: f.cleanAtWork(working.join(", ")) };
  const unsaved: string[] = [];
  const open = openTasks(fleetId, mission);
  if (open.length > 0) unsaved.push(f.cleanOpenTasks(open));
  // The folder the cleanup works in, as cleanMission reads it; without one there are no worktrees to lose.
  if (mission.project && mission.slug) {
    try {
      unsaved.push(...(await missionCleanupUnsaved(mission.project, mission.slug, mission.members.map((m) => m.name))));
    } catch (error) {
      return { cleaned: false, reason: f.cleanCheckFailed(errorText(error)) };
    }
  }
  if (unsaved.length > 0) return { cleaned: false, reason: f.cleanUnsaved(unsaved.join("; ")) };
  // Read again: the check waited on git, and the user may have cleaned the mission up meanwhile.
  const latest = missionOf(nodesStore.getState().nodes[fleetId]);
  if (latest?.state !== "terminee") return { cleaned: false, reason: f.cleanNothing };
  const name = latest.name ?? "";
  // Gone with the mission once it is cleaned up: the Fleet is told, the user still has to merge it.
  const branch = latest.branch;
  const summary = (latest.summary ?? "").trim();
  const checks = latest.handChecks ?? [];
  const result = await cleanMission(fleetId);
  // A string is git failing after the fact: the mission is blank all the same (`cleanMission` frees it in any case).
  const failure = typeof result === "string" ? result : undefined;
  if (failure) toastError(messages(missionMessages).cleanFailed, { error: failure });
  else toast(messages(missionMessages).cleanedByFleet(name));
  const lines = [f.cleanedUp(name, branch, typeof result === "string" ? [] : result.kept, failure)];
  if (summary || checks.length > 0) lines.push(f.cleanedSummary(summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY)}…` : summary, checks));
  return { cleaned: true, text: lines.join(" ") };
}
