// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { showDecisionToast } from "@/shell/DecisionToast";
import { missionLand, missionLanding, type Landing } from "@/ipc/mission";
import { fleetTool, fleetTools, managerTool, managerTools } from "@/mcp/fleetTools";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { notify } from "./events";
import { answerLand } from "./land";
import { oneMergeAtATime } from "./launch";
import { NEW_MISSION, readMission, type Mission } from "./mission";
import { missionOf } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) }));
// The question's toast, shown while the Fleet is out of sight (no canvas here): missionToasts.test.tsx draws it for real.
vi.mock("@/shell/DecisionToast", () => ({ showDecisionToast: vi.fn() }));
vi.mock("@/ipc/mission", () => ({ missionLanding: vi.fn(), missionLand: vi.fn() }));
vi.mock("./events", () => ({ notify: vi.fn() }));
vi.mock("./launch", () => ({
  oneMergeAtATime: vi.fn((_worktree: string, run: () => Promise<unknown>) => run()),
  endMission: vi.fn(),
  mergeMission: vi.fn(),
  reassignTask: vi.fn(),
  deliveryPending: vi.fn(() => false),
  launchMission: vi.fn(() => Promise.resolve()),
  cleanMission: vi.fn(),
}));

const session = { title: "Chef", name: "Chef", agent: "claude" as const, cwd: "C:/code/proj", shell: "default" as const, command: "", role: "orchestrator" as const };
const manager = { title: "Manager", name: "Manager", agent: "claude" as const, cwd: "C:/code/proj", shell: "default" as const, command: "", role: "manager" as const, fleet: "chef" };
const textOf = (result: { content: { text: string }[] }) => result.content[0].text;
const tip = "a1b2c3d4".repeat(5);
const asked: Landing = { target: "main", branch: "dummyplane/auth", tip, commits: ["a1b2c3d API", "9f8e7d6 Login"], count: 2, fastForward: true };
const running: Partial<Mission> = { state: "en_cours", name: "Auth", project: "C:/code/proj", slug: "auth", branch: "dummyplane/auth", worktree: "C:/w/auth", base: "main", members: [] };

async function setup(mission: Partial<Mission>) {
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", session, mission: { ...NEW_MISSION, ...mission } } });
}
const mission = () => missionOf(nodesStore.getState().nodes.chef);
const landing = () => mission()?.landing;

beforeEach(async () => {
  // The store's own saves: no git command goes through here, they are `@/ipc/mission`'s, mocked above.
  mockIPC(() => undefined);
  vi.clearAllMocks();
  vi.mocked(missionLanding).mockResolvedValue(asked);
  workspacesStore.setState({ activeId: "w1" });
  await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: manager });
  for (const id of ["chef", "boss"]) terminalStatusStore.getState().set(id, { state: "running" });
});

describe("land", () => {
  it("is listed to the Fleet and the Manager", () => {
    expect(fleetTools().map((tool) => tool.name)).toContain("land");
    expect(managerTools().map((tool) => tool.name)).toContain("land");
    expect(fleetTools().find((tool) => tool.name === "land")?.description).toContain("never push, open a pull request, or call gh or any remote");
  });

  it("only asks the user: the Fleet's call lands nothing, it raises Land / Not now and says so", async () => {
    await setup(running);
    const result = await fleetTool("chef", "land", {});
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("The user is asked, in the Fleet's panel, whether main gets the 2 commits of dummyplane/auth");
    expect(textOf(result)).toContain("Only their click there lands");
    expect(missionLanding).toHaveBeenCalledWith("C:/code/proj", "C:/w/auth", "main");
    expect(missionLand).not.toHaveBeenCalled();
    expect(landing()).toMatchObject({ target: "main", branch: "dummyplane/auth", tip, count: 2, fastForward: true });
    const [id, decision] = vi.mocked(showDecisionToast).mock.calls[0];
    expect(id).toBe("land-chef");
    expect(decision.title).toBe("Land the mission on main?");
    expect([decision.action.label, decision.cancel.label]).toEqual(["Land", "Not now"]);
  });

  it("only asks the user for the Manager too, whatever it says the user agreed to", async () => {
    await setup({ ...running, manager: "boss" });
    expect(textOf(await managerTool("boss", "land", { yes: true, user_agreed: true }))).toContain("The user is asked");
    expect(missionLand).not.toHaveBeenCalled();
    expect(landing()?.tip).toBe(tip);
  });

  it("says when there is nothing to land, and asks nothing", async () => {
    await setup(running);
    vi.mocked(missionLanding).mockResolvedValueOnce({ ...asked, commits: [], count: 0 });
    expect(textOf(await fleetTool("chef", "land", {}))).toBe("Nothing to land: main already has every commit of dummyplane/auth.");
    expect(landing()).toBeUndefined();
    expect(toast).not.toHaveBeenCalled();
    expect(showDecisionToast).not.toHaveBeenCalled();
  });

  it("refuses a mission that is only planned", async () => {
    await setup({ state: "plan", name: "Auth" });
    const result = await fleetTool("chef", "land", {});
    expect(result.isError).toBe(true);
    expect(missionLanding).not.toHaveBeenCalled();
  });

  it("keeps the question across a restart", () => {
    const saved = JSON.parse(JSON.stringify({ ...NEW_MISSION, ...running, landing: { ...asked, at: 5 } }));
    expect(readMission(saved)?.landing).toEqual({ ...asked, at: 5 });
    expect(readMission(saved)?.base).toBe("main");
  });
});

