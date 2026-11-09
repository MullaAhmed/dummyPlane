import { useEffect, useState } from "react";
import { History, X } from "lucide-react";
import type { TerminalPayload } from "@/nodes/types";
import type { TerminalStatus } from "@/store/terminalStatus";
import { resumeOfferOf } from "./pill";
import { relaunchTerminal } from "./registry";
import { useMessages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";

/** Floating card over a stopped terminal (spec habillage §7.3). */
export function ResumeCard(props: { nodeId: string; payload: TerminalPayload; status: TerminalStatus }) {
  const { nodeId, payload, status } = props;
  const t = useMessages(nodesMessages).resumeCard;
  const [dismissed, setDismissed] = useState(false);
  const offer = resumeOfferOf(status, payload.agent, Boolean(payload.claudeSessionId));

  useEffect(() => {
    if (status.state === "running") setDismissed(false);
  }, [status.state]);

  if (!offer || dismissed) return null;
  const resume = offer === "resume";
  return (
    <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-dp-line bg-dp-surface/95 px-3 py-2 text-xs shadow-dp">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition-[color,background-color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 motion-reduce:transition-none"
        onClick={() => relaunchTerminal(nodeId, payload, resume ? "resume" : "new")}
      >
        <History className="size-4 shrink-0 text-dp-accent-ink" />
        <span className="min-w-0">
          <span className="block font-medium text-dp-text">
            {resume ? t.resumeTitle : t.relaunchTitle}
          </span>
          <span className="block truncate text-dp-text-2">
            {resume ? t.resumeHint : payload.oneShot ? t.oneShotHint : t.relaunchHint}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={t.hide}
        className="grid size-7 shrink-0 place-items-center rounded-md text-dp-text-2 transition-[color,background-color,transform] duration-150 ease-out hover:bg-dp-hover hover:text-dp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97] motion-reduce:transition-none"
        onClick={() => setDismissed(true)}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
