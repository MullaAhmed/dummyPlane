import { getCurrentWindow } from "@tauri-apps/api/window";
import { onAction, sendNotification, type ActionPerformed } from "@tauri-apps/plugin-notification";
import { nativeNotificationsStore } from "@/app/nativeNotifications";
import { goToAgent } from "@/commands/goToRun";
import { currentWaitingAgents, openAgent } from "@/agents/waitingAgents";
import { messages } from "@/i18n";
import { recordNotification } from "@/notifications/capture";
import { notificationsStore } from "@/notifications/store";
import { agentActivityStore } from "@/store/agentActivity";
import { projectsStore } from "@/store/projects";
import { shellMessages } from "./messages";

const warn = (error: unknown) => console.warn("Windows notification failed", error);

/**
 * A question for the notification panel, whatever the window and the "Windows notifications" setting: the
 * Windows notification's words, the agent as its plane, unread until the agent no longer waits.
 */
function recordQuestion(nodeId: string) {
  const agent = currentWaitingAgents().find((a) => a.id === nodeId);
  if (!agent) return;
  const t = messages(shellMessages).notification;
  recordNotification({ type: "question", kind: "info", title: t.title(agent.name, t.waiting), description: t.question, context: { nodeId, workspaceId: agent.workspaceId } });
}

/** The panel's questions whose agent does not wait (any more): answered, or no longer asked. */
function readAnsweredQuestions() {
  const activities = agentActivityStore.getState().activities;
  const asked = new Set(notificationsStore.getState().entries.flatMap((e) => (e.type === "question" && !e.read && e.plane.nodeId ? [e.plane.nodeId] : [])));
  for (const nodeId of asked) if (activities[nodeId]?.activity !== "waiting") notificationsStore.getState().markQuestionsRead(nodeId);
}

async function alertFor(nodeId: string) {
  if (!nativeNotificationsStore.getState().enabled) return;
  const agent = currentWaitingAgents().find((a) => a.id === nodeId);
  if (!agent || (await getCurrentWindow().isFocused())) return;
  const t = messages(shellMessages).notification;
  sendNotification({ title: t.title(agent.name, t.waiting), body: t.question, extra: { nodeId } });
}

/**
 * A click on the notification: back to the window, on the agent if it still waits and a canvas can show it.
 * A finish's notification (`./finishAlert`) arrives on its agent if it is still in the open project.
 */
async function comeBack({ actionId, notification }: ActionPerformed) {
  if (actionId !== "tap") return;
  const appWindow = getCurrentWindow();
  await appWindow.unminimize();
  await appWindow.setFocus();
  const nodeId = notification?.extra.nodeId;
  const agent =
    notification?.extra.finished === true && typeof nodeId === "string" ? openAgent(nodeId) : currentWaitingAgents().find((a) => a.id === nodeId);
  if (agent && projectsStore.getState().view === "project") goToAgent(agent);
}

/**
 * A Windows notification when an agent starts waiting while the window is not
 * focused, and the question in the notification panel, read once the agent no
 * longer waits. Installed after the activity snapshot, so a reload does not
 * repeat the waits already known; a question kept from before whose agent no
 * longer waits is read then. Its failures are only logged: the notice in the
 * window says the same.
 */
export function installWaitingAlerts(): () => void {
  const listening = onAction((event) => void comeBack(event).catch(warn)).catch(warn);
  readAnsweredQuestions();
  const unsubscribe = agentActivityStore.subscribe((state, previous) => {
    for (const [nodeId, { activity }] of Object.entries(state.activities)) {
      if (activity === "waiting" && previous.activities[nodeId]?.activity !== "waiting") {
        recordQuestion(nodeId);
        void alertFor(nodeId).catch(warn);
      }
    }
    // Out of waiting by any way: it works again, goes idle, or its process ended and it left the list.
    for (const [nodeId, { activity }] of Object.entries(previous.activities)) {
      if (activity === "waiting" && state.activities[nodeId]?.activity !== "waiting") notificationsStore.getState().markQuestionsRead(nodeId);
    }
  });
  return () => {
    unsubscribe();
    void listening.then((listener) => listener?.unregister());
  };
}
