/**
 * How Arrange lays the canvas out (./arrange.ts), a setting
 * (src/app/arrangeLayoutSetting.ts): Arrange, a group's Arrange and
 * Auto-arrange all follow it. Kept free of imports so the setting, the menu
 * and the layout read it without pulling the canvas in.
 *
 * - `grid`: the tidy grid, packed to the view's shape (the default, as before).
 * - `row`: everything side by side, in one row.
 * - `column`: everything one under the other, in one column.
 * - `columns-N`: N side by side per row, the next ones in rows under them.
 * - `tree`: who opened whom, downward: each spawn tree from its root, its
 *   children in rows under it (a mission's team's shape, ./treeLayout.ts), and
 *   what a wire joins (a Fleet and its groups, an agent and its board) hung
 *   under its other end; what nothing joins stands as a root of its own, the
 *   roots side by side, packed to the view's shape (./arrangeTree.ts).
 *
 * Inside a group, its grid of terminals follows it as well: one row, one
 * column, or N columns, still filled top to bottom then left to right; or, for
 * the tree, its members as a tree.
 */

/** The column counts offered. */
export const COLUMN_COUNTS = [2, 3, 4] as const;
export type ColumnCount = (typeof COLUMN_COUNTS)[number];

export type ArrangeLayout = "grid" | "row" | "column" | `columns-${ColumnCount}` | "tree";

/** Every layout, in the order the Settings menu offers them. */
export const ARRANGE_LAYOUTS: readonly ArrangeLayout[] = ["grid", "row", "column", ...COLUMN_COUNTS.map((n) => `columns-${n}` as const), "tree"];

export const DEFAULT_ARRANGE_LAYOUT: ArrangeLayout = "grid";

/** A saved or chosen value, else the default. */
export function readArrangeLayout(raw: unknown): ArrangeLayout {
  return ARRANGE_LAYOUTS.find((layout) => layout === raw) ?? DEFAULT_ARRANGE_LAYOUT;
}

/** How many blocks a row of the canvas holds at most: null for the grid, which packs to the view's shape (the tree's roots too). */
export function perRowOf(layout: ArrangeLayout): number | null {
  if (layout === "grid" || layout === "tree") return null;
  if (layout === "row") return Infinity;
  if (layout === "column") return 1;
  return Number(layout.slice("columns-".length));
}

/**
 * The heights of a group's columns, left to right, for `count` pieces filled
 * top to bottom: the grid's columns of `maxRows`, the last one shorter; one row
 * (columns of one); one column; or N columns as even as they go (4 pieces in
 * 3 columns: 2, 1, 1), so N columns always show when there are N pieces or more.
 */
export function columnHeightsOf(count: number, layout: ArrangeLayout, maxRows: number): number[] {
  if (count <= 0) return [];
  if (layout === "column") return [count];
  if (layout === "row") return Array.from({ length: count }, () => 1);
  // The tree lays a group out as a tree (./arrangeTree.ts); asked for columns all the same, the grid's.
  if (layout === "grid" || layout === "tree") {
    const rows = Math.min(count, maxRows);
    return Array.from({ length: Math.ceil(count / rows) }, (_, c) => Math.min(rows, count - c * rows));
  }
  const columns = Math.min(perRowOf(layout)!, count);
  return Array.from({ length: columns }, (_, c) => Math.floor(count / columns) + (c < count % columns ? 1 : 0));
}
