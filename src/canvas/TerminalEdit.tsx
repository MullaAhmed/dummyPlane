import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronUp, ClipboardCopy, Copy, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PanelTabs, PanelTabsContent, PanelTabsList, PanelTabsTrigger } from "@/components/PanelTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { duplicateTerminal, requestClose } from "@/fleet/terminals";
import { modelLabel } from "@/mission/router";
import { nodesStore, terminalOf, useNodes, type NodeRecord, type NodesState } from "@/store/nodes";
import { ExtensionList, useClaudeExtensions, type ExtensionKind } from "./ExtensionList";
import { canvasMessages } from "./messages";
import { keepCanvasFocus, PanelAction } from "./PanelAction";

/** The terminal alone on the selection, if the selection is exactly one terminal. */
export function selectedTerminalId(selectedIds: readonly string[], nodes: Record<string, NodeRecord>): string | null {
  return selectedIds.length === 1 && nodes[selectedIds[0]]?.kind === "terminal" ? selectedIds[0] : null;
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
 * What a selected terminal lets you do without opening its menu. General:
 * rename it, copy it (a duplicate beside it), delete it (closing it, with the
 * same confirmation as its header's X), change its name and, for a custom
 * command, the command (read at the next launch); its folder is shown, not
 * changed; a model a mission chose can go back to the default. A Claude
 * terminal also gets its skills, plugins, MCP servers and subagents, each on or
 * off for it alone. The other options (shell, title) stay under the agent
 * icon's "Options…". The panel folds back to its Edit tab (SelectionPanel).
 */
export function TerminalEdit({ nodeId, onFold }: { nodeId: string; onFold: () => void }) {
  const t = useMessages(canvasMessages).selection;
  const payload = useNodes((s) => terminalOf(s.nodes[nodeId]));
  const workspaceId = useNodes((s) => s.nodes[nodeId]?.workspaceId);
  const [tab, setTab] = useState<Tab>("general");
  const nameField = useRef<HTMLInputElement>(null);
  const bodyId = useId();
  const claude = payload?.agent === "claude";
  const shown: Tab = claude ? tab : "general";
  const { lists, retry } = useClaudeExtensions(payload?.cwd ?? "", payload?.accountId, claude && shown !== "general");
  if (!payload) return null;

  const update = (patch: Parameters<NodesState["update"]>[1]) => nodesStore.getState().update(nodeId, patch);

  const commitName = (value: string) => {
    const name = value.trim();
    if (name && name !== payload.name) update({ name });
  };
  const commitCommand = (value: string) => {
    const command = value.trim();
    if (command !== payload.command) update({ command });
  };
  const rename = () => {
    nameField.current?.focus();
    nameField.current?.select();
  };
  const copy = () => {
    if (!workspaceId) return;
    duplicateTerminal(workspaceId, nodeId).catch((error: unknown) => toast.error(t.copyFailed(String(error))));
  };

  // A field starts from the stored value again whenever the stored value changes (a rename from the header, an undo).
  // One column at most the panel's width (grid-cols-1): an auto column would widen to the folder's whole path.
  const general = (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex gap-1.5">
        <PanelAction icon={<Pencil className="size-3.5" />} label={t.rename} onClick={rename} />
        <PanelAction icon={<Copy className="size-3.5" />} label={t.copy} onClick={copy} />
        <PanelAction icon={<Trash2 className="size-3.5" />} label={t.delete} onClick={() => requestClose(nodeId)} danger />
      </div>
      <Field label={t.name}>
        <Input
          ref={nameField}
          key={`name:${payload.name}`}
          aria-label={t.name}
          defaultValue={payload.name}
          onBlur={(e) => commitName(e.currentTarget.value)}
          onKeyDown={endEdit(payload.name)}
          className={FIELD}
        />
      </Field>
      <Field label={t.folder}>
        <FolderPath cwd={payload.cwd} />
      </Field>
      {payload.agent === "custom" && (
        <Field label={t.command}>
          <Input
            key={`command:${payload.command}`}
            aria-label={t.command}
            defaultValue={payload.command}
            placeholder="npm run dev"
            onBlur={(e) => commitCommand(e.currentTarget.value)}
            onKeyDown={endEdit(payload.command)}
            className={cn(FIELD, "font-mono")}
          />
        </Field>
      )}
      {payload.model && (
        <Field label={t.model}>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-xs text-dp-text">{modelLabel(payload.model)}</span>
            <Button type="button" variant="ghost" size="xs" onClick={() => update({ model: undefined })}>
              {t.defaultModel}
            </Button>
          </div>
        </Field>
      )}
      {payload.agent === "custom" && <p className="text-xs text-dp-text-3">{t.nextLaunch}</p>}
    </div>
  );

  return (
    <section aria-label={t.edit} className="flex min-h-0 flex-col gap-3">
      {/* The panel's head: its title in the primary text, a step above the field labels; the chevron quiet until pointed at. */}
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-(length:--text-ui) leading-6 font-medium text-dp-text">{t.editTerminal(payload.name || t.thisTerminal)}</p>
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
        {claude ? (
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
                <ExtensionList nodeId={nodeId} kind={kind} cwd={payload.cwd} choice={payload.extensions} lists={lists} onRetry={retry} />
              </PanelTabsContent>
            ))}
          </PanelTabs>
        ) : (
          <div className={cn(SCROLLS, "grid grid-cols-1 gap-3")}>
            {general}
            <p className="text-xs text-dp-text-3">{t.claudeOnly}</p>
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

/**
 * The terminal's folder, read only: it is where its sessions live. Cut from
 * the start, so the end of the path, the part that tells folders apart, stays
 * in view; the whole path on hover, and a copy of it.
 */
function FolderPath({ cwd }: { cwd: string }) {
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
    <div className="flex items-center gap-1">
      {/* rtl cuts the start; bdi keeps the path itself left to right, a leading "/" or "~" included. */}
      <p data-folder title={cwd} className="min-w-0 flex-1 truncate font-mono text-xs text-dp-text-2" style={{ direction: "rtl", textAlign: "left" }}>
        <bdi>{cwd}</bdi>
      </p>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t.copyPath}
            onMouseDown={keepCanvasFocus}
            onClick={copyPath}
            className="-mr-1 text-dp-text-2 hover:text-dp-text"
          >
            {copied ? <Check className="size-3.5" /> : <ClipboardCopy className="size-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {copied ? t.pathCopied : t.copyPath}
        </TooltipContent>
      </Tooltip>
      <span role="status" className="sr-only">
        {copied ? t.pathCopied : ""}
      </span>
    </div>
  );
}
