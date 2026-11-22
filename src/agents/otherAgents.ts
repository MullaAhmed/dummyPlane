import { requestUi } from "@/commands/uiRequests";
import type { AgentId, AgentInfo } from "@/ipc/pty";
import { uiStore } from "@/store/ui";
import { isAvailable } from "./agentsStore";
import { AGENT_ORDER, AGENTS } from "./catalog";
import { defaultLaunchOptions } from "./launchAgent";
import { launchAt } from "./quickActions";
import type { Point } from "./terminals";

/**
 * What an "Other agent…" offers, its list (./OtherAgentMenu.tsx) and the canvas ring's arc alike: the agents found on
 * this machine, and no more (one that is not installed is offered by the ＋ menu and the palette's "Install …"). The
 * Shell is the ring's and the palette's own.
 */
export function otherAgentsOf(agents: readonly AgentInfo[]): AgentId[] {
  return AGENT_ORDER.filter((id) => id !== "shell" && isAvailable(agents, id));
}

/**
 * No agent of a program was found: a machine with no CLI still has a Custom command (always "available"), and that is
 * all `listed` holds, with nothing to say where to get the others.
 */
export function noAgentFound(listed: readonly AgentId[]): boolean {
  return listed.every((id) => AGENTS[id].binary === "");
}

/**
 * Starts the agent picked in an "Other agent…" at the scene point `place` (the ring's press). A Custom command and
 * Ollama, which need a command or a model first, go on in the ＋ menu's own view for them. From the palette (no
 * place), the agent follows the pointer until the canvas is clicked.
 */
export function launchOtherAgent(agent: AgentId, place?: Point) {
  if (agent === "custom" || agent === "ollama") requestUi({ kind: "agentMenu", view: agent === "custom" ? "options" : "ollama", at: place });
  else if (place) launchAt(agent, place);
  else uiStore.getState().setPlacing({ agent, options: defaultLaunchOptions() });
}
