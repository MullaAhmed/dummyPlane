import { forgetWorkspaces } from "@/app/forget";
import { confirmAction } from "@/components/confirm";
import { flushAll } from "@/lib/flush";
import { messages } from "@/i18n";
import { nodeNameOf, nodesStore } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { isCanvas, workspacesStore, type Workspace } from "@/store/workspaces";
import { shellMessages } from "./messages";

/**
 * Deletes a workspace after confirmation, stopping its terminals (spec V1 §8.5): the tab's × and the palette.
 * The code and notes tabs just close: their files are on disk, and what was being edited stays in memory
 * until the window closes, which asks about it (studio/QuitPrompt.tsx).
 */
export async function removeWorkspace(workspace: Workspace, running: number) {
  if (!isCanvas(workspace)) {
    await workspacesStore.getState().remove(workspace.id);
    forgetWorkspaces([workspace.id]);
    return;
  }
  const t = messages(shellMessages).removeWorkspace;
  // The agents it would stop, by name: a count alone does not say which work is lost.
  const names = Object.entries(nodesStore.getState().nodes)
    .filter(([id, node]) => node.workspaceId === workspace.id && isRunning(id))
    .map(([, node]) => nodeNameOf(node) || "Agent");
  const confirmed = await confirmAction({
    title: t.title(workspace.name),
    description: t.description(running, names),
    confirm: t.ok,
    cancel: t.cancel,
    destructive: true,
  });
  if (!confirmed) return;
  // Pending saves are written first: once the row is gone they would fail.
  await flushAll();
  await workspacesStore.getState().remove(workspace.id);
  forgetWorkspaces([workspace.id]);
}
