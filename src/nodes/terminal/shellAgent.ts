import { agentProcessSnapshot, dismissAgentProcess, onAgentProcess, type AgentProcessEvent } from "@/ipc/pty";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, sessionOf, updateSession } from "@/store/nodes";
import { folderLockOf, sameFolder } from "./folder";
import { defaultTitle, switchedAgent } from "./launch";

/**
 * What an agent that runs in a Shell terminal (`AgentProcessEvent`) makes of the terminal. Its folder, name, group,
 * position and screen stay, and so does the process: nothing restarts. From then on it is the agent's terminal,
 * with that agent's options, status and activity, and its next launch starts the agent with dummyPlane's own settings,
 * hooks and tools.
 * - A title still the shell's default ("Shell · api") becomes the agent's ("Claude · api"): Claude is named after it
 *   when a new conversation starts.
 * - The conversation Claude (or Codex) runs is kept when it is known for sure: the next launch resumes it. When it
 *   is not, the next launch starts a new one.
 * - Claude says the folder it runs in. When the shell changed folder before it started, that folder becomes the
 *   terminal's own, as for a `claude` started by hand in an agent terminal (`folderAdoption`): the conversation is
 *   kept there, so a launch from the old folder would not find it. A folder that is fixed (a mission's) stays.
 */
export function shellAgentPatch(payload: TerminalPayload, sighting: Pick<AgentProcessEvent, "agent" | "sessionId" | "cwd">, folderFixed: boolean): Partial<TerminalPayload> {
  const { agent } = sighting;
  const moved = !folderFixed && sighting.cwd && sighting.sessionId && !sameFolder(sighting.cwd, payload.cwd) ? sighting.cwd.trim() : null;
  const cwd = moved ?? payload.cwd;
  const patch: Partial<TerminalPayload> = {
    ...switchedAgent(payload, agent),
    fromShell: true,
  };
  if (payload.title === defaultTitle(payload.agent, payload.cwd)) patch.title = defaultTitle(agent, cwd);
  if (moved) {
    patch.cwd = moved;
    // The agent runs in that folder with what the shell started it with: no restart is offered for it.
    if (payload.launched) patch.launched = { ...payload.launched, cwd: moved };
  }
  if (sighting.sessionId) {
    if (agent === "claude") patch.claudeSessionId = sighting.sessionId;
    if (agent === "codex") patch.codexSessionId = sighting.sessionId;
  }
  return patch;
}

/**
 * Turns a Shell terminal into the agent's that the user started in it; false when nothing changed. A terminal that
 * became one this way (`fromShell`) follows what runs in its shell next: another agent, or the same one's conversation
 * once it is known. An agent terminal dummyPlane launched has its agent already, and a Fleet, a Manager or a spawned
 * agent is never a shell to start in.
 */
export function agentStartedInShell(nodeId: string, sighting: AgentProcessEvent): boolean {
  const { nodes } = nodesStore.getState();
  const record = nodes[nodeId];
  const current = sessionOf(record);
  if (record?.kind !== "terminal" || !current || current.role || current.spawnedBy) return false;
  const { agent } = sighting;
  if (agent === "shell" || agent === "custom" || agent === "ollama") return false;
  if (current.agent === "shell" || (current.fromShell && current.agent !== agent)) {
    updateSession(nodeId, shellAgentPatch(current, sighting, folderLockOf(nodeId, nodes) !== null));
    return true;
  }
  if (!current.fromShell || !sighting.sessionId) return false;
  // The same agent, whose conversation is known now (its record came late).
  const known = agent === "claude" ? current.claudeSessionId : agent === "codex" ? current.codexSessionId : undefined;
  if (known === sighting.sessionId) return false;
  const { claudeSessionId, codexSessionId, cwd, launched } = shellAgentPatch(current, sighting, folderLockOf(nodeId, nodes) !== null);
  updateSession(nodeId, {
    ...(claudeSessionId ? { claudeSessionId } : {}),
    ...(codexSessionId ? { codexSessionId } : {}),
    ...(cwd ? { cwd } : {}),
    ...(launched ? { launched } : {}),
  });
  return true;
}

/** The terminal is a Shell again, by the user's choice, while its agent runs: dummyPlane stops reporting that process. */
export function leaveShellAgent(nodeId: string) {
  void dismissAgentProcess(nodeId).catch((error: unknown) => console.warn("agent process not dismissed", error));
}

/** Listens for the agents the user starts in Shell terminals. */
export function installShellAgents() {
  return onAgentProcess((event) => void agentStartedInShell(event.nodeId, event));
}

/**
 * An agent that started in the shell of a terminal that was not on screen, or while the page reloaded: asked once the
 * terminal reattaches to its process, when its node is known. A process the user already turned back to a shell is
 * not reported again.
 */
export async function applyShellAgent(nodeId: string) {
  const session = sessionOf(nodesStore.getState().nodes[nodeId]);
  if (session?.agent !== "shell" && !session?.fromShell) return;
  try {
    const event = (await agentProcessSnapshot()).find((one) => one.nodeId === nodeId);
    if (event) agentStartedInShell(nodeId, event);
  } catch (error) {
    console.warn("agents started in shells not read", error);
  }
}
