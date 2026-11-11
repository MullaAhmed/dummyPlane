import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { nodeKindOf } from "./nodeElement";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A box joins a row when it overlaps the row's first box by half the smaller height at least. */
function sameRow(first: Box, next: Box): boolean {
  const overlap = Math.min(first.y + first.height, next.y + next.height) - Math.max(first.y, next.y);
  return overlap >= Math.min(first.height, next.height) / 2;
}

/** Reading order: boxes taken from the top, gathered in rows, each row read left to right. */
export function readingOrder<T extends Box>(boxes: readonly T[]): T[] {
  const rows: T[][] = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y)) {
    const row = rows[rows.length - 1];
    if (row && sameRow(row[0], box)) row.push(box);
    else rows.push([box]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/**
 * Ctrl+Tab's order: each frame holding a terminal is a
 * block, blocks in reading order and their members in reading order, then
 * the terminals outside any frame. Rotation is ignored.
 */
export function terminalOrder(elements: readonly ExcalidrawElement[]): string[] {
  const live = elements.filter((e) => !e.isDeleted);
  const frames = new Map(live.filter((e) => e.type === "frame").map((f) => [f.id, f] as const));
  const members = new Map<string, ExcalidrawElement[]>();
  const isolated: ExcalidrawElement[] = [];
  for (const terminal of live.filter((e) => nodeKindOf(e) === "terminal")) {
    const frame = terminal.frameId ? frames.get(terminal.frameId) : undefined;
    if (!frame) {
      isolated.push(terminal);
      continue;
    }
    const list = members.get(frame.id) ?? [];
    list.push(terminal);
    members.set(frame.id, list);
  }
  const blocks = readingOrder([...members.keys()].map((id) => frames.get(id) as ExcalidrawElement));
  return [...blocks.flatMap((block) => readingOrder(members.get(block.id) ?? [])), ...readingOrder(isolated)].map((e) => e.id);
}

/**
 * The terminal after (1) or before (-1) `current`, wrapping around. Without a
 * current terminal, or with one no longer in `order`: the first or the last.
 */
export function stepTerminal(order: readonly string[], current: string | null, direction: 1 | -1): string | null {
  if (order.length === 0) return null;
  const index = current === null ? -1 : order.indexOf(current);
  if (index < 0) return direction === 1 ? order[0] : order[order.length - 1];
  return order[(index + direction + order.length) % order.length];
}
