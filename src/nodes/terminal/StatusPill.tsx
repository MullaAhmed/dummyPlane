import { formatDuration } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import type { AgentActivity } from "@/store/agentActivity";
import type { TerminalStatus } from "@/store/terminalStatus";
import { pillOf } from "./pill";
import { DOT_OF_TONE, StatusDot } from "./StatusDot";
import { useMessages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";

/**
 * Where an agent stands (spec habillage §7.2): its status dot and a quiet word,
 * no pill around them. The tooltip tells how long it has been so (§10.4).
 */
export function StatusPill(props: { status: TerminalStatus; activity?: AgentActivity; indigo?: boolean }) {
  const { status, activity, indigo } = props;
  const now = useNow(15_000);
  const t = useMessages(nodesMessages).pill;
  const running = status.state === "running";
  const pill = pillOf(status, running ? activity?.activity : undefined, indigo);
  const title =
    status.state === "error"
      ? status.message
      : running && activity
        ? t.since(pill.label, formatDuration(now - activity.since))
        : undefined;
  return (
    <span title={title} className="flex shrink-0 items-center gap-2 text-xs text-dp-text-2 tabular-nums">
      <StatusDot state={DOT_OF_TONE[pill.tone]} />
      {pill.label}
    </span>
  );
}
