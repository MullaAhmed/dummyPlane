import type { AgentId } from "@/ipc/pty";

/**
 * The CLIs a Fleet can run on, and with it everything it starts: dummyPlane gives them its tools, the
 * role prompt, the mission's permissions and the manager's rails, and can tell when one is ready for
 * its task. Claude, and Codex (checked on Codex 0.167: its read-only sandbox, its prompt, its saved
 * threads). A leaf module: stored nodes are read with it.
 */
export const FLEET_CAPABLE: readonly AgentId[] = ["claude", "codex"];
