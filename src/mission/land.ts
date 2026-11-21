import { GitMerge } from "lucide-react";
import { toast } from "sonner";
import { isClosedNode } from "@/agents/closedNode";
import { messages } from "@/i18n";
import { missionLand, missionLanding, type Landed, type Landing } from "@/ipc/mission";
import { toastError } from "@/lib/errorToast";
import { agentMessages } from "@/mcp/messages";
import { nodeNameOf, nodesStore } from "@/store/nodes";
import { notify } from "./events";
import { oneMergeAtATime } from "./launch";
import { missionMessages } from "./messages";
import { askInToast } from "./missionToasts";
import { oneLine, type LandRequest, type Mission } from "./mission";
import { missionOf, missionRunner, setMission } from "./store";

const t = () => messages(agentMessages).land;
const u = () => messages(missionMessages).land;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const short = (sha: string) => sha.slice(0, 7);
const toastId = (fleetId: string) => `land-${fleetId}`;
const landable = (mission: Mission | undefined): mission is Mission & { project: string; worktree: string } =>
  (mission?.state === "en_cours" || mission?.state === "terminee") && Boolean(mission.project) && Boolean(mission.worktree);

/**
 * The question `at` still stands: its Fleet is on the canvas, its mission can be landed and still asks exactly it. The
 * toast follows this (`askInToast`), so a mission cleaned up, or a Fleet deleted or closed, takes it off the
 * screen without a click. A mission that ended (stopped or finished) is still landable: its question stands.
 */
const asking = (fleetId: string, at: number) => {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  return landable(mission) && mission.landing?.at === at && !isClosedNode(fleetId);
};

/** At most three names, then how many more: a refusal stays one line. */
function few(names: readonly string[]): string {
  const more = names.length - 3;
  return more > 0 ? `${names.slice(0, 3).join(", ")}, ${u().more(more)}` : names.join(", ");
}

/**
 * `land`, the Fleet's or the Manager's: reads what the mission would bring onto the user's branch and asks them, in the
 * Fleet's panel (and in a toast while the Fleet is out of sight, `askInToast`), with Land and Not now. It never lands:
 * only the user's click does (`answerLand`), so no agent can land by saying the user agreed. A second call asks again,
 * in place of the first question.
 */
export async function askToLand(fleetId: string, askedBy: string): Promise<{ text: string; refused?: true }> {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (!landable(mission)) return { text: t().noMission, refused: true };
  let landing: Landing;
  try {
    landing = await missionLanding(mission.project, mission.worktree, mission.base);
  } catch (error) {
    return { text: t().unreadable(errorText(error)), refused: true };
  }
  if (landing.count === 0) {
    // What a question still open showed is on the branch already: it is moot, and its toast goes with it. Its asker, when
    // another agent than this caller and still on the canvas, hears it: it would wait for an answer that never comes.
    const before = missionOf(nodesStore.getState().nodes[fleetId])?.landing;
    if (before) {
      setMission(fleetId, { landing: undefined });
      if (before.askedBy && before.askedBy !== askedBy && nodesStore.getState().nodes[before.askedBy]) notify(before.askedBy, oneLine(t().withdrawn(t().nothing(landing.target, landing.branch))));
    }
    return { text: t().nothing(landing.target, landing.branch) };
  }
  // Read again: the mission may have been cleaned up while git read.
  const now = missionOf(nodesStore.getState().nodes[fleetId]);
  if (!landable(now) || now.worktree !== mission.worktree) return { text: t().noMission, refused: true };
  const request: LandRequest = { target: landing.target, branch: landing.branch, tip: landing.tip, commits: landing.commits, count: landing.count, fastForward: landing.fastForward, at: Date.now(), askedBy };
  // Before the state it reads changes: the toast this replaces (same id) is not taken for a moot one. The Fleet's panel
  // asks it; the toast only while the Fleet is out of sight.
  const m = u();
  askInToast(toastId(fleetId), fleetId, () => asking(fleetId, request.at), {
    title: m.title(request.target),
    description: `${m.body(request.target, request.count, request.branch)}${request.fastForward ? "" : ` ${m.moved(request.target, request.branch)}`}`,
    icon: GitMerge,
    action: { label: m.land, onClick: () => void answerLand(fleetId, request.at, true) },
    cancel: { label: m.notNow, onClick: () => void answerLand(fleetId, request.at, false) },
  });
  setMission(fleetId, { landing: request });
  return { text: t().asked(request.target, request.count, request.branch, request.fastForward) };
}

