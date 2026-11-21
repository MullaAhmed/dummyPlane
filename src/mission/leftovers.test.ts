// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { missionCleanLeftovers, missionLeftovers, type Leftovers } from "@/ipc/mission";
import { fleetTool } from "@/mcp/fleetTools";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { showDecisionToast } from "@/shell/DecisionToast";
import { notify } from "./events";
import { answerLeftovers, askLeftovers, leftoversStore, liveSlugs } from "./leftovers";
import { NEW_MISSION, type Mission } from "./mission";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) }));
// The question's toast, shown while the Fleet is out of sight (no canvas here): missionToasts.test.tsx draws it for real.
vi.mock("@/shell/DecisionToast", () => ({ showDecisionToast: vi.fn() }));
vi.mock("@/ipc/mission", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/ipc/mission")>()), missionLeftovers: vi.fn(), missionCleanLeftovers: vi.fn() }));
vi.mock("./events", async (importOriginal) => ({ ...(await importOriginal<typeof import("./events")>()), notify: vi.fn() }));
vi.mock("@/mission/launch", () => ({ cleanMission: vi.fn(), cleaningNow: vi.fn(() => false), endMission: vi.fn(), mergeMission: vi.fn(), reassignTask: vi.fn(), deliveryPending: vi.fn(() => false), launchMission: vi.fn() }));
vi.mock("@/agents/broadcast", () => ({ pauseAgents: vi.fn() }));
vi.mock("@/agents/remoteControl", () => ({ setRemoteControl: vi.fn(), remoteBusy: vi.fn(() => false) }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(), quietFor: vi.fn(() => 0), typedAgo: vi.fn(() => Infinity), freshText: vi.fn(() => "") }));

const terminal = (name: string, cwd: string) => ({ title: name, name, agent: "claude" as const, cwd, shell: "default" as const, command: "" });
const fleet = (name: string, cwd: string, mission: Partial<Mission>) => ({ name, session: { ...terminal(name, cwd), role: "orchestrator" as const }, mission: { ...NEW_MISSION, ...mission } });

/** What git found: two past missions' leftovers, one kept with why. */
const found: Leftovers = {
  target: "main",
  keptFolder: "C:\\code\\proj.worktrees\\.kept",
  worktrees: [
    { name: "alpha-thor", branch: "dummyplane/alpha-thor", wip: true, moves: [".env", ".env.local"], moveCount: 2, gone: false },
    { name: "alpha-storm", branch: "dummyplane/alpha-storm", kept: "Storm is open there", wip: false, moves: [], moveCount: 0, gone: false },
  ],
  branches: [
    { name: "dummyplane/alpha", head: "a1" },
    { name: "dummyplane/alpha-thor", head: "t1", kept: "unlanded: its uncommitted work is saved on it first (WIP saved at clean-up)" },
  ],
  trash: [],
  strays: [],
};

beforeEach(async () => {
  modelRouterStore.setState({ on: false, levels: {} });
  mockIPC(() => undefined);
  vi.clearAllMocks();
  leftoversStore.setState({ asks: {} });
  workspacesStore.setState({ activeId: "w1" });
  agentActivityStore.setState({ activities: {} });
  terminalStatusStore.getState().set("chef", { state: "running" });
  // Chef, between missions; Other runs gamma in the same project; Night finished beta in another one.
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: fleet("Chef", "C:/code/proj", {}) });
  await nodesStore.getState().create("other", { workspaceId: "w1", kind: "fleet", payload: fleet("Other", "C:/code/proj", { state: "en_cours", slug: "gamma", project: "C:\\code\\proj\\" }) });
  await nodesStore.getState().create("night", { workspaceId: "w1", kind: "fleet", payload: fleet("Night", "C:/code/else", { state: "terminee", slug: "beta", project: "C:/code/else" }) });
  await nodesStore.getState().create("storm", { workspaceId: "w1", kind: "terminal", payload: terminal("Storm", "C:/code/proj.worktrees/alpha-storm") });
  vi.mocked(missionLeftovers).mockResolvedValue(found);
  vi.mocked(missionCleanLeftovers).mockResolvedValue({ removed: ["alpha-thor", "dummyplane/alpha"], kept: ["alpha-storm (Storm is open there)"], saved: ["dummyplane/alpha-thor (abc1234)"] });
});

