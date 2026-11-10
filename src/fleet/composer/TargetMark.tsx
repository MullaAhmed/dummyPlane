import { Group, SquareTerminal, Users } from "lucide-react";
import { pillOf } from "@/nodes/terminal/pill";
import { DOT_OF_TONE, StatusDot } from "@/nodes/terminal/StatusDot";
import { useActivity } from "@/store/agentActivity";
import { terminalOf, useNodes } from "@/store/nodes";
import { useTerminalStatus } from "@/store/terminalStatus";
import { AGENTS } from "../catalog";
import type { Target } from "../targets";

const ICON = "size-4 shrink-0 text-dp-text-2";

/** What a line of the `@` list starts with: everyone, a group, or the agent's own icon. */
export function TargetIcon({ target }: { target: Target }) {
  if (target.kind === "all") return <Users className={ICON} aria-hidden />;
  if (target.kind === "group") return <Group className={ICON} aria-hidden />;
  return <AgentIcon id={target.id} />;
}

function AgentIcon({ id }: { id: string }) {
  const agent = useNodes((s) => terminalOf(s.nodes[id])?.agent);
  const Icon = agent ? AGENTS[agent].Icon : SquareTerminal;
  return <Icon className={ICON} aria-hidden />;
}

/**
 * An agent's live status dot: the one StatusDot of every place an agent
 * appears. Alone on its row, it is named for screen readers by its status.
 */
export function AgentStatusDot({ id }: { id: string }) {
  const status = useTerminalStatus(id);
  const activity = useActivity(id);
  const pill = pillOf(status, status.state === "running" ? activity?.activity : undefined);
  return <StatusDot state={DOT_OF_TONE[pill.tone]} label={pill.label} data-status-dot={pill.tone} />;
}
