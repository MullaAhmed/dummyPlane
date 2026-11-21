// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { CLEANUP_WAIT_MS, cleanFromPanel } from "@/mission/cleanup";
import { cleanMission, type MissionCleanup } from "@/mission/launch";
import { NEW_MISSION, type Mission } from "@/mission/mission";
import { missionOf } from "@/mission/store";
import { pendingEvents } from "@/mission/events";
import { clearDraft, trackInput } from "@/nodes/terminal/draft";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { fleetTool } from "./fleetTools";

/**
 * A clean-up git takes long over (28 worktrees and their node_modules took 89 s on the user's PC): Rust gives a tool
 * 30 s (MCP_TIMEOUT), past which the Fleet heard only "dummyPlane is not responding" while the work went on behind it.
 * Here a slow fake cleanup stands for git: the tool must answer in time, start nothing twice, and the result must
 * reach the Fleet's terminal later through the notice path, never spliced into what the user is typing there.
 */

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("@/mission/launch", async () => {
  const { NEW_MISSION: blank } = await import("@/mission/mission");
  const { nodesStore: store } = await import("@/store/nodes");
  // git, as slow as a test makes it: the cleanup ends when `finishGit` is called.
  let running: Promise<MissionCleanup> | undefined;
  return {
    endMission: vi.fn(),
    mergeMission: vi.fn(),
    reassignTask: vi.fn(),
    deliveryPending: vi.fn(() => false),
    launchMission: vi.fn(() => Promise.resolve()),
    cleaningNow: vi.fn(() => running !== undefined),
    cleanMission: vi.fn((fleetId: string) => {
      running = new Promise<MissionCleanup>((resolve) => {
        (globalThis as { finishGit?: () => void }).finishGit = () => {
          store.getState().update(fleetId, { mission: { ...blank } });
          running = undefined;
          resolve({ removed: ["auth-batman", "auth"], kept: ["dummyplane/auth (2 commits not on main)"], open: [], moved: [{ worktree: "auth", folder: "C:\\code\\proj.worktrees\\.kept\\auth", files: [".env.local", "public/fonts/"], count: 2 }] });
        };
      });
      return running;
    }),
  };
});
vi.mock("@/agents/broadcast", () => ({ pauseAgents: vi.fn() }));
vi.mock("@/agents/remoteControl", () => ({ setRemoteControl: vi.fn(), remoteBusy: vi.fn(() => false) }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(), quietFor: vi.fn(() => 0), typedAgo: vi.fn(() => Infinity), freshText: vi.fn(() => "") }));

const finishGit = () => (globalThis as { finishGit?: () => void }).finishGit?.();
const session = { title: "Chef", name: "Chef", agent: "claude" as const, cwd: "C:/code/proj", shell: "default" as const, command: "", role: "orchestrator" as const };
const textOf = (result: { content: { text: string }[] }) => result.content[0].text;
const finished: Partial<Mission> = { state: "terminee", name: "Auth", maxAgents: 3, project: "C:/code/proj", slug: "auth", branch: "dummyplane/auth", summary: "Login shipped.", members: [] };
const plan = { nom: "Next", tache: "T", sous_taches: [{ titre: "Docs", consigne: "Write them", agent: "nouveau", budget_min: 5 }] };

/** What dummyPlane typed into a terminal (`ptySendText`), by node. */
let typed: { nodeId: string; text: string }[] = [];

beforeEach(async () => {
  vi.useFakeTimers();
  modelRouterStore.setState({ on: false, levels: {} });
  typed = [];
  mockIPC((cmd, args) => {
    if (cmd === "pty_send_text") typed.push(args as { nodeId: string; text: string });
    return undefined;
  });
  vi.clearAllMocks();
  workspacesStore.setState({ activeId: "w1" });
  agentActivityStore.setState({ activities: {} });
  terminalStatusStore.getState().set("chef", { state: "running" });
  clearDraft("chef");
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", session, mission: { ...NEW_MISSION, ...finished } } });
});

afterEach(() => {
  finishGit();
  vi.useRealTimers();
});

/** Calls a Fleet tool and lets fake time run until it answers, as Rust would wait: how long it took, in ms. */
async function timed(name: string, args: Record<string, unknown> = {}) {
  const started = Date.now();
  let answer: Awaited<ReturnType<typeof fleetTool>> | undefined;
  void fleetTool("chef", name, args).then((result) => (answer = result));
  while (!answer && Date.now() - started < 60_000) await vi.advanceTimersByTimeAsync(250);
  return { answer: answer!, ms: Date.now() - started };
}

