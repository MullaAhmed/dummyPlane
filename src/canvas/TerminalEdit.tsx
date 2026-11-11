import { useEffect, useId, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, ChevronUp, ClipboardCopy, Copy, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PanelTabs, PanelTabsContent, PanelTabsList, PanelTabsTrigger } from "@/components/PanelTabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { accountsMessages } from "@/accounts/messages";
import { loadAccounts, useAccounts } from "@/accounts/store";
import { useAgents } from "@/agents/agentsStore";
import { AGENTS, INDIGO } from "@/agents/catalog";
import { remoteErrorText, useRemoteLink, type RemoteLink } from "@/agents/remoteControl";
import { switchRemote } from "@/agents/RemoteButton";
import { requestCloseFleet, renameFleet } from "@/fleet/fleets";
import { duplicateTerminal, requestClose } from "@/agents/terminals";
import { claudeLaunchDefaults, type ClaudeLaunchDefaults } from "@/ipc/claudeExtensions";
import type { Permission, ShellKind } from "@/ipc/pty";
import { EFFORT_LEVELS, MODEL_CHOICES, modelLabel, readEffort, settingsModelLabel, type EffortLevel } from "@/mission/router";
import { folderChange, folderLockOf, type FolderLock } from "@/nodes/terminal/folder";
import { newConversation, SHELL_LABELS } from "@/nodes/terminal/launch";
import { resumeTerminal } from "@/nodes/terminal/registry";
import { StatusPill } from "@/nodes/terminal/StatusPill";
import type { TerminalPayload } from "@/nodes/types";
import { useActivity } from "@/store/agentActivity";
import { nodeNameOf, nodesStore, sessionOf, updateSession, useNodes, type NodeRecord } from "@/store/nodes";
import { useTerminalStatus } from "@/store/terminalStatus";
import { formatTokens } from "@/usage/usage";
import { useNodeSession } from "@/usage/usageStore";
import { IconButton } from "@/shell/buttons";
import { ExtensionList, QUIET_BOX, useClaudeExtensions, type ExtensionKind } from "./ExtensionList";
import { canvasMessages } from "./messages";
import { keepCanvasFocus } from "./PanelAction";
import { forgetStartedChoice } from "./startedChoice";
import { forgetStartedLaunch, noteLaunchChange, useLaunchRestartPending, useStartedLaunch } from "./startedLaunch";

/** The node alone on the selection, if the selection is exactly one terminal or one Fleet: the nodes that have an edit panel. */
export function selectedEditId(selectedIds: readonly string[], nodes: Record<string, NodeRecord>): string | null {
  const kind = selectedIds.length === 1 ? nodes[selectedIds[0]]?.kind : undefined;
  return kind === "terminal" || kind === "fleet" ? selectedIds[0] : null;
}

/** The panel's fields: as small as its actions (Input's own `md:text-sm` would win over a bare `text-xs`). */
const FIELD = "h-7 rounded-md text-xs md:text-xs";
/** A select of the panel: as tall and as small as its fields. */
const CHOICE = "w-full rounded-md text-xs";

type Tab = "general" | ExtensionKind;
const KINDS: readonly ExtensionKind[] = ["skills", "plugins", "mcp", "agents"];

/** Radix's Select cannot hold an empty value: the choice of no `--model`, no `--permission-mode`, or the default account. */
const NONE = "none";
const PERMISSIONS: readonly Permission[] = ["ask", "edits", "work"];

/** Enter ends the edit and the field's blur saves it; Escape puts the stored value back first, so nothing changes. */
const endEdit = (stored: string) => (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Escape") event.currentTarget.value = stored;
  if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
};

/**
 * A field that cannot be empty, left: the trimmed text when it is a new value; null when there is nothing to
 * save, an empty field getting the stored text back (a blank name keeps the stored one).
 */
function keepStored(input: HTMLInputElement, stored: string): string | null {
  const value = input.value.trim();
  if (!value) input.value = stored;
  return value && value !== stored ? value : null;
}

/** The session as it is stored now, not as this render saw it: two quick edits both count. */
const latestSession = (nodeId: string) => sessionOf(nodesStore.getState().nodes[nodeId]);

