import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useCanvas } from "@/canvas/canvasStore";
import { isGroup } from "@/canvas/groups";
import { AGENTS } from "@/fleet/catalog";
import { CommandInput } from "@/fleet/CommandInput";
import { HINT_KEY, historyStore } from "@/fleet/history";
import { selectionTargets, targetAgents } from "@/fleet/targets";
import { useMessages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { terminalOf, useNodes } from "@/store/nodes";
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
  const fallback = useMemo(
    () => selectionTargets(selectedIds, frames, agents.map((a) => a.id)),
    [selectedIds, frames, agents],
  );

  return (
    <div data-command-bar className="ov-glass-strong pointer-events-auto flex min-h-[46px] w-[680px] max-w-[calc(100vw-360px)] items-end gap-3 rounded-[16px] py-[7px] pl-3.5 pr-[7px]">
      <span className="mb-1.5 shrink-0 text-base font-bold text-ov-accent" aria-hidden>
        ›
      </span>
      <CommandInput
        agents={agents}
        groups={groups}
        fallback={fallback}
        placeholder={t.placeholder}
        emptyHint={t.emptyHint}
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
    <div className="ov-glass-strong pointer-events-auto flex items-center gap-2 rounded-[10px] py-1 pl-3 pr-1 text-xs text-ov-text-2">
      {t.hint}
      <button
        type="button"
        aria-label={t.hideHint}
        onClick={() => {
          setShown(false);
          void setSetting(HINT_KEY, true).catch(() => undefined);
        }}
        className="grid size-5 place-items-center rounded-[6px] hover:bg-ov-hover hover:text-ov-text"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
