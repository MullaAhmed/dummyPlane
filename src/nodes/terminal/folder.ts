import type { TerminalPayload } from "@/nodes/types";
import type { NodeRecord } from "@/store/nodes";
import { newConversation } from "./launch";

/** Why a node's folder cannot be changed: a Fleet stays in the project, a mission's agent in its worktree. */
export type FolderLock = "fleet" | "mission";

/**
 * Whether the node's folder is fixed. A Fleet creates its mission's branches and
 * worktrees from the project, so it stays in the project's repository. An agent
 * a running mission put in its worktree stays there until the mission ends
 * (`endMission` sends the linked ones back to the project), or its branch would
 * be worked on from another folder.
 */
export function folderLockOf(nodeId: string, nodes: Record<string, NodeRecord>): FolderLock | null {
  const record = nodes[nodeId];
  if (record?.kind === "fleet") return "fleet";
  if (record?.kind !== "terminal") return null;
  const inMission = Object.values(nodes).some(
    (node) => node.kind === "fleet" && node.payload.mission?.state === "en_cours" && node.payload.mission.members.some((member) => member.nodeId === nodeId),
  );
  return inMission ? "mission" : null;
}

/** A path as comparable text: slashes one way, no trailing one, case ignored (the folder pickers return Windows paths with backslashes). */
function comparable(path: string): string {
  const slashed = path.trim().replace(/\\/g, "/");
  const trimmed = slashed.replace(/\/+$/, "");
  return (trimmed || slashed).toLowerCase();
}

/** Whether two paths name the same folder, to a user's eye. */
export function sameFolder(a: string, b: string): boolean {
  return comparable(a) === comparable(b);
}

/**
 * What moving a terminal to `cwd` changes, null when it is already there. Claude
 * keeps its conversations per folder: resuming one from another folder starts
 * nothing (it falls back to the bare shell), so a Claude terminal moves with a
 * conversation of its own, stored with the folder so the two never part. Only
 * that: its model, permission and profile stay as they are.
 */
export function folderChange(payload: TerminalPayload, cwd: string): Partial<TerminalPayload> | null {
  const next = cwd.trim();
  if (!next || sameFolder(next, payload.cwd)) return null;
  return { cwd: next, ...(payload.agent === "claude" ? newConversation() : {}) };
}
