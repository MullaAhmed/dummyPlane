import { useEffect, useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { useStore } from "zustand";
import { useActiveTerminal } from "@/canvas/activeTerminal";
import { useCanvas } from "@/canvas/canvasStore";
import { isGroup } from "@/canvas/groups";
import { Button } from "@/components/ui/button";
import { AGENTS } from "@/agents/catalog";
import { CommandInput } from "@/agents/CommandInput";
import { HINT_KEY, historyStore } from "@/agents/history";
import { activeTarget, selectionChips, selectionTargets, targetAgents, type Target } from "@/agents/targets";
import { useMessages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { terminalOf, useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { useWorkspaces } from "@/store/workspaces";
import { shellMessages } from "./messages";

/** The bar under the chips: a command for the workspace's agents. */
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
  // Who Enter reaches without `@` shows as `@` chips, as if typed: the selected terminals and groups, else the active terminal.
  const autoTargets = useMemo<Target[]>(
    () => (nothingSelected ? (activeName && active !== null ? [{ kind: "agent", id: active }] : []) : selectionChips(selectedIds, frames, agents.map((a) => a.id))),
    [nothingSelected, activeName, active, selectedIds, frames, agents],
  );

  return (
    // A panel round enough (rounded-xl, 16) to hold Send's 8px corner 8px in from its own (16 = 8 + 8).
    <div data-command-bar className="dp-glass-strong pointer-events-auto flex min-h-12 w-[680px] max-w-[calc(100vw-360px)] items-end gap-2 rounded-xl py-2 pl-3 pr-2">
      {/* The prompt sits at the foot of the bar, centred on Send, however tall the field grows. */}
      <ChevronRight className="mb-2 size-4 shrink-0 text-dp-text-3" aria-hidden />
      <CommandInput
        agents={agents}
        groups={groups}
        fallback={fallback}
        placeholder={activeName ? t.placeholderTo(activeName) : t.placeholder}
        // The name stays generic: the active terminal's chip can be removed or replaced, the name would then lie.
        label={t.placeholder}
        emptyHint={t.emptyHint}
        sendsTo={activeName}
        autoTargets={autoTargets}
        fromSelection={!nothingSelected}
      />
    </div>
  );
}

/** The hint "Try @all run the tests", above the chips until dismissed. */
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
    // rounded-lg (12), 4 in: its ✕ (icon-xs) is 8 round.
    <div className="dp-glass-strong pointer-events-auto flex items-center gap-2 rounded-lg py-1 pl-3 pr-1 text-xs text-dp-text-2">
      {t.hint}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t.hideHint}
        onClick={() => {
          setShown(false);
          void setSetting(HINT_KEY, true).catch(() => undefined);
        }}
        className="text-dp-text-2 hover:text-dp-text"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
