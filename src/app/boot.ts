import { messages } from "@/i18n";
import { appMessages } from "./messages";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { loadAgentsPanel } from "@/agents/agentsPanelState";
import { agentActivitySnapshot, onAgentActivity } from "@/ipc/activity";
import { onAgentSubagents } from "@/ipc/mcp";
import { onPtyExit, ptyList } from "@/ipc/pty";
import { installMcp } from "@/mcp/router";
import { connectNotifications, loadNotifications } from "@/notifications/store";
import { installMissionClock } from "@/mission/clock";
import { installKeepAwake } from "@/mission/keepAwake";
import { installMissionEvents } from "@/mission/events";
import { installRedelivery } from "@/mission/redeliver";
import { installRestartWatch } from "@/mission/restartWatch";
import { installSubagentNodes } from "@/nodes/subagent/sync";
import { forgetLivePty, setLivePtys } from "@/nodes/terminal/registry";
import { installFinishedStops } from "@/agents/finishedStop";
import { installFollowWaiting } from "@/agents/followWaiting";
import { installWaitingAlerts } from "@/shell/waitingAlert";
import { installFinishAlerts } from "@/shell/finishAlert";
import { installBoardDoneAlerts } from "@/shell/boardDoneAlert";
import { agentActivityStore } from "@/store/agentActivity";
import { subagentsStore } from "@/store/subagents";
import { terminalStatusStore } from "@/store/terminalStatus";
import { installUsage } from "@/usage/usageStore";
import { installCodexSessions } from "@/nodes/terminal/codexSessions";
import { installShellAgents } from "@/nodes/terminal/shellAgent";
import { projectsStore, setForgetWorkspaces } from "@/store/projects";
import { saveBeforeClose } from "./close";
import { forgetWorkspaces } from "./forget";
import { loadThemeSettings } from "./theme";
import { loadArrangeLayout } from "./arrangeLayoutSetting";
import { loadAutoArrange } from "./autoArrangeSetting";
import { loadFollowWaiting } from "./followWaitingSetting";
import { loadFinishAlerts } from "./finishAlertsSetting";
import { loadFleetAgent } from "@/fleet/fleetAgent";
import { loadNativeNotifications } from "./nativeNotifications";
import { loadModelRouter } from "./modelRouterSetting";
import { installResetNotice } from "./resetNotice";
import { loadSubagentSettings } from "./subagentSettings";
import { loadUpdateSettings, startUpdateChecks } from "./updates";
import { syncWindowTitle } from "./windowTitle";

let booting: Promise<void> | undefined;

/**
 * Starts the app once (React's StrictMode runs effects twice in development).
 * Order matters: exits are listened to before any terminal starts, and running
 * sessions are known before any terminal node mounts.
 */
export function boot(): Promise<void> {
  booting ??= (async () => {
    // From the first moment: what the panel keeps is recorded, the saved list is read below.
    connectNotifications();
    // Before any setting is read or written: a list a write resets is said at once, once.
    installResetNotice();
    await loadThemeSettings();
    await loadUpdateSettings();
    await loadNativeNotifications();
    await loadFollowWaiting();
    await loadFinishAlerts();
    await loadAutoArrange();
    await loadArrangeLayout();
    await loadFleetAgent();
    await loadSubagentSettings();
    await loadModelRouter();
    await loadAgentsPanel();
    await loadNotifications();
    await onPtyExit(({ nodeId, exitCode }) => {
      forgetLivePty(nodeId);
      terminalStatusStore.getState().set(nodeId, { state: "exited", code: exitCode });
      agentActivityStore.getState().remove(nodeId);
    });
    // Listened to before the snapshot: no change can fall between the two.
    await onAgentActivity((event) => agentActivityStore.getState().apply(event));
    await onAgentSubagents(({ nodeId, running }) => subagentsStore.getState().set(nodeId, running));
    const activity = await agentActivitySnapshot();
    agentActivityStore.getState().load(activity.activities);
    // What the sessions ran before this page loaded: the count is not lost on a reload.
    for (const { nodeId, running } of activity.subagents ?? []) subagentsStore.getState().set(nodeId, running);
    await installSubagentNodes();
    if (!activity.hooksAvailable) toast.warning(messages(appMessages).hooksDown);
    await installMcp();
    await installUsage();
    await installCodexSessions();
    // An agent the user starts by hand in a Shell terminal makes it that agent's.
    await installShellAgents();
    installMissionEvents();
    // A sub-task dummyPlane had not typed before it restarted goes once its agent's terminal runs again.
    installRedelivery();
    // A mission member's restart, whoever asks for it: a full team it takes past Max agents is told, a failed one frees its seat.
    installRestartWatch();
    installMissionClock();
    installKeepAwake();
    installWaitingAlerts();
    installFollowWaiting();
    installFinishAlerts();
    // A board whose cards are all done, from here on: those already done say nothing.
    installBoardDoneAlerts();
    setLivePtys(await ptyList());
    // Once the sessions alive in Rust are known: a finished agent still running after a webview reload stops too.
    installFinishedStops();
    await getCurrentWindow().onCloseRequested(saveBeforeClose);
    setForgetWorkspaces(forgetWorkspaces);
    syncWindowTitle();
    await projectsStore.getState().init();
    startUpdateChecks();
  })();
  return booting;
}