describe("Clean up leftovers", () => {
  it("leaves out every mission a Fleet still holds in the project, and only those", () => {
    expect(liveSlugs("C:/code/proj")).toEqual(["gamma"]);
    expect(liveSlugs("c:\\code\\else")).toEqual(["beta"]);
  });

  it("reads with the live slugs left out and every terminal's folder, asks the user, and acts on nothing", async () => {
    const asked = await askLeftovers("chef", "chef");
    expect(asked.refused).toBeUndefined();
    expect(asked.text).toBe(
      "The user is asked, in the Fleet's panel, whether to clean up 2 worktrees (1 would go) and 2 branches (1 would be deleted, the others kept as unlanded) of past missions. Only their click acts: do not tell them it is done, and never remove a worktree or delete a branch yourself. The outcome arrives as a [dummyPlane] line.",
    );
    expect(missionLeftovers).toHaveBeenCalledWith("C:/code/proj", ["gamma"], expect.arrayContaining([{ path: "C:/code/proj.worktrees/alpha-storm", why: "Storm is open there" }]));
    expect(missionCleanLeftovers).not.toHaveBeenCalled();
    expect(leftoversStore.getState().asks.chef?.leftovers).toEqual(found);
    expect(showDecisionToast).toHaveBeenCalledWith(
      "leftovers-chef",
      expect.objectContaining({ title: "Clean up the leftovers of past missions?", action: expect.objectContaining({ label: "Clean up" }), cancel: expect.objectContaining({ label: "Not now" }) }),
    );
  });

  it("Not now touches nothing, and the Fleet that asked hears it", async () => {
    await askLeftovers("chef", "chef");
    const { at } = leftoversStore.getState().asks.chef!;
    await answerLeftovers("chef", at, false);
    expect(missionCleanLeftovers).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("chef", "The user chose Not now: nothing was touched. Ask again only when they want it.");
    expect(leftoversStore.getState().asks.chef).toBeUndefined();
  });

  it("Clean up does only what the user was shown, the live mission left out again, and tells the outcome", async () => {
    await askLeftovers("chef", "chef");
    const { at } = leftoversStore.getState().asks.chef!;
    await answerLeftovers("chef", at, true);
    expect(missionCleanLeftovers).toHaveBeenCalledOnce();
    expect(missionCleanLeftovers).toHaveBeenCalledWith("C:/code/proj", ["gamma"], expect.arrayContaining([{ path: "C:/code/proj.worktrees/alpha-storm", why: "Storm is open there" }]), {
      worktrees: ["alpha-thor", "alpha-storm"],
      branches: found.branches,
      trash: [],
    });
    expect(notify).toHaveBeenCalledWith(
      "chef",
      "The user clicked Clean up on the leftovers. Removed: alpha-thor, dummyplane/alpha. WIP saved: dummyplane/alpha-thor (abc1234). Kept, and shown to the user with why: alpha-storm (Storm is open there). What was kept stays until its reason goes: clean_up_leftovers again changes nothing for it before then.",
    );
    expect(toast.success).toHaveBeenCalledWith("Leftovers cleaned up", expect.objectContaining({ duration: Infinity }));
    // The question is gone: a second click does nothing.
    await answerLeftovers("chef", at, true);
    expect(missionCleanLeftovers).toHaveBeenCalledOnce();
  });

  it("an older question does nothing", async () => {
    await askLeftovers("chef", "chef");
    await answerLeftovers("chef", 1, true);
    expect(missionCleanLeftovers).not.toHaveBeenCalled();
  });

  it("is refused while a mission starts in the project: its worktrees being made are no leftovers", async () => {
    nodesStore.getState().update("other", { mission: { ...NEW_MISSION, state: "lancement", project: "C:/code/proj" } });
    const asked = await askLeftovers("chef", "chef");
    expect(asked).toEqual({ text: "A mission is starting in this project: ask again once it runs.", refused: true });
    expect(missionLeftovers).not.toHaveBeenCalled();
  });

  it("asks nothing when there is nothing to clean up", async () => {
    vi.mocked(missionLeftovers).mockResolvedValueOnce({ keptFolder: "C:\\code\\proj.worktrees\\.kept", worktrees: [], branches: [], trash: [], strays: ["old-copy"] });
    const asked = await askLeftovers("chef", "chef");
    expect(asked.text).toContain("No leftovers of past missions in this project");
    expect(asked.text).toContain("left alone: old-copy");
    expect(leftoversStore.getState().asks.chef).toBeUndefined();
  });

  // What never-lose-work keeps stays kept at every pass: a question over it only led to a Clean up that changed nothing,
  // its outcome "kept" again, and the question again, in a loop (BOS-Mono, 20 November: two unlanded branches, nothing else).
  describe("when everything left is kept", () => {
    const keptOnly: Leftovers = {
      ...found,
      worktrees: [found.worktrees[1]],
      branches: [{ name: "dummyplane/remi-loki", head: "l1", kept: "unlanded: 3 commits not on main" }],
    };
    const KEPT = "alpha-storm (Storm is open there); dummyplane/remi-loki (unlanded: 3 commits not on main)";

    it("asks nothing and cleans nothing, and a second ask says the same: never a Clean up that would change nothing", async () => {
      vi.mocked(missionLeftovers).mockResolvedValue(keptOnly);
      const first = await askLeftovers("chef", "chef");
      const second = await askLeftovers("chef", "chef");
      expect(second).toEqual(first);
      expect(first).toEqual({
        text: `Nothing to clean up: everything past missions left in this project is kept, so the user is not asked (a Clean up would change nothing). Kept, with why: ${KEPT}. Each stays until its reason goes (its branch landed on the user's branch, the terminal in it closed): tell the user, and do not call clean_up_leftovers again for them before then.`,
      });
      expect(leftoversStore.getState().asks.chef).toBeUndefined();
      expect(showDecisionToast).not.toHaveBeenCalled();
      expect(missionCleanLeftovers).not.toHaveBeenCalled();
    });

    it("tells the user who clicked the button what is kept and why, once, and takes back a question asked before", async () => {
      await askLeftovers("chef", "chef");
      expect(leftoversStore.getState().asks.chef).toBeDefined();
      vi.mocked(missionLeftovers).mockResolvedValue(keptOnly);
      expect(await askLeftovers("chef")).toEqual(expect.objectContaining({ text: expect.stringContaining("Nothing to clean up") }));
      expect(leftoversStore.getState().asks.chef).toBeUndefined();
      expect(toast.dismiss).toHaveBeenCalledWith("leftovers-chef");
      expect(toast).toHaveBeenLastCalledWith("Nothing to clean up", { description: `Everything past missions left here is kept: ${KEPT}. Each stays until its reason goes.` });
      expect(missionCleanLeftovers).not.toHaveBeenCalled();
    });
  });

  it("is a Fleet tool that only raises the question: the user's click alone acts", async () => {
    const result = await fleetTool("chef", "clean_up_leftovers", {});
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("Only their click acts");
    expect(leftoversStore.getState().asks.chef).toBeDefined();
    expect(missionCleanLeftovers).not.toHaveBeenCalled();
  });
});
