import type { Activity } from "@/ipc/activity";
import type { AgentId } from "@/ipc/pty";
import { promptUp } from "@/mission/ready";
import type { LoopDef } from "./model";

/** The least time between two runs of an idle or output loop. */
export const COOLDOWN_MS = 30_000;
/** How often the engine is ticked (output screens are read at each tick). */
export const TICK_MS = 2000;

export type StopReason = "runs" | "duration" | "manual" | "noTargets" | "noAgents";

/** What the interface shows of a loop. */
export interface LoopRuntime {
  running: boolean;
  runs: number;
  startedAt: number | null;
  stoppedBecause: StopReason | null;
}

/** What the engine needs from the application: tests pass fakes, so no real agent is ever driven. */
export interface EngineDeps {
  now: () => number;
  /** The agent is still on the canvas. */
  isLive: (nodeId: string) => boolean;
  /** The target is an agent: a plain shell is never typed into, a loop's targets are agents only. */
  isAgent: (nodeId: string) => boolean;
  activityOf: (nodeId: string) => Activity | undefined;
  /** What the agent's terminal shows now. */
  screenOf: (nodeId: string) => string;
  /** The instruction would reach the agent, not the shell it left. */
  canReceive: (nodeId: string) => boolean;
  /** Types the instruction into the agents; how many it reached (it spares those that wait, stopped or starting). */
  send: (nodeIds: string[], text: string) => Promise<{ sent: number }>;
}

interface State {
  def: LoopDef;
  runtime: LoopRuntime;
  nextAt: number;
  lastRunAt: number | null;
  /** Output trigger: whether each target's screen showed the text at the last look. */
  matched: Map<string, boolean>;
  /**
   * Output trigger: the targets whose text appeared and has not reached them yet. It goes once the pause is over and
   * the agent can take it (not at work, not waiting, its prompt up), if the text is still on screen by then.
   */
  pending: Set<string>;
  /** Idle trigger: the targets that just became idle. */
  idle: Set<string>;
  busy: boolean;
}

/**
 * A Claude or a Codex that quit leaves its shell running, and the shell would run the text as a command (README
 * mission); a plain shell terminal would too, so it never takes one.
 */
export function acceptsInstruction(agent: AgentId | undefined, screen: string): boolean {
  if (agent === "shell") return false;
  return !agent || promptUp(agent, screen);
}

const shows = (screen: string, text: string) => screen.toLocaleLowerCase().includes(text.toLocaleLowerCase());

/**
 * The loops' engine. Nothing here runs by itself: the
 * caller ticks it and reports activity changes. Every run goes through the
 * guards: a stop condition checked before each run, no send to an agent that
 * waits (a permission dialog included), a pause between runs, one send at a
 * time per loop.
 */
