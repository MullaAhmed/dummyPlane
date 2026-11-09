import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import type { AgentActivity } from "@/store/agentActivity";
import type { TerminalStatus } from "@/store/terminalStatus";
import { pillOf, type PillTone } from "./pill";
import { useMessages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";

const TONES: Record<PillTone, string> = {
  live: "bg-dp-card text-dp-text",
  ready: "bg-dp-card text-dp-text",
  working: "border border-dp-working/70 text-dp-working",
  workingIndigo: "border border-[#707de3]/70 text-[#707de3]",
  waiting: "border border-dp-waiting/70 text-dp-waiting",
  stopped: "bg-dp-card text-dp-text-2",
  done: "border border-dp-done/60 text-dp-done",
  failed: "border border-dp-danger/60 text-dp-danger",
};

const DOTS: Record<PillTone, string> = {
  live: "bg-dp-live",
  ready: "bg-dp-text-2",
  working: "bg-dp-working",
  workingIndigo: "bg-[#707de3]",
  waiting: "bg-dp-waiting animate-pulse",
  stopped: "bg-dp-text-2/60",
  done: "bg-dp-done",
  failed: "bg-dp-danger",
};

/** Spec habillage §7.2; the tooltip tells how long the agent has been in its state (§10.4). */
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
    <span
      title={title}
      className={cn(
        "flex h-4 items-center gap-1 rounded-full px-1.5 font-mono text-[9px] font-medium tracking-wide",
        TONES[pill.tone],
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOTS[pill.tone])} />
      {pill.label}
    </span>
  );
}
