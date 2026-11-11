import type { ReactNode } from "react";
import { Crosshair, FileDiff, Pause, Play, Smartphone, X } from "lucide-react";
import { focusNode } from "@/canvas/focusNode";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { HeaderButton } from "@/nodes/terminal/TerminalHeader";
import { openReview } from "@/review/reviewStore";
import { StatusPill } from "@/nodes/terminal/StatusPill";
import { Hint } from "@/shell/buttons";
import { useActivity } from "@/store/agentActivity";
import { terminalOf, useNodes } from "@/store/nodes";
import { useTerminalStatus } from "@/store/terminalStatus";
import { canPause, canResume, pauseAgents, resumeAgent } from "./broadcast";
import { agentInk, AGENTS, INDIGO } from "./catalog";
import { agentsMessages } from "./messages";
import { useRemoteLink } from "./remoteControl";
import { requestClose } from "./terminals";

/**
 * One agent of the agents panel or of a fleet: logo, name, agent, pill;
 * on hover, Center, Pause, Resume and Close (spec theme §5.5, §13).
 */
export function AgentRow(props: { id: string; onOpen?: () => void; trailing?: ReactNode; showCenter?: boolean }) {
  const { id, onOpen, trailing, showCenter = true } = props;
  const t = useMessages(agentsMessages).agentRow;
  const payload = useNodes((s) => terminalOf(s.nodes[id]));
  const status = useTerminalStatus(id);
  const activity = useActivity(id);
  const remote = useRemoteLink(id);
  if (!payload) return null;
  const meta = AGENTS[payload.agent];
  const name = payload.name || meta.label;
  const facts = { agent: payload.agent, running: status.state === "running", activity: activity?.activity };
  return (
    <div className="group flex h-9 items-center gap-2 rounded-md px-2 transition-[background-color] duration-(--dp-dur-fast) ease-(--dp-ease-out) hover:bg-dp-hover motion-reduce:transition-none">
      {/* The row is the surface (its hover is the row's): the button only carries the click and the focus ring. */}
      <Button
        type="button"
        variant="ghost"
        onClick={onOpen}
        className="h-auto min-w-0 flex-1 justify-start gap-2 px-0 text-left text-(length:--text-ui) font-normal hover:bg-transparent active:scale-100"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-sm" style={{ color: agentInk(meta.tint) }}>
          <meta.Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-dp-text">
          {name} <span className="text-dp-text-2">{meta.label}</span>
        </span>
      </Button>
      {remote?.state === "on" && (
        // The same hint as the buttons of the row, not a native title: the row mixes both.
        <Hint label={t.remoteOn}>
          <span role="img" aria-label={t.remoteOn} className="text-dp-accent-ink">
            <Smartphone className="size-3.5" />
          </span>
        </Hint>
      )}
      {/* The status and the actions share one cell, as wide as the wider of the two: the pointer swaps them
          with a fade, the keyboard at once, and the name beside them never moves. */}
      <span className="grid shrink-0 items-center justify-items-end">
        <span className="flex items-center gap-2 transition-[opacity] duration-(--dp-dur-fast) ease-(--dp-ease-out) [grid-area:1/1] group-hover:opacity-0 group-focus-within:opacity-0 group-focus-within:transition-none">
          <StatusPill status={status} activity={activity} indigo={meta.tint === INDIGO} report={payload.lastReport?.status} />
          {trailing}
        </span>
        <span
          data-row-actions
          className="flex items-center gap-0.5 opacity-0 transition-[opacity] duration-(--dp-dur-fast) ease-(--dp-ease-out) [grid-area:1/1] group-hover:opacity-100 group-focus-within:opacity-100 group-focus-within:transition-none"
        >
          {showCenter && (
            <HeaderButton label={t.center(name)} onClick={() => focusNode(id)}>
              <Crosshair />
            </HeaderButton>
          )}
          <HeaderButton label={t.review(name)} onClick={() => openReview(id)}>
            <FileDiff />
          </HeaderButton>
          {canPause(facts) && (
            <HeaderButton label={t.pause(name)} onClick={() => void pauseAgents([id])}>
              <Pause />
            </HeaderButton>
          )}
          {canResume(facts) && (
            <HeaderButton label={t.resume(name)} onClick={() => void resumeAgent(id)}>
              <Play />
            </HeaderButton>
          )}
          <HeaderButton label={t.close(name)} onClick={() => requestClose(id)}>
            <X />
          </HeaderButton>
        </span>
      </span>
    </div>
  );
}
