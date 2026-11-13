import { toastError } from "@/lib/errorToast";
import { currentWaitingAgents, nextWaiting, type OpenAgent } from "@/agents/waitingAgents";
import { messages } from "@/i18n";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import type { GoToItem } from "./goTo";
import { commandsMessages } from "./messages";
import { arrivalPending, requestArrival, type PendingArrival } from "./pendingArrival";
import { reach } from "./reach";

/** Reaches a node or a group, switching to its workspace first if it is not on screen. */
function reachTarget(target: PendingArrival) {
  const workspaces = workspacesStore.getState();
  // A second click during the switch finds the workspace active but its scene not there yet.
  if (target.workspaceId !== workspaces.activeId || arrivalPending(target.workspaceId)) {
    requestArrival(target);
    workspaces.select(target.workspaceId);
    return;
  }
  if (!reach(target.kind, target.id) && !target.quiet) toastError(messages(commandsMessages).goTo.gone(target.label));
}

/** Enter on a line of "Go to". */
export function goTo(item: GoToItem) {
  switch (item.kind) {
    case "workspace":
      if (item.workspaceId) workspacesStore.getState().select(item.workspaceId);
      return;
    case "project":
      if (item.projectId) {
        void projectsStore
          .getState()
          .open(item.projectId)
          .catch((error: unknown) => toastError(messages(commandsMessages).goTo.openFailed, { error }));
      }
      return;
    default:
      if (item.workspaceId && item.targetId) reachTarget({ workspaceId: item.workspaceId, kind: item.kind, id: item.targetId, label: item.label });
  }
}

/**
 * A node by its id, as an arrival: a fleet reaches like a terminal, whatever else the node is, and one not
 * loaded yet (its workspace's scene is read on the first visit) is reached as a terminal is. `quiet`: it says
 * nothing when the node is gone.
 */
export function nodeTarget(workspaceId: string, nodeId: string, label: string, quiet = false): PendingArrival {
  const kind = nodesStore.getState().nodes[nodeId]?.kind === "fleet" ? "fleet" : "terminal";
  return { workspaceId, kind, id: nodeId, label, quiet };
}

/** A node by its id, wherever it is: its workspace first if it is not on screen. The notification panel's click. */
export function goToNode(workspaceId: string, nodeId: string, label: string, quiet = false) {
  reachTarget(nodeTarget(workspaceId, nodeId, label, quiet));
}

let lastReached: string | null = null;

/** A click on the notification, or on an agent's finish alert. */
export function goToAgent(agent: OpenAgent) {
  lastReached = agent.id;
  reachTarget({ workspaceId: agent.workspaceId, kind: agent.kind, id: agent.id, label: agent.name });
}

/**
 * The next waiting agent, after the current node. The
 * keyboard of a fleet is not in the context, which keeps naming the
 * last terminal: a fleet just reached counts as the current node, or
 * the command would never get past it.
 */
export function goToNextWaiting(currentId: string | null) {
  const agents = currentWaitingAgents();
  const reached = agents.find((a) => a.id === lastReached);
  const next = nextWaiting(agents, reached?.kind === "fleet" ? reached.id : currentId);
  if (next) goToAgent(next);
}
