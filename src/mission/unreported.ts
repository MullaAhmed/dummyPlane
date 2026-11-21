import { outAgentState, outReport } from "@/mcp/protocol";
import { isRestarting } from "@/store/terminalStatus";
import type { Mission } from "./mission";
import { agentState } from "./store";

/**
 * The team's members whose work is not "done" on the record, and how each stands: what `merge` names when it has nothing
 * to merge, so that an agent finished without reporting (idle at its prompt) is told from one still at work.
 */
export function unreported(mission: Mission): { name: string; how: string }[] {
  return mission.members
    .filter((m) => !m.handedTo && !m.abandoned && !m.cleanedUp && m.report?.status !== "termine")
    .map((m) => ({ name: m.name, how: m.report ? outReport(m.report.status) : outAgentState(agentState(m.nodeId), isRestarting(m.nodeId)) }));
}
