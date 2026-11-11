import {
  Asterisk,
  Bot,
  Code,
  Cpu,
  Hexagon,
  MousePointer2,
  Sparkle,
  SquareCode,
  SquareTerminal,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { messages } from "@/i18n";
import { AGENT_IDS, type AgentId, type AgentInfo } from "@/ipc/pty";
import { agentsMessages } from "./messages";

export interface AgentMeta {
  label: string;
  vendor: string;
  /** Border and logo color of the agent's terminals (spec theme §8). */
  tint: string;
  /** The program looked for on the PATH ("" for shell and custom). */
  binary: string;
  Icon: LucideIcon;
}

/**
 * An agent's tint as an icon or text color: pulled toward the theme's text so
 * that light tints stay visible on Ivoire and dark ones on Clay (spec identity
 * §3, "readable in both"). The palest (PALE_TINTS) are pulled further: at 65 %
 * Cursor's and Ollama's icons read near 2:1 on calm's light grounds, and an icon
 * carries its agent at 3:1 (WCAG 1.4.11). catalog.test.ts measures every agent,
 * in every palette, on every ground an icon sits on.
 */
export function agentInk(tint: string): string {
  return `color-mix(in srgb, ${tint} ${PALE_TINTS.has(tint) ? PALE_MIX : TINT_MIX}%, var(--dp-text))`;
}

/** How much of its tint an agent's ink keeps; the palest keep less. */
const TINT_MIX = 65;
const PALE_MIX = 40;

/** `label` and `vendor` of the three agents with words of their own are read when used, so they follow the language. */
export const AGENTS: Record<AgentId, AgentMeta> = {
  claude: { label: "Claude", vendor: "Anthropic", tint: "#e8603a", binary: "claude", Icon: Asterisk },
  codex: { label: "Codex", vendor: "OpenAI", tint: "#707de3", binary: "codex", Icon: SquareTerminal },
  gemini: { label: "Gemini", vendor: "Google", tint: "#5c86e0", binary: "gemini", Icon: Sparkle },
  qwen: { label: "Qwen Code", vendor: "Alibaba", tint: "#a57be0", binary: "qwen", Icon: Hexagon },
  cursor: { label: "Cursor", vendor: "cursor-agent", tint: "#d4d4cc", binary: "cursor-agent", Icon: MousePointer2 },
  opencode: { label: "OpenCode", vendor: "sst", tint: "#77b7c0", binary: "opencode", Icon: Code },
  aider: { label: "Aider", vendor: "aider", tint: "#86a174", binary: "aider", Icon: Bot },
  ollama: {
    label: "Ollama",
    get vendor() {
      return messages(agentsMessages).catalog.ollamaVendor;
    },
    tint: "#ede8df",
    binary: "ollama",
    Icon: Cpu,
  },
  shell: {
    label: "Shell",
    get vendor() {
      return messages(agentsMessages).catalog.shellVendor;
    },
    tint: "#8a8a80",
    binary: "",
    Icon: Terminal,
  },
  custom: {
    get label() {
      return messages(agentsMessages).catalog.customLabel;
    },
    get vendor() {
      return messages(agentsMessages).catalog.customVendor;
    },
    tint: "#8a8a80",
    binary: "",
    Icon: SquareCode,
  },
};

/** The agents whose tint is too light to read at TINT_MIX on calm's grounds (OpenCode's in the agent menu's tinted chip). */
const PALE_TINTS = new Set((["cursor", "opencode", "ollama"] as const).map((id) => AGENTS[id].tint));

export const AGENT_ORDER: AgentId[] = [...AGENT_IDS];

/**
 * An agent tint, kept as a name because the status pill still takes an `indigo` flag (pillOf's
 * `workingIndigo` tone). Tints are identity for an agent's icon only: frames are neutral, and
 * the status dot looks the same for every agent.
 */
export const INDIGO = "#707de3";

/** Agents that start without options: Ollama needs a model, Custom a command. */
export const AGENTS_WITHOUT_OPTIONS = AGENT_ORDER.filter((id) => id !== "ollama" && id !== "custom");

/** The agent of "New console": the first available of Claude, Codex, Shell. */
export function defaultAgent(agents: readonly AgentInfo[]): AgentId {
  for (const id of ["claude", "codex"] as const) {
    if (agents.some((agent) => agent.id === id && agent.available)) return id;
  }
  return "shell";
}
