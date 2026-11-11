import { toastError } from "@/lib/errorToast";
import { createStore, useStore } from "zustand";
import { agentsStore, loadedAgents } from "@/agents/agentsStore";
import { messages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { AGENT_IDS, type AgentId } from "@/ipc/pty";
import { errorText } from "@/lib/format";
import { FLEET_CAPABLE } from "./capable";
import { fleetMessages } from "./messages";

const KEY = "fleet.agent";

export { FLEET_CAPABLE };

/** The AI CLIs the choice lists, in the launch menu's order. */
export const FLEET_CANDIDATES: readonly AgentId[] = ["claude", "codex", "gemini", "qwen", "cursor", "opencode"];

export type Unsupported = "noTools";

/** Why a CLI cannot carry a Fleet yet; null when it can. */
export function whyNot(agent: AgentId): Unsupported | null {
  return FLEET_CAPABLE.includes(agent) ? null : "noTools";
}

interface FleetAgentState {
  /** The user's choice; null until one is made. */
  agent: AgentId | null;
  /** The question is open: its answer resolves the call that asked. */
  asking: ((agent: AgentId | null) => void) | null;
}

export const fleetAgentStore = createStore<FleetAgentState>()(() => ({ agent: null, asking: null }));
export const useFleetAgent = <T,>(selector: (state: FleetAgentState) => T) => useStore(fleetAgentStore, selector);

const isAgentId = (value: unknown): value is AgentId => typeof value === "string" && (AGENT_IDS as readonly string[]).includes(value);

/** At boot. An unreadable or unknown setting is no choice. */
export async function loadFleetAgent() {
  try {
    const saved = await getSetting<unknown>(KEY);
    fleetAgentStore.setState({ agent: isAgentId(saved) ? saved : null });
  } catch (error) {
    console.warn(`fleet agent setting: ${errorText(error)}`);
  }
}

export async function setFleetAgent(agent: AgentId) {
  fleetAgentStore.setState({ agent });
  await setSetting(KEY, agent).catch((error: unknown) => toastError(messages(fleetMessages).agent.notSaved, { error, next: messages(fleetMessages).agent.forNow }));
}

/**
 * What the Fleet, its team and what they start run on: the user's choice; until one is made, or when it
 * cannot carry a Fleet, the first installed CLI that can, Claude when none is known.
 */
export function fleetAgent(): AgentId {
  const { agent } = fleetAgentStore.getState();
  if (agent && FLEET_CAPABLE.includes(agent)) return agent;
  const installed = FLEET_CAPABLE.find((id) => agentsStore.getState().agents.some((info) => info.id === id && info.available));
  return installed ?? "claude";
}

/** Opens the choice (the settings menu, or before a first Fleet); resolves with the CLI picked, null when it is closed. */
export function chooseFleetAgent(): Promise<AgentId | null> {
  return new Promise((resolve) => {
    fleetAgentStore.getState().asking?.(null);
    fleetAgentStore.setState({ asking: resolve });
  });
}

/** The dialog's answer: saved when it is one, and handed to whoever asked. */
export function answerFleetAgent(agent: AgentId | null) {
  const { asking } = fleetAgentStore.getState();
  fleetAgentStore.setState({ asking: null });
  if (agent) void setFleetAgent(agent);
  asking?.(agent);
}

/**
 * Before a Fleet is created: the CLI it runs on. Asked once, when more than one installed CLI could carry
 * it; with a single one there is nothing to choose, and it is taken. Null when the user closes the question.
 */
export async function ensureFleetAgent(): Promise<AgentId | null> {
  if (fleetAgentStore.getState().agent) return fleetAgent();
  const installed = (await loadedAgents()).filter((info) => info.available && FLEET_CAPABLE.includes(info.id)).map((info) => info.id);
  if (installed.length <= 1) return fleetAgent();
  return chooseFleetAgent();
}
