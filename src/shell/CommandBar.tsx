import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useStore } from "zustand";
import { useActiveTerminal } from "@/canvas/activeTerminal";
import { useCanvas } from "@/canvas/canvasStore";
import { isGroup } from "@/canvas/groups";
import { AGENTS } from "@/fleet/catalog";
import { CommandInput } from "@/fleet/CommandInput";
import { HINT_KEY, historyStore } from "@/fleet/history";
import { activeTarget, selectionTargets, targetAgents } from "@/fleet/targets";
import { useMessages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { terminalOf, useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { useWorkspaces } from "@/store/workspaces";
import { shellMessages } from "./messages";

/** The bar under the chips (spec habillage §5.6, §12): a command for the workspace's agents. */
export function CommandBar() {
  const t = useMessages(shellMessages).commandBar;
  const nodeIds = useCanvas((s) => s.nodeIds);
  const frames = useCanvas((s) => s.frames);
  const selectedIds = useCanvas((s) => s.view.selectedIds);
  const nodes = useNodes((s) => s.nodes);
  const projectId = useWorkspaces((s) => s.projectId);
  const activeId = useActiveTerminal();
  // A stopped, exited or failed session is no target; one still starting is (Send says it is not ready yet).
  const activeAlive = useStore(terminalStatusStore, (s) => {
    const state = activeId ? s.statuses[activeId]?.state : undefined;
    return state === "running" || state === "starting";
  });

  useEffect(() => {
    if (projectId) void historyStore.getState().load(projectId);
  }, [projectId]);

  const agents = useMemo(
    () =>
      targetAgents(
        nodeIds,
        (id) => {
          const payload = terminalOf(nodes[id]);
          return payload ? payload.name || AGENTS[payload.agent].label : undefined;
        },
        frames,
      ),
    [nodeIds, nodes, frames],
  );
  const groups = useMemo(() => frames.filter(isGroup), [frames]);
  // Without `@`: the selection, else, with nothing selected at all, the terminal the user last entered if it is still alive.
  const selected = useMemo(
    () => selectionTargets(selectedIds, frames, agents.map((a) => a.id)),
    [selectedIds, frames, agents],
  );
  const active = useMemo(
    () => activeTarget(activeId, agents.map((a) => a.id), () => activeAlive),
    [activeId, agents, activeAlive],
  );
  const nothingSelected = selectedIds.length === 0;
  const fallback = useMemo(() => (nothingSelected && active !== null ? [active] : selected), [nothingSelected, selected, active]);
  const activeName = nothingSelected && active !== null ? agents.find((a) => a.id === active)?.name : undefined;

  return (
    <div data-command-bar className="dp-glass-strong pointer-events-auto flex min-h-12 w-[680px] max-w-[calc(100vw-360px)] items-end gap-3 rounded-lg py-2 pl-3.5 pr-2">
      <span className="mb-1.5 shrink-0 text-base font-bold text-dp-accent-ink" aria-hidden>
        ›
      </span>
      <CommandInput
        agents={agents}
        groups={groups}
        fallback={fallback}
        placeholder={activeName ? t.placeholderTo(activeName) : t.placeholder}
        emptyHint={t.emptyHint}
        sendsTo={activeName}
      />
    </div>
  );
}

/** The hint "Try @all run the tests", above the chips until dismissed (spec §12). */
export function CommandHint() {
  const t = useMessages(shellMessages).commandBar;
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let alive = true;
    getSetting<boolean>(HINT_KEY).then(
      (dismissed) => alive && setShown(dismissed !== true),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  if (!shown) return null;
  return (
    <div className="dp-glass-strong pointer-events-auto flex items-center gap-2 rounded-lg py-1 pl-3 pr-1 text-xs text-dp-text-2">
      {t.hint}
      <button
        type="button"
        aria-label={t.hideHint}
        onClick={() => {
          setShown(false);
          void setSetting(HINT_KEY, true).catch(() => undefined);
        }}
        className="grid size-5 place-items-center rounded-md text-dp-text-2 transition-[color,background-color,transform] duration-150 ease-out motion-reduce:transition-none hover:bg-dp-hover hover:text-dp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97]"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
