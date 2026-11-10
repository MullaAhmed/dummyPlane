import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { accountsMessages } from "@/accounts/messages";
import { useAccounts } from "@/accounts/store";
import { useUiRequest } from "@/commands/uiRequests";
import { useCanvas } from "@/canvas/canvasStore";
import { groupOf } from "@/canvas/groups";
import { agentInk, AGENTS, AGENTS_WITHOUT_OPTIONS, INDIGO } from "@/agents/catalog";
import { RemoteButton } from "@/agents/RemoteButton";
import { modelLabel } from "@/mission/router";
import { openReview } from "@/review/reviewStore";
import { ROLES } from "@/agents/roles";
import type { AgentId } from "@/ipc/pty";
import { cn } from "@/lib/utils";
import type { TerminalPayload } from "@/nodes/types";
import type { AgentActivity } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import type { TerminalStatus } from "@/store/terminalStatus";
import { newConversation, switchedAgent, type LaunchMode } from "./launch";
import { minimizeTerminal } from "./minimize";
import { NameField } from "./NameField";
import { HeaderButton, HeaderMenu, NodeHeader, NodeHeaderEnd, WIDE_ONLY } from "./NodeHeader";
import { relaunchTerminal, stopTerminal } from "./registry";
import { StatusPill } from "./StatusPill";
import { TerminalOptionsDialog } from "./TerminalOptionsDialog";
import { useMessages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";

// Other parts of the app (the agents panel) draw their rows with the header's button.
export { HeaderButton };

function switchAgent(nodeId: string, payload: TerminalPayload, agent: AgentId) {
  nodesStore.getState().update(nodeId, switchedAgent(payload, agent));
}

/**
 * Everything a terminal does now and then, behind its header's "⋯": the row
 * keeps the agent, the name, where it stands and Close, and a narrow node
 * still has room for its name. A Claude session restarts three ways.
 */
function TerminalMenu(props: { nodeId: string; payload: TerminalPayload; running: boolean; onDuplicate?: () => void }) {
  const { nodeId, payload, running, onDuplicate } = props;
  const t = useMessages(nodesMessages).header;
  const duplicate = useMessages(nodesMessages).terminal.duplicate;
  const relaunch = (mode: LaunchMode) => relaunchTerminal(nodeId, payload, mode);
  const newSession = () => {
    const fresh = newConversation();
    nodesStore.getState().update(nodeId, fresh);
    relaunchTerminal(nodeId, { ...payload, ...fresh }, "new");
  };
  return (
    <HeaderMenu label={t.more}>
      <DropdownMenuItem onSelect={() => openReview(nodeId)}>{t.review}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => minimizeTerminal(nodeId)}>{t.minimize}</DropdownMenuItem>
      {onDuplicate && <DropdownMenuItem onSelect={onDuplicate}>{duplicate}</DropdownMenuItem>}
      <DropdownMenuSeparator />
      {payload.agent === "claude" ? (
        <>
          <DropdownMenuLabel>{t.relaunch}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => relaunch("resume")}>{t.resumeSession}</DropdownMenuItem>
          <DropdownMenuItem onSelect={newSession}>{t.newSession}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => relaunch("continue")}>{t.latestInFolder}</DropdownMenuItem>
        </>
      ) : (
        <DropdownMenuItem onSelect={() => relaunch("new")}>{t.relaunch}</DropdownMenuItem>
      )}
      {/* The model chip says it from 28rem of header on; here it is said, and cleared, at any width. */}
      {payload.model && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t.modelChosen(modelLabel(payload.model))}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => nodesStore.getState().update(nodeId, { model: undefined })}>{t.modelDefault}</DropdownMenuItem>
        </>
      )}
      {running && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => stopTerminal(nodeId)}>
            {t.stopProcess}
          </DropdownMenuItem>
        </>
      )}
    </HeaderMenu>
  );
}

/**
 * The Claude profile a terminal started with (spec comptes §6), once there is a choice to show:
 * at least one profile besides the default one.
 */