/**
 * What a selected terminal, or a selected Fleet, lets you do without opening its
 * menu. General, from what is true now to what its next launch reads: where it
 * stands (its status, step, last report and spending), its name, with a copy
 * (a duplicate beside it; not a Fleet) and a delete (its header's X, with the
 * same confirmation), Remote Control (applied at once), then under "Next
 * launch" its model and effort, permissions, account, folder, shell, or for a
 * custom command the command, with an offer to restart a running one. A Claude
 * terminal, and a Fleet, also gets its skills, plugins, MCP servers and
 * subagents, each on or off for it alone. A Fleet is edited through its Claude
 * session (`session`, nested in its node): its model, effort and shell only.
 * The panel folds back to its Edit tab (SelectionPanel).
 */
export function TerminalEdit({ nodeId, onFold }: { nodeId: string; onFold: () => void }) {
  const t = useMessages(canvasMessages).selection;
  const record = useNodes((s) => s.nodes[nodeId]);
  const [tab, setTab] = useState<Tab>("general");
  const bodyId = useId();
  const fleet = record?.kind === "fleet";
  const session = sessionOf(record);
  const name = nodeNameOf(record);
  const claude = session?.agent === "claude";
  const shown: Tab = claude ? tab : "general";
  const { lists, retry } = useClaudeExtensions(session?.cwd ?? "", session?.accountId, claude && shown !== "general");
  if (!record) return null;

  const general = <General nodeId={nodeId} record={record} session={session} />;
  return (
    <section aria-label={t.edit} className="flex min-h-0 flex-col gap-3">
      {/* The panel's head: its title in the primary text, a step above the field labels; the chevron quiet until pointed at. */}
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-(length:--text-ui) leading-6 font-medium text-dp-text">{t.editTerminal(name || (fleet ? t.thisFleet : t.thisTerminal))}</p>
        {/* Says what it does: a native title is enough, as on a group's chevron. */}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t.foldPanel}
          title={t.foldPanel}
          aria-expanded
          aria-controls={bodyId}
          onMouseDown={keepCanvasFocus}
          onClick={onFold}
          // Ghost buttons tint while aria-expanded (a menu's trigger); this one is expanded whenever the panel is open.
          // Its centre sits on the checkboxes' column (-mr-1).
          className="-mr-1 text-dp-text-3 hover:text-dp-text aria-expanded:bg-transparent aria-expanded:text-dp-text-3 aria-expanded:hover:bg-dp-hover aria-expanded:hover:text-dp-text"
        >
          <ChevronUp className="size-3.5" />
        </Button>
      </div>
      <div id={bodyId} className="flex min-h-0 flex-col">
        {claude && session ? (
          <PanelTabs value={shown} onValueChange={(value) => setTab(value as Tab)} className="min-h-0 flex-1 gap-3">
            {/* The five labels on one hairline, never a scroller: they fit the panel's width (PANEL_WIDTH) with room to spare. */}
            <PanelTabsList look="line" className="w-full shrink-0">
              {(["general", ...KINDS] as const).map((value) => (
                <PanelTabsTrigger key={value} value={value} onMouseDown={keepCanvasFocus}>
                  {t.tabs[value]}
                </PanelTabsTrigger>
              ))}
            </PanelTabsList>
            <PanelTabsContent value="general" className={SCROLLS}>
              {general}
            </PanelTabsContent>
            {KINDS.map((kind) => (
              <PanelTabsContent key={kind} value={kind} className="min-h-0 flex-1">
                <ExtensionList nodeId={nodeId} kind={kind} cwd={session.cwd} choice={session.extensions} lists={lists} onRetry={retry} />
              </PanelTabsContent>
            ))}
          </PanelTabs>
        ) : (
          <div className={cn(SCROLLS, "grid grid-cols-1 gap-4")}>
            {general}
            {session && <p className="text-xs text-dp-text-3">{t.claudeOnly}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

/** A page of the panel that scrolls when the canvas is short; its fields keep their focus rings (4 px of room). */
const SCROLLS = "-m-1 min-h-0 overflow-y-auto p-1";

/**
 * The General page, in three groups: where the agent stands now, who it is
 * (its name, Remote Control), and what its next launch reads. Each setting is
 * one row, its label beside it.
 */
function General({ nodeId, record, session }: { nodeId: string; record: NodeRecord; session: TerminalPayload | undefined }) {
  const t = useMessages(canvasMessages).selection;
  const lock = useNodes((s) => folderLockOf(nodeId, s.nodes));
  const shells = useAgents((s) => s.shells);
  const profiles = useAccounts((s) => s.profiles);
  const restartPending = useLaunchRestartPending(nodeId, session);
  const running = useTerminalStatus(nodeId).state === "running";
  const fleet = record.kind === "fleet";
  const name = nodeNameOf(record);
  const claude = session?.agent === "claude";
  const ids = { name: useId(), model: useId(), permission: useId(), account: useId(), shell: useId(), command: useId() };
  const ownModel = useOwnModelLabel(nodeId, session, running);

  const commitName = (input: HTMLInputElement) => {
    const next = keepStored(input, name);
    if (next === null) return;
    if (fleet) renameFleet(nodeId, next);
    else nodesStore.getState().update(nodeId, { name: next });
  };
  /** A setting read at the next launch: a running terminal keeps the one it started with, and offers a restart. */
  const setLaunch = (patch: Partial<TerminalPayload>) => {
    const current = latestSession(nodeId);
    if (!current) return;
    noteLaunchChange(nodeId, current);
    updateSession(nodeId, patch);
  };
  const commitCommand = (value: string) => {
    const command = value.trim();
    if (command !== session?.command) setLaunch({ command });
  };
  /** Claude keeps each conversation in its profile's folder: another account starts a new one, as another folder does. */
  const setAccount = (accountId: string | undefined) => {
    if (accountId === latestSession(nodeId)?.accountId) return;
    setLaunch({ accountId, ...newConversation() });
    toast.info(t.accountNewConversation);
  };
  const copy = () => {
    if (!record.workspaceId) return;
    duplicateTerminal(record.workspaceId, nodeId).catch((error: unknown) => toast.error(t.copyFailed(String(error))));
  };
  const remove = () => (fleet ? requestCloseFleet(nodeId) : requestClose(nodeId));
  const restart = () => {
    forgetStartedChoice(nodeId);
    forgetStartedLaunch(nodeId);
    resumeTerminal(nodeId);
  };
  const account = session?.accountId && profiles.some((p) => p.id === session.accountId) ? session.accountId : NONE;

  // A field starts from the stored value again whenever the stored value changes (a rename from the header, an undo).
  return (
    <div className="grid grid-cols-1 gap-4">
      {session && <LiveStatus nodeId={nodeId} session={session} />}
      <Rows>
        <Row label={t.name} htmlFor={ids.name}>
          <div className="flex items-center gap-1">
            <Input
              id={ids.name}
              key={`name:${name}`}
              aria-label={t.name}
              defaultValue={name}
              onBlur={(e) => commitName(e.currentTarget)}
              onKeyDown={endEdit(name)}
              className={cn(FIELD, "min-w-0 flex-1")}
            />
            {!fleet && (
              <IconButton label={t.copyTerminal} onMouseDown={keepCanvasFocus} onClick={copy}>
                <Copy className="size-3.5" />
              </IconButton>
            )}
            <IconButton
              label={fleet ? t.deleteFleet : t.deleteTerminal}
              onMouseDown={keepCanvasFocus}
              onClick={remove}
              className="hover:bg-dp-danger/10 hover:text-dp-danger focus-visible:ring-dp-danger"
            >
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        </Row>
        {claude && <RemoteRow nodeId={nodeId} wanted={session.remoteControl === true} running={running} />}
      </Rows>
      {session && (
        <div role="group" aria-labelledby={`${ids.model}-heading`} className="grid grid-cols-1 gap-2">
          <p id={`${ids.model}-heading`} className="dp-label">
            {t.nextLaunch}
          </p>
          <Rows>
            {claude && (
              <Row label={t.model} htmlFor={ids.model} note={<RunningModel nodeId={nodeId} running={running} />}>
                <ModelSelect id={ids.model} value={session.model} own={ownModel} onChange={(model) => setLaunch({ model })} />
              </Row>
            )}
            {claude && (
              <Row label={t.effort} note={<EffortNote nodeId={nodeId} running={running} chosen={session.effort} />}>
                {/* One per node: a drag under way never carries over to the next terminal selected. */}
                <EffortSlider key={nodeId} value={session.effort} onChange={(effort) => setLaunch({ effort })} />
              </Row>
            )}
            {claude && !fleet && (
              <Row label={t.permission} htmlFor={ids.permission} note={session.permission && t.permissionHelp[session.permission]}>
                {/* None given: Claude as the user set it up. A mission's agent keeps its mission's choice, and its push block. */}
                <Choice
                  id={ids.permission}
                  label={t.permission}
                  value={session.permission ?? NONE}
                  options={[{ value: NONE, label: t.claudeSettings }, ...PERMISSIONS.map((p) => ({ value: p, label: t.permissions[p] }))]}
                  disabled={lock === "mission"}
                  onChange={(permission) => setLaunch({ permission: permission === NONE ? undefined : (permission as Permission) })}
                />
              </Row>
            )}
            {claude && !fleet && profiles.length > 0 && (
              <Row label={t.account} htmlFor={ids.account}>
                <AccountSelect id={ids.account} value={account} disabled={lock === "mission"} onChange={setAccount} />
              </Row>
            )}
            <Row label={t.folder} note={lock && (lock === "fleet" ? t.folderFleet : t.folderMission)}>
              <FolderField nodeId={nodeId} session={session} lock={lock} />
            </Row>
            <Row label={t.shell} htmlFor={ids.shell}>
              <ShellSelect id={ids.shell} value={session.shell} shells={shells} onChange={(shell) => setLaunch({ shell })} />
            </Row>
            {session.agent === "custom" && (
              <Row label={t.command} htmlFor={ids.command}>
                <Input
                  id={ids.command}
                  key={`command:${session.command}`}
                  aria-label={t.command}
                  defaultValue={session.command}
                  placeholder="npm run dev"
                  onBlur={(e) => commitCommand(e.currentTarget.value)}
                  onKeyDown={endEdit(session.command)}
                  className={cn(FIELD, "font-mono")}
                />
              </Row>
            )}
          </Rows>
        </div>
      )}
      {restartPending && (
        <div className="flex items-center justify-between gap-3 border-t border-dp-line pt-2">
          <p className="min-w-0 truncate text-xs leading-7 text-dp-text-3">{t.launchChanged}</p>
          <Button type="button" variant="secondary" size="sm" onMouseDown={keepCanvasFocus} onClick={restart} className="text-xs font-normal text-dp-text-2 hover:text-dp-text">
            <RotateCw className="size-3.5" />
            {t.restartNow}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Rows of a label and its control: one column of labels, the controls lined up beside it. The labels' column
 * (96 px) holds the longest, "Remote Control", whole at 12 px; the controls keep about 200 px of the panel's 312.
 */
function Rows({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2">{children}</div>;
}

/** One setting: its label, its control, and under the control a quiet line when there is something to know. */
function Row({ label, htmlFor, note, children }: { label: string; htmlFor?: string; note?: ReactNode; children: ReactNode }) {
  return (
    <>
      <label htmlFor={htmlFor} className="truncate text-xs leading-7 text-dp-text-2">
        {label}
      </label>
      <div className="grid min-w-0 grid-cols-1 gap-1">
        {children}
        {note && <p className="text-xs leading-4 text-dp-text-3">{note}</p>}
      </div>
    </>
  );
}

/**
 * Where the agent stands now: its dot and word, the same as its header's or
 * its foot's (the tooltip says for how long), and while Claude runs, what its
 * status line last said it spent. Then the step under way and its last report.
 */
function LiveStatus({ nodeId, session }: { nodeId: string; session: TerminalPayload }) {
  const t = useMessages(canvasMessages).selection;
  const status = useTerminalStatus(nodeId);
  const activity = useActivity(nodeId);
  const usage = useNodeSession(nodeId);
  const running = status.state === "running";
  const steps = session.steps ?? [];
  const current = steps.findIndex((step) => step.state === "en_cours");
  const stepLine =
    current >= 0 ? t.step(current + 1, steps.length, steps[current].title) : steps.length > 0 ? t.stepsDone(steps.filter((step) => step.state === "fait").length, steps.length) : null;
  const report = session.lastReport;
  const facts = running && usage ? [t.tokens(formatTokens(usage.inputTokens + usage.outputTokens)), usage.contextPercent !== null && t.context(Math.round(usage.contextPercent))].filter(Boolean).join(" · ") : "";
  return (
    <div role="group" aria-label={t.status} className="grid grid-cols-1 gap-1">
      <div className="flex h-7 items-center justify-between gap-3">
        <StatusPill status={status} activity={activity} indigo={AGENTS[session.agent].tint === INDIGO} report={report?.status} />
        {facts && <span className="min-w-0 truncate text-xs text-dp-text-3 tabular-nums">{facts}</span>}
      </div>
      {stepLine && (
        <p data-step className="truncate text-xs text-dp-text-2">
          {stepLine}
        </p>
      )}
      {report && (
        <p data-report-summary title={report.summary} className="line-clamp-3 text-xs text-dp-text-2">
          <span className="text-dp-text-3">{t.lastReport} · </span>
          {report.summary}
        </p>
      )}
    </div>
  );
}

/**
 * What a Claude terminal in `cwd`, with its profile, starts on when its launch names no model, read when the
 * panel opens, again when its folder or profile changes and at each start. Undefined until it is known.
 */
function useLaunchDefaults(cwd: string | undefined, accountId: string | undefined, running: boolean): ClaudeLaunchDefaults | undefined {
  const accountsLoaded = useAccounts((s) => s.loaded);
  const configDir = useAccounts((s) => (accountId ? s.profiles.find((p) => p.id === accountId)?.configDir : undefined));
  const ready = Boolean(cwd) && (!accountId || accountsLoaded);
  const token = `${cwd}\n${configDir ?? ""}\n${running}`;
  const [result, setResult] = useState<{ token: string; defaults: ClaudeLaunchDefaults } | null>(null);
  useEffect(() => {
    if (cwd && !ready) void loadAccounts();
  }, [cwd, ready]);
  useEffect(() => {
    if (!ready || !cwd) return;
    let live = true;
    // Nothing read (no Claude folder, a refused profile): Claude's default is all that can be said.
    const settle = (defaults: ClaudeLaunchDefaults) => live && setResult({ token, defaults });
    claudeLaunchDefaults(cwd, configDir).then(settle, () => settle({}));
    return () => {
      live = false;
    };
  }, [ready, token, cwd, configDir]);
  return result?.token === token ? result.defaults : undefined;
}

/**
 * The model the next launch gets with no `--model`, named rather than called a default: while the session
 * runs on Claude's own pick, the model its status line reports; otherwise the `model` its settings give,
 * else the plan's default.
 */
function useOwnModelLabel(nodeId: string, session: TerminalPayload | undefined, running: boolean): string {
  const t = useMessages(canvasMessages).selection;
  const claude = session?.agent === "claude";
  const defaults = useLaunchDefaults(claude ? session?.cwd : undefined, session?.accountId, running);
  const usage = useNodeSession(nodeId);
  const started = useStartedLaunch(nodeId, session);
  const fromSettings = defaults?.model;
  // Only a session started without `--model` runs Claude's own pick.
  const reported = running && started?.model === "" ? usage?.model?.name : undefined;
  if (reported) return fromSettings ? t.ownModel.settings(reported) : t.ownModel.plan(reported);
  return fromSettings ? t.ownModel.settings(settingsModelLabel(fromSettings)) : t.ownModel.planOnly;
}

/** While Claude runs: the model its status line says it uses now (it may be another than the one chosen, after /model). */
function RunningModel({ nodeId, running }: { nodeId: string; running: boolean }) {
  const t = useMessages(canvasMessages).selection;
  const usage = useNodeSession(nodeId);
  if (!running || !usage?.model) return null;
  return <span data-running-model>{t.runningModel(usage.model.name)}</span>;
}

/** An effort level as the panel names it; a level of another Claude version as Claude sent it. */
const effortName = (efforts: Record<EffortLevel, string>, level: string) => {
  const known = readEffort(level);
  return known ? efforts[known] : level;
};

/**
 * Under the effort: while Claude runs, the level its status line reports (after /effort, maybe another than
 * the one chosen); otherwise, on Claude's own level, where that level comes from.
 */
function EffortNote({ nodeId, running, chosen }: { nodeId: string; running: boolean; chosen: EffortLevel | undefined }) {
  const t = useMessages(canvasMessages).selection;
  const usage = useNodeSession(nodeId);
  if (running && usage?.effort) return <span data-running-effort>{t.runningEffort(effortName(t.efforts, usage.effort))}</span>;
  return chosen ? null : <span>{t.effortAutoHint}</span>;
}

/**
 * The `--effort` of the next launch, on a slider of Claude Code's levels: Auto (no flag: Claude's settings or
 * the model's default), then low to max. The thumb follows a drag at once; the level is stored when the drag
 * or the key ends, once.
 */
function EffortSlider({ value, onChange }: { value: EffortLevel | undefined; onChange: (effort: EffortLevel | undefined) => void }) {
  const t = useMessages(canvasMessages).selection;
  const stored = value ? EFFORT_LEVELS.indexOf(value) + 1 : 0;
  // Where a drag has the thumb. Radix reports a key's step after committing it, so a step leaves one behind:
  // any change of the stored stop (that step stored, an undo) drops it, and the thumb shows the store again.
  const [moving, setMoving] = useState<number | null>(null);
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setMoving(null);
  }
  const shown = moving ?? stored;
  const levelAt = (stop: number): EffortLevel | undefined => (stop > 0 ? EFFORT_LEVELS[stop - 1] : undefined);
  const nameAt = (stop: number) => {
    const level = levelAt(stop);
    return level ? t.efforts[level] : t.effortAuto;
  };
  return (
    <div className="flex h-7 min-w-0 items-center gap-3">
      <Slider
        min={0}
        max={EFFORT_LEVELS.length}
        step={1}
        value={[shown]}
        thumbLabel={t.effort}
        valueText={nameAt(shown)}
        onValueChange={([stop]) => setMoving(stop)}
        onValueCommit={([stop]) => {
          setMoving(null);
          const next = levelAt(stop);
          if (next !== value) onChange(next);
        }}
        className="min-w-0 flex-1"
      />
      <span data-effort aria-hidden className="w-16 shrink-0 truncate text-xs text-dp-text">
        {nameAt(shown)}
      </span>
    </div>
  );
}

/** One of the panel's selects: its options by value and label. */
function Choice(props: { id: string; label: string; value: string; options: readonly { value: string; label: string }[]; disabled?: boolean; onChange: (value: string) => void }) {
  const { id, label, value, options, disabled, onChange } = props;
  return (
    <Select value={value} disabled={disabled} onValueChange={(next) => next !== value && onChange(next)}>
      <SelectTrigger id={id} size="sm" aria-label={label} className={CHOICE}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The `--model` of the next launch: none, the model Claude picks itself (`own` names it), or one of the
 * current family; a stored one off the list stays offered.
 */
function ModelSelect({ id, value, own, onChange }: { id: string; value: string | undefined; own: string; onChange: (model: string | undefined) => void }) {
  const t = useMessages(canvasMessages).selection;
  const known = !value || MODEL_CHOICES.some((choice) => choice.model === value);
  const models = known ? MODEL_CHOICES : [{ model: value, modelLabel: modelLabel(value) }, ...MODEL_CHOICES];
  const options = [{ value: NONE, label: own }, ...models.map((m) => ({ value: m.model, label: m.modelLabel }))];
  return <Choice id={id} label={t.model} value={value ?? NONE} options={options} onChange={(next) => onChange(next === NONE ? undefined : next)} />;
}

/** The Claude profile of the next launch, or the default account. */
function AccountSelect({ id, value, disabled, onChange }: { id: string; value: string; disabled: boolean; onChange: (accountId: string | undefined) => void }) {
  const t = useMessages(canvasMessages).selection;
  const accounts = useMessages(accountsMessages);
  const profiles = useAccounts((s) => s.profiles);
  const options = [{ value: NONE, label: accounts.defaultName }, ...profiles.map((p) => ({ value: p.id, label: p.name }))];
  return <Choice id={id} label={t.account} value={value} options={options} disabled={disabled} onChange={(next) => onChange(next === NONE ? undefined : next)} />;
}

/** The shell of the next launch. The shells this machine has, and the one stored if it has gone. */
function ShellSelect({ id, value, shells, onChange }: { id: string; value: ShellKind; shells: readonly ShellKind[]; onChange: (shell: ShellKind) => void }) {
  const t = useMessages(canvasMessages).selection;
  const choices = shells.includes(value) ? shells : [value, ...shells];
  return <Choice id={id} label={t.shell} value={value} options={choices.map((shell) => ({ value: shell, label: SHELL_LABELS[shell] }))} onChange={(shell) => onChange(shell as ShellKind)} />;
}

/** What its box says of Remote Control: its state, or nothing while it is simply off. */
function remoteState(link: RemoteLink | undefined, wanted: boolean, running: boolean, states: { on: string; connecting: string; pending: string; requested: string; nextStart: string }): string | null {
  if (link?.state === "on") return states.on;
  if (link?.state === "connecting") return states.connecting;
  if (link?.state === "pending") return states.pending;
  if (link?.state === "error") return link.error ? remoteErrorText(link.error) : null;
  if (wanted) return running ? states.requested : states.nextStart;
  return null;
}

/** Remote Control of the Claude session, the same switch as its header's phone: it applies to a running session at once. */
function RemoteRow({ nodeId, wanted, running }: { nodeId: string; wanted: boolean; running: boolean }) {
  const t = useMessages(canvasMessages).selection;
  const link = useRemoteLink(nodeId);
  const id = useId();
  const state = remoteState(link, wanted, running, t.remoteStates);
  return (
    <>
      <label htmlFor={id} className="truncate text-xs leading-7 text-dp-text-2">
        {t.remoteControl}
      </label>
      <div className="flex h-7 min-w-0 items-center gap-2">
        <Checkbox id={id} aria-label={t.remoteControl} checked={wanted} onCheckedChange={(checked) => switchRemote(nodeId, checked === true)} onMouseDown={keepCanvasFocus} className={QUIET_BOX} />
        {state && <span className={cn("min-w-0 truncate text-xs", link?.state === "error" ? "text-dp-danger" : "text-dp-text-3")}>{state}</span>}
      </div>
    </>
  );
}

/**
 * The folder of a terminal: its path, a copy of it and, unless it is fixed
 * (`FolderLock`), "Change…", which picks another one for the next launch. A
 * Claude terminal that moves starts a new conversation (Claude keeps each one
 * with its folder): a toast says so when it happens, not before.
 */
function FolderField({ nodeId, session, lock }: { nodeId: string; session: TerminalPayload; lock: FolderLock | null }) {
  const t = useMessages(canvasMessages).selection;
  const change = async () => {
    let picked: string | string[] | null;
    try {
      picked = await open({ directory: true, defaultPath: session.cwd || undefined, title: t.pickFolder });
    } catch (error) {
      toast.error(t.pickFolderFailed(String(error)));
      return;
    }
    if (typeof picked !== "string") return;
    // The store as it is after the picker: a mission may have started while it was open.
    const current = latestSession(nodeId);
    if (!current || folderLockOf(nodeId, nodesStore.getState().nodes)) return;
    const patch = folderChange(current, picked);
    if (!patch) return;
    noteLaunchChange(nodeId, current);
    updateSession(nodeId, patch);
    if (current.agent === "claude") toast.info(t.folderNewConversation);
  };

  return <FolderPath cwd={session.cwd} onChange={lock ? undefined : () => void change()} />;
}

/**
 * The terminal's folder, where its sessions live. Cut from the start, so the
 * end of the path, the part that tells folders apart, stays in view; the whole
 * path on hover, and a copy of it. With `onChange`, a button picks another.
 */
function FolderPath({ cwd, onChange }: { cwd: string; onChange?: () => void }) {
  const t = useMessages(canvasMessages).selection;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyPath = () =>
    void navigator.clipboard.writeText(cwd).then(
      () => setCopied(true),
      () => toast.error(t.copyPathFailed),
    );

  return (
    <div className="flex h-7 items-center gap-1">
      {/* rtl cuts the start; bdi keeps the path itself left to right, a leading "/" or "~" included. */}
      <p data-folder title={cwd} className="min-w-0 flex-1 truncate font-mono text-xs text-dp-text-2" style={{ direction: "rtl", textAlign: "left" }}>
        <bdi>{cwd}</bdi>
      </p>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t.copyPath} onMouseDown={keepCanvasFocus} onClick={copyPath} className="text-dp-text-2 hover:text-dp-text">
            {copied ? <Check className="size-3.5" /> : <ClipboardCopy className="size-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {copied ? t.pathCopied : t.copyPath}
        </TooltipContent>
      </Tooltip>
      {onChange && (
        <Button type="button" variant="secondary" size="sm" aria-label={t.changeFolderLabel} onMouseDown={keepCanvasFocus} onClick={onChange} className="text-xs font-normal text-dp-text-2 hover:text-dp-text">
          {t.changeFolder}
        </Button>
      )}
      <span role="status" className="sr-only">
        {copied ? t.pathCopied : ""}
      </span>
    </div>
  );
}
