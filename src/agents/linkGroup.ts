import { newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { groupInfoOf } from "@/canvas/groups";
import { nodeKindOf } from "@/canvas/nodeElement";
import { placeOutput } from "@/nodes/output/placement";
import { anchorsOf } from "./attachments";
import { overlap } from "./groupLayout";
import { groupingOf, withNewGroup } from "./selectionGroup";
import { spawnTreeOf, type ParentOf } from "./spawnLayout";
import { placeTerminal } from "./terminals";
import { rerouteWires } from "./wires";

/**
 * Two agents the user links (./agentLinks.ts) become a group: the wire says they
 * work together, the group keeps them together on the canvas.
 *
 * - Both in no group: a new group around them where they stand, as "Group" makes
 *   it for a selection (`groupingOf`, `withNewGroup`). When something stands
 *   between them, the group is made around the first one, and the other joins it
 *   (else around the other one, the first joining it).
 * - One in a group: the other joins it, in the first free cell of its grid, as a
 *   new agent of the group does (`placeTerminal`); its outputs come with it.
 *   Never when the frame, grown, would cover a node or a group outside it.
 * - Both in the same group: nothing more.
 * - In two groups: never merged. They are linked, each in its own group, and the
 *   user is told why.
 *
 * Nor does a group take an agent that would leave its spawn tree behind (Arrange
 * leaves a group whose tree reaches out of its frame as it stands), a mission's
 * Manager, an agent into a mission's group (it would close with the mission), nor
 * one out of a frame drawn by hand: linked all the same, the user is told why.
 */

/** Why two linked agents were not made a group, with what the notice names (node ids for agents, names for groups). */
export type NotGrouped =
  | { reason: "otherGroups"; groups: [string, string] }
  | { reason: "inTheWay" }
  | { reason: "family" | "mission" | "frame"; agent: string };

/** What a link did besides the wire: made or grew a group, nothing more (same group), or nothing, and why. */
export type LinkOutcome = { kind: "grouped"; groupId: string } | { kind: "linked" } | ({ kind: "notGrouped" } & NotGrouped);

export interface LinkGroupOptions {
  /** The set the names of a new group's agents come from: one no group uses. */
  pantheon: () => string;
  /** Who spawned a node (`spawnedBy`). */
  parentOf: ParentOf;
  /** A mission's Manager: it keeps its mission's group. */
  isManager: (nodeId: string) => boolean;
  /** The groups a mission keeps for its team: closed with it. */
  missionGroups: ReadonlySet<string>;
}

const notGrouped = (why: NotGrouped): LinkOutcome => ({ kind: "notGrouped", ...why });

/**
 * `elements` with agents `fromId` and `toId` (live terminals) in one group, as
 * above, in one scene, and what was done. The wire between them is the
 * caller's, drawn after: it then runs between where they stand at the end.
 */
export function withLinkGroup(elements: readonly ExcalidrawElement[], fromId: string, toId: string, options: LinkGroupOptions): { elements: readonly ExcalidrawElement[]; outcome: LinkOutcome } {
  const byId = new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const from = byId.get(fromId);
  const to = byId.get(toId);
  const kept = (why: NotGrouped) => ({ elements, outcome: notGrouped(why) });
  if (!from || !to || fromId === toId) return { elements, outcome: { kind: "linked" } };
  const frameOf = (e: ExcalidrawElement) => (e.frameId ? byId.get(e.frameId) : undefined);
  const groupOf = (e: ExcalidrawElement) => {
    const frame = frameOf(e);
    return frame && groupInfoOf(frame) ? frame : undefined;
  };
  const fromGroup = groupOf(from);
  const toGroup = groupOf(to);
  if (fromGroup && toGroup) {
    const nameOf = (frame: ExcalidrawElement) => (frame.type === "frame" ? (frame.name ?? "") : "");
    return fromGroup.id === toGroup.id ? { elements, outcome: { kind: "linked" } } : kept({ reason: "otherGroups", groups: [nameOf(fromGroup), nameOf(toGroup)] });
  }
  for (const agent of [from, to]) if (agent.frameId && !groupOf(agent)) return kept({ reason: "frame", agent: agent.id });
  for (const agent of [from, to]) if (options.isManager(agent.id)) return kept({ reason: "mission", agent: agent.id });

  // One in a group: the other joins it.
  const group = fromGroup ?? toGroup;
  if (group) {
    const [member, joiner] = fromGroup ? [from, to] : [to, from];
    if (options.missionGroups.has(group.id)) return kept({ reason: "mission", agent: member.id });
    const stay = new Set(elements.filter((e) => !e.isDeleted && e.frameId === group.id).map((e) => e.id));
    const split = splitFamily(elements, [joiner.id], stay, options.parentOf);
    if (split) return kept({ reason: "family", agent: split });
    const next = joined(elements, joiner, group.id);
    return next ? { elements: next, outcome: { kind: "grouped", groupId: group.id } } : kept({ reason: "inTheWay" });
  }

  // Both in no group: a new one, where they stand when nothing is in its way; else around one of them, the other
  // joining it (the first one's group, then the other's), when that covers nothing either.
  const split = splitFamily(elements, [fromId, toId], new Set(), options.parentOf);
  if (split) return kept({ reason: "family", agent: split });
  if (!groupingOf(elements, [fromId, toId]).blocked) {
    const made = withNewGroup(elements, [from, to], options.pantheon());
    return { elements: made.elements, outcome: { kind: "grouped", groupId: made.frame.id } };
  }
  for (const [first, other] of [
    [from, to],
    [to, from],
  ]) {
    if (groupingOf(elements, [first.id]).blocked) continue;
    const made = withNewGroup(elements, [first], options.pantheon());
    const next = joined(made.elements, other, made.frame.id);
    if (next) return { elements: next, outcome: { kind: "grouped", groupId: made.frame.id } };
  }
  return kept({ reason: "inTheWay" });
}

/**
 * The first of `moving` whose spawn tree a group of `moving` and `staying` would
 * split: one of its relatives (its spawner, a sub-agent of it…) neither moves
 * with it nor is in that group. Null when none would.
 */
function splitFamily(elements: readonly ExcalidrawElement[], moving: readonly string[], staying: ReadonlySet<string>, parentOf: ParentOf): string | null {
  const together = new Set([...moving, ...staying]);
  for (const id of moving) {
    const tree = spawnTreeOf(elements, parentOf, id);
    if (tree && [...tree.ids].some((relative) => !together.has(relative))) return id;
  }
  return null;
}

/**
 * `elements` with terminal `joiner` in the group `groupId`: in the first free
 * cell of its grid, the frame grown if it was full and unfolded (`placeTerminal`,
 * as for a new agent of the group, a folded group's terminals unlocked). The
 * outputs it showed come with it, each beside it in the group (`placeOutput`).
 * The wires of what moved, and of the frame (a Fleet's), are routed again.
 * Null when the frame, grown, would cover a node or a frame it did not cover
 * before: the grid's free cells are counted inside the frame only.
 */
function joined(elements: readonly ExcalidrawElement[], joiner: ExcalidrawElement, groupId: string): readonly ExcalidrawElement[] | null {
  const frameBefore = elements.find((e) => e.id === groupId);
  if (!frameBefore) return null;
  const folded = groupInfoOf(frameBefore)?.folded === true;
  const unlocked = folded ? elements.map((e) => (e.frameId === groupId && e.locked && nodeKindOf(e) === "terminal" ? newElementWith(e, { locked: false }) : e)) : elements;
  let next: readonly ExcalidrawElement[] = placeTerminal(
    unlocked.filter((e) => e.id !== joiner.id),
    joiner,
    groupId,
  );
  const attachedTo = anchorsOf(next);
  const outputs = next.filter((e) => !e.isDeleted && nodeKindOf(e) === "output" && attachedTo(e)?.anchor === joiner.id);
  for (const output of outputs) {
    next = placeOutput(
      next.filter((e) => e.id !== output.id),
      output,
      joiner.id,
    );
  }
  // What stays outside the group, where it stands: the frame, grown, must not cover it.
  const moving = new Set([joiner.id, ...outputs.map((o) => o.id)]);
  const anchorOf = anchorsOf(elements);
  const inGroup = (id: string) => id === joiner.id || elements.some((e) => e.id === id && e.frameId === groupId);
  const outside = elements.filter((e) => {
    if (e.isDeleted || e.id === groupId || moving.has(e.id) || e.frameId === groupId) return false;
    if (nodeKindOf(e) === null && e.type !== "frame") return false;
    // A member's quick note stands beside it, in no frame: it goes where its host goes.
    const attachment = anchorOf(e);
    return !(attachment?.beside === true && inGroup(attachment.anchor));
  });
  const frameAfter = next.find((e) => e.id === groupId);
  if (!frameAfter || outside.some((e) => overlap(e, frameAfter) > 0 && overlap(e, frameBefore) === 0)) return null;
  return rerouteWires(next, new Set([joiner.id, groupId, ...outputs.map((o) => o.id)]));
}
