import { canvasStore } from "@/canvas/canvasStore";
import { lastTerminalOf, terminalWithKeyboard } from "@/canvas/keyboardFocus";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { AGENT_COMMANDS } from "./catalog/agents";
import { APP } from "./catalog/app";
import { CURRENT } from "./catalog/current";
import { DRAWING, SCENE } from "./catalog/drawing";
import { NAVIGATION } from "./catalog/navigation";
import { FLEET } from "./catalog/fleet";
import { WORKSPACES } from "./catalog/workspaces";
import type { Command, CommandContext } from "./command";

/** Every function of the application, by section, in a fixed order. */
export const COMMANDS: readonly Command[] = [...NAVIGATION, ...WORKSPACES, ...AGENT_COMMANDS, ...CURRENT, ...FLEET, ...DRAWING, ...SCENE, ...APP];

/** The context of a command, read at this moment from the stores and the keyboard focus. */
export function commandContext(): CommandContext {
  const project =
    projectsStore.getState().view === "project" &&
    workspacesStore.getState().status === "ready" &&
    canvasStore.getState().api !== null;
  if (!project) return { project: false, workspaceId: null, terminalCount: 0, terminalId: null };
  const workspaceId = workspacesStore.getState().activeId;
  const nodes = nodesStore.getState().nodes;
  const terminals = canvasStore.getState().nodeIds.filter((id) => nodes[id]?.kind === "terminal");
  const remembered = workspaceId ? lastTerminalOf(workspaceId) : null;
  const terminalId = terminalWithKeyboard() ?? (remembered && terminals.includes(remembered) ? remembered : null);
  return { project, workspaceId, terminalCount: terminals.length, terminalId };
}
