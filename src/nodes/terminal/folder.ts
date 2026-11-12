import type { TerminalPayload } from "@/nodes/types";
import type { NodeRecord } from "@/store/nodes";
import { defaultTitle, newConversation } from "./launch";

/** Why a node's folder cannot be changed: a Fleet stays in the project, a mission's agent in its worktree. */
export type FolderLock = "fleet" | "mission";

/**
 * Whether the node's folder is fixed. A Fleet creates its mission's branches and
 * worktrees from the project, so it stays in the project's repository. An agent
 * a running mission put in its worktree stays there until the mission ends
 * (`endMission` sends the linked ones back to the project), or its branch would
 * be worked on from another folder.
 */
export function folderLockOf(nodeId: string, nodes: Record<string, NodeRecord>): FolderLock | null {
  const record = nodes[nodeId];
  if (record?.kind === "fleet") return "fleet";
  if (record?.kind !== "terminal") return null;
  const inMission = Object.values(nodes).some(
    (node) => node.kind === "fleet" && node.payload.mission?.state === "en_cours" && node.payload.mission.members.some((member) => member.nodeId === nodeId),
  );
  return inMission ? "mission" : null;
}

/** A path as comparable text: slashes one way, no trailing one, case ignored (the folder pickers return Windows paths with backslashes). */
function comparable(path: string): string {
  const slashed = path.trim().replace(/\\/g, "/");
  const trimmed = slashed.replace(/\/+$/, "");
  return (trimmed || slashed).toLowerCase();
}

/** Whether two paths name the same folder, to a user's eye. */
export function sameFolder(a: string, b: string): boolean {
  return comparable(a) === comparable(b);
}

/**
 * What moving a terminal to `cwd` changes, null when it is already there. Claude
 * keeps its conversations per folder: resuming one from another folder starts
 * nothing (it falls back to the bare shell), so a Claude terminal moves with a
 * conversation of its own, stored with the folder so the two never part. A
 * title still named after the old folder ("Claude · api") follows it: Claude
 * names the new conversation after it (`-n`) and shows it on its prompt. Only
 * that: a title of the user's, the model, permission and profile stay as they are.
 * The folder Claude already runs in, started by hand, is `folderAdoption`'s.
 */
export function folderChange(payload: TerminalPayload, cwd: string): Partial<TerminalPayload> | null {
  const next = cwd.trim();
  if (!next || sameFolder(next, payload.cwd)) return null;
  return {
    cwd: next,
    ...followingTitle(payload, next),
    ...(payload.agent === "claude" ? newConversation() : {}),
  };
}

/** A title still the old folder's default ("Claude · api") becomes the new folder's; a title the user gave stays. */
function followingTitle(payload: TerminalPayload, cwd: string): Partial<TerminalPayload> {
  return payload.title === defaultTitle(payload.agent, payload.cwd) ? { title: defaultTitle(payload.agent, cwd) } : {};
}

/** What `--session-id` and `--resume` take: the PTY refuses any other conversation id (`shell.rs`). */
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What making `cwd` a running terminal's folder changes, when the `claude` started by hand in its shell (after a
 * `cd`) runs there, on the conversation `sessionId` its status line names. Unlike a move, nothing restarts and no
 * conversation starts: the node takes the one Claude runs, so its next launch resumes it where Claude keeps it. A
 * `claude` typed by hand gets the node's settings, never its conversation (`manual_claude`): `claude` starts a new
 * one, `claude -c` the folder's latest. Its own id, when the user resumed it, is kept as it is. A default title
 * follows the folder, as in a move. `launched` takes the folder too: the Claude that runs started with the rest of
 * what it holds (the shell's settings, model, profile), and runs in that folder, so no restart is offered for it.
 * Null when it is the folder already.
 */
export function folderAdoption(payload: TerminalPayload, cwd: string, sessionId: string): Partial<TerminalPayload> | null {
  const next = cwd.trim();
  if (!next || sameFolder(next, payload.cwd)) return null;
  const conversation =
    payload.agent !== "claude" || sessionId === payload.claudeSessionId
      ? {}
      : // An id no launch could take is no conversation to resume: the folder's next launch starts one of its own.
        { claudeSessionId: CONVERSATION_ID.test(sessionId) ? sessionId : crypto.randomUUID() };
  return {
    cwd: next,
    ...followingTitle(payload, next),
    ...conversation,
    ...(payload.launched ? { launched: { ...payload.launched, cwd: next } } : {}),
  };
}
