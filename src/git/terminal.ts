import { agentsMessages } from "@/agents/messages";
import { messages } from "@/i18n";
import { toastError } from "@/lib/errorToast";
import { isCanvas, useWorkspaces } from "@/store/workspaces";

/** A terminal needs a canvas to land on: the code and notes workspaces have none, and the panels may stay open over them. */
export function useCanOpenTerminal(): boolean {
  return useWorkspaces((s) => isCanvas(s.workspaces.find((w) => w.id === s.activeId)));
}

/**
 * A shell in `folder`, in the middle of the view: where the git the panels do not offer (pull, init) is run.
 * The panel that offers it closes first, or the terminal would arrive under it. The launch is loaded when asked
 * for: it brings the canvas, which the panels' own tests do not load.
 */
export function openTerminalIn(folder: string, closePanel: () => void) {
  closePanel();
  void Promise.all([import("@/agents/launchAgent"), import("@/agents/quickActions")])
    .then(([{ defaultLaunchOptions }, { launchAt }]) => launchAt("shell", undefined, { ...defaultLaunchOptions(), cwd: folder }))
    .catch((error: unknown) => toastError(messages(agentsMessages).launchFailed, { error, next: messages(agentsMessages).launchNext }));
}
