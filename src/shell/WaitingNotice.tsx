import type { ReactNode } from "react";
import { goToAgent } from "@/commands/goToRun";
import { Button } from "@/components/ui/button";
import { useWaitingAgents, type WaitingAgent } from "@/agents/waitingAgents";
import { useMessages } from "@/i18n";
import { useWorkspaces } from "@/store/workspaces";
import { shellMessages } from "./messages";

/** Beyond this, a line counts the others: a tall stack would hide more of the canvas. */
const MAX_ROWS = 3;

/** A row of the notice: at least 32 px, the dot in one column, the text left-aligned and free to take two lines. */
function Row({ agent, children }: { agent: WaitingAgent; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      onClick={() => goToAgent(agent)}
      className="h-auto min-h-8 w-full justify-start gap-2 rounded-md px-2 py-1 text-left text-(length:--text-ui) font-normal whitespace-normal"
    >
      {children}
    </Button>
  );
}

/**
 * Who has a question (spec notification §4): at the bottom left, for as long
 * as an agent waits. The top of the canvas stays to the bars, the bottom right
 * to the toasts; 70 px from the edge clears the tool rail in a short window
 * (the rail ends at 58: 12 in, 4 + 36 + 4 wide, 2 hairlines; then the 12 of a gap).
 * The live region stays mounted: one that appears with its text is not announced.
 */
export function WaitingNotice() {
  const t = useMessages(shellMessages);
  const agents = useWaitingAgents();
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  const hidden = agents.slice(MAX_ROWS);
  return (
    <div aria-live="polite">
      {agents.length > 0 && (
        <section
          data-waiting-notice
          aria-label={t.agentCounts.waiting}
          className="dp-glass-strong absolute bottom-14 left-[70px] z-30 flex w-[260px] animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dp-dur) ease-(--dp-ease-out) motion-reduce:animate-none flex-col rounded-lg p-1"
        >
          {agents.slice(0, MAX_ROWS).map((agent) => (
            <Row key={agent.id} agent={agent}>
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-dp-wait" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{t.waitingNotice.question(agent.name)}</span>
                {agent.message && (
                  <span title={agent.message} className="block truncate text-xs text-dp-text-2">
                    {agent.message}
                  </span>
                )}
              </span>
              {agent.workspaceId !== activeId && (
                <span className="max-w-24 shrink-0 truncate font-mono text-xs text-dp-text-3">
                  {workspaces.find((w) => w.id === agent.workspaceId)?.name}
                </span>
              )}
            </Row>
          ))}
          {hidden.length > 0 && (
            <Row agent={hidden[0]}>
              <span className="pl-4 font-mono text-xs text-dp-text-2">{t.waitingNotice.others(hidden.length)}</span>
            </Row>
          )}
        </section>
      )}
    </div>
  );
}
