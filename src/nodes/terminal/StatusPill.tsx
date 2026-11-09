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
  working: "border border-dp-accent/70 text-dp-accent-ink",
  workingIndigo: "border border-dp-accent/70 text-dp-accent-ink",
  waiting: "border border-dp-wait/70 text-dp-wait",
  stopped: "bg-dp-card text-dp-text-2",
  done: "border border-dp-ok/60 text-dp-ok",
  failed: "border border-dp-danger/60 text-dp-danger",
};

const DOTS: Record<PillTone, string> = {
  live: "bg-dp-ok",
  ready: "bg-dp-text-2",
  working: "bg-dp-accent",
  workingIndigo: "bg-dp-accent",
  waiting: "bg-dp-wait animate-pulse motion-reduce:animate-none",
  stopped: "bg-dp-text-2/60",
  done: "bg-dp-ok",
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
