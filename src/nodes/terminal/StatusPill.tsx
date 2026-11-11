import { formatDuration } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import type { TerminalReportStatus } from "@/nodes/types";
import type { AgentActivity } from "@/store/agentActivity";
import type { TerminalStatus } from "@/store/terminalStatus";
import { pillActivity, pillOf } from "./pill";
import { DOT_OF_TONE, StatusDot } from "./StatusDot";
import { useMessages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";

/** A status dot and its quiet word: the one look of every status of a node (a header's, a minimized card's, a subagent's). */
export const STATUS_TEXT = "flex shrink-0 items-center gap-2 text-xs text-dp-text-2 tabular-nums";

/**
 * Where an agent stands: its status dot and a quiet word,
 * no pill around them. The tooltip tells how long it has been so.
 * `labelClassName` lets a narrow header take the word back to the screen
 * readers and the tooltip, the dot alone staying. `report` is the agent's last
 * report: once it rests it reads Done, Blocked or Failed (pillOf). `shell`: a plain console, never
 * Working nor Waiting (pillActivity).
 */
export function StatusPill(props: {
  status: TerminalStatus;
  activity?: AgentActivity;
  indigo?: boolean;
  report?: TerminalReportStatus;
  labelClassName?: string;
  shell?: boolean;
}) {
  const { status, activity, indigo, report, labelClassName, shell } = props;
  const now = useNow(15_000);
  const t = useMessages(nodesMessages).pill;
  const running = status.state === "running";
  const pill = pillOf(status, pillActivity(status, activity, shell), indigo, report);
  const title =
    status.state === "error"
      ? status.message
      : running && activity
        ? t.since(pill.label, formatDuration(now - activity.since))
        : labelClassName
          ? pill.label
          : undefined;
  return (
    <span title={title} data-report={pill.report} className={STATUS_TEXT}>
      <StatusDot state={DOT_OF_TONE[pill.tone]} />
      <span className={labelClassName}>{pill.label}</span>
    </span>
  );
}
