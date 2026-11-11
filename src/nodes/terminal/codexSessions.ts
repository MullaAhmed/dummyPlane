import { onCodexSession } from "@/ipc/pty";
import { nodesStore, sessionOf, updateSession } from "@/store/nodes";

/**
 * Codex names its conversation only once it has saved it, at the end of a turn: the terminal
 * keeps that id for its next "Resume" (`codex resume <id>`), a fleet's session as an agent's.
 */
export function rememberCodexSession(nodeId: string, sessionId: string) {
  const session = sessionOf(nodesStore.getState().nodes[nodeId]);
  if (session?.agent !== "codex" || session.codexSessionId === sessionId) return;
  updateSession(nodeId, { codexSessionId: sessionId });
}

export function installCodexSessions() {
  return onCodexSession(({ nodeId, sessionId }) => rememberCodexSession(nodeId, sessionId));
}
