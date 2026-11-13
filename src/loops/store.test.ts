import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineDeps } from "./engine";
import { TICK_MS } from "./engine";
import { LOOPS_VERSION, type LoopDef } from "./model";
import { createLoopsStore } from "./store";

const loop = (id: string, over: Partial<LoopDef> = {}): LoopDef => ({
  id,
  projectId: "p1",
  name: `Boucle ${id}`,
  instruction: "go",
  targets: ["a"],
  trigger: { kind: "interval", minutes: 1 },
  maxRuns: 3,
  ...over,
});

let stored: unknown;
let saved: unknown[];
let now: number;
let timers: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; fire: () => void };
let sent: string[][];
/** Where the nodes are saved, the project open, and what the migration asked. */
let projectOf: Record<string, string>;
let active: string | null;
let looked: string[][];
let lookFails: boolean;

const engineDeps = (): EngineDeps => ({
  now: () => now,
  isLive: () => true,
  isAgent: () => true,
  activityOf: () => undefined,
  screenOf: () => "",
  canReceive: () => true,
  send: async (ids) => {
    sent.push(ids);
    return { sent: ids.length };
  },
});

const io = () => ({
  read: async () => stored,
  write: async (value: unknown) => void saved.push(value),
  projectsOf: async (ids: string[]) => {
    looked.push(ids);
    if (lookFails) throw new Error("db closed");
    return Object.fromEntries(ids.flatMap((id) => (projectOf[id] ? [[id, projectOf[id]]] : [])));
  },
  activeProject: () => active,
});

function make() {
  let callback: () => void = () => undefined;
  timers = {
    start: vi.fn((fn: () => void) => {
      callback = fn;
      return 1 as never;
    }),
    stop: vi.fn(),
    fire: () => callback(),
  };
  return createLoopsStore(
    engineDeps(),
    io(),
    { setInterval: timers.start as never, clearInterval: timers.stop as never },
  );
}

beforeEach(() => {
  now = 0;
  saved = [];
  sent = [];
  projectOf = {};
  active = "p1";
  looked = [];
  lookFails = false;
  stored = { version: LOOPS_VERSION, loops: [loop("1"), loop("2")] };
});

describe("loops saved before they belonged to a project", () => {
  /** A loop as version 1 saved it: no project. */
  const old = (id: string, targets: string[]) => {
    const { projectId: _none, ...rest } = loop(id, { targets });
    return rest;
  };

  it("are placed once, each in its targets' project or the one open, and saved so", async () => {
    projectOf = { a: "p1", b: "p2" };
    active = "p3";
    stored = { version: 1, loops: [old("1", ["a"]), old("2", ["b"]), old("3", ["a", "b"]), old("4", ["gone"])] };
    const store = make();
    await store.getState().load();
    expect(looked).toEqual([["a", "b", "gone"]]);
    expect(store.getState().loops.map((l) => [l.id, l.projectId])).toEqual([
      ["1", "p1"],
      ["2", "p2"],
      ["3", "p3"],
      ["4", "p3"],
    ]);
    // Saved in the new shape at once, every loop kept: the next start reads them as they are.
    expect(saved).toEqual([{ version: LOOPS_VERSION, loops: store.getState().loops }]);
    stored = saved[0];
    const again = make();
    await again.getState().load();
    expect(again.getState().loops).toEqual(store.getState().loops);
    expect(looked).toHaveLength(1);
  });

  it("stay as they were when their targets' projects cannot be read, and are placed at the next read", async () => {
    stored = { version: 1, loops: [old("1", ["a"])] };
    lookFails = true;
    const store = make();
    await store.getState().load();
    expect(store.getState().loaded).toBe(false);
    expect(saved).toEqual([]);
    await expect(store.getState().save(loop("9"))).rejects.toThrow();
    lookFails = false;
    projectOf = { a: "p2" };
    await store.getState().load();
    expect(store.getState().loops.map((l) => [l.id, l.projectId])).toEqual([["1", "p2"]]);
  });
});

describe("a loop whose targets are shells", () => {
  it("never types into a shell and stops saying so, an agent beside it still served", async () => {
    const deps = { ...engineDeps(), isAgent: (id: string) => id !== "shell" };
    const store = createLoopsStore(deps, io(), { setInterval: () => 1 as never, clearInterval: () => undefined });
    stored = { version: LOOPS_VERSION, loops: [loop("mixed", { targets: ["shell", "a"] }), loop("shell-only", { targets: ["shell"] })] };
    await store.getState().load();
    store.getState().start("mixed");
    store.getState().start("shell-only");
    now = 60_000;
    await store.tick();
    expect(sent).toEqual([["a"]]);
    expect(store.getState().runtime["shell-only"]).toMatchObject({ running: false, stoppedBecause: "noAgents" });
    expect(store.getState().runtime.mixed.running).toBe(true);
  });
});

