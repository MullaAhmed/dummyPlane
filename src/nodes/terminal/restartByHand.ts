import { isRestarting } from "@/store/terminalStatus";

/**
 * A restart the user asks for (its terminal's menu, its resume card, the command palette, "Resume all"): ignored while
 * one is under way. A second click is the same wish, not a new one, and its start would kill the session the first
 * one just opened. `start` runs only when it goes ahead, so that nothing it writes first (a new conversation's id)
 * is left behind by one ignored. Whether it went ahead.
 */
export function restartByHand(nodeId: string, start: () => unknown): boolean {
  if (isRestarting(nodeId)) return false;
  start();
  return true;
}
