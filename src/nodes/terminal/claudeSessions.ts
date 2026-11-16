import { nodesStore, sessionOf, updateSession } from "@/store/nodes";
import { isRestarting, isRunning } from "@/store/terminalStatus";
import { nodeSession, type SessionUsage } from "@/usage/usage";
import { usageStore } from "@/usage/usageStore";
import { CONVERSATION_ID, sameFolder } from "./folder";

/**
 * The conversation a terminal's Claude runs now, as its status line names it (`run`). A `/clear`, or a `/resume` that
 * picks another conversation, changes it without a restart, and the terminal follows: its next "Resume" takes up the
 * conversation it last showed. Before, it kept the one it was launched on, which may hold nothing (a `/resume` right
 * after a new launch), and Claude started blank again. Followed only while the terminal runs and no restart is under
 * way, so an old process's last report never replaces the id its new launch was given; and only where Claude runs in
 * the terminal's own folder and profile: a terminal moved while it runs keeps its new folder's conversation
 * (`folderChange`), one given another account keeps the new conversation that account starts (`TerminalEdit`), and a
 * Claude started by hand in another folder is the user's to adopt (`adoptLiveFolder`). True when it followed.
 */
export function followClaudeConversation(nodeId: string, run: Pick<SessionUsage, "sessionId" | "folder">): boolean {
  // An id no launch could take is no conversation to resume (`shell.rs` refuses it).
  if (!run.folder || !CONVERSATION_ID.test(run.sessionId)) return false;
  if (!isRunning(nodeId) || isRestarting(nodeId)) return false;
  const session = sessionOf(nodesStore.getState().nodes[nodeId]);
  if (session?.agent !== "claude" || session.claudeSessionId === run.sessionId || !sameFolder(run.folder, session.cwd)) return false;
  if (session.launched && session.launched.accountId !== (session.accountId ?? "")) return false;
  updateSession(nodeId, { claudeSessionId: run.sessionId });
  return true;
}

/**
 * Follows each report that is the latest of its terminal's current launch (`nodeSession`): one from before the
 * launch belongs to the process it replaced.
 */
export function installClaudeConversations() {
  return usageStore.subscribe((state, previous) => {
    if (state.sessions === previous.sessions) return;
    for (const [id, run] of Object.entries(state.sessions)) {
      if (previous.sessions[id] === run) continue;
      if (nodeSession(state.sessions, run.nodeId, state.launchedAt[run.nodeId]) === run) followClaudeConversation(run.nodeId, run);
    }
  });
}
