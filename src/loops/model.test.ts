import { describe, expect, it } from "vitest";
import {
  LOOP_TEMPLATES,
  loopsLeftOut,
  loopsOf,
  MAX_LOOPS,
  placeLoops,
  readLoops,
  readUnplacedLoops,
  stopsAfter,
  validateLoop,
  withLoop,
  withoutLoop,
  type LoopDef,
  type LoopDraft,
} from "./model";

const draft = (over: Partial<LoopDraft> = {}): LoopDraft => ({
  name: "Point",
  instruction: "Fais un point d'avancement",
  targets: ["a"],
  trigger: { kind: "interval", minutes: 30 },
  maxRuns: 8,
  ...over,
});

describe("validateLoop", () => {
  it("accepts a loop with a stop condition, trimming its texts", () => {
    const result = validateLoop(draft({ name: "  Point  ", instruction: "  go  " }));
    expect(result).toEqual({ ok: true, loop: expect.objectContaining({ name: "Point", instruction: "go", targets: ["a"], maxRuns: 8 }) });
  });

  it("refuses a loop without any stop condition, whatever the rest", () => {
    expect(validateLoop(draft({ maxRuns: undefined, maxMinutes: undefined }))).toEqual({ ok: false, error: "stop" });
    expect(validateLoop(draft({ maxRuns: undefined, maxMinutes: 60 })).ok).toBe(true);
  });

  it("bounds the runs, the duration and the interval", () => {
    expect(validateLoop(draft({ maxRuns: 0 }))).toEqual({ ok: false, error: "runs" });
    expect(validateLoop(draft({ maxRuns: 1001 }))).toEqual({ ok: false, error: "runs" });
    expect(validateLoop(draft({ maxRuns: 2.5 }))).toEqual({ ok: false, error: "runs" });
    expect(validateLoop(draft({ maxRuns: undefined, maxMinutes: 1441 }))).toEqual({ ok: false, error: "minutes" });
    expect(validateLoop(draft({ trigger: { kind: "interval", minutes: 0 } }))).toEqual({ ok: false, error: "interval" });
    expect(validateLoop(draft({ trigger: { kind: "interval", minutes: 1441 } }))).toEqual({ ok: false, error: "interval" });
  });

  it("needs a name, an instruction, a target and, for the output trigger, a text of 200 characters at most", () => {
    expect(validateLoop(draft({ name: "  " }))).toEqual({ ok: false, error: "name" });
    expect(validateLoop(draft({ instruction: "" }))).toEqual({ ok: false, error: "instruction" });
    expect(validateLoop(draft({ targets: [] }))).toEqual({ ok: false, error: "targets" });
    expect(validateLoop(draft({ trigger: { kind: "output", text: "  " } }))).toEqual({ ok: false, error: "text" });
    expect(validateLoop(draft({ trigger: { kind: "output", text: "x".repeat(201) } }))).toEqual({ ok: false, error: "text" });
    expect(validateLoop(draft({ trigger: { kind: "output", text: "FAIL" } })).ok).toBe(true);
    expect(validateLoop(draft({ trigger: { kind: "idle" } })).ok).toBe(true);
  });

  it("keeps each target once", () => {
    const result = validateLoop(draft({ targets: ["a", "b", "a"] }));
    expect(result.ok && result.loop.targets).toEqual(["a", "b"]);
  });
});

describe("the templates", () => {
  it("are three, each a valid loop once given a target, and none starts anything by itself", () => {
    expect(LOOP_TEMPLATES.map((t) => t.id)).toEqual(["progress", "relaunch", "tests"]);
    for (const template of LOOP_TEMPLATES) {
      const filled = validateLoop({ ...template.draft, name: "n", instruction: "x", targets: ["a"] });
      expect(filled.ok, template.id).toBe(true);
      expect(template.draft.maxRuns ?? template.draft.maxMinutes, template.id).toBeDefined();
    }
  });
});

describe("stopsAfter", () => {
  it("reads which condition a loop has", () => {
    const loop = validateLoop(draft({ maxRuns: 3, maxMinutes: 10 }));
    expect(loop.ok && stopsAfter(loop.loop)).toEqual({ runs: 3, minutes: 10 });
  });
});

