import { toast } from "sonner";
import { messages } from "@/i18n";
import { workspacesStore } from "@/store/workspaces";
import { agentsMessages } from "./messages";

/** What brings a terminal nobody asked for onto the canvas: it words the notice. */
export type ArrivalSource = "mission" | "spawn";

/**
 * How a new terminal reaches the canvas. One the user asked for (a launch, a
 * placed terminal, a composed group) comes into view, as it always did. One
 * nobody asked for (a mission's agent, a sub-agent) neither moves the view nor
 * takes the keyboard: it starts where it is, and a notice says so.
 */
export type Arrival = { reveal: true } | { reveal: false; source: ArrivalSource };

/** The default: the terminal comes into view. */
export const IN_VIEW: Arrival = { reveal: true };

/** The terminal starts without moving the view nor taking the keyboard; `announceArrival` says so. */
export const quietly = (source: ArrivalSource): Arrival => ({ reveal: false, source });

/** Agents arriving within this of the first are one notice: a team forms in a burst. */
const BURST_MS = 400;

interface Batch {
  workspaceId: string;
  source: ArrivalSource;
  agents: { nodeId: string; name: string }[];
}

const batches = new Map<string, Batch>();

/** The notice for a burst, and "Show" takes the user to its first agent, in its workspace if it is not the one on screen. */
function flush(key: string) {
  const batch = batches.get(key);
  batches.delete(key);
  if (!batch) return;
  const { workspaceId, source, agents } = batch;
  const { activeId, workspaces } = workspacesStore.getState();
  const where = workspaceId === activeId ? undefined : workspaces.find((w) => w.id === workspaceId)?.name;
  const t = messages(agentsMessages).arrival;
  const first = agents[0];
  toast(t[source](agents.map((a) => a.name), where), {
    action: {
      label: t.show,
      // Imported late: the commands reach into the agents.
      onClick: () =>
        void import("@/commands/goToRun").then(({ goTo }) =>
          goTo({ key: first.nodeId, kind: "terminal", label: first.name, keywords: [], workspaceId, targetId: first.nodeId }),
        ),
    },
  });
}

/** Tells, without taking the focus, that terminals arrived on their own; several at once are one notice. */
export function announceArrival(workspaceId: string, source: ArrivalSource, agents: readonly { nodeId: string; name: string }[]) {
  if (agents.length === 0) return;
  const key = `${workspaceId}:${source}`;
  const pending = batches.get(key);
  if (pending) {
    pending.agents.push(...agents);
    return;
  }
  batches.set(key, { workspaceId, source, agents: [...agents] });
  setTimeout(() => flush(key), BURST_MS);
}