export function AccountChip({ accountId }: { accountId?: string }) {
  const t = useMessages(accountsMessages);
  const profiles = useAccounts((s) => s.profiles);
  if (profiles.length === 0) return null;
  const profile = profiles.find((p) => p.id === accountId);
  return (
    <span
      data-account={profile?.id ?? "default"}
      title={t.chipTitle(profile?.configDir ?? t.defaultHint)}
      className="max-w-24 truncate px-1 text-xs text-dp-text-2"
    >
      {profile?.name ?? t.defaultName}
    </span>
  );
}

/** The model a mission's router chose; it stays after the mission until cleared (final review maj §3). */
function ModelChip({ nodeId, model }: { nodeId: string; model: string }) {
  const t = useMessages(nodesMessages).header;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-model={model}
          title={t.modelChosen(model)}
          className="rounded-md px-1 font-mono font-normal text-dp-text-2 hover:text-dp-text"
        >
          {modelLabel(model)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => nodesStore.getState().update(nodeId, { model: undefined })}>
          {t.modelDefault}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Header of a terminal node (spec habillage §7.1). A row of essentials: the
 * agent, the name, where the process stands when the foot does not say it,
 * Remote Control's state, "⋯" for the rest, Close. Chips of the account and
 * the model join them from 28rem of header on.
 */
export function TerminalHeader(props: {
  nodeId: string;
  payload: TerminalPayload;
  status: TerminalStatus;
  activity?: AgentActivity;
  /** Offered in "⋯" when there is something to duplicate into. */
  onDuplicate?: () => void;
  /** The header's Close; a header without it only renders. */
  onClose?: () => void;
  /** False when the node's foot tells where the agent stands (./AgentFoot.tsx): one status dot per agent. */
  showStatus?: boolean;
}) {
  const { nodeId, payload, status, activity, onDuplicate, onClose, showStatus = true } = props;
  const t = useMessages(nodesMessages).header;
  const close = useMessages(nodesMessages).terminal.close;
  const [editing, setEditing] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // "Rename" of the palette.
  useUiRequest("renameTerminal", (request) => {
    if (request.id !== nodeId) return false;
    setEditing(true);
    return true;
  });
  const meta = AGENTS[payload.agent];
  const role = useCanvas((s) => groupOf(s.frames, nodeId)?.group.role);
  const running = status.state === "running";
  const shown = payload.name || meta.label;

  return (
    <NodeHeader title={payload.title}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" aria-label={t.agent} className="shrink-0 gap-0.5 rounded-md px-1">
            <meta.Icon className="size-4" style={{ color: agentInk(meta.tint) }} />
            <ChevronDown className="size-3 text-dp-text-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {/* Only agents that start without options can be switched to from the header. */}
          {AGENTS_WITHOUT_OPTIONS.map((id) => {
            const Icon = AGENTS[id].Icon;
            return (
              <DropdownMenuItem key={id} onSelect={() => switchAgent(nodeId, payload, id)}>
                <Icon style={{ color: agentInk(AGENTS[id].tint) }} /> {AGENTS[id].label}
                {id === payload.agent && <span className="ml-auto text-dp-text-2">{t.current}</span>}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOptionsOpen(true)}>{t.options}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: role ? ROLES[role].color : "var(--dp-text-3)" }}
      />
      <NameField
        value={shown}
        editing={editing}
        onEditingChange={setEditing}
        onCommit={(name) => {
          if (name) nodesStore.getState().update(nodeId, { name });
        }}
      />
      <NodeHeaderEnd>
        {showStatus && (
          <StatusPill status={status} activity={activity} indigo={meta.tint === INDIGO} report={payload.lastReport?.status} labelClassName="@max-xs/head:sr-only" />
        )}
        <div className={cn(WIDE_ONLY, "items-center gap-1")}>
          {payload.agent === "claude" && <AccountChip accountId={payload.accountId} />}
          {payload.model && <ModelChip nodeId={nodeId} model={payload.model} />}
        </div>
        {payload.agent === "claude" && <RemoteButton nodeId={nodeId} wanted={payload.remoteControl === true} running={running} />}
        <TerminalMenu nodeId={nodeId} payload={payload} running={running} onDuplicate={onDuplicate} />
        {onClose && (
          <HeaderButton label={close} onClick={onClose}>
            <X />
          </HeaderButton>
        )}
      </NodeHeaderEnd>
      {optionsOpen && <TerminalOptionsDialog nodeId={nodeId} payload={payload} onClose={() => setOptionsOpen(false)} />}
    </NodeHeader>
  );
}
