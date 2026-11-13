import { toastError } from "@/lib/errorToast";
import { goToNode, nodeTarget } from "@/commands/goToRun";
import { requestArrival } from "@/commands/pendingArrival";
import { messages } from "@/i18n";
import { nodeNameOf, nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { notificationsMessages } from "./messages";
import { notificationsStore, type NotificationEntry } from "./store";

/**
 * A click on a notification: it is read, and the view goes to its plane. Its project opens if another one (or
 * the home screen) is shown, its workspace is selected, and the node it is about is centred when it is still
 * there. A popup about a workspace or project that is gone only becomes read: there is nowhere to go.
 */
export async function openNotification(entry: NotificationEntry) {
  notificationsStore.getState().markRead(entry.id);
  const { projectId, workspaceId, nodeId } = entry.plane;
  if (!workspaceId) return;
  const t = messages(notificationsMessages);

  const shown = projectsStore.getState().view === "project";
  const open = workspacesStore.getState().projectId;
  // The node it is about, if it is still there: a closed one leaves the workspace to go to.
  const record = nodeId ? nodesStore.getState().nodes[nodeId] : undefined;
  const target = nodeId && record ? { nodeId, label: nodeNameOf(record) || entry.title } : null;

  const elsewhere = projectId !== null && (!shown || open !== projectId);
  if (elsewhere) {
    const project = projectsStore.getState().projects.find((p) => p.id === projectId);
    if (!project) return;
    // The canvas of the project opens a moment later: the node is reached once its scene is on screen.
    if (target) requestArrival(nodeTarget(workspaceId, target.nodeId, target.label));
    try {
      await projectsStore.getState().open(projectId);
    } catch (error) {
      toastError(t.openFailed(project.name), { error });
      return;
    }
  } else if (!shown) {
    return;
  }

  if (!workspacesStore.getState().workspaces.some((w) => w.id === workspaceId)) return;
  if (target) goToNode(workspaceId, target.nodeId, target.label);
  else workspacesStore.getState().select(workspaceId);
}
