import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n";
import { modelLabel } from "@/mission/router";
import { nodesStore, terminalOf, useNodes, type NodeRecord, type NodesState } from "@/store/nodes";
import { canvasMessages } from "./messages";

/** The terminal alone on the selection, if the selection is exactly one terminal. */
export function selectedTerminalId(selectedIds: readonly string[], nodes: Record<string, NodeRecord>): string | null {
  return selectedIds.length === 1 && nodes[selectedIds[0]]?.kind === "terminal" ? selectedIds[0] : null;
}

/** Enter ends the edit and the field's blur saves it; Escape puts the stored value back first, so nothing changes. */
const endEdit = (stored: string) => (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Escape") event.currentTarget.value = stored;
  if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
};

/**
 * The few things a selected terminal lets you change without opening its
 * menu: its name, its folder, and, for a custom command, the command; a model
 * a mission chose can go back to the default. The other options (shell, title)
 * stay under the agent icon's "Options…". The folder and the command are read
 * at the next launch, like the options dialog; the name applies at once.
 */
export function TerminalEdit({ nodeId }: { nodeId: string }) {
  const t = useMessages(canvasMessages).selection;
  const payload = useNodes((s) => terminalOf(s.nodes[nodeId]));
  if (!payload) return null;

  const update = (patch: Parameters<NodesState["update"]>[1]) => nodesStore.getState().update(nodeId, patch);

  const commitName = (value: string) => {
    const name = value.trim();
    if (name && name !== payload.name) update({ name });
  };
  const commitFolder = (value: string) => {
    const cwd = value.trim();
    if (cwd && cwd !== payload.cwd) update({ cwd });
  };
  const commitCommand = (value: string) => {
    const command = value.trim();
    if (command !== payload.command) update({ command });
  };
  const browse = async () => {
    const picked = await open({ directory: true, defaultPath: payload.cwd || undefined, title: t.workingFolder });
    if (typeof picked === "string") commitFolder(picked);
  };

  // A field starts from the stored value again whenever the stored value changes (a rename from the header, an undo).
  return (
    <section aria-label={t.edit} className="grid gap-3">
      <p className="dp-label">{t.editTerminal(payload.name || t.thisTerminal)}</p>
      <Field label={t.name}>
        <Input
          key={`name:${payload.name}`}
          aria-label={t.name}
          defaultValue={payload.name}
          onBlur={(e) => commitName(e.currentTarget.value)}
          onKeyDown={endEdit(payload.name)}
          className="h-7 text-xs"
        />
      </Field>
      <Field label={t.folder}>
        <div className="flex gap-1.5">
          <Input
            key={`cwd:${payload.cwd}`}
            aria-label={t.folder}
            defaultValue={payload.cwd}
            onBlur={(e) => commitFolder(e.currentTarget.value)}
            onKeyDown={endEdit(payload.cwd)}
            className="h-7 font-mono text-xs"
          />
          <Button type="button" variant="outline" size="icon-sm" aria-label={t.browse} title={t.browse} onClick={() => void browse()}>
            <FolderOpen />
          </Button>
        </div>
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
            className="h-7 font-mono text-xs"
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
      <p className="text-xs text-dp-text-3">{t.nextLaunch}</p>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <p className="dp-label">{label}</p>
      {children}
    </div>
  );
}
