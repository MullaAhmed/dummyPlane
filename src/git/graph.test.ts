import { describe, expect, it } from "vitest";
import { layoutGraph, MAX_LANES, type GraphCommit, type GraphEdge, type GraphRow } from "./graph";

/** `"m: a s"` is commit m with parents a then s. */
const history = (...lines: string[]): GraphCommit[] =>
  lines.map((line) => {
    const [hash, parents = ""] = line.split(":");
    return { hash: hash.trim(), parents: parents.split(" ").filter(Boolean) };
  });

/** A row's lines, short: `in 1>0` is a line from lane 1's top into the dot in column 0. */
const lines = (row: GraphRow) => row.edges.map((e: GraphEdge) => `${e.span} ${e.from}>${e.to}`).sort();

describe("the history's graph", () => {
  it("keeps a straight history in one lane, on HEAD's line", () => {
    const graph = layoutGraph(history("c: b", "b: a", "a"));
    expect(graph.rows.map((row) => row.column)).toEqual([0, 0, 0]);
    expect(graph.rows.map(lines)).toEqual([["out 0>0"], ["in 0>0", "out 0>0"], ["in 0>0"]]);
    expect(graph.rows.every((row) => row.trunk && !row.merge)).toBe(true);
    expect(graph.rows.flatMap((row) => row.edges).every((e) => e.trunk)).toBe(true);
    expect(graph.columns).toBe(1);
    expect(graph.cut).toBe(false);
  });

  it("opens a lane for a merged branch and closes it where the branch began, in the order git gives", () => {
    // `git log --topo-order` on: one, then two on main and s1 on side, merged.
    const graph = layoutGraph(history("merged: two s1", "s1: one", "two: one", "one"));
    const [merged, s1, two, one] = graph.rows;
    expect(merged).toMatchObject({ column: 0, merge: true, trunk: true });
    expect(lines(merged)).toEqual(["out 0>0", "out 0>1"]);
    expect(s1).toMatchObject({ column: 1, merge: false, trunk: false });
    expect(lines(s1)).toEqual(["in 1>1", "out 1>1", "through 0>0"]);
    expect(lines(two)).toEqual(["in 0>0", "out 0>0", "through 1>1"]);
    expect(two.trunk).toBe(true);
    expect(one).toMatchObject({ column: 0, trunk: true });
    expect(lines(one)).toEqual(["in 0>0", "in 1>0"]);
    // HEAD's line is drawn in the full ink, the merged branch is not.
    expect(one.edges.find((e) => e.from === 0)!.trunk).toBe(true);
    expect(one.edges.find((e) => e.from === 1)!.trunk).toBe(false);
    expect(graph.columns).toBe(2);
  });

  it("lays out the same branch with its commits interleaved by date", () => {
    const graph = layoutGraph(history("merged: two s1", "two: one", "s1: one", "one"));
    expect(graph.rows.map((row) => row.column)).toEqual([0, 0, 1, 0]);
    expect(lines(graph.rows[1])).toEqual(["in 0>0", "out 0>0", "through 1>1"]);
    expect(lines(graph.rows[2])).toEqual(["in 1>1", "out 1>1", "through 0>0"]);
    expect(lines(graph.rows[3])).toEqual(["in 0>0", "in 1>0"]);
  });

  it("gives each parent of an octopus merge its own lane, and brings them back together", () => {
    const graph = layoutGraph(history("m: a b c", "c: r", "b: r", "a: r", "r"));
    expect(lines(graph.rows[0])).toEqual(["out 0>0", "out 0>1", "out 0>2"]);
    expect(graph.rows.map((row) => row.column)).toEqual([0, 2, 1, 0, 0]);
    expect(lines(graph.rows[4])).toEqual(["in 0>0", "in 1>0", "in 2>0"]);
    expect(graph.columns).toBe(3);
  });

  it("holds no lane for a parent past the cap: its line ends under the dot", () => {
    // `x` and `y` were not loaded: the history stopped before them.
    const graph = layoutGraph(history("m: a x", "a: y"));
    const [m, a] = graph.rows;
    expect(m).toMatchObject({ merge: true, cutFirst: false, cutOther: true });
    expect(lines(m)).toEqual(["out 0>0"]);
    expect(a).toMatchObject({ cutFirst: true, cutOther: false });
    expect(lines(a)).toEqual(["in 0>0"]);
    expect(graph.columns).toBe(1);
    expect(graph.cut).toBe(true);
  });

  it("treats a parent listed above its child as not loaded, rather than waiting for it forever", () => {
    const graph = layoutGraph(history("a", "b: a"));
    expect(graph.rows[1].cutFirst).toBe(true);
    expect(graph.rows[1].edges).toEqual([]);
  });

  it("reuses a lane a branch left, so the graph stays narrow", () => {
    const graph = layoutGraph(history("m2: m1 s2", "s2: m1", "m1: r s1", "s1: r", "r"));
    expect(graph.rows.map((row) => row.column)).toEqual([0, 1, 0, 1, 0]);
    expect(lines(graph.rows[2])).toEqual(["in 0>0", "in 1>0", "out 0>0", "out 0>1"]);
    expect(graph.columns).toBe(2);
  });

  it("joins a merged parent to the lane already heading for it", () => {
    // Both merges take `s`: the second meets the lane the first opened.
    const graph = layoutGraph(history("m2: m1 s", "m1: r s", "s: r", "r"));
    expect(lines(graph.rows[1])).toEqual(["in 0>0", "out 0>0", "out 0>1", "through 1>1"]);
    expect(graph.rows[1].edges.filter((e) => e.span === "out" && e.to === 1)).toHaveLength(1);
    expect(graph.rows[2].column).toBe(1);
    expect(graph.columns).toBe(2);
  });

  it("folds the lanes past the cap into one dashed column instead of growing", () => {
    const branches = Array.from({ length: 12 }, (_, n) => `b${n}`);
    const graph = layoutGraph(history(`m: ${branches.join(" ")}`, ...branches.reverse().map((b) => `${b}: r`), "r"));
    expect(graph.columns).toBe(MAX_LANES + 1);
    const edges = graph.rows.flatMap((row) => row.edges);
    expect(Math.max(...edges.flatMap((e) => [e.from, e.to]), ...graph.rows.map((row) => row.column))).toBe(MAX_LANES);
    expect(edges.filter((e) => e.folded).every((e) => e.lane >= MAX_LANES)).toBe(true);
    expect(edges.some((e) => e.folded)).toBe(true);
    expect(edges.filter((e) => e.lane < MAX_LANES).every((e) => !e.folded)).toBe(true);
  });

  it("keeps HEAD's line apart from an unrelated history that reuses its lane", () => {
    const graph = layoutGraph(history("a: b", "b", "c: d", "d"));
    expect(graph.rows.map((row) => [row.column, row.trunk])).toEqual([
      [0, true],
      [0, true],
      [0, false],
      [0, false],
    ]);
    expect(graph.rows[2].edges.every((e) => !e.trunk)).toBe(true);
  });

  it("lays out nothing for an empty history", () => {
    expect(layoutGraph([])).toEqual({ rows: [], columns: 0, cut: false });
  });
});
