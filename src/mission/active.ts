import { isRunning } from "@/store/terminalStatus";
import type { Member, Mission } from "./mission";

/**
 * Who counts against Max agents: the agents at work at once, not the team
 *. Shared by the queue and `reassign`, which
 * `./queue` imports: it lives apart so neither imports the other.
 */

/** Members being moved on, each one once: two reports must not give two tasks. */
export const moving = new Set<string>();

/** By fleet, the tasks a new agent is being started for: each one once, each one a seat already. */
const seats = new Map<string, Set<string>>();

export function holdSeat(fleetId: string, title: string) {
  const held = seats.get(fleetId) ?? new Set<string>();
  held.add(title);
  seats.set(fleetId, held);
}

export function freeSeat(fleetId: string, title: string) {
  const held = seats.get(fleetId);
  held?.delete(title);
  if (held?.size === 0) seats.delete(fleetId);
}

export const seatHeld = (fleetId: string, title: string) => seats.get(fleetId)?.has(title) === true;
export const seatsHeld = (fleetId: string) => seats.get(fleetId)?.size ?? 0;

/**
 * The members `relaunch` is starting again: at work from the call on. Their old process is killed first, and the new
 * one runs only later: in between, nothing else would count them.
 */
export const relaunching = new Set<string>();

/**
 * Members whose seat reassign "new" holds for the agent it creates in their place: the held seat counts for both, once.
 * Not counted while that agent is created, even if their terminal stops meanwhile.
 */
export const handingOver = new Set<string>();

/** On a task: not handed over, and no report, or moving on to the next one. */
const onTask = (m: Member) => !m.handedTo && !handingOver.has(m.nodeId) && (!m.report || moving.has(m.nodeId));

/**
 * The members at work: not handed over, on a task (no report, or moving on to
 * the next one) and running. A member whose task is not typed yet counts too:
 * its terminal is still starting, or relaunching for a new conversation. One
 * that never starts keeps its seat until its task is reassigned. One that
 * `relaunch` starts again counts while it does.
 */
export function activeMembers(mission: Mission): Member[] {
  return mission.members.filter((m) => onTask(m) && (m.sentAt === undefined || isRunning(m.nodeId) || relaunching.has(m.nodeId)));
}

/** Whether a member holds a seat now: it counts against Max agents. */
export const hasSeat = (mission: Mission, nodeId: string) => activeMembers(mission).some((m) => m.nodeId === nodeId);

/**
 * Whether starting a member's terminal again takes one more seat: on its task, it holds none now (stopped after
 * its sub-task was typed, so the queue may have filled its place), and one once it runs.
 */
export function relaunchTakesSeat(mission: Mission, member: Member): boolean {
  return onTask(member) && !hasSeat(mission, member.nodeId);
}

/** The seats taken: the members at work, and the new agents on their way. */
export const activeCount = (fleetId: string, mission: Mission) => activeMembers(mission).length + seatsHeld(fleetId);

/** The agents being created, by fleet: one at a time, each named and placed once the previous one exists. */
const creating = new Map<string, Promise<unknown>>();

export function oneAtATime<T>(fleetId: string, create: () => Promise<T>): Promise<T> {
  const turn = (creating.get(fleetId) ?? Promise.resolve()).then(create, create);
  creating.set(fleetId, turn.catch(() => undefined));
  return turn;
}
