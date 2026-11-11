import { readExtensionChoice } from "@/ipc/claudeExtensions";
import { STORED_FLEET_ROLE, type AgentId, type OllamaLaunch, type ShellKind, type SpawnSpec } from "@/ipc/pty";
import { AGENTS } from "@/agents/catalog";
import type { TerminalPayload } from "@/nodes/types";
import { profileNamed } from "@/accounts/store";
import { messages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";

/** How "Relancer" starts a Claude terminal (spec V1 §5.3); other agents ignore it. */
export type LaunchMode = "new" | "resume" | "continue";

export const SHELL_LABELS: Record<ShellKind, string> = {
  // Read when used, so they follow the language.
  get default() {
    return messages(nodesMessages).shells.default;
  },
  powershell: "PowerShell",
  pwsh: "PowerShell 7",
  get cmd() {
    return messages(nodesMessages).shells.cmd;
  },
  gitbash: "Git Bash",
};

/** "Claude · dummyplane": the agent and the last folder of the working directory. */
export function defaultTitle(agent: AgentId, cwd: string): string {
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop();
  return folder ? `${AGENTS[agent].label} · ${folder}` : AGENTS[agent].label;
}

export interface LaunchInput {
  title: string;
  cwd: string;
  agent: AgentId;
  command: string;
  shell: ShellKind;
  ollama?: OllamaLaunch;
  oneShot?: boolean;
  accountId?: string;
}

/** The payload of a new terminal; a Claude terminal gets its own conversation id. */
export function newTerminalPayload(input: LaunchInput, name = ""): TerminalPayload {
  const payload: TerminalPayload = {
    title: input.title.trim() || defaultTitle(input.agent, input.cwd),
    name,
    agent: input.agent,
    cwd: input.cwd,
    shell: input.shell,
    command: input.command.trim(),
  };
  if (input.agent === "claude") payload.claudeSessionId = crypto.randomUUID();
  if (input.agent === "ollama" && input.ollama) payload.ollama = input.ollama;
  if (input.oneShot) payload.oneShot = true;
  if (input.agent === "claude" && input.accountId) payload.accountId = input.accountId;
  return payload;
}

/** A fresh conversation: Claude's own id, Codex's to come, none of the previous one's steps nor report (spec orchestrateur §5). */
export function newConversation(): Partial<TerminalPayload> {
  return { claudeSessionId: crypto.randomUUID(), codexSessionId: undefined, steps: undefined, lastReport: undefined };
}

/** A conversation it can take up again: Claude's own id, or the thread Codex saved. */
export function canResume(payload: TerminalPayload): boolean {
  return (payload.agent === "claude" && Boolean(payload.claudeSessionId)) || (payload.agent === "codex" && Boolean(payload.codexSessionId));
}

/** How "Relaunch" starts it: on its conversation when it has one, anew otherwise. */
export const relaunchMode = (payload: TerminalPayload): LaunchMode => (canResume(payload) ? "resume" : "new");

/** Another agent in the same terminal: the steps, the report and a one-shot mark go with the old one; Claude gets a conversation if it has none. */
export function switchedAgent(payload: TerminalPayload, agent: AgentId): Partial<TerminalPayload> {
  const left = { agent, steps: undefined, lastReport: undefined, oneShot: undefined, codexSessionId: undefined };
  return agent === "claude" && !payload.claudeSessionId ? { ...left, claudeSessionId: crypto.randomUUID() } : left;
}

export function buildSpawnSpec(payload: TerminalPayload, mode: LaunchMode): SpawnSpec {
  const spec: SpawnSpec = { cwd: payload.cwd, shell: payload.shell, agent: payload.agent, command: payload.command };
  if (payload.agent === "claude") {
    spec.claude = { mode, sessionId: payload.claudeSessionId ?? crypto.randomUUID(), title: payload.title, role: payload.role ?? "agent" };
    if (payload.remoteControl) spec.claude.remoteControl = payload.name || payload.title;
    if (payload.model) spec.claude.model = payload.model;
    if (payload.effort) spec.claude.effort = payload.effort;
    if (payload.permission) spec.claude.permission = payload.permission;
    if (payload.linear) spec.claude.linear = true;
    const extensions = readExtensionChoice(payload.extensions);
    if (extensions) spec.claude.extensions = extensions;
    // The profile's folder if it still exists, else the default account (spec comptes §3).
    const profile = profileNamed(payload.accountId);
    if (profile) spec.claude.configDir = profile.configDir;
  }
  if (payload.agent === "codex") {
    // Its role, its mission's permission and its night's Linear, as for Claude; Claude's model names mean nothing to it.
    spec.codex = { role: payload.role ?? "agent" };
    if (mode !== "new" && payload.codexSessionId) spec.codex.sessionId = payload.codexSessionId;
    if (payload.permission) spec.codex.permission = payload.permission;
    if (payload.linear) spec.codex.linear = true;
    if (payload.model && !CLAUDE_MODEL.test(payload.model)) spec.codex.model = payload.model;
  }
  if (payload.agent === "ollama" && payload.ollama) spec.ollama = payload.ollama;
  return spec;
}

/** A Claude model or alias (a mission's router gives these): never passed to another CLI. */
const CLAUDE_MODEL = /^(claude|haiku|sonnet|opus|fable)/i;

/** A fleet's brain: its CLI (Claude or Codex: fleet/fleetAgent.ts) in the project folder, with the manager's role (spec orchestrateur §6). */
export function fleetSession(name: string, options: { cwd: string; shell: ShellKind }, agent: AgentId = "claude"): TerminalPayload {
  return { ...newTerminalPayload({ title: name, cwd: options.cwd, agent, command: "", shell: options.shell }, name), role: STORED_FLEET_ROLE };
}