describe("the loops store", () => {
  it("saves nothing over a list it could not read: a read error must not wipe the loops (review)", async () => {
    const store = createLoopsStore(engineDeps(), { ...io(), read: () => Promise.reject(new Error("database is locked")) });
    await expect(store.getState().save(loop("9"))).rejects.toThrow();
    await expect(store.getState().remove("1")).rejects.toThrow();
    expect(saved).toEqual([]);
    expect(store.getState().loaded).toBe(false);
  });

  it("loads the saved loops all off: nothing runs after a restart", async () => {
    const store = make();
    await store.getState().load();
    expect(store.getState().loops.map((l) => l.id)).toEqual(["1", "2"]);
    expect(store.getState().runtime).toEqual({});
    expect(timers.start).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("turns a loop on, ticks the engine while one runs, and stops the timer when none does", async () => {
    const store = make();
    await store.getState().load();
    store.getState().start("1");
    expect(store.getState().runtime["1"]).toMatchObject({ running: true, runs: 0 });
    expect(timers.start).toHaveBeenCalledWith(expect.any(Function), TICK_MS);
    now = 60_000;
    timers.fire();
    await vi.waitFor(() => expect(store.getState().runtime["1"].runs).toBe(1));
    expect(sent).toEqual([["a"]]);
    store.getState().stop("1");
    expect(timers.stop).toHaveBeenCalled();
  });

  it("stops all loops at once", async () => {
    const store = make();
    await store.getState().load();
    store.getState().start("1");
    store.getState().start("2");
    expect(store.getState().runningCount()).toBe(2);
    store.getState().stopAll();
    expect(store.getState().runningCount()).toBe(0);
    expect(store.getState().runtime["2"].stoppedBecause).toBe("manual");
  });

  it("saves definitions only, versioned: never that a loop is on", async () => {
    const store = make();
    await store.getState().load();
    store.getState().start("1");
    expect(await store.getState().save(loop("3"))).toBe("ok");
    expect(saved[saved.length - 1]).toEqual({ version: LOOPS_VERSION, loops: [loop("1"), loop("2"), loop("3")] });
    expect(JSON.stringify(saved)).not.toContain("running");
  });

  it("refuses a loop without stop condition, even if the interface let it through", async () => {
    const store = make();
    await store.getState().load();
    expect(await store.getState().save(loop("9", { maxRuns: undefined }))).toBe("invalid");
    expect(saved).toEqual([]);
    expect(store.getState().loops).toHaveLength(2);
  });

  it("removes a loop, stopping it first", async () => {
    const store = make();
    await store.getState().load();
    store.getState().start("1");
    await store.getState().remove("1");
    expect(store.getState().loops.map((l) => l.id)).toEqual(["2"]);
    expect(store.getState().runtime["1"]?.running ?? false).toBe(false);
  });

  it("puts a deleted loop back at its place, turned off, once (the delete's undo, audit P2 #42)", async () => {
    const store = make();
    await store.getState().load();
    store.getState().start("1");
    const removed = store.getState().loops[0];
    await store.getState().remove("1");
    expect(await store.getState().restore(removed, 0)).toBe("ok");
    expect(store.getState().loops.map((l) => l.id)).toEqual(["1", "2"]);
    expect(saved[saved.length - 1]).toEqual({ version: LOOPS_VERSION, loops: [loop("1"), loop("2")] });
    expect(store.getState().runtime["1"]?.running ?? false).toBe(false);
    // A second undo writes nothing more.
    const writes = saved.length;
    expect(await store.getState().restore(removed, 0)).toBe("ok");
    expect(saved).toHaveLength(writes);
    expect(store.getState().loops).toHaveLength(2);
  });

  it("does not put a loop back into a full list", async () => {
    stored = { version: LOOPS_VERSION, loops: Array.from({ length: 30 }, (_, i) => loop(String(i))) };
    const store = make();
    await store.getState().load();
    expect(await store.getState().restore(loop("extra"), 0)).toBe("full");
    expect(store.getState().loops).toHaveLength(30);
    expect(saved).toEqual([]);
  });

  it("changing a loop that runs turns it off: it was not the loop the user turned on", async () => {
    const store = make();
    await store.getState().load();
    store.getState().start("1");
    await store.getState().save(loop("1", { instruction: "autre chose" }));
    expect(store.getState().runtime["1"].running).toBe(false);
  });

  it("does not save over a list it has not read", async () => {
    let release: (value: unknown) => void = () => undefined;
    const store = createLoopsStore(engineDeps(), { ...io(), read: () => new Promise((resolve) => (release = resolve)) });
    const saving = store.getState().save(loop("3"));
    release({ version: LOOPS_VERSION, loops: [loop("1")] });
    expect(await saving).toBe("ok");
    expect(saved[saved.length - 1]).toEqual({ version: LOOPS_VERSION, loops: [loop("1"), loop("3")] });
  });
});
