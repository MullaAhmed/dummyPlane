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
 * The members at work: not handed over, on a task (no report, or moving on to
 * the next one) and running. A member whose task is not typed yet counts too:
 * its terminal is still starting, or relaunching for a new conversation. One
 * that never starts keeps its seat until its task is reassigned.
 */
export function activeMembers(mission: Mission): Member[] {
  return mission.members.filter((m) => !m.handedTo && (!m.report || moving.has(m.nodeId)) && (m.sentAt === undefined || isRunning(m.nodeId)));
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
