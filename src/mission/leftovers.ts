import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createStore, useStore } from "zustand";
import { isClosedNode } from "@/agents/closedNode";
import { messages } from "@/i18n";
import { missionCleanLeftovers, missionLeftovers, type Cleanup, type HeldOpen, type Leftovers } from "@/ipc/mission";
import { toastError } from "@/lib/errorToast";
import { outlasts } from "@/lib/outlasts";
import { agentMessages } from "@/mcp/messages";
import { nodeNameOf, nodesStore, terminalOf } from "@/store/nodes";
import { CLEANUP_WAIT_MS } from "./cleanup";
import { notify } from "./events";
import { missionFolder } from "./folder";
import { missionMessages } from "./messages";
import { askInToast, showOutcomeToast, sweepQuestionToasts } from "./missionToasts";
import { oneLine } from "./mission";
import { missionOf } from "./store";

/**
 * "Clean up leftovers": the `dummyplane/*` worktrees and branches past missions left in a project (one kept at its
 * clean-up, one whose mission was freed since) stay reachable. The panel's button, or the Fleet's clean_up_leftovers,
 * reads them and asks the user, with what becomes of each; only the user's Clean up acts (`answerLeftovers`), by the
 * mission clean-up's own rules, never losing work. "Not now" does nothing. What a live mission holds is never read.
 */

const t = () => messages(agentMessages).leftovers;
const u = () => messages(missionMessages).leftovers;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const toastId = (fleetId: string) => `leftovers-${fleetId}`;
const plain = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** The question shown to the user: what was read, when, and who asked (the Fleet, to tell the outcome). */
export interface LeftoversRequest {
  at: number;
  project: string;
  leftovers: Leftovers;
  askedBy?: string;
}

/** The questions open, by Fleet: in memory only, read again at the click. */
export const leftoversStore = createStore<{ asks: Record<string, LeftoversRequest> }>(() => ({ asks: {} }));

export const useLeftoversAsk = (fleetId: string) => useStore(leftoversStore, (s) => s.asks[fleetId]);

function setAsk(fleetId: string, ask: LeftoversRequest | undefined) {
  leftoversStore.setState((s) => {
    const asks = { ...s.asks };
    if (ask) asks[fleetId] = ask;
    else delete asks[fleetId];
    return { asks };
  });
  // A question taken away takes its toast with it, whoever took it. A newer one replaces its toast in `raise`.
  if (!ask) sweepQuestionToasts();
}

/** The question `at` still stands: it is the one held for the Fleet, and the Fleet is on the canvas. */
const asking = (fleetId: string, at: number) =>
  leftoversStore.getState().asks[fleetId]?.at === at && nodesStore.getState().nodes[fleetId] !== undefined && !isClosedNode(fleetId);

/** The projects whose leftovers are being cleaned up now: a second click, or a second Fleet's, waits for nothing. */
const sweeping = new Set<string>();

/** The folder the Fleet's missions work in: its mission's, else its workspace's. */
const projectOf = (fleetId: string) => missionOf(nodesStore.getState().nodes[fleetId])?.project || missionFolder(fleetId);

/**
 * The slugs of every mission a Fleet still holds in `project`: running, finished and not yet cleaned up (its own
 * clean-up takes its worktrees). "launching" while one is starting: its worktrees are being made, and are no leftovers.
 */
export function liveSlugs(project: string): string[] | "launching" {
  const slugs: string[] = [];
  for (const [id, record] of Object.entries(nodesStore.getState().nodes)) {
    const mission = missionOf(record);
    if (!mission || mission.state === "redaction" || mission.state === "plan") continue;
    const folder = mission.project || missionFolder(id);
    if (!folder || plain(folder) !== plain(project)) continue;
    if (mission.state === "lancement") return "launching";
    if (mission.slug) slugs.push(mission.slug);
  }
  return slugs;
}

/** Every terminal's folder on the canvas, whoever it is: a worktree a terminal is open in stays. */
export function openFolders(): HeldOpen[] {
  const nodes = nodesStore.getState().nodes;
  return Object.entries(nodes).flatMap(([id, record]) => {
    const cwd = terminalOf(record)?.cwd;
    if (!cwd || isClosedNode(id)) return [];
    return [{ path: cwd, why: `${nodeNameOf(record) || id} is open there` }];
  });
}

/** Whether nothing would be done: no worktree, no branch, nothing in the trash. */
const empty = (found: Leftovers) => found.worktrees.length + found.branches.length + found.trash.length === 0;

/**
 * Whether the user's Clean up would change anything, by Rust's `clean_leftovers`: a worktree that goes (one whose folder
 * is gone too), a branch deleted, the trash emptied. What never-lose-work keeps stays kept at every pass.
 */
const changes = (found: Leftovers) => found.worktrees.some((w) => !w.kept) || found.branches.some((b) => !b.kept) || found.trash.length > 0;

/** What stays, each with why, as a click's outcome names it. */
const keptWhy = (found: Leftovers) => [...found.worktrees, ...found.branches].map(({ name, kept }) => `${name} (${kept})`);

/**
 * Reads the project's leftovers and asks the user, in the Fleet's panel (a toast too while the Fleet is out of sight),
 * with Clean up and Not now. It never acts: only the user's click does (`answerLeftovers`), so no agent can clean up by
 * saying the user agreed. A second call asks again, in place of the first question. When everything left is kept, a
 * Clean up would change nothing: it asks nothing, and names what stays and why. For the Fleet's tool it answers within
 * `wait`, whatever git takes: a read that outlasts it raises the question when it ends.
 */
