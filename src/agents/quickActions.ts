import { toastError } from "@/lib/errorToast";
import { canvasStore } from "@/canvas/canvasStore";
import { messages } from "@/i18n";
import type { AgentId } from "@/ipc/pty";
import { workspacesStore } from "@/store/workspaces";
import { loadedAgents } from "./agentsStore";
import { defaultAgent } from "./catalog";
import { defaultLaunchOptions, launchAgent, type LaunchOptions } from "./launchAgent";
import { launchFolderStore, pickFolder } from "./launchFolder";
import { agentsMessages } from "./messages";
import { addFleet } from "@/fleet/fleets";
import { viewportCenter } from "./placement";
import type { Point } from "./terminals";

const reportLaunchError = (error: unknown) => toastError(messages(agentsMessages).launchFailed, { error, next: messages(agentsMessages).launchNext });

/**
 * An agent at `at`, else at the center of the view, in the group under it if any. It starts in the active workspace's folder, unless `options` says otherwise.
 */
export function launchAt(agent: AgentId, at?: Point, options: LaunchOptions = defaultLaunchOptions()) {
  const center = at ?? viewportCenter(canvasStore.getState().view);
  void launchAgent(agent, options, center).catch(reportLaunchError);
}

/** "New console": the default agent. */
export async function newConsole(at?: Point) {
  launchAt(defaultAgent(await loadedAgents()), at);
}

/**
 * "New terminal in folder…": asks for a folder, then starts the default agent there. A one-off: the
 * folder is offered again among the recent ones, but the next launches stay where they were.
 */
export async function newTerminalInFolder(at?: Point) {
  const from = defaultLaunchOptions().cwd;
  const folder = await pickFolder(from);
  if (!folder) return;
  launchFolderStore.getState().remember(folder);
  launchAt(defaultAgent(await loadedAgents()), at, { ...defaultLaunchOptions(), cwd: folder });
}

/** "Fleet": at `at`, else at the center of the view, like a launch. */
export function placeFleet(at?: Point) {
  const workspaceId = workspacesStore.getState().activeId;
  if (!workspaceId) return;
  void addFleet(workspaceId, at ?? viewportCenter(canvasStore.getState().view)).catch(reportLaunchError);
}

/**
 * "Sign in" of a Claude profile: a visible Claude terminal started with that
 * profile, where the user logs in. False when there is no canvas to place it on: no project, or the code workspace.
 */
export async function launchLogin(accountId: string): Promise<boolean> {
  if (!workspacesStore.getState().activeId) return false;
  const center = viewportCenter(canvasStore.getState().view);
  return (await launchAgent("claude", { ...defaultLaunchOptions(), accountId }, center)) !== null;
}