export function createLoopEngine(deps: EngineDeps, onChange: (id: string, runtime: LoopRuntime) => void) {
  const states = new Map<string, State>();

  const publish = (state: State) => onChange(state.def.id, { ...state.runtime });

  function stop(id: string, reason: StopReason = "manual") {
    const state = states.get(id);
    if (!state || !state.runtime.running) return;
    state.runtime = { ...state.runtime, running: false, stoppedBecause: reason };
    publish(state);
  }

  function start(def: LoopDef) {
    const now = deps.now();
    const state: State = {
      def,
      runtime: { running: true, runs: 0, startedAt: now, stoppedBecause: null },
      nextAt: def.trigger.kind === "interval" ? now + def.trigger.minutes * 60_000 : 0,
      lastRunAt: null,
      matched: new Map(),
      pending: new Set(),
      idle: new Set(),
      busy: false,
    };
    // A text already on screen is not news: only its appearing fires.
    if (def.trigger.kind === "output") for (const id of def.targets) state.matched.set(id, shows(deps.screenOf(id), def.trigger.text));
    states.set(def.id, state);
    publish(state);
  }

  /** One send to `ids`; counted only if it reached someone, and says whether it did. */
  async function run(state: State, ids: string[]): Promise<boolean> {
    const targets = ids.filter((id) => deps.isLive(id) && deps.isAgent(id) && deps.activityOf(id) !== "waiting" && deps.canReceive(id));
    if (targets.length === 0 || state.busy) return false;
    state.busy = true;
    state.lastRunAt = deps.now();
    try {
      const { sent } = await deps.send(targets, state.def.instruction);
      if (sent > 0 && state.runtime.running) {
        state.runtime = { ...state.runtime, runs: state.runtime.runs + 1 };
        publish(state);
        if (state.def.maxRuns !== undefined && state.runtime.runs >= state.def.maxRuns) stop(state.def.id, "runs");
      }
      return sent > 0;
    } catch {
      // A dead agent: not a run, and the loop goes on to its next trigger or stop.
      return false;
    } finally {
      state.busy = false;
    }
  }

  const cooledDown = (state: State) => state.lastRunAt === null || deps.now() - state.lastRunAt >= COOLDOWN_MS;

  /** The agent can take an instruction now: not at work, not waiting for the user, its prompt up. */
  const free = (id: string) => deps.activityOf(id) !== "working" && deps.activityOf(id) !== "waiting" && deps.canReceive(id);

  async function check(state: State) {
    const { def } = state;
    const now = deps.now();
    if (def.maxMinutes !== undefined && now - (state.runtime.startedAt ?? now) >= def.maxMinutes * 60_000) return stop(def.id, "duration");
    const live = def.targets.filter(deps.isLive);
    if (live.length === 0) return stop(def.id, "noTargets");
    // A loop saved when shells could be targets: none of its own is an agent, it says so rather than send nothing.
    const targets = live.filter(deps.isAgent);
    if (targets.length === 0) return stop(def.id, "noAgents");
    if (state.busy) return;
    const { trigger } = def;
    if (trigger.kind === "interval") {
      if (now < state.nextAt) return;
      state.nextAt = now + trigger.minutes * 60_000;
      await run(state, targets);
    } else if (trigger.kind === "idle") {
      // Held while the pause lasts, as the output trigger's text: the agent stays idle, so no other idle would come.
      if (!cooledDown(state)) return;
      // One run per pause, to the one idle longest (the set keeps their order): the others wait for the next.
      const fired = [...state.idle].find((id) => targets.includes(id));
      if (fired === undefined) return;
      state.idle.delete(fired);
      await run(state, [fired]);
    } else {
      for (const id of targets) {
        const shown = shows(deps.screenOf(id), trigger.text);
        // Each appearance waits to reach its agent; a text gone from the lines watched takes its wait with it.
        if (shown && state.matched.get(id) !== true) state.pending.add(id);
        if (!shown) state.pending.delete(id);
        state.matched.set(id, shown);
        // Held while the pause lasts and while the agent is at work, waits or cannot take it: sent once it can.
        if (!state.pending.has(id) || !cooledDown(state) || !free(id) || !state.runtime.running) continue;
        if (await run(state, [id])) state.pending.delete(id);
      }
    }
  }

  return {
    start,
    stop,
    stopAll() {
      for (const id of [...states.keys()]) stop(id, "manual");
    },
    running: () => [...states.values()].filter((s) => s.runtime.running).map((s) => s.def.id),
    /** An agent's activity changed (the idle trigger). */
    activity(nodeId: string, activity: Activity, previous: Activity | undefined) {
      // At work or waiting again before its run: its held idle is no news, nothing is typed into what it does.
      if (activity !== "idle") {
        for (const state of states.values()) state.idle.delete(nodeId);
        return;
      }
      if (previous !== "working" && previous !== "waiting") return;
      for (const state of states.values()) {
        if (state.runtime.running && state.def.trigger.kind === "idle" && state.def.targets.includes(nodeId)) state.idle.add(nodeId);
      }
    },
    async tick() {
      for (const state of [...states.values()]) if (state.runtime.running) await check(state);
    },
  };
}

export type LoopEngine = ReturnType<typeof createLoopEngine>;