/** The clicks under way, by fleet: a second one waits for nothing and lands nothing twice. */
const answering = new Set<string>();

/**
 * Who hears how a question to land ended: whoever runs the mission while it runs (its Manager, or its Fleet run the
 * old way), who can hand the checks to the team; its Fleet once it is finished, which cleans it up. And the agent that
 * asked, when another one and still on the canvas (`asker`): the Fleet while its Manager runs the board, or a Manager
 * whose mission ended meanwhile.
 */
function listener(fleetId: string, request: LandRequest): { to: string; running: boolean; asker?: string } {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  const running = mission?.state === "en_cours";
  const to = running ? missionRunner(fleetId) : fleetId;
  const asker = request.askedBy && request.askedBy !== to && nodesStore.getState().nodes[request.askedBy] ? request.askedBy : undefined;
  return { to, running, ...(asker ? { asker } : {}) };
}

/** `line` to whoever runs the mission, and to the agent that asked, told who acts on it. */
function sayTo({ to, asker }: { to: string; asker?: string }, line: string) {
  notify(to, line);
  if (asker) notify(asker, t().alsoTold(line, nodeNameOf(nodesStore.getState().nodes[to]) || to));
}

/**
 * The user's answer to the question `at`, from the Fleet's panel or the toast: the only way a mission lands. An older
 * question, or one the mission's cleanup took, does nothing. Land runs in turn with the mission's merges while it runs
 * (`oneMergeAtATime`): a moved branch is merged in its worktree.
 */
export async function answerLand(fleetId: string, at: number, land: boolean): Promise<void> {
  toast.dismiss(toastId(fleetId));
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  const request = mission?.landing;
  if (!landable(mission) || !request || request.at !== at || answering.has(fleetId)) return;
  setMission(fleetId, { landing: undefined });
  if (!land) {
    sayTo(listener(fleetId, request), t().notNow(request.target));
    return;
  }
  const { project, worktree } = mission;
  const run = () => missionLand(project, worktree, request.target, request.tip);
  answering.add(fleetId);
  let landed: Landed;
  try {
    landed = await (mission.state === "en_cours" ? oneMergeAtATime(worktree, run) : run());
  } catch (error) {
    toastError(u().failed, { error });
    sayTo(listener(fleetId, request), t().failed(oneLine(errorText(error))));
    return;
  } finally {
    answering.delete(fleetId);
  }
  tell(fleetId, request, landed, worktree);
}

/** The outcome, to the user as a toast and to the mission's runner as a line. */
function tell(fleetId: string, request: LandRequest, landed: Landed, worktree: string) {
  const a = t();
  const m = u();
  const hearers = listener(fleetId, request);
  const { to, running, asker } = hearers;
  const { target, branch } = request;
  switch (landed.kind) {
    case "landed": {
      toast.success(m.landed(target, request.count));
      const line = a.landed(target, short(landed.from), short(landed.to));
      const next = to !== fleetId ? a.thenFinish : running ? a.thenFinishAndClean : a.thenClean;
      notify(to, `${line} ${next}`);
      // The Fleet cleans the mission up: it hears of the landing even while its Manager runs the board.
      if (to !== fleetId) notify(fleetId, a.landedFleet(target, short(landed.to)));
      else if (asker) notify(asker, line);
      return;
    }
    case "upToDate":
      toast(m.upToDate(target));
      sayTo(hearers, a.upToDate(target));
      return;
    case "dirty":
      toastError(m.dirty(target), { next: m.dirtyNext(few(landed.files)) });
      sayTo(hearers, a.dirty(target, landed.checkout, few(landed.files)));
      return;
    case "merged":
      toast(m.merged(target), { description: m.mergedNext });
      sayTo(hearers, a.moved(target, branch, landed.commit, worktree, running));
      return;
    case "conflict":
      toastError(m.conflict(target), { next: m.conflictNext(few(landed.files)) });
      sayTo(hearers, a.conflict(target, branch, few(landed.files), worktree, running));
      return;
  }
}
