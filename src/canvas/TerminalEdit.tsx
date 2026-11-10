import { useEffect, useId, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, ChevronUp, ClipboardCopy, Copy, Pencil, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PanelTabs, PanelTabsContent, PanelTabsList, PanelTabsTrigger } from "@/components/PanelTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { useAgents } from "@/agents/agentsStore";
import { requestCloseFleet, renameFleet } from "@/fleet/fleets";
import { duplicateTerminal, requestClose } from "@/agents/terminals";
import type { ShellKind } from "@/ipc/pty";
import { modelLabel } from "@/mission/router";
import { folderChange, folderLockOf, type FolderLock } from "@/nodes/terminal/folder";
import { SHELL_LABELS } from "@/nodes/terminal/launch";
import { resumeTerminal } from "@/nodes/terminal/registry";
import type { TerminalPayload } from "@/nodes/types";
import { nodeNameOf, nodesStore, sessionOf, updateSession, useNodes, type NodeRecord } from "@/store/nodes";
import { ExtensionList, useClaudeExtensions, type ExtensionKind } from "./ExtensionList";
import { canvasMessages } from "./messages";
import { keepCanvasFocus, PanelAction } from "./PanelAction";
import { forgetStartedChoice } from "./startedChoice";
import { forgetStartedLaunch, noteLaunchChange, useLaunchRestartPending } from "./startedLaunch";

/** The node alone on the selection, if the selection is exactly one terminal or one Fleet: the nodes that have an edit panel. */
export function selectedEditId(selectedIds: readonly string[], nodes: Record<string, NodeRecord>): string | null {
  const kind = selectedIds.length === 1 ? nodes[selectedIds[0]]?.kind : undefined;
  return kind === "terminal" || kind === "fleet" ? selectedIds[0] : null;
}

/** The panel's fields: as small as its actions (Input's own `md:text-sm` would win over a bare `text-xs`). */
const FIELD = "h-7 rounded-md text-xs md:text-xs";

type Tab = "general" | ExtensionKind;
const KINDS: readonly ExtensionKind[] = ["skills", "plugins", "mcp", "agents"];

/** Enter ends the edit and the field's blur saves it; Escape puts the stored value back first, so nothing changes. */
const endEdit = (stored: string) => (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Escape") event.currentTarget.value = stored;
  if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
};

/**
 * A field that cannot be empty, left: the trimmed text when it is a new value; null when there is nothing to
 * save, an empty field getting the stored text back (a blank name or title keeps the stored one).
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
 * menu. General: rename it, copy it (a duplicate beside it; not a Fleet), delete
 * it (closing it, with the same confirmation as its header's X), change its
 * name, its folder (a Fleet's and a mission agent's stay put), its shell, its
 * title (a Fleet's is its name) and, for a custom command, the command, all read
 * at the next launch, with an offer to restart a running one now; a model a
 * mission chose can go back to the default. A Claude terminal, and a Fleet,
 * also gets its skills, plugins, MCP servers and subagents, each on or off for
 * it alone. A Fleet is edited through its Claude session (`session`, nested in
 * its node). The panel folds back to its Edit tab (SelectionPanel).
 */
