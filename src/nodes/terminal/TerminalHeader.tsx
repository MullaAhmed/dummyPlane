import { useState, type ReactNode } from "react";
import { ChevronDown, FileDiff, Minimize2, RotateCw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { accountsMessages } from "@/accounts/messages";
import { useAccounts } from "@/accounts/store";
import { useUiRequest } from "@/commands/uiRequests";
import { useCanvas } from "@/canvas/canvasStore";
import { groupOf } from "@/canvas/groups";
import { agentInk, AGENTS, AGENTS_WITHOUT_OPTIONS, INDIGO } from "@/fleet/catalog";
import { RemoteButton } from "@/fleet/RemoteButton";
import { modelLabel } from "@/mission/router";
import { openReview } from "@/review/reviewStore";
import { ROLES } from "@/fleet/roles";
import type { AgentId } from "@/ipc/pty";
import type { TerminalPayload } from "@/nodes/types";
import type { AgentActivity } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import type { TerminalStatus } from "@/store/terminalStatus";
import { newConversation, switchedAgent, type LaunchMode } from "./launch";
import { minimizeTerminal } from "./minimize";
import { relaunchTerminal, stopTerminal } from "./registry";
import { StatusPill } from "./StatusPill";
import { TerminalOptionsDialog } from "./TerminalOptionsDialog";
import { useMessages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";


/** The quiet icon buttons of a header: muted until pointed at. */
const HEADER_ICON = "rounded-md text-dp-text-2 hover:text-dp-text";

/** An icon action of a header; its name shows in a tooltip, the glyph alone not always saying it. */
export function HeaderButton(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={props.label} onClick={props.onClick} className={HEADER_ICON}>
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {props.label}
      </TooltipContent>
    </Tooltip>
  );
}

function switchAgent(nodeId: string, payload: TerminalPayload, agent: AgentId) {
  nodesStore.getState().update(nodeId, switchedAgent(payload, agent));
}

function RelaunchMenu(props: { nodeId: string; payload: TerminalPayload; running: boolean }) {
  const { nodeId, payload, running } = props;
  const t = useMessages(nodesMessages).header;
  const relaunch = (mode: LaunchMode) => relaunchTerminal(nodeId, payload, mode);
  const newSession = () => {
    const fresh = newConversation();
    nodesStore.getState().update(nodeId, fresh);
    relaunchTerminal(nodeId, { ...payload, ...fresh }, "new");
  };
  return (
    <DropdownMenu>
      {/* A menu's trigger keeps a native title: a tooltip would pop up again when the closing menu hands the focus back. */}
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" title={t.relaunch} aria-label={t.relaunch} className={HEADER_ICON}>
          <RotateCw />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {payload.agent === "claude" ? (
          <>
            <DropdownMenuItem onSelect={() => relaunch("resume")}>{t.resumeSession}</DropdownMenuItem>
            <DropdownMenuItem onSelect={newSession}>{t.newSession}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => relaunch("continue")}>{t.latestInFolder}</DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={() => relaunch("new")}>{t.relaunch}</DropdownMenuItem>
        )}
        {running && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => stopTerminal(nodeId)}>
              {t.stopProcess}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
          className="h-6 rounded-md px-1 font-mono text-xs font-normal text-dp-text-2 hover:text-dp-text"
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

/** Header of a terminal node (spec habillage §7.1). */
export function TerminalHeader(props: {
  nodeId: string;
  payload: TerminalPayload;
  status: TerminalStatus;
  activity?: AgentActivity;
  actions?: ReactNode;
  /** False when the node's foot tells where the agent stands (./AgentFoot.tsx): one status dot per agent. */
  showStatus?: boolean;
}) {
  const { nodeId, payload, status, activity, actions, showStatus = true } = props;
  const t = useMessages(nodesMessages).header;
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

  return (
    <header
      title={payload.title}
      className="flex h-9 shrink-0 items-center gap-2 border-b border-dp-line bg-dp-terminal-head px-3 text-xs"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" aria-label="Agent" className="gap-0.5 rounded-md px-1">
            <meta.Icon className="size-3.5" style={{ color: agentInk(meta.tint) }} />
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
      {editing ? (
        <Input
          autoFocus
          defaultValue={payload.name}
          className="h-5 w-32 rounded-md px-1 text-xs md:text-xs"
          onBlur={(e) => {
            const name = e.currentTarget.value.trim();
            if (name) nodesStore.getState().update(nodeId, { name });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span
          className="truncate font-medium text-dp-text"
          onDoubleClick={() => setEditing(true)}
          title={t.doubleClickRename}
        >
          {payload.name || meta.label}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {showStatus && <StatusPill status={status} activity={activity} indigo={meta.tint === INDIGO} />}
        {payload.agent === "claude" && <AccountChip accountId={payload.accountId} />}
        {payload.model && <ModelChip nodeId={nodeId} model={payload.model} />}
        {payload.agent === "claude" && <RemoteButton nodeId={nodeId} wanted={payload.remoteControl === true} running={status.state === "running"} />}
        <HeaderButton label={t.review} onClick={() => openReview(nodeId)}>
          <FileDiff />
        </HeaderButton>
        <RelaunchMenu nodeId={nodeId} payload={payload} running={status.state === "running"} />
        <HeaderButton label={t.minimize} onClick={() => minimizeTerminal(nodeId)}>
          <Minimize2 />
        </HeaderButton>
        {actions}
      </div>
      {optionsOpen && <TerminalOptionsDialog nodeId={nodeId} payload={payload} onClose={() => setOptionsOpen(false)} />}
    </header>
  );
}
