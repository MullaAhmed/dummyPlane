import type { Rect } from "@/canvas/groups";
import { NODE_SIZE } from "@/canvas/nodeElement";
import { GAP, GROUP_GAP } from "./groupLayout";
import type { Point } from "./terminals";

export interface Size {
  width: number;
  height: number;
}

/** A tree of agents spawned by agents, as the flowchart lays it out. */
export interface FlowTree {
  rootId: string;
  /** The root as it stands: it never moves. */
  root: Rect;
  /** Each node's children, top to bottom. A node absent from the map has none. */
  children: Readonly<Record<string, readonly string[]>>;
  /** Size of each node below the root; a missing one is NODE_SIZE.terminal. */
  sizes: Readonly<Record<string, Size>>;
}

interface Placed {
  id: string;
  depth: number;
  size: Size;
  children: Placed[];
  /** Height of the vertical band its subtree takes. */
  band: number;
}

/**
 * The tree as it is walked: each node once, at its first occurrence in the
 * children lists; a child that is already placed (an ancestor, a node listed
 * twice) is left out, so a cycle cannot loop.
 */
function walk(tree: FlowTree): Placed {
  const seen = new Set<string>([tree.rootId]);
  const visit = (id: string, depth: number, size: Size): Placed => {
    const children: Placed[] = [];
    for (const childId of tree.children[id] ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      children.push(visit(childId, depth + 1, tree.sizes[childId] ?? NODE_SIZE.terminal));
    }
    const stacked = children.reduce((sum, child) => sum + child.band, 0) + GAP * Math.max(0, children.length - 1);
    return { id, depth, size, children, band: Math.max(size.height, stacked) };
  };
  return visit(tree.rootId, 0, { width: tree.root.width, height: tree.root.height });
}

/**
 * Where each node of a spawn tree goes, as a flowchart read left to right: a
 * node's depth is its column, GROUP_GAP right of the widest node of the column
 * before, so columns never overlap. Siblings stack in one column, GAP apart,
 * the first one level with its parent's top; each subtree keeps its own band
 * of height, so no two subtrees overlap. Top-left corners of every node
 * reachable from the root, the root included where it stands.
 */
export function flowLayout(tree: FlowTree): Map<string, Point> {
  const top = walk(tree);
  // Widest node of each depth, then the x of each column.
  const widths: number[] = [];
  const measure = (node: Placed) => {
    widths[node.depth] = Math.max(widths[node.depth] ?? 0, node.size.width);
    node.children.forEach(measure);
  };
  measure(top);
  const columns = [tree.root.x];
  for (let depth = 1; depth < widths.length; depth++) columns.push(columns[depth - 1] + widths[depth - 1] + GROUP_GAP);

  const positions = new Map<string, Point>();
  const place = (node: Placed, y: number) => {
    positions.set(node.id, { x: columns[node.depth], y });
    let next = y;
    for (const child of node.children) {
      place(child, next);
      next += child.band + GAP;
    }
  };
  place(top, tree.root.y);
  return positions;
}
