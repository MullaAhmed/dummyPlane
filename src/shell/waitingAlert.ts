import { getCurrentWindow } from "@tauri-apps/api/window";
import { onAction, sendNotification, type ActionPerformed } from "@tauri-apps/plugin-notification";
import { nativeNotificationsStore } from "@/app/nativeNotifications";
import { goToAgent } from "@/commands/goToRun";
import { currentWaitingAgents, openAgent, type WaitingAgent } from "@/agents/waitingAgents";
import { messages } from "@/i18n";
import { recordNotification } from "@/notifications/capture";
import { notificationsStore } from "@/notifications/store";
import { agentActivityStore, personActivities } from "@/store/agentActivity";
import { fleetDecisionsStore } from "@/store/fleetDecisions";
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
  recordNotification({ type: "question", kind: "info", title: t.title(agent.name, t.waiting), description: bodyOf(agent), context: { nodeId, workspaceId: agent.workspaceId } });
}

/** The notification's line: a fixed one, the question's, or the decision's a Fleet waits on. */
function bodyOf(agent: WaitingAgent): string {
  const t = messages(shellMessages).notification;
  return agent.decision ? t.decision[agent.decision] : t.question;
}

/**
 * A Windows notification for an agent that has been held long on the user (`@/mission/stalls`), while the window is
 * not focused: a login that ran out overnight is seen nowhere else. Its panel entry and popup are the caller's.
 */
export async function alertStuck(nodeId: string, title: string, body: string) {
  if (!nativeNotificationsStore.getState().enabled || (await getCurrentWindow().isFocused())) return;
  sendNotification({ title, body, extra: { nodeId } });
}

/** The panel's questions whose agent does not wait (any more): answered, or no longer asked. */
function readAnsweredQuestions() {
  const activities = personActivities();
  const asked = new Set(notificationsStore.getState().entries.flatMap((e) => (e.type === "question" && !e.read && e.plane.nodeId ? [e.plane.nodeId] : [])));
  for (const nodeId of asked) if (activities[nodeId]?.activity !== "waiting") notificationsStore.getState().markQuestionsRead(nodeId);
}

async function alertFor(nodeId: string) {
  if (!nativeNotificationsStore.getState().enabled) return;
  const agent = currentWaitingAgents().find((a) => a.id === nodeId);
  if (!agent || (await getCurrentWindow().isFocused())) return;
  const t = messages(shellMessages).notification;
  sendNotification({ title: t.title(agent.name, t.waiting), body: bodyOf(agent), extra: { nodeId } });
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
 * window says the same. A Fleet that waits on a decision its panel asks (a plan's
 * go-ahead, Land, Clean up) waits as an agent's question does (`personActivities`),
 * but one found standing as its Fleet is first read is not told again.
 */
export function installWaitingAlerts(): () => void {
  const listening = onAction((event) => void comeBack(event).catch(warn)).catch(warn);
  readAnsweredQuestions();
  let previous = personActivities();
  const changed = () => {
    const now = personActivities();
    if (now === previous) return;
    const before = previous;
    previous = now;
    for (const [nodeId, { activity, decision }] of Object.entries(now)) {
      if (activity !== "waiting" || before[nodeId]?.activity === "waiting") continue;
      if (decision && fleetDecisionsStore.getState().decisions[nodeId]?.standing) continue;
      recordQuestion(nodeId);
      void alertFor(nodeId).catch(warn);
    }
    // Out of waiting by any way: it works again, goes idle, its decision is taken, or its process ended and it left the list.
    for (const [nodeId, { activity }] of Object.entries(before)) {
      if (activity === "waiting" && now[nodeId]?.activity !== "waiting") notificationsStore.getState().markQuestionsRead(nodeId);
    }
  };
  const unsubscribe = agentActivityStore.subscribe(changed);
  const unsubscribeDecisions = fleetDecisionsStore.subscribe(changed);
  return () => {
    unsubscribe();
    unsubscribeDecisions();
    void listening.then((listener) => listener?.unregister());
  };
}