export function TerminalEdit({ nodeId, onFold }: { nodeId: string; onFold: () => void }) {
  const t = useMessages(canvasMessages).selection;
  const record = useNodes((s) => s.nodes[nodeId]);
  const lock = useNodes((s) => folderLockOf(nodeId, s.nodes));
  const shells = useAgents((s) => s.shells);
  const [tab, setTab] = useState<Tab>("general");
  const nameField = useRef<HTMLInputElement>(null);
  const bodyId = useId();
  const fleet = record?.kind === "fleet";
  const session = sessionOf(record);
  const name = nodeNameOf(record);
  const claude = session?.agent === "claude";
  const shown: Tab = claude ? tab : "general";
  const { lists, retry } = useClaudeExtensions(session?.cwd ?? "", session?.accountId, claude && shown !== "general");
  const restartPending = useLaunchRestartPending(nodeId, session);
  if (!record) return null;

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
  const commitTitle = (input: HTMLInputElement) => {
    const title = keepStored(input, session?.title ?? "");
    if (title !== null) setLaunch({ title });
  };
  const rename = () => {
    nameField.current?.focus();
    nameField.current?.select();
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

  // A field starts from the stored value again whenever the stored value changes (a rename from the header, an undo).
  // One column at most the panel's width (grid-cols-1): an auto column would widen to the folder's whole path.
  const general = (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex gap-1.5">
        <PanelAction icon={<Pencil className="size-3.5" />} label={t.rename} onClick={rename} />
        {!fleet && <PanelAction icon={<Copy className="size-3.5" />} label={t.copy} onClick={copy} />}
        <PanelAction icon={<Trash2 className="size-3.5" />} label={t.delete} onClick={remove} danger />
      </div>
      <Field label={t.name}>
        <Input
          ref={nameField}
          key={`name:${name}`}
          aria-label={t.name}
          defaultValue={name}
          onBlur={(e) => commitName(e.currentTarget)}
          onKeyDown={endEdit(name)}
          className={FIELD}
        />
      </Field>
      {session && (
        <>
          <Field label={t.folder}>
            <FolderField nodeId={nodeId} session={session} lock={lock} />
          </Field>
          {session.agent === "custom" && (
            <Field label={t.command}>
              <Input
                key={`command:${session.command}`}
                aria-label={t.command}
                defaultValue={session.command}
                placeholder="npm run dev"
                onBlur={(e) => commitCommand(e.currentTarget.value)}
                onKeyDown={endEdit(session.command)}
                className={cn(FIELD, "font-mono")}
              />
            </Field>
          )}
          <Field label={t.shell}>
            <ShellSelect value={session.shell} shells={shells} onChange={(shell) => setLaunch({ shell })} />
          </Field>
          {!fleet && (
            <Field label={t.title}>
              <Input
                key={`title:${session.title}`}
                aria-label={t.title}
                defaultValue={session.title}
                onBlur={(e) => commitTitle(e.currentTarget)}
                onKeyDown={endEdit(session.title)}
                className={FIELD}
              />
            </Field>
          )}
          {claude && (
            <Field label={t.model}>
              <div className="flex h-7 items-center justify-between gap-2">
                <span className={cn("truncate text-xs", session.model ? "font-mono text-dp-text" : "text-dp-text-2")}>{session.model ? modelLabel(session.model) : t.defaultModel}</span>
                {session.model && (
                  <Button type="button" variant="ghost" size="sm" onMouseDown={keepCanvasFocus} onClick={() => updateSession(nodeId, { model: undefined })} className="text-xs font-normal text-dp-text-2 hover:text-dp-text">
                    {t.useDefaultModel}
                  </Button>
                )}
              </div>
            </Field>
          )}
          <p className="text-xs text-dp-text-3">{fleet ? t.nextLaunchFleet : session.agent === "custom" ? t.nextLaunchCustom : t.nextLaunch}</p>
          {restartPending && (
            <div className="flex items-center justify-between gap-3 border-t border-dp-line pt-2">
              <p className="min-w-0 truncate text-xs leading-7 text-dp-text-3">{t.launchChanged}</p>
              <Button type="button" variant="secondary" size="sm" onMouseDown={keepCanvasFocus} onClick={restart} className="text-xs font-normal text-dp-text-2 hover:text-dp-text">
                <RotateCw className="size-3.5" />
                {t.restartNow}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );

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
          <div className={cn(SCROLLS, "grid grid-cols-1 gap-3")}>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <p className="dp-label">{label}</p>
      {children}
    </div>
  );
}

/** The shell of the next launch. The shells this machine has, and the one stored if it has gone. */
function ShellSelect({ value, shells, onChange }: { value: ShellKind; shells: readonly ShellKind[]; onChange: (shell: ShellKind) => void }) {
  const t = useMessages(canvasMessages).selection;
  const choices = shells.includes(value) ? shells : [value, ...shells];
  return (
    <Select value={value} onValueChange={(shell) => shell !== value && onChange(shell as ShellKind)}>
      <SelectTrigger size="sm" aria-label={t.shell} className="w-full rounded-md text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((shell) => (
          <SelectItem key={shell} value={shell}>
            {SHELL_LABELS[shell]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The folder of a terminal: its path, a copy of it and, unless it is fixed
 * (`FolderLock`), "Change…", which picks another one for the next launch. It
 * says what a change costs a Claude terminal: its conversation stays with the
 * old folder, so a new one starts.
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
  };

  return (
    <div className="grid grid-cols-1 gap-1.5">
      <FolderPath cwd={session.cwd} onChange={lock ? undefined : () => void change()} />
      {lock && <p className="text-xs text-dp-text-3">{lock === "fleet" ? t.folderFleet : t.folderMission}</p>}
      {!lock && session.agent === "claude" && <p className="text-xs text-dp-text-3">{t.folderNewConversation}</p>}
    </div>
  );
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