describe("a clean-up that outlasts the 30 s a tool has", () => {
  it("answers clean_up_mission in time that it is under way, then types its result into the Fleet's terminal, once", async () => {
    const { answer, ms } = await timed("clean_up_mission");
    expect(ms).toBeLessThan(30_000);
    expect(ms).toBeGreaterThanOrEqual(CLEANUP_WAIT_MS);
    expect(answer.isError).not.toBe(true);
    expect(textOf(answer)).toBe(
      'The clean-up of mission "Auth" is under way: git takes a while on its worktrees. Its result comes to your terminal as a [dummyPlane] line. Nothing to do meanwhile: never clean up by hand, and do not call clean_up_mission again.',
    );
    // Still finished while git works: nothing reset the mission behind the Fleet's back.
    expect(missionOf(nodesStore.getState().nodes.chef)?.state).toBe("terminee");
    expect(typed).toEqual([]);
    finishGit();
    await vi.advanceTimersByTimeAsync(0);
    expect(typed).toHaveLength(1);
    expect(typed[0].nodeId).toBe("chef");
    expect(typed[0].text).toContain('[dummyPlane] The clean-up has ended. Mission "Auth" cleaned up');
    expect(typed[0].text).toContain("Removed: auth-batman, auth.");
    expect(typed[0].text).toContain("Kept, and shown to the user with why: dummyplane/auth (2 commits not on main).");
    expect(typed[0].text).toContain("auth: .env.local, public/fonts/ → C:\\code\\proj.worktrees\\.kept\\auth");
    expect(typed[0].text).toContain("Summary: Login shipped.");
    // The user is shown it once, as the panel's own clean-up shows it.
    expect(toast.success).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(typed).toHaveLength(1);
  });

  it("types its late result as one line, a Markdown summary of many lines flattened: an Enter in it would send it halfway", async () => {
    nodesStore.getState().update("chef", { mission: { ...NEW_MISSION, ...finished, summary: "## Done\n\n- Login\n- API\r\n\nChecks pass." } });
    await timed("clean_up_mission");
    finishGit();
    await vi.advanceTimersByTimeAsync(0);
    expect(typed).toHaveLength(1);
    expect(typed[0].text).not.toMatch(/[\r\n]/);
    expect(typed[0].text).toContain("Summary: ## Done - Login - API Checks pass.");
  });

  it("answers a second clean_up_mission at once that it is already under way, and never starts a second pass", async () => {
    await timed("clean_up_mission");
    const { answer, ms } = await timed("clean_up_mission");
    expect(ms).toBeLessThan(1_000);
    expect(answer.isError).not.toBe(true);
    expect(textOf(answer)).toBe(
      "The clean-up of the finished mission is already under way: nothing was started twice. Its result comes to your terminal as a [dummyPlane] line; wait for it.",
    );
    expect(cleanMission).toHaveBeenCalledOnce();
    finishGit();
    await vi.advanceTimersByTimeAsync(0);
    // Told once, however many times it asked.
    expect(typed).toHaveLength(1);
  });

  it("never lets propose_plan hang: the plan waits for a blank mission, and the Fleet is told to send it again", async () => {
    const { answer, ms } = await timed("proposer_plan", plan);
    expect(ms).toBeLessThan(30_000);
    expect(answer.isError).toBe(true);
    expect(textOf(answer)).toContain('The clean-up of mission "Auth" is under way');
    expect(textOf(answer)).toContain("Your plan is not taken yet: the mission must be blank first. Send it again with propose_plan once the clean-up's result reaches you.");
    // A second propose_plan meanwhile: at once, and no second pass.
    const again = await timed("proposer_plan", plan);
    expect(again.ms).toBeLessThan(1_000);
    expect(textOf(again.answer)).toContain("already under way");
    expect(cleanMission).toHaveBeenCalledOnce();
    expect(missionOf(nodesStore.getState().nodes.chef)?.plan).toBeUndefined();
    finishGit();
    await vi.advanceTimersByTimeAsync(0);
    expect(typed).toHaveLength(1);
    expect(typed[0].text).toContain("The mission is blank now: send your plan again with propose_plan.");
    // And the plan sent again is taken.
    const taken = await timed("proposer_plan", plan);
    expect(taken.answer.isError).not.toBe(true);
    expect(missionOf(nodesStore.getState().nodes.chef)?.state).toBe("plan");
  });

  it("holds its result while the user has typed in the Fleet's terminal without sending: nothing spliced into their line", async () => {
    await timed("clean_up_mission");
    // Half a line, written and not sent.
    trackInput("chef", "can you also");
    finishGit();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(typed).toEqual([]);
    expect(pendingEvents("chef")).toHaveLength(1);
    // Their Enter sends their line; the result comes after it.
    trackInput("chef", "\r");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(typed).toHaveLength(1);
    expect(typed[0].text).toContain("The clean-up has ended.");
  });

  it("answers in one go when git is quick, as before", async () => {
    void fleetTool("chef", "clean_up_mission", {});
    const answer = fleetTool("chef", "clean_up_mission", {});
    await vi.advanceTimersByTimeAsync(0);
    expect(textOf(await answer)).toContain("already under way");
    finishGit();
    await vi.advanceTimersByTimeAsync(0);
    expect(cleanMission).toHaveBeenCalledOnce();
  });

  it("a click on the panel's button while the Fleet's clean-up runs starts nothing: the user is told it is under way", async () => {
    await timed("clean_up_mission");
    await cleanFromPanel("chef");
    expect(cleanMission).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith("The clean-up of this mission is already under way: its result shows here when it ends");
    finishGit();
    await vi.advanceTimersByTimeAsync(0);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("a clean_up_mission while the panel's clean-up runs is told it is under way, and hears its result", async () => {
    const clicked = cleanFromPanel("chef");
    const { answer } = await timed("clean_up_mission");
    expect(textOf(answer)).toContain("already under way");
    finishGit();
    await clicked;
    await vi.advanceTimersByTimeAsync(0);
    expect(cleanMission).toHaveBeenCalledOnce();
    expect(typed).toHaveLength(1);
    expect(typed[0].text).toContain('Mission "Auth" cleaned up');
  });
});
