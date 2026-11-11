import { NODE_SIZE } from "@/canvas/nodeElement";
import type { FlowTree, Size } from "./flowLayout";
import { COLUMN_GAP, GROUP_GAP } from "./groupLayout";
import type { Point } from "./terminals";

/**
 * A Manager's spawn tree laid out downward (`downLayout`): the Manager on top,
 * its team under it, each agent's own sub-agents under that agent.
 *
 * Siblings sit side by side in rows of at most ROW_SIZE that wrap, not in one
 * row nor in one column: twelve agents read as a 4×3 grid, about a screen's
 * shape, where a stacked column would be twelve terminals tall and a single row
 * twelve terminals wide.
 */

/** Siblings side by side in a row, at most: the next one starts a new row under them. */
export const ROW_SIZE = 4;

/** A tree laid out downward: a flowchart's input, and where each node stands in its box. */
export interface DownTree extends FlowTree {
  /**
   * How far right of its box's left edge each node stands (its quick notes
   * on its left widen the box): its children's rows start at the node's own
   * left edge. A missing one is 0.
   */
  insets?: Readonly<Record<string, number>>;
}

export interface DownLayout {
  /** Top-left corner of each node's box reachable from the root, the root's where it stands. */
  positions: Map<string, Point>;
  /** The row each node below the root sits in under its parent: 0 for the first. */
  rows: Map<string, number>;
}

/** A node and the room its subtree takes. */
interface Cell {
  id: string;
  size: Size;
  inset: number;
  /** Its children, in rows of ROW_SIZE. */
  rows: Cell[][];
  width: number;
  height: number;
}

const rowWidth = (row: readonly Cell[]) => row.reduce((sum, cell) => sum + cell.width, 0) + COLUMN_GAP * Math.max(0, row.length - 1);
const rowHeight = (row: readonly Cell[]) => Math.max(...row.map((cell) => cell.height));

/**
 * Where each node of a tree goes, laid out downward: the root stays; a node's
 * children sit under it in rows of at most ROW_SIZE, left to right in the
 * order given (spawn order), the first row's top GROUP_GAP under the node's
 * box, each next row GROUP_GAP under the bottom of the row above (its tallest
 * child's subtree), every row starting at the node's own left edge. A child
 * takes a cell as wide and tall as its subtree, COLUMN_GAP from the next one,
 * so no two subtrees overlap, and the wires' channels (the middle of each gap
 * between rows, and the riser COLUMN_GAP / 2 left of a node's rows) cross no
 * node. Each node once, at its first occurrence: a cycle cannot loop.
 */
export function downLayout(tree: DownTree): DownLayout {
  const seen = new Set<string>([tree.rootId]);
  const inset = (id: string) => tree.insets?.[id] ?? 0;
  const measure = (id: string, size: Size): Cell => {
    const kids: Cell[] = [];
    for (const childId of tree.children[id] ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      kids.push(measure(childId, tree.sizes[childId] ?? NODE_SIZE.terminal));
    }
    const rows: Cell[][] = [];
    for (let i = 0; i < kids.length; i += ROW_SIZE) rows.push(kids.slice(i, i + ROW_SIZE));
    const width = Math.max(size.width, ...rows.map((row) => inset(id) + rowWidth(row)));
    const height = size.height + rows.reduce((sum, row) => sum + GROUP_GAP + rowHeight(row), 0);
    return { id, size, inset: inset(id), rows, width, height };
  };
  const top = measure(tree.rootId, { width: tree.root.width, height: tree.root.height });

  const positions = new Map<string, Point>();
  const rows = new Map<string, number>();
  const place = (cell: Cell, x: number, y: number) => {
    positions.set(cell.id, { x, y });
    let rowTop = y + cell.size.height + GROUP_GAP;
    cell.rows.forEach((row, r) => {
      let left = x + cell.inset;
      for (const child of row) {
        rows.set(child.id, r);
        place(child, left, rowTop);
        left += child.width + COLUMN_GAP;
      }
      rowTop += rowHeight(row) + GROUP_GAP;
    });
  };
  place(top, tree.root.x, tree.root.y);
  return { positions, rows };
}
