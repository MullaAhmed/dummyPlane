import { isManagerRecord, terminalOf, type NodeRecord } from "@/store/nodes";
import type { TerminalStatus } from "@/store/terminalStatus";

/**
 * A spawn_agent sub-agent that reported (`lastReport`, kept with its node until new work typed into it clears it):
 * its task is done, and after a restart it stays stopped on its saved screen instead of taking memory again. Only
 * a click on its own node brings it back. A mission's team is the Manager's sub-agents: its members stay as they are
 * (`spawnedAtWork` draws the same line), and so does a member whose Manager is gone, found in its Fleet's mission.
 */
export function isFinishedSubAgent(nodes: Record<string, NodeRecord>, id: string): boolean {
  const payload = terminalOf(nodes[id]);
  if (!payload?.spawnedBy || !payload.lastReport) return false;
  if (isManagerRecord(nodes[payload.spawnedBy])) return false;
  return !Object.values(nodes).some((record) => record.kind === "fleet" && record.payload.mission?.members.some((member) => member.nodeId === id));
}

/** What "Resume all" offers: the terminals it resumes, and the finished sub-agents it leaves stopped. */
export interface ResumeOffer {
  resume: string[];
  stayStopped: string[];
}

/**
 * Terminals restored stopped that can pick their conversation back up. A terminal never shown yet has no status: it counts as stopped,
 * unless its process still runs in Rust (webview reload). Only terminals on the
 * canvas count: a closed one keeps its record in memory for undo. Finished sub-agents (`isFinishedSubAgent`) are
 * set apart: the offer names them, and leaves them stopped.
 */
export function resumeOfferOf(
  nodes: Record<string, NodeRecord>,
  statuses: Record<string, TerminalStatus>,
  workspaceId: string,
  alive: ReadonlySet<string>,
  onScene: ReadonlySet<string>,
): ResumeOffer {
  const stopped = Object.entries(nodes)
    .filter(
      ([id, node]) =>
        node.workspaceId === workspaceId &&
        node.kind === "terminal" &&
        !node.payload.oneShot &&
        onScene.has(id) &&
        !alive.has(id) &&
        (statuses[id]?.state ?? "stopped") === "stopped",
    )
    .map(([id]) => id);
  return {
    resume: stopped.filter((id) => !isFinishedSubAgent(nodes, id)),
    stayStopped: stopped.filter((id) => isFinishedSubAgent(nodes, id)),
  };
}

/** The terminals "Resume all" resumes (`resumeOfferOf`). */
export function resumableTerminals(
  nodes: Record<string, NodeRecord>,
  statuses: Record<string, TerminalStatus>,
  workspaceId: string,
  alive: ReadonlySet<string>,
  onScene: ReadonlySet<string>,
): string[] {
  return resumeOfferOf(nodes, statuses, workspaceId, alive, onScene).resume;
}
