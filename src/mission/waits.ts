import { messages } from "@/i18n";
import { agentMessages } from "@/mcp/messages";
import { sameName, type Mission, type QueuedTask } from "./mission";

/**
 * A waiting task that waits for others (`waitsFor`): the names of tasks of the same mission, nothing more. It is
 * handed to no agent before each of them is done and its branch is in the mission's, since a new agent's worktree is
 * cut from the mission's branch and would miss the work of one that is not.
 */

/**
 * The titles of the tasks an agent holds or has held: the plan's once the mission runs (it holds every task started,
 * the queue's included), and what its members went through. Those an amendment keeps untouched.
 */
export function startedTitles(mission: Mission): string[] {
  const running = mission.state === "en_cours" || mission.state === "terminee";
  const titles = [...(running ? (mission.plan ?? []).map((s) => s.title) : []), ...mission.members.flatMap((m) => [m.task, ...(m.done ?? []), ...(m.past ?? []).map((p) => p.task)])];
  return titles.filter((title, i) => title !== "" && titles.findIndex((other) => sameName(other, title)) === i);
}

/** Whether a task is done and its branch is in the mission's. A task another agent took over (`reassign`) is its taker's. */
export function taskIn(mission: Mission, title: string): boolean {
  return mission.members.some(
    (m) =>
      // `reassign` takes a finished task over only once it is merged, so what an agent finished before is in.
      (m.done ?? []).some((done) => sameName(done, title)) ||
      (!m.handedTo && sameName(m.task, title) && m.report?.status === "termine" && m.merged === true),
  );
}

/**
 * The tasks `task` waits for that are not in yet, by title. A title that stands for no task of the mission any more
 * is not waited for: its task was settled, its card Done outside the queue (`settleQueue`), so its work is over.
 */
export function waitingOn(mission: Mission, task: Pick<QueuedTask, "waitsFor">): string[] {
  return (task.waitsFor ?? []).filter((title) => stands(mission, title) && !taskIn(mission, title));
}

/** Whether a title stands for a task of the mission: one waiting in the queue, or one an agent holds or held. */
const stands = (mission: Mission, title: string) => [...(mission.queue ?? []).map((queued) => queued.title), ...startedTitles(mission)].some((other) => sameName(other, title));

/** Where a task is that others wait for, if it is not in: only a task blocked, failed, left or unmerged needs someone to take it up. */
export type WaitState = "done" | "queued" | "working" | "unmerged" | "blocked" | "failed" | "left";

export function waitState(mission: Mission, title: string): WaitState {
  // As `waitingOn` reads it: a task no longer in the mission was settled, its work is over.
  if (taskIn(mission, title) || !stands(mission, title)) return "done";
  const holder = mission.members.find((m) => !m.handedTo && sameName(m.task, title));
  if (!holder) return "queued";
  if (holder.abandoned) return "left";
  if (holder.report?.status === "bloque") return "blocked";
  if (holder.report?.status === "echec") return "failed";
  return holder.report ? "unmerged" : "working";
}

/**
 * The names a batch of tasks waits for, as the titles they stand for: a task of the batch, one already waiting
 * (`waiting`), or one an agent holds or held (`started`). Or what is wrong: a name that is none of them, a task waiting
 * for itself, a wait in circles (none of it would ever start); a task of `waiting` that waits for a task this change
 * removes (`removed`: the titles an amendment drops, or the pending plan's that a new plan replaces). A name that stood
 * for nothing before, a task settled meanwhile, is not this change's to refuse.
 */
export function resolvedWaits<T extends QueuedTask>(batch: readonly T[], waiting: readonly QueuedTask[], started: readonly string[], removed: readonly string[] = []): T[] | string {
  const e = messages(agentMessages).plan;
  const titles = [...batch.map((task) => task.title), ...waiting.map((task) => task.title), ...started];
  const resolved: T[] = [];
  for (const [i, task] of batch.entries()) {
    const waitsFor: string[] = [];
    for (const name of task.waitsFor ?? []) {
      const title = titles.find((other) => sameName(other, name));
      if (!title) return e.waitsForUnknown(i + 1, name);
      if (sameName(title, task.title)) return e.waitsForSelf(i + 1);
      if (!waitsFor.includes(title)) waitsFor.push(title);
    }
    resolved.push(waitsFor.length > 0 ? { ...task, waitsFor } : task);
  }
  for (const task of waiting) {
    const lost = (task.waitsFor ?? []).find((name) => removed.some((other) => sameName(other, name)) && !titles.some((title) => sameName(title, name)));
    if (lost) return e.waitedGone(task.title, lost);
  }
  // Each waiting task's names followed through the waiting ones: coming back to itself is a circle.
  const waits = [...waiting, ...resolved].map((task) => ({ title: task.title, waitsFor: task.waitsFor ?? [] }));
  const reaches = (from: string, target: string, seen: string[] = []): boolean =>
    (waits.find((other) => sameName(other.title, from))?.waitsFor ?? []).some((next) => sameName(next, target) || (!seen.some((s) => sameName(s, next)) && reaches(next, target, [...seen, next])));
  const circle = resolved.findIndex((task) => reaches(task.title, task.title));
  if (circle !== -1) return e.waitsInCircles(circle + 1, resolved[circle].title);
  return resolved;
}
