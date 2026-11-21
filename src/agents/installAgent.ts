import { toast } from "sonner";
import { toastError } from "@/lib/errorToast";
import { arrive } from "@/canvas/arrive";
import { canvasStore } from "@/canvas/canvasStore";
import { messages } from "@/i18n";
import { listOllamaModels, type AgentId, type ShellKind } from "@/ipc/pty";
import { projectsStore } from "@/store/projects";
import { statusOf } from "@/store/terminalStatus";
import { isCanvas, workspacesStore } from "@/store/workspaces";
import { agentsStore } from "./agentsStore";
import { AGENTS } from "./catalog";
import { AGENT_INSTALLS, ollamaPullCommand, sameOllamaModel, validOllamaModel } from "./installCommands";
import { defaultLaunchOptions, launchAgent } from "./launchAgent";
import { agentsMessages } from "./messages";
import { currentWorkArea } from "@/shell/lane";
import { viewportCenter } from "./placement";
import type { Point } from "./terminals";

const WATCH_EVERY_MS = 4000;
const WATCH_FOR_MS = 30 * 60_000;
/** The "installed" toast stays long enough to take its Launch (the folder move's offer, `canvas/folderMove.ts`). */
const LAUNCH_OFFER_MS = 10_000;

/**
 * Asks `found` every few seconds until it says yes, the terminal stops or the
 * time is up. The command is typed into a shell that stays open, so no
 * `pty-exit` marks the end of an install.
 */
export function watchTerminal(nodeId: string, found: () => Promise<boolean>, onFound: () => void) {
  const deadline = Date.now() + WATCH_FOR_MS;
  const tick = async () => {
    // A new terminal reads "starting" from its creation; a closed one has no status left.
    const { state } = statusOf(nodeId);
    const ended = state !== "running" && state !== "starting";
    if (await found().catch(() => false)) onFound();
    else if (!ended && Date.now() < deadline) setTimeout(() => void tick(), WATCH_EVERY_MS);
  };
  setTimeout(() => void tick(), WATCH_EVERY_MS);
}

/** A terminal running `command` in plain sight: never in the background. Its id, or null with the reason shown. */
async function openCommandTerminal(title: string, command: string, shell: ShellKind, at?: Point): Promise<string | null> {
  const t = messages(agentsMessages);
  try {
    const center = at ?? viewportCenter(canvasStore.getState().view, currentWorkArea());
    const nodeId = await launchAgent("custom", { ...defaultLaunchOptions(), title, command, shell, oneShot: true }, center);
    if (!nodeId) toastError(t.install.noCanvas);
    // The installer may ask something: the terminal comes into view with the keyboard.
    else arrive(nodeId);
    return nodeId;
  } catch (error) {
    toastError(t.install.terminalFailed, { error });
    return null;
  }
}

async function agentDetected(agent: AgentId): Promise<boolean> {
  await agentsStore.getState().recheck();
  return agentsStore.getState().agents.some((a) => a.id === agent && a.available);
}

/** A canvas is on screen: a project open on one of its canvas tabs, not Home, Code Studio or the notes. */
function canvasOnScreen(): boolean {
  const { workspaces, activeId } = workspacesStore.getState();
  return projectsStore.getState().view === "project" && isCanvas(workspaces.find((w) => w.id === activeId));
}

/** The agent just installed, in the middle of the view, with the keyboard: the install's next step. */
async function launchInstalled(agent: AgentId) {
  const t = messages(agentsMessages);
  // The toast may come long after the install: the user may be elsewhere, where a terminal would land unseen.
  if (!canvasOnScreen()) {
    toastError(t.install.launchNoCanvas);
    return;
  }
  try {
    const nodeId = await launchAgent(agent, defaultLaunchOptions(), viewportCenter(canvasStore.getState().view, currentWorkArea()));
    if (nodeId) arrive(nodeId);
    else toastError(t.install.launchNoCanvas);
  } catch (error) {
    toastError(t.launchFailed, { error, next: t.launchNext });
  }
}

/** Says the agent is installed, and offers to launch it; Ollama's launch picks a model first, in its menu. */
function sayInstalled(agent: AgentId, label: string) {
  const t = messages(agentsMessages).install;
  if (agent === "ollama") toast(t.installed(label));
  else toast(t.installed(label), { action: { label: t.launch(label), onClick: () => void launchInstalled(agent) }, duration: LAUNCH_OFFER_MS });
}

/** Runs the agent's official command in a terminal; the menus follow once it is found, and the toast offers to launch it. */
export async function installAgent(agent: AgentId, at?: Point): Promise<string | null> {
  const install = AGENT_INSTALLS[agent];
  if (!install) return null;
  const { label } = AGENTS[agent];
  const nodeId = await openCommandTerminal(messages(agentsMessages).install.terminalTitle(label), install.command, install.shell, at);
  if (nodeId) watchTerminal(nodeId, () => agentDetected(agent), () => sayInstalled(agent, label));
  return nodeId;
}

/** `ollama pull` in a terminal; PowerShell runs ollama.exe whatever the execution policy. */
export async function pullOllamaModel(model: string, at?: Point): Promise<string | null> {
  if (!validOllamaModel(model)) return null;
  const nodeId = await openCommandTerminal(`Ollama · ${model}`, ollamaPullCommand(model), "powershell", at);
  if (nodeId) {
    const pulled = async () => (await listOllamaModels()).some((name) => sameOllamaModel(name, model));
    watchTerminal(nodeId, pulled, () => toast(messages(agentsMessages).ollama.pulled(model)));
  }
  return nodeId;
}