export async function askLeftovers(fleetId: string, askedBy?: string, wait = CLEANUP_WAIT_MS): Promise<{ text: string; refused?: true }> {
  const project = projectOf(fleetId);
  if (!project) return { text: t().noProject, refused: true };
  if (sweeping.has(plain(project))) return { text: t().underWay, refused: true };
  const live = liveSlugs(project);
  if (live === "launching") return { text: t().launching, refused: true };
  const read = missionLeftovers(project, live, openFolders()).then(
    (found) => ({ found }),
    (error: unknown) => ({ error: errorText(error) }),
  );
  const ask = async () => {
    const answer = await read;
    if ("error" in answer) return { text: t().unreadable(oneLine(answer.error)), refused: true as const };
    const found = answer.found;
    if (!changes(found)) {
      // No question whose Clean up changes nothing: it only led to "kept" again, and to the question again, in a loop.
      const kept = keptWhy(found);
      const text = empty(found) ? t().nothing(found.strays) : t().allKept(kept);
      // What an earlier question showed is moot (cleaned by hand, by another run, or all of it kept): its click would change
      // nothing, so it is taken back and its toast goes with it. Its asker, when another agent than this caller and still
      // on the canvas, hears it: a Fleet left waiting would ask again.
      const before = leftoversStore.getState().asks[fleetId];
      if (before) {
        setAsk(fleetId, undefined);
        if (before.askedBy && before.askedBy !== askedBy && nodesStore.getState().nodes[before.askedBy]) notify(before.askedBy, oneLine(t().withdrawn(text)));
      }
      if (!askedBy) {
        if (empty(found)) toast(u().nothing);
        else toast(u().allKept, { description: u().allKeptWhy(kept) });
      }
      return { text };
    }
    raise(fleetId, { at: Date.now(), project, leftovers: found, ...(askedBy ? { askedBy } : {}) });
    const going = found.worktrees.filter((w) => !w.kept).length;
    const deleted = found.branches.filter((b) => !b.kept).length;
    return { text: t().asked(found.worktrees.length, going, found.branches.length, deleted) };
  };
  const asked = ask();
  if (!(await outlasts(asked, wait))) return asked;
  // Still reading: the question shows when it is ready, and the Fleet hears of it then.
  void asked.then(({ text }) => {
    if (askedBy) notify(askedBy, oneLine(text));
  });
  return { text: t().reading };
}

/** Shows the question: the panel's prompt (`useLeftoversAsk`), and a toast only while the Fleet is out of sight. */
function raise(fleetId: string, request: LeftoversRequest) {
  setAsk(fleetId, request);
  const m = u();
  const { worktrees, branches } = request.leftovers;
  askInToast(toastId(fleetId), fleetId, () => asking(fleetId, request.at), {
    title: m.title,
    description: m.body(worktrees.length, branches.length),
    icon: Trash2,
    action: { label: m.clean, onClick: () => void answerLeftovers(fleetId, request.at, true) },
    cancel: { label: m.notNow, onClick: () => void answerLeftovers(fleetId, request.at, false) },
  });
}

/** What the click covers: what the user was shown, by name; a branch only at the head shown. */
const chosenOf = (found: Leftovers) => ({ worktrees: found.worktrees.map((w) => w.name), branches: found.branches, trash: found.trash });

/**
 * The user's answer to the question `at`, from the panel or the toast: the only way leftovers are cleaned up. Not now
 * touches nothing. Clean up reads everything again and does only what the question showed (`missionCleanLeftovers`),
 * a live mission's worktrees never: a mission starting meanwhile refuses it. An older question does nothing.
 */
export async function answerLeftovers(fleetId: string, at: number, clean: boolean): Promise<void> {
  toast.dismiss(toastId(fleetId));
  const ask = leftoversStore.getState().asks[fleetId];
  if (!ask || ask.at !== at) return;
  const key = plain(ask.project);
  if (sweeping.has(key)) {
    toast(u().underWay);
    return;
  }
  setAsk(fleetId, undefined);
  const tell = (line: string) => {
    if (ask.askedBy && nodesStore.getState().nodes[ask.askedBy]) notify(ask.askedBy, oneLine(line));
  };
  if (!clean) {
    tell(t().notNow);
    return;
  }
  const live = liveSlugs(ask.project);
  if (live === "launching") {
    toastError(u().failed, { error: u().launching });
    tell(t().failed(u().launching));
    return;
  }
  sweeping.add(key);
  let done: Cleanup;
  try {
    done = await missionCleanLeftovers(ask.project, live, openFolders(), chosenOf(ask.leftovers));
  } catch (error) {
    toastError(u().failed, { error });
    tell(t().failed(oneLine(errorText(error))));
    return;
  } finally {
    sweeping.delete(key);
  }
  showLeftovers(fleetId, done);
  const moved = done.moved ?? [];
  tell(t().done(t().result({ removed: done.removed, saved: done.saved ?? [], kept: done.kept }) + (moved.length > 0 ? messages(agentMessages).fleet.cleanedMoved(moved) : "")));
}

/**
 * What the click did, to the user: as the mission's clean-up shows it, kept on screen when anything stayed. One toast
 * per Fleet: a clean-up that runs again replaces it, it never stacks another one that has to be closed by hand.
 */
function showLeftovers(fleetId: string, done: Cleanup) {
  const m = messages(missionMessages);
  const saved = done.saved ?? [];
  const moved = done.moved ?? [];
  const lines = [m.cleanedRemoved(done.removed), saved.length > 0 ? m.cleanedSaved(saved) : "", moved.length > 0 ? m.cleanedMoved(moved) : "", done.kept.length > 0 ? m.cleanedKept(done.kept) : ""];
  const kept = saved.length + moved.length + done.kept.length > 0;
  showOutcomeToast(`leftovers-done-${fleetId}`, m.leftovers.done, lines.filter(Boolean).join(" "), kept);
}