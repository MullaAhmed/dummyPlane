import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { canvasStore } from "@/canvas/canvasStore";
import { nodeKindOf } from "@/canvas/nodeElement";
import { signalWire } from "@/canvas/wireActivity";
import { nodesStore } from "@/store/nodes";
import { sceneAccess } from "./sceneAccess";
import { joiningWire, wireReading, withTalkWire } from "./wires";

/**
 * Talk wires: when a message passes between two agents (or a Fleet, or a
 * mission's board) that no wire joins, a dashed wire forms between them, so the
 * canvas shows who talks to whom. It is an element of the scene, saved with it,
 * and no undo step of the user's: an undo takes back what the user did, not
 * the wire a message drew meanwhile. It is never a fleet's link to its team
 * (`fleetTargets` skips it); between two terminals it is an agent link like any
 * wire, so the two can message each other from then on.
 */

/**
 * A message passed from `fromId` to `toId`: the wire that joins them (either
 * way round, of any kind; a Fleet's wire to a group joins it with each of the
 * group's members) shows it, a talk wire drawn first when none does, in their
 * workspace's scene, on screen or stored. Ends: a terminal, a Fleet or a Kanban
 * board, alive. A scene never read, or an end it lacks: only the pulse.
 */
export function talk(fromId: string, toId: string): void {
  if (fromId === toId) return;
  const nodes = nodesStore.getState().nodes;
  const workspaceId = nodes[fromId]?.workspaceId;
  const scene = workspaceId && nodes[toId]?.workspaceId === workspaceId ? sceneAccess(workspaceId) : null;
  if (!scene) {
    signalWire(toId, "toAgent", fromId);
    return;
  }
  let elements = scene.elements();
  let wire = joiningWire(elements, fromId, toId);
  if (!wire) {
    const next = withTalkWire(elements, fromId, toId);
    if (next !== elements) {
      if (scene.shown) canvasStore.getState().api?.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER });
      else scene.write(next);
      elements = next;
      wire = joiningWire(elements, fromId, toId);
    }
  }
  pulse(elements, wire, fromId, toId);
}

/**
 * Lights `wire` for a message from `fromId` to `toId`, read the way the wire's
 * light runs (`wireReading`): a pulse on the wire's far end naming its near
 * one, toward the far end when the message leaves the near one, else back.
 * Over a Fleet's wire to a group, the pulse is the member's, naming the Fleet.
 * No wire: as if one ran from `fromId` to `toId`.
 */
function pulse(elements: readonly ExcalidrawElement[], wire: ExcalidrawArrowElement | null, fromId: string, toId: string) {
  if (!wire?.startBinding || !wire.endBinding) {
    signalWire(toId, "toAgent", fromId);
    return;
  }
  const byId = new Map(elements.map((e) => [e.id, e]));
  const isFleet = (id: string) => {
    const e = byId.get(id);
    return e !== undefined && !e.isDeleted && nodeKindOf(e) === "fleet";
  };
  const { from: near, to: far } = wireReading(wire.startBinding.elementId, wire.endBinding.elementId, isFleet);
  const outward = fromId === near;
  // The far end is one of the two, or the group of the one that is not the Fleet.
  const agent = far === fromId || far === toId ? far : outward ? toId : fromId;
  signalWire(agent, outward ? "toAgent" : "toFleet", near);
}
