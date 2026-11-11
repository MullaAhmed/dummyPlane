/**
 * The history's graph, laid out like `git log --graph`: each commit gets
 * a lane, and the lines between a commit and its parents are routed one row at a time, so each
 * row draws itself alone. Pure: the History tab lays a history out once per read, then only draws.
 */

/** What the layout needs of a commit. The history comes children first (`git log --topo-order`). */
export interface GraphCommit {
  hash: string;
  parents: readonly string[];
}

/** Lanes drawn side by side. Any lane past them is folded into one more column, drawn dashed. */
export const MAX_LANES = 8;

/**
 * A line in one row. `through` crosses the row top to bottom in its lane; `in` comes from the top
 * of a lane into the commit's dot; `out` leaves the dot for the bottom of a lane, toward a parent.
 */
export interface GraphEdge {
  span: "through" | "in" | "out";
  /** The column it starts in: at the top of the row, or the dot's. */
  from: number;
  /** The column it ends in: the dot's, or at the bottom of the row. */
  to: number;
  /** The lane the line belongs to, which sets its tone. */
  lane: number;
  /** On HEAD's own line, its first parents: drawn in the full ink. */
  trunk: boolean;
  /** Its lane is past `MAX_LANES`, folded into the last column. */
  folded: boolean;
}

export interface GraphRow {
  /** The column of the commit's dot. */
  column: number;
  lane: number;
  /** On HEAD's own line. */
  trunk: boolean;
  /** More than one parent: a hollow dot. */
  merge: boolean;
  edges: GraphEdge[];
  /** The first parent is not in the history (past the cap): a short line that ends, and no lane held for it. */
  cutFirst: boolean;
  /** A merged parent is not in the history either. */
  cutOther: boolean;
}

export interface Graph {
  rows: GraphRow[];
  /** The columns of the widest row: every row is drawn this wide, so the subjects line up. */
  columns: number;
  /** Some parent is not in the history: older commits are left out. */
  cut: boolean;
}

/** What a lane is heading for: the commit it waits for, and whether it is HEAD's own line. */
interface Track {
  hash: string;
  trunk: boolean;
}

const columnOf = (lane: number) => Math.min(lane, MAX_LANES);

/** The lowest lane a line left, or a new one: freed lanes are reused, so the graph stays narrow. */
function freeLane(lanes: (Track | null)[]): number {
  const free = lanes.indexOf(null);
  return free === -1 ? lanes.length : free;
}

/** The first-parent line from the first commit (HEAD), as far as the history goes. */
function trunkOf(commits: readonly GraphCommit[], rowOf: Map<string, number>): Set<string> {
  const trunk = new Set<string>();
  let row: number | undefined = commits.length > 0 ? 0 : undefined;
  while (row !== undefined) {
    const commit = commits[row];
    trunk.add(commit.hash);
    const first = commit.parents[0];
    const next = first === undefined ? undefined : rowOf.get(first);
    row = next !== undefined && next > row ? next : undefined;
  }
  return trunk;
}

/**
 * Lays a history out, children before parents. Lanes never move once given, so a line that only
 * passes through a row is straight; only the lines that reach or leave a dot bend. A parent the
 * history does not hold (past the cap, or a parent listed above its child) holds no lane: its line
 * ends under the dot.
 */
export function layoutGraph(commits: readonly GraphCommit[]): Graph {
  const rowOf = new Map<string, number>();
  commits.forEach((commit, row) => {
    if (!rowOf.has(commit.hash)) rowOf.set(commit.hash, row);
  });
  const trunk = trunkOf(commits, rowOf);
  const lanes: (Track | null)[] = [];
  const rows: GraphRow[] = [];
  let columns = 0;
  let cut = false;

  commits.forEach((commit, row) => {
    const held = (parent: string) => (rowOf.get(parent) ?? -1) > row;
    const edge = (span: GraphEdge["span"], from: number, to: number, lane: number, onTrunk: boolean): GraphEdge => ({
      span,
      from: columnOf(from),
      to: columnOf(to),
      lane,
      trunk: onTrunk,
      folded: lane >= MAX_LANES,
    });

    // Every lane waiting for this commit meets at its dot; HEAD's line keeps its own lane.
    const incoming = lanes.flatMap((track, lane) => (track?.hash === commit.hash ? [lane] : []));
    const lane = incoming.find((at) => lanes[at]?.trunk) ?? incoming[0] ?? freeLane(lanes);
    const edges: GraphEdge[] = [];
    lanes.forEach((track, at) => {
      if (!track) return;
      edges.push(track.hash === commit.hash ? edge("in", at, lane, at, track.trunk) : edge("through", at, at, at, track.trunk));
    });
    for (const at of incoming) lanes[at] = null;

    const onTrunk = trunk.has(commit.hash);
    let cutFirst = false;
    let cutOther = false;
    for (const [n, parent] of commit.parents.entries()) {
      if (!held(parent)) {
        if (n === 0) cutFirst = true;
        else cutOther = true;
      } else if (n === 0) {
        // The first parent carries on in the commit's lane, even when another lane waits for it
        // too: the two meet at the parent, where the branch began.
        lanes[lane] = { hash: parent, trunk: onTrunk };
        edges.push(edge("out", lane, lane, lane, onTrunk));
      } else {
        // A merged parent joins the lane already heading there, or opens one.
        const waiting = lanes.findIndex((track) => track?.hash === parent);
        const target = waiting === -1 ? freeLane(lanes) : waiting;
        if (waiting === -1) lanes[target] = { hash: parent, trunk: false };
        edges.push(edge("out", lane, target, target, false));
      }
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const column = columnOf(lane);
    columns = Math.max(columns, column + 1, ...edges.map((e) => Math.max(e.from, e.to) + 1));
    cut = cut || cutFirst || cutOther;
    rows.push({ column, lane, trunk: onTrunk, merge: commit.parents.length > 1, edges, cutFirst, cutOther });
  });

  return { rows, columns, cut };
}
