import type { Rect } from "@/canvas/groups";
import { overlap } from "./groupLayout";
import type { Point } from "./terminals";

/**
 * The room Arrange (./arrange.ts) makes when what it arranged now covers a
 * block it left alone: a group's Arrange tidies the group where it stands,
 * and a layout that changes the group's shape ("One row" makes a column of
 * terminals one long row) grows its frame over its neighbours; a selection
 * laid out from its corner lands on what was not selected. Those are pushed
 * out of its way (the whole canvas leaves nothing out: every block is laid
 * out, none over another):
 *
 * - Only what grew into a block pushes it: one of the boxes of a block that
 *   moved now covers more of one of its boxes than it did before Arrange. A
 *   block nothing grew into stays exactly where it is, a frame that grew into
 *   nothing changes nothing, and arranging again moves nothing (nothing grows
 *   the second time). An overlap that was there before is left alone, unless
 *   a push makes it worse: then the two are pulled apart, the later one the
 *   shorter way (a pile the frame pushes ends up spread out, not piled).
 * - A pushed block keeps its side: the one that stood to the right goes right,
 *   the one that stood below goes down (right when both), just clear of what
 *   pushed it, by the gap canvas Arrange keeps between the two (`hGap`, `vGap`:
 *   GROUP_GAP beside a group, a node's gap between two lone nodes, the frieze's
 *   ROW_GAP under a terminal). Two that already overlapped: the shorter move of
 *   the two, right on a tie.
 * - What was arranged (`fixed`) never moves: the other block does, the shorter way.
 * - A pushed block pushes in turn, the same way, until nothing grows into
 *   anything. Of two blocks, the one that stood further right (or down) is the
 *   one that moves: a row of neighbours keeps its order and its gaps.
 *
 * Pushes only go right or down. A block moves whole: the caller moves
 * everything that goes with it by its shift. Pure: boxes in, shifts out.
 */

export interface Body {
  /** Its boxes as they stood before Arrange: its frames, and what of it stands outside them. */
  was: readonly Rect[];
  /** The same boxes where Arrange put them; `was` for a block it left alone. */
  now: readonly Rect[];
  /** Arranged by this Arrange: it pushes and is never pushed. */
  fixed: boolean;
}

/** An overlap that grew by less than this (in square pixels) is rounding, not a block in the way. */
const GROWTH = 1;

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;
const moved = (a: Rect, b: Rect) => Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5 || Math.abs(a.width - b.width) > 0.5 || Math.abs(a.height - b.height) > 0.5;

/**
 * How far each body must move (right and down) for nothing to cover what it
 * did not cover before, as above. `bodies` in the order they are looked at:
 * the arranged ones first, then the others in reading order (that order
 * settles which of two that stood on each other moves). Zero for a fixed one.
 */
export function roomMade<T extends Body>(bodies: readonly T[], hGap: (left: T, right: T) => number, vGap: (above: T, below: T) => number): Point[] {
  const shift = bodies.map(() => ({ x: 0, y: 0 }));
  // A body that moved (laid out, or pushed): only a pair with one can have grown into the other.
  const moving = bodies.map((b) => b.fixed && b.now.some((r, k) => moved(r, b.was[k])));
  const box = (i: number, k: number): Rect => {
    const r = bodies[i].now[k];
    return { ...r, x: r.x + shift[i].x, y: r.y + shift[i].y };
  };

  /** Moves `mover` clear of box `ok` of `other`, right, down, or the shorter way. */
  const push = (mover: number, mk: number, other: number, ok: number, way: "right" | "down" | "shorter") => {
    const m = box(mover, mk);
    const o = box(other, ok);
    const dx = right(o) + hGap(bodies[other], bodies[mover]) - m.x;
    const dy = bottom(o) + vGap(bodies[other], bodies[mover]) - m.y;
    if (way === "right" || (way === "shorter" && dx <= dy)) shift[mover].x += dx;
    else shift[mover].y += dy;
    moving[mover] = true;
  };

  /** Box `ak` of `a` grew into box `bk` of `b` (`a` before `b` in the order): the one on the far side moves away. */
  const resolve = (a: number, ak: number, b: number, bk: number) => {
    const was = { a: bodies[a].was[ak], b: bodies[b].was[bk] };
    const [mover, way]: [number, "right" | "down" | "shorter"] =
      was.b.x >= right(was.a) - 0.5
        ? [b, "right"]
        : was.a.x >= right(was.b) - 0.5
          ? [a, "right"]
          : was.b.y >= bottom(was.a) - 0.5
            ? [b, "down"]
            : was.a.y >= bottom(was.b) - 0.5
              ? [a, "down"]
              : [b, "shorter"];
    if (!bodies[mover].fixed) push(mover, mover === a ? ak : bk, mover === a ? b : a, mover === a ? bk : ak, way);
    // What was arranged stays: the other one makes the room, the shorter way.
    else if (mover === a) push(b, bk, a, ak, "shorter");
    else push(a, ak, b, bk, "shorter");
  };

  // Each push is right or down and clears one pair; a chain settles within a round per block it runs through. The cap is a guard.
  for (let round = 0; round <= 2 * bodies.length; round++) {
    let pushed = false;
    for (let a = 0; a < bodies.length; a++) {
      for (let b = a + 1; b < bodies.length; b++) {
        if ((bodies[a].fixed && bodies[b].fixed) || (!moving[a] && !moving[b])) continue;
        for (let ak = 0; ak < bodies[a].now.length; ak++) {
          for (let bk = 0; bk < bodies[b].now.length; bk++) {
            if (overlap(box(a, ak), box(b, bk)) <= overlap(bodies[a].was[ak], bodies[b].was[bk]) + GROWTH) continue;
            resolve(a, ak, b, bk);
            pushed = true;
          }
        }
      }
    }
    if (!pushed) break;
  }
  return shift;
}
