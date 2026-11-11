import { useEffect, useState } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { toast } from "sonner";
import { messages } from "@/i18n";
import { useStore } from "zustand";
import { canvasStore } from "@/canvas/canvasStore";
import { loadScene } from "@/canvas/sceneCache";
import { tallyAgents, workspaceNodeIds } from "@/agents/agentState";
import { useActivities } from "@/store/agentActivity";
import { useNodes } from "@/store/nodes";
import { useProjects } from "@/store/projects";
import { terminalStatusStore } from "@/store/terminalStatus";
import { useWorkspaces } from "@/store/workspaces";
import { commandsMessages } from "./messages";
import { goToItems, type GoToItem } from "./goTo";

/**
 * The items of "Go to" for the palette that just opened (spec window
 * §7.2): the scene on screen as it is, the other workspaces' scenes read by
 * the scene cache (one SQLite read per workspace and session); their lines
 * come as they are read. An unreadable scene leaves its items out.
 */
export function useGoToData(): { items: GoToItem[]; loading: boolean } {
  const view = useProjects((s) => s.view);
  const projects = useProjects((s) => s.projects);
  const activeProjectId = useProjects((s) => s.activeId);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaces((s) => s.activeId);
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const activities = useActivities();
  const [scenes, setScenes] = useState<Record<string, readonly ExcalidrawElement[]>>({});
  const home = view !== "project";

  useEffect(() => {
    if (home) return;
    let alive = true;
    const keep = (id: string, elements: readonly ExcalidrawElement[]) => alive && setScenes((s) => ({ ...s, [id]: elements }));
    const api = canvasStore.getState().api;
    for (const workspace of workspaces) {
      if (workspace.id === activeWorkspaceId && api) {
        keep(workspace.id, api.getSceneElements());
        continue;
      }
      loadScene(workspace.id).then(
        (scene) => keep(workspace.id, scene.initialData.elements ?? []),
        () => {
          if (!alive) return;
          toast.error(messages(commandsMessages).goTo.unreadable(workspace.name));
          keep(workspace.id, []);
        },
      );
    }
    return () => {
      alive = false;
    };
  }, [home, workspaces, activeWorkspaceId]);

  // A workspace's "N active": its live agents, as its tab's badge and the title bar count them.
  const live = Object.fromEntries(workspaces.map((w) => [w.id, tallyAgents(workspaceNodeIds(nodes, w.id), nodes, statuses, activities).active]));
  // At home no project is open, even if "All projects…" kept the last one's id.
  const items = goToItems({ home, projects, activeProjectId: home ? null : activeProjectId, workspaces, activeWorkspaceId, scenes, nodes, live });
  return { items, loading: !home && workspaces.some((w) => !(w.id in scenes)) };
}
