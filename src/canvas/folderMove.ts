import { toast } from "sonner";
import { messages } from "@/i18n";
import { folderAdoption, folderLockOf, sameFolder } from "@/nodes/terminal/folder";
import { resumeTerminal } from "@/nodes/terminal/registry";
import type { TerminalPayload } from "@/nodes/types";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, sessionOf, updateSession } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { nodeSession, type SessionUsage } from "@/usage/usage";
import { usageStore } from "@/usage/usageStore";
import { folderName } from "./ExtensionList";
import { canvasMessages } from "./messages";
import { forgetStartedChoice } from "./startedChoice";
import { withPlane } from "@/notifications/capture";

/** The one toast a terminal's move offers its restart in: a second move replaces it, a move back or a restart takes it away. */
const toastId = (nodeId: string) => `folder-move:${nodeId}`;

/**
 * Restarts a terminal with what is stored now: its folder, its launch settings and its extension choice.
 * Claude resumes its conversation (a moved one, the conversation its move gave it). "Restart now", the
 * Folder row's "Restart in …" and the toast's all do this. The toast's offer goes with it: clicked later,
 * it would restart the session that just started.
 */
export function restartTerminal(nodeId: string) {
  toast.dismiss(toastId(nodeId));
  forgetStartedChoice(nodeId);
  resumeTerminal(nodeId);
}

/** Long enough to read where it runs and to decide: the Folder row keeps the offer after it. */
const OFFER_MS = 10_000;

/**
 * Says what a terminal moved from `before` to `cwd` does, once it moved. A running one stays where its process
 * started until it restarts: said plainly, with the restart offered ("Restart in web"). Nothing is restarted
 * without that click. A stopped one starts there anyway: Claude's new conversation is all there is to say. A
 * running Claude moved back to the folder it runs in takes its conversation there again (`folderChange`): it goes on.
 */
export function announceFolderMove(nodeId: string, before: TerminalPayload, cwd: string) {
  const t = messages(canvasMessages).selection;
  const claude = before.agent === "claude";
  // Where its process started, as stored now: `before` may be a dialog's copy from before a restart.
  const launched = sessionOf(nodesStore.getState().nodes[nodeId])?.launched;
  const from = isRunning(nodeId) ? (launched?.cwd ?? before.cwd) : null;
  if (from === null || sameFolder(from, cwd)) {
    // Not running, or back in the folder it runs in: nothing waits for a restart.
    toast.dismiss(toastId(nodeId));
    if (claude) withPlane({ nodeId }, () => toast.info(from === null ? t.folderNewConversation : t.folderBack(folderName(cwd))));
    return;
  }
  const to = folderName(cwd);
  withPlane({ nodeId }, () =>
    toast.info(t.folderMoveRunning(folderName(from)), {
      id: toastId(nodeId),
      description: claude ? t.folderMoveConversation(to) : t.folderMoveNext(to),
      action: { label: t.restartIn(to), onClick: () => restartTerminal(nodeId) },
      duration: OFFER_MS,
    }),
  );
}

/**
 * What the run of Claude live in a terminal last said in its status line: while the terminal runs, its Claude hasn't
 * left its shell, and it reported since its last launch. The same run `useClaudeFolder` reads its folder from.
 */
function liveRun(nodeId: string): SessionUsage | undefined {
  if (!isRunning(nodeId) || agentActivityStore.getState().activities[nodeId]?.left) return undefined;
  const { sessions, launchedAt } = usageStore.getState();
  return nodeSession(sessions, nodeId, launchedAt[nodeId]);
}

/**
 * "Make upload this terminal's folder": `folder`, where the `claude` started by hand in the terminal's shell runs,
 * becomes the terminal's own, on the conversation Claude runs there (`folderAdoption`). Nothing restarts. A move's
 * offer goes: the terminal is where its Claude runs. Read as the stores are now, as a move reads them after its
 * picker; false when Claude no longer runs there or the folder is fixed.
 */
export function adoptLiveFolder(nodeId: string, folder: string): boolean {
  const { nodes } = nodesStore.getState();
  const current = sessionOf(nodes[nodeId]);
  const run = liveRun(nodeId);
  if (!current || !run?.folder || !sameFolder(run.folder, folder) || folderLockOf(nodeId, nodes)) return false;
  const patch = folderAdoption(current, run.folder, run.sessionId);
  if (!patch?.cwd) return false;
  updateSession(nodeId, patch);
  toast.dismiss(toastId(nodeId));
  const adopted = folderName(patch.cwd);
  withPlane({ nodeId }, () => toast.info(messages(canvasMessages).selection.folderAdopted(adopted)));
  return true;
}
