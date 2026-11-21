import type { TerminalReportStatus } from "@/nodes/types";
import { useActivity } from "@/store/agentActivity";
import { terminalOf, useNodes } from "@/store/nodes";
import { useTerminalStatus } from "@/store/terminalStatus";
import { pillActivity, pillOf } from "./pill";
import { DOT_OF_TONE, StatusDot } from "./StatusDot";

/**
 * A terminal's status dot read from its node, the one its header's StatusPill
 * shows (`pillOf`): for a row that says the state in its own words, such as a
 * mission's team. Beside those words it is decoration, hidden from screen readers.
 * `report`: the report the row itself says, which wins over the node's own: a
 * Manager's record gives a member its report without the agent writing one.
 */
export function AgentDot({ nodeId, report }: { nodeId: string; report?: TerminalReportStatus }) {
  const status = useTerminalStatus(nodeId);
  const activity = useActivity(nodeId);
  const payload = useNodes((s) => terminalOf(s.nodes[nodeId]));
  const said = report ?? payload?.lastReport?.status;
  const pill = pillOf(status, pillActivity(status, activity, payload?.agent === "shell"), false, said, payload?.stoppedFinished === true);
  return <StatusDot state={DOT_OF_TONE[pill.tone]} />;
}