describe("readLoops and the list", () => {
  const good = (() => {
    const r = validateLoop(draft());
    return { ...(r.ok ? r.loop : ({} as LoopDef)), id: "1", projectId: "p1" };
  })();

  it("reads a good list, nothing from a damaged setting, and drops an invalid loop alone", () => {
    expect(readLoops({ version: 2, loops: [good] })).toEqual([good]);
    for (const bad of [null, 4, "x", [], { version: 3, loops: [good] }, { version: 2, loops: "no" }]) expect(readLoops(bad)).toEqual([]);
    const noStop = { ...good, id: "2", maxRuns: undefined };
    // A loop of version 2 names its project: one without is not read.
    const noProject = { ...good, id: "4", projectId: undefined };
    expect(readLoops({ version: 2, loops: [noStop, good, { id: 3 }, noProject] })).toEqual([good]);
  });

  it("says how much of a saved setting it leaves out: nothing, some of its loops, or all of it", () => {
    expect(loopsLeftOut(null)).toBe("none");
    expect(loopsLeftOut({ version: 2, loops: [] })).toBe("none");
    expect(loopsLeftOut({ version: 2, loops: [good] })).toBe("none");
    expect(loopsLeftOut({ version: 2, loops: [good, { id: 3 }] })).toBe("some");
    // The setting of a loop without a project is read for its migration: it leaves out only a damaged loop.
    const { projectId: _none, ...old } = good;
    expect(loopsLeftOut({ version: 1, loops: [old] })).toBe("none");
    expect(loopsLeftOut({ version: 1, loops: [old, { id: 3 }] })).toBe("some");
    // A newer version, another shape: read as no loop at all.
    for (const other of [{ version: 3, loops: [good] }, { loops: [good] }, { version: 2, loops: "no" }, "x", 4, [good]]) expect(loopsLeftOut(other), JSON.stringify(other)).toBe("all");
  });

  it("keeps at most 30 loops per project, replaces one by id, removes one by id", () => {
    const many = Array.from({ length: MAX_LOOPS + 5 }, (_, i) => ({ ...good, id: String(i) }));
    const other = { ...good, id: "other", projectId: "p2" };
    expect(readLoops({ version: 2, loops: [...many, other] })).toEqual([...many.slice(0, MAX_LOOPS), other]);
    expect(withLoop([good], { ...good, name: "Autre" })!.map((l) => l.name)).toEqual(["Autre"]);
    expect(withLoop(many.slice(0, MAX_LOOPS), { ...good, id: "new" })).toBeNull();
    // A full project leaves room in another, and a loop of the full one can still change.
    expect(withLoop(many.slice(0, MAX_LOOPS), other)).toHaveLength(MAX_LOOPS + 1);
    expect(withLoop(many.slice(0, MAX_LOOPS), { ...good, id: "0", name: "Autre" })).toHaveLength(MAX_LOOPS);
    expect(withoutLoop([good], "1")).toEqual([]);
  });
});

describe("loops per project", () => {
  const base = (() => {
    const r = validateLoop(draft());
    return r.ok ? r.loop : ({} as LoopDef);
  })();
  const v1 = (id: string, targets: string[]) => ({ ...base, id, targets });

  it("reads a setting saved before loops had a project, and only such a one, as loops to place", () => {
    expect(readUnplacedLoops({ version: 1, loops: [v1("a", ["t1"]), { id: 3 }] })).toEqual([v1("a", ["t1"])]);
    for (const other of [null, { version: 2, loops: [] }, { version: 1, loops: "no" }]) expect(readUnplacedLoops(other)).toBeNull();
    // The new reader does not take it for its own.
    expect(readLoops({ version: 1, loops: [v1("a", ["t1"])] })).toEqual([]);
  });

  it("places each old loop once: its targets' project, else the project open, else none, and never drops one", () => {
    const projectOf = { t1: "p1", t2: "p1", t3: "p2" };
    const placed = placeLoops([v1("same", ["t1", "t2"]), v1("half-gone", ["t1", "gone"]), v1("spread", ["t1", "t3"]), v1("gone", ["gone"])], projectOf, "p9");
    expect(placed.map((l) => [l.id, l.projectId])).toEqual([
      ["same", "p1"],
      ["half-gone", "p1"],
      ["spread", "p9"],
      ["gone", "p9"],
    ]);
    // No project open: placed in none, which every project shows.
    expect(placeLoops([v1("gone", ["gone"])], {}, null)[0].projectId).toBe("");
    expect(placed[0]).toEqual({ ...v1("same", ["t1", "t2"]), projectId: "p1" });
  });

  it("shows a project its own loops, and those of no project it knows", () => {
    const loops = [
      { ...v1("mine", ["t1"]), projectId: "p1" },
      { ...v1("theirs", ["t3"]), projectId: "p2" },
      { ...v1("none", ["gone"]), projectId: "" },
      { ...v1("removed", ["t9"]), projectId: "p-removed" },
    ];
    expect(loopsOf(loops, "p1", ["p1", "p2"]).map((l) => l.id)).toEqual(["mine", "none", "removed"]);
    expect(loopsOf(loops, "p2", ["p1", "p2"]).map((l) => l.id)).toEqual(["theirs", "none", "removed"]);
  });
});
