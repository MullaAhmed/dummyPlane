import { toast } from "sonner";
import { messages } from "@/i18n";
import { sameFolder } from "@/nodes/terminal/folder";
import { resumeTerminal } from "@/nodes/terminal/registry";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, sessionOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { folderName } from "./ExtensionList";
import { canvasMessages } from "./messages";
import { forgetStartedChoice } from "./startedChoice";

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
 * without that click. A stopped one starts there anyway: Claude's new conversation is all there is to say.
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
    if (claude) toast.info(t.folderNewConversation);
    return;
  }
  const to = folderName(cwd);
  toast.info(t.folderMoveRunning(folderName(from)), {
    id: toastId(nodeId),
    description: claude ? t.folderMoveConversation(to) : t.folderMoveNext(to),
    action: { label: t.restartIn(to), onClick: () => restartTerminal(nodeId) },
    duration: OFFER_MS,
  });
}