describe("the user's answer", () => {
  async function ask(extra: Partial<Mission> = {}) {
    await setup({ ...running, ...extra });
    await fleetTool("chef", "land", {});
    return landing()?.at ?? -1;
  }

  it("lands the tip the user was shown, in turn with the mission's merges, and tells the runner and the Fleet", async () => {
    const at = await ask({ manager: "boss" });
    vi.mocked(missionLand).mockResolvedValueOnce({ kind: "landed", target: "main", from: "0".repeat(40), to: tip });
    await answerLand("chef", at, true);
    expect(missionLand).toHaveBeenCalledWith("C:/code/proj", "C:/w/auth", "main", tip);
    expect(oneMergeAtATime).toHaveBeenCalledWith("C:/w/auth", expect.any(Function));
    expect(landing()).toBeUndefined();
    expect(toast.success).toHaveBeenCalledWith("Mission landed: main has its 2 commits");
    expect(notify).toHaveBeenCalledWith("boss", expect.stringContaining("The user clicked Land: main went from 0000000 to a1b2c3d"));
    expect(notify).toHaveBeenCalledWith("boss", expect.stringContaining("Call finish with your summary; the Fleet then cleans the mission up."));
    expect(notify).toHaveBeenCalledWith("chef", expect.stringContaining("clean_up_mission cleans the mission up"));
  });

  it("lands a finished mission for the Fleet, which then cleans it up", async () => {
    const at = await ask({ state: "terminee" });
    vi.mocked(missionLand).mockResolvedValueOnce({ kind: "landed", target: "main", from: "0".repeat(40), to: tip });
    await answerLand("chef", at, true);
    // No merge runs in a finished mission: its line of merges is not kept.
    expect(oneMergeAtATime).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("chef", expect.stringContaining("clean_up_mission cleans the mission up now."));
  });

  it("Not now lands nothing and tells the runner", async () => {
    const at = await ask({ manager: "boss" });
    await answerLand("chef", at, false);
    expect(missionLand).not.toHaveBeenCalled();
    expect(landing()).toBeUndefined();
    expect(notify).toHaveBeenCalledWith("boss", "The user chose Not now: the mission is not landed on main. Call land again only when they ask for it.");
  });

  it("a click on an older question, a second click, or after the cleanup lands nothing", async () => {
    const at = await ask();
    await answerLand("chef", at - 1, true);
    expect(missionLand).not.toHaveBeenCalled();
    vi.mocked(missionLand).mockResolvedValue({ kind: "upToDate" });
    await Promise.all([answerLand("chef", at, true), answerLand("chef", at, true)]);
    expect(missionLand).toHaveBeenCalledTimes(1);
    const again = await ask();
    nodesStore.getState().update("chef", { mission: { ...NEW_MISSION } });
    await answerLand("chef", again, true);
    expect(missionLand).toHaveBeenCalledTimes(1);
  });

  it("an uncommitted checkout is the user's: refused, and the runner told never to stash it", async () => {
    const at = await ask({ manager: "boss" });
    vi.mocked(missionLand).mockResolvedValueOnce({ kind: "dirty", checkout: "C:\\code\\proj", files: ["a.ts", "b.ts", "c.ts", "d.ts"] });
    await answerLand("chef", at, true);
    expect(toast.error).toHaveBeenCalledWith("Mission not landed: your checkout of main has uncommitted changes", expect.anything());
    expect(notify).toHaveBeenCalledWith(
      "boss",
      "Not landed: the user's checkout of main (C:\\code\\proj) has uncommitted changes (a.ts, b.ts, c.ts, +1 more). Nothing was touched. They commit or set them aside themselves: never ask an agent to stash, reset or commit them. Call land again when they say so.",
    );
  });

  it("a moved branch merged into the mission's worktree sends the checks to a team agent, then asks again", async () => {
    const at = await ask({ manager: "boss" });
    vi.mocked(missionLand).mockResolvedValueOnce({ kind: "merged", commit: "77aa11b" });
    await answerLand("chef", at, true);
    const line = vi.mocked(notify).mock.calls.find(([to]) => to === "boss")?.[1] ?? "";
    expect(line).toContain("Not landed yet: main moved since the mission started. dummyPlane merged it into dummyplane/auth in the mission's worktree C:/w/auth (commit 77aa11b)");
    expect(line).toContain("hand a team agent a sub-task (add_tasks) to run them in that worktree and report, then call land again.");
  });

  it("a conflict goes to an agent to resolve in the mission's worktree; a finished mission's, to the Fleet's spawn_agent", async () => {
    const at = await ask({ state: "terminee" });
    vi.mocked(missionLand).mockResolvedValueOnce({ kind: "conflict", files: ["src/a.ts"] });
    await answerLand("chef", at, true);
    const line = vi.mocked(notify).mock.calls[0]?.[1] ?? "";
    expect(vi.mocked(notify).mock.calls[0]?.[0]).toBe("chef");
    expect(line).toContain("merging it into dummyplane/auth conflicts in src/a.ts");
    expect(line).toContain("open an agent with spawn_agent to run git merge main in the mission's worktree C:/w/auth");
    expect(line).toContain("never on its own branch");
  });

  it("the Fleet that asked while its Manager runs the board hears the outcome too, and who acts on it", async () => {
    const at = await ask({ manager: "boss" });
    vi.mocked(missionLand).mockResolvedValueOnce({ kind: "merged", commit: "77aa11b" });
    await answerLand("chef", at, true);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith("boss", expect.stringContaining("hand a team agent a sub-task"));
    expect(notify).toHaveBeenCalledWith("chef", expect.stringMatching(/hand a team agent a sub-task.*\(Manager, which runs the mission, hears the same and acts on it\.\)$/));
  });

  it("a Manager that asked hears the landing after its mission finished, and the Fleet cleans up", async () => {
    await setup({ ...running, manager: "boss" });
    await managerTool("boss", "land", {});
    const at = landing()?.at ?? -1;
    nodesStore.getState().update("chef", { mission: { ...mission()!, state: "terminee" } });
    vi.mocked(missionLand).mockResolvedValueOnce({ kind: "landed", target: "main", from: "0".repeat(40), to: tip });
    await answerLand("chef", at, true);
    expect(notify).toHaveBeenCalledWith("chef", expect.stringContaining("clean_up_mission cleans the mission up now."));
    expect(notify).toHaveBeenCalledWith("boss", "The user clicked Land: main went from 0000000 to a1b2c3d, a fast-forward. Nothing was pushed.");
  });

  it("a finished mission's moved branch sends the Fleet's agent to the worktree, away from the user's checkout", async () => {
    const at = await ask({ state: "terminee" });
    vi.mocked(missionLand).mockResolvedValueOnce({ kind: "merged", commit: "77aa11b" });
    await answerLand("chef", at, true);
    expect(vi.mocked(notify).mock.calls[0]?.[1]).toContain("It opens in the user's checkout: tell it to work only in C:/w/auth (git -C there, its commands run from there) and never to touch the checkout.");
  });

  it("a git failure is said to the user and the runner", async () => {
    const at = await ask();
    vi.mocked(missionLand).mockRejectedValueOnce(new Error("The branch main no longer exists."));
    await answerLand("chef", at, true);
    expect(toast.error).toHaveBeenCalledWith("Could not land the mission", expect.anything());
    expect(notify).toHaveBeenCalledWith("chef", "Not landed: The branch main no longer exists. Nothing was pushed; tell the user.");
  });
});
