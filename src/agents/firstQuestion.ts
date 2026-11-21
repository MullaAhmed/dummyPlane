import type { AgentId } from "@/ipc/pty";
import { whenReady } from "@/mission/ready";
import { freshText, quietFor } from "@/nodes/terminal/registry";
import { nodesStore, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { heldByDialog, holdFor } from "./dialogs";

/** The CLIs whose questions dummyPlane reads on the screen (`./dialogScreen`). */
const READ: ReadonlySet<AgentId> = new Set<AgentId>(["claude", "codex"]);

/** After a question goes, how long another may still come before the session opens (a project's MCP servers after trust). */
const NEXT_QUESTION_MS = 60_000;

/**
 * A launch the user made by hand: the question its CLI asks before its session opens (whether to trust the folder, a
 * project's new MCP servers, a login) waits for them as any agent's question does (`holdFor`): its pill, the counts, the
 * waiting notice. Nothing is pressed: it is theirs to answer. Read until the session opens, or the process ends, or a
 * minute passes with no question on screen (a "No, exit" back to the shell). spawn_agent, a mission and a wake read
 * their own agents' screens (`whenReady`): never call it for those, two probes would let go of each other's hold.
 */
export function watchFirstQuestion(nodeId: string, agent: AgentId): void {
  if (!READ.has(agent)) return;
  let lastChange = Date.now();
  void whenReady(
    {
      running: () => isRunning(nodeId),
      quietMs: () => quietFor(nodeId),
      screen: () => freshText(nodeId, 50),
      press: () => Promise.resolve(),
      agent,
      held: holdFor(nodeId, () => {
        lastChange = Date.now();
      }),
      // A question on screen holds it as long as the user takes; past one, the next may still come for a while.
      waitLonger: () => isRunning(nodeId) && (heldByDialog(nodeId) || Date.now() - lastChange < NEXT_QUESTION_MS),
      // Nothing is typed: it ends as its prompt shows. The user may type at once, and a permission request their message
      // brings is the hooks' to tell (Rust's activity), never a hold of this probe that would outlast the answer.
      readyQuietMs: 0,
    },
    undefined,
    // The trust question is the user's: dummyPlane answers it only in the worktrees it made itself.
    false,
  ).catch((error: unknown) => console.warn("first question not read", error));
}

/**
 * `watchFirstQuestion` for the terminals the user launched by another route than `launchAgent` (a group's Add an agent,
 * Duplicate, Compose a group, a team preset deployed): each one's agent read from its payload.
 */
export function watchLaunched(nodeIds: readonly (string | null | undefined)[]): void {
  for (const nodeId of nodeIds) {
    const agent = nodeId ? terminalOf(nodesStore.getState().nodes[nodeId])?.agent : undefined;
    if (nodeId && agent) watchFirstQuestion(nodeId, agent);
  }
}
