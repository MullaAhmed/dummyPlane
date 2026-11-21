import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useStore } from "zustand";
import { useActiveTerminal } from "@/canvas/activeTerminal";
import { useCanvas } from "@/canvas/canvasStore";
import { isGroup } from "@/canvas/groups";
import { AGENTS } from "@/agents/catalog";
import { CommandInput } from "@/agents/CommandInput";
import { HINT_KEY, historyStore } from "@/agents/history";
import { activeTarget, broadcastAgents, selectionChips, selectionTargets, targetAgents, type Target } from "@/agents/targets";
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

  // The tip waits for the saved commands and for the saved dismissal: neither flashes it up and takes it back.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    getSetting<boolean>(HINT_KEY).then(
      (saved) => alive && setDismissed(saved === true),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  // A command in the history, sent now or before, is a send: the tip has done its work, here and for good.
  const historyLoaded = useStore(historyStore, (s) => s.loaded);
  const sent = useStore(historyStore, (s) => s.loaded && s.entries.length > 0);
  useEffect(() => {
    if (!sent || dismissed !== false) return;
    setDismissed(true);
    void setSetting(HINT_KEY, true).catch(() => undefined);
  }, [sent, dismissed]);

  const agents = useMemo(
    () =>
      targetAgents(
        nodeIds,
        (id) => {
          // A Fleet is written to by its name (`@fleet`), like an agent: its session is the one that plans and delegates.
          const record = nodes[id];
          if (record?.kind === "fleet") return record.payload.name;
          const payload = terminalOf(record);
          return payload ? payload.name || AGENTS[payload.agent].label : undefined;
        },
        frames,
        (id) => nodes[id]?.kind === "fleet",
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

  // With two agents or more there is someone to address as a group (`@all` leaves a Fleet out); an empty field says how, until the first send.
  const tip = dismissed === false && historyLoaded && !sent && broadcastAgents(agents).length >= 2;

  return (
    // A panel round enough (rounded-xl, 16) to hold Send's 8px corner 8px in from its own (16 = 8 + 8).
    // The field draws no ring of its own (outline-none), so the bar shows the keyboard's place: the shared accent ring, while the field has the focus.
    <div data-command-bar className="dp-glass-strong pointer-events-auto flex min-h-12 w-[680px] max-w-[calc(100vw-360px)] items-end gap-2 rounded-xl py-2 pl-3 pr-2 has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-dp-accent/70">
      {/* The prompt sits at the foot of the bar, centred on Send, however tall the field grows. */}
      <ChevronRight className="mb-2 size-4 shrink-0 text-dp-text-3" aria-hidden />
      <CommandInput
        agents={agents}
        groups={groups}
        fallback={fallback}
        placeholder={tip ? t.tip : activeName ? t.placeholderTo(activeName) : t.placeholder}
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
