import type { CSSProperties, ReactNode } from "react";
import { goToAgent } from "@/commands/goToRun";
import { Button } from "@/components/ui/button";
import { useWaitingAgents, type WaitingAgent } from "@/agents/waitingAgents";
import { useMessages } from "@/i18n";
import { StatusDot } from "@/nodes/terminal/StatusDot";
import { useWorkspaces } from "@/store/workspaces";
import { BOTTOM_GUTTER, BOTTOM_STACK_GAP, COMMAND_BAR_MIN_HEIGHT, LOOPS_ROOM_PROPERTY, WAITING_NOTICE_BOTTOM, WAITING_NOTICE_LEFT } from "./layout";
import { useCornerCovered } from "./lane";
import { shellMessages } from "./messages";

/** Beyond this, a line counts the others: a tall stack would hide more of the canvas. */
const MAX_ROWS = 3;

/** The foot of the notice: the corner's stack (`layout.ts`), above the loops pill while one shows. */
const STANDING = `calc(${WAITING_NOTICE_BOTTOM}px + var(${LOOPS_ROOM_PROPERTY}, 0px))`;
/** Below 1,340 px the command bar reaches the notice's column: it stands one gap above the band as well, whatever the bar's lines. */
const ABOVE_BAND = `calc(var(--dp-bottom-band, ${COMMAND_BAR_MIN_HEIGHT}px) + ${BOTTOM_GUTTER + BOTTOM_STACK_GAP}px)`;
const PLACE = {
  left: WAITING_NOTICE_LEFT,
  "--dp-notice-bottom": STANDING,
  "--dp-notice-bottom-narrow": `max(${STANDING}, ${ABOVE_BAND})`,
} as CSSProperties;

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
 * Who has a question: at the bottom left, for as long
 * as an agent waits, in the corner's stack (`layout.ts`): above the git chip and the loops pill. Below 1,340 px the
 * centred command bar reaches its column: there it also rises 8 px above the command band (`--dp-bottom-band`,
 * ProjectView). The top of the canvas stays to the bars, the bottom right to the toasts; 70 px from the edge clears the
 * tool rail in a short window. It stands on the layer under the work windows (git, review: z-20): where one reaches left
 * over it, the window keeps its field and its buttons, the notice is inert (the keyboard never reaches a row nobody
 * sees; the rail's Agents badge still counts who waits), and it shows again as the window closes.
 * The live region stays mounted: one that appears with its text is not announced.
 */
export function WaitingNotice() {
  const t = useMessages(shellMessages);
  const agents = useWaitingAgents();
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  const covered = useCornerCovered();
  const hidden = agents.slice(MAX_ROWS);
  return (
    <div aria-live="polite">
      {agents.length > 0 && (
        <section
          data-waiting-notice
          inert={covered}
          aria-label={t.waitingNotice.label}
          style={PLACE}
          className="dp-glass-strong absolute bottom-(--dp-notice-bottom) max-[1340px]:bottom-(--dp-notice-bottom-narrow) z-10 flex w-[260px] animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dp-dur) ease-(--dp-ease-out) motion-reduce:slide-in-from-bottom-0 flex-col rounded-lg p-1"
        >
          {agents.slice(0, MAX_ROWS).map((agent) => (
            <Row key={agent.id} agent={agent}>
              {/* The signature waiting dot, ringed, the one every place an agent waits shows: never the colour alone. */}
              <StatusDot state="waiting" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{agent.decision ? t.waitingNotice.decision[agent.decision](agent.name) : t.waitingNotice.question(agent.name)}</span>
                {/* Two lines of the question, never a native title: the row's name reads it whole, and a click shows the agent. */}
                {agent.message && <span className="line-clamp-2 block break-words text-xs text-dp-text-2">{agent.message}</span>}
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
