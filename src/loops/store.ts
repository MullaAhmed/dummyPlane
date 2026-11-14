import { createStore } from "zustand";
import { messages } from "@/i18n";
import { createLoopEngine, TICK_MS, type EngineDeps, type LoopRuntime } from "./engine";
import { loopsMessages } from "./messages";
import { LOOPS_VERSION, loopsLeftOut, placeLoops, projectFull, readLoops, readUnplacedLoops, validateLoop, withLoop, withoutLoop, type LoopDef } from "./model";

/** The setting that holds the loops: their definitions only, never that one is on. */
export const LOOPS_KEY = "loops.list";

export interface LoopsIo {
  read: () => Promise<unknown>;
  write: (value: unknown) => Promise<void>;
  /** The project of each node still saved, on screen or not: where a loop saved before loops had one goes (`placeLoops`). */
  projectsOf: (nodeIds: string[]) => Promise<Record<string, string>>;
  /** The project open now. */
  activeProject: () => string | null;
  /**
   * Has the saved text kept aside before a save can replace it, when a read left some of it out (`some`) or all of it
   * (a newer version, another shape): what is left out is lost at the next save otherwise.
   */
  keepAside?: (some: boolean) => Promise<void>;
}

export interface Timers {
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (timer: ReturnType<typeof setInterval>) => void;
}

export interface LoopsState {
  loops: LoopDef[];
  loaded: boolean;
  /** The state of the loops turned on since the application started. */
  runtime: Record<string, LoopRuntime>;
  load: () => Promise<void>;
  /** "invalid" when the loop breaks a rule (no stop condition, say), "full" when its project's list is. */
  save: (loop: LoopDef) => Promise<"ok" | "invalid" | "full">;
  remove: (id: string) => Promise<void>;
  /** Puts a deleted loop back at `index`, turned off (the delete's undo); "full" when its project's list is. */
  restore: (loop: LoopDef, index: number) => Promise<"ok" | "full">;
  start: (id: string) => void;
  stop: (id: string) => void;
  /** Every loop running, whatever its project: the emergency brake. */
  stopAll: () => void;
  /** The loops running, every project's. */
  runningCount: () => number;
}

/**
 * The loops' store. Its inputs are passed in: the real ones
 * are wired in `live.ts`; tests pass fakes and never drive a real agent.
 */
export function createLoopsStore(
  engineDeps: EngineDeps,
  io: LoopsIo,
  timers: Timers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (t) => clearInterval(t) },
) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let reading: Promise<void> | null = null;

  const engine = createLoopEngine(engineDeps, (id, runtime) => {
    store.setState((s) => ({ runtime: { ...s.runtime, [id]: runtime } }));
    // The timer only runs while a loop does.
    if (timer !== null && engine.running().length === 0) {
      timers.clearInterval(timer);
      timer = null;
    }
  });

  const store = createStore<LoopsState>()((set, get) => {
    const persist = (loops: LoopDef[]) => io.write({ version: LOOPS_VERSION, loops });
    // A failed read stops the change: it does not read as an empty list.
    const readList = async () => {
      await get().load();
      if (!get().loaded) throw new Error(messages(loopsMessages).notRead);
    };
    const ticking = () => {
      timer ??= timers.setInterval(() => void engine.tick(), TICK_MS);
    };
    return {
      loops: [],
      loaded: false,
      runtime: {},
      load: () => {
        if (get().loaded) return Promise.resolve();
        reading ??= io
          .read()
          .then(async (raw) => {
            // Before anything is read into the list, or saved: a failed keep stops the read, as a failed read does.
            const leftOut = loopsLeftOut(raw);
            if (leftOut !== "none") await io.keepAside?.(leftOut === "some");
            const unplaced = readUnplacedLoops(raw);
            if (!unplaced) return set({ loops: readLoops(raw), loaded: true });
            // Saved before loops belonged to a project: each is placed once, and saved so. A failed look stops the
            // read, as a failed read does: the next one tries again, and no loop is lost meanwhile.
            const targets = [...new Set(unplaced.flatMap((l) => l.targets))];
            const loops = placeLoops(unplaced, targets.length ? await io.projectsOf(targets) : {}, io.activeProject());
            await persist(loops);
            set({ loops, loaded: true });
          })
          .catch((error: unknown) => console.warn("loops not read", error))
          .finally(() => {
            reading = null;
          });
        return reading;
      },
      save: async (loop) => {
        const checked = validateLoop(loop);
        if (!checked.ok) return "invalid";
        await readList();
        const kept: LoopDef = { ...checked.loop, id: loop.id, projectId: loop.projectId };
        const next = withLoop(get().loops, kept);
        if (next === null) return "full";
        // A loop changed while it ran is no longer the one the user turned on.
        engine.stop(kept.id);
        set({ loops: next });
        await persist(next);
        return "ok";
      },
      remove: async (id) => {
        await readList();
        engine.stop(id);
        const next = withoutLoop(get().loops, id);
        set({ loops: next });
        await persist(next);
      },
      restore: async (loop, index) => {
        await readList();
        const list = get().loops;
        // A second undo, or a loop saved again since, is already there.
        if (list.some((l) => l.id === loop.id)) return "ok";
        if (projectFull(list, loop.projectId)) return "full";
        const at = Math.max(0, Math.min(index, list.length));
        const next = [...list.slice(0, at), loop, ...list.slice(at)];
        set({ loops: next });
        await persist(next);
        return "ok";
      },
      start: (id) => {
        const loop = get().loops.find((l) => l.id === id);
        if (!loop) return;
        engine.start(loop);
        ticking();
      },
      stop: (id) => engine.stop(id),
      stopAll: () => engine.stopAll(),
      runningCount: () => Object.values(get().runtime).filter((r) => r.running).length,
    };
  });

  return Object.assign(store, {
    /** The idle trigger's input: an agent's activity changed. */
    activity: engine.activity,
    /** Ticks the engine once (the timer does it every `TICK_MS`). */
    tick: engine.tick,
  });
}
