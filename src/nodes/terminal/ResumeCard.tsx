import { useEffect, useState } from "react";
import { History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-dp-line bg-dp-surface px-3 py-2 text-xs shadow-dp">
      {/* The whole text is the button: a row, so no press scale; its hover fill reaches past the text, which stays in place. */}
      <Button
        type="button"
        variant="ghost"
        className="-my-1 -ml-1.5 h-auto min-w-0 flex-1 justify-start gap-2 rounded-md px-1.5 py-1 text-left text-xs font-normal whitespace-normal active:scale-100"
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
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t.hide} className="rounded-md text-dp-text-2 hover:text-dp-text" onClick={() => setDismissed(true)}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
