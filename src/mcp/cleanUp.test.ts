// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { cleanMission } from "@/mission/launch";
import { NEW_MISSION, type Member, type Mission } from "@/mission/mission";
import { missionOf } from "@/mission/store";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { fleetTool, fleetTools, managerTool } from "./fleetTools";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/mission/launch", async () => {
  const { NEW_MISSION: blank } = await import("@/mission/mission");
  const { nodesStore: store } = await import("@/store/nodes");
  return {
    endMission: vi.fn(),
    mergeMission: vi.fn(),
    reassignTask: vi.fn(),
    launchMission: vi.fn(() => Promise.resolve()),
    // The panel's cleanup, as far as these tests look: it frees the Fleet with a blank mission, its settings kept.
    cleanMission: vi.fn(async (fleetId: string) => {
      const mission = (store.getState().nodes[fleetId]?.payload as { mission?: { maxAgents: number; router?: boolean } }).mission;
      store.getState().update(fleetId, { mission: { ...blank, maxAgents: mission?.maxAgents ?? blank.maxAgents, ...(mission?.router ? { router: true } : {}) } });
      return { removed: ["auth-batman", "auth"], kept: [] as string[] };
    }),
  };
});
vi.mock("@/agents/broadcast", () => ({ pauseAgents: vi.fn() }));
vi.mock("@/agents/remoteControl", () => ({ setRemoteControl: vi.fn() }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(), quietFor: vi.fn(() => 0), typedAgo: vi.fn(() => Infinity), freshText: vi.fn(() => "") }));

const session = { title: "Chef", name: "Chef", agent: "claude" as const, cwd: "C:/code/proj", shell: "default" as const, command: "", role: "orchestrator" as const };
const textOf = (result: { content: { text: string }[] }) => result.content[0].text;
const member = (nodeId: string, name: string, extra: Partial<Member> = {}): Member => ({
  nodeId, name, task: "Login", budgetMin: 10, linked: false, branch: `dummyplane/auth-${name.toLowerCase()}`, worktree: `C:/w/${name.toLowerCase()}`, sentAt: 1, report: { summary: "ok", status: "termine", at: 2 }, merged: true, ...extra,
});
const finished = (extra: Partial<Mission> = {}): Partial<Mission> => ({
  state: "terminee", name: "Auth", maxAgents: 3, project: "C:/code/proj", slug: "auth", branch: "dummyplane/auth", summary: "Login and API shipped.", members: [member("a1", "Batman")], ...extra,
});
const plan = { name: "Next", task: "T", subtasks: [{ title: "Docs", brief: "Write them", agent: "new", budget_min: 5 }] };

/** What the project's git would say the cleanup leaves in place: `mission_cleanup_unsaved`'s answer. */
let unsaved: string[] | Error = [];
let asked: Record<string, unknown>[] = [];

async function setup(mission: Partial<Mission>) {
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", session, mission: { ...NEW_MISSION, ...mission } } });
}

beforeEach(() => {
  unsaved = [];
  asked = [];
  mockIPC((command, args) => {
    if (command !== "mission_cleanup_unsaved") return undefined;
    asked.push(args as Record<string, unknown>);
    if (unsaved instanceof Error) throw unsaved;
    return unsaved;
  });
  vi.clearAllMocks();
  workspacesStore.setState({ activeId: "w1" });
  agentActivityStore.setState({ activities: {} });
  terminalStatusStore.getState().set("chef", { state: "running" });
});

describe("clean_up_mission", () => {
  it("cleans a finished mission up with the panel's own cleanup, and tells the Fleet what went and what it must pass on", async () => {
    await setup(finished({ handChecks: ["Read the migration"] }));
    const result = await fleetTool("chef", "clean_up_mission", {});
    expect(result.isError).not.toBe(true);
    expect(cleanMission).toHaveBeenCalledOnce();
    expect(cleanMission).toHaveBeenCalledWith("chef");
    expect(textOf(result)).toBe(
      'Mission "Auth" cleaned up: the worktrees of its team that were merged are removed (the branches stay), its Manager (if it had one) is closed, and the mission starts again blank. ' +
        "Its branch dummyplane/auth stays too: the user merges it into their own, and the next mission starts from the project's current commit. " +
        "Its summary is no longer in the panel: tell the user what it said, if you have not. Summary: Login and API shipped. To check by hand: Read the migration.",
    );
    // The same check the panel's cleanup would keep nothing from: the project, the mission's slug, every member.
    expect(asked).toEqual([{ project: "C:/code/proj", mission: "auth", agents: ["Batman"] }]);
    expect(missionOf(nodesStore.getState().nodes.chef)).toMatchObject({ state: "redaction", maxAgents: 3, members: [] });
  });

  it("shows a quiet toast, 'Mission <name> cleaned up'", async () => {
    await setup(finished());
    await fleetTool("chef", "clean_up_mission", {});
    expect(toast).toHaveBeenCalledWith("Mission Auth cleaned up");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("names the worktrees the real cleanup still left in place", async () => {
    await setup(finished());
    vi.mocked(cleanMission).mockImplementationOnce(async (fleetId) => {
      nodesStore.getState().update(fleetId, { mission: { ...NEW_MISSION } });
      return { removed: ["auth-batman"], kept: ["auth (Permission denied)"] };
    });
    expect(textOf(await fleetTool("chef", "clean_up_mission", {}))).toContain("Left in place: auth (Permission denied).");
  });

  it("tells a git failure after the checks, the mission being blank all the same", async () => {
    await setup(finished());
    vi.mocked(cleanMission).mockImplementationOnce(async (fleetId) => {
      nodesStore.getState().update(fleetId, { mission: { ...NEW_MISSION } });
      return "The project folder is not a git repository.";
    });
    const result = await fleetTool("chef", "clean_up_mission", {});
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain("Git said: The project folder is not a git repository. Some worktrees may be left in place.");
    expect(toast.error).toHaveBeenCalled();
  });

  it.each([
    ["lancement", "A mission is under way: it can be cleaned up once it is finished."],
    ["en_cours", "A mission is under way: it can be cleaned up once it is finished."],
    ["redaction", "No finished mission to clean up."],
    ["plan", "No finished mission to clean up."],
  ] as const)("refuses a mission that is %s and touches nothing", async (state, text) => {
    await setup({ state, members: [member("a1", "Batman")], project: "C:/code/proj", slug: "auth" });
    const result = await fleetTool("chef", "clean_up_mission", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(text);
    expect(cleanMission).not.toHaveBeenCalled();
    expect(asked).toEqual([]);
  });

  it("refuses an overnight run: its report is the user's, and the cleanup would restart the Fleet's own session", async () => {
    await setup(finished({ overnight: true, budgetMin: 480, summary: "Night done" }));
    const result = await fleetTool("chef", "clean_up_mission", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Not cleaned up: it was an overnight run, and its report is for the user, who cleans the mission up from the panel.");
    expect(cleanMission).not.toHaveBeenCalled();
  });

  it("refuses while an agent made for the mission, or its Manager, is still at work", async () => {
    await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: { title: "Manager", name: "Manager", agent: "claude", cwd: "C:/p", shell: "default", command: "", role: "manager", fleet: "chef" } });
    await setup(finished({ manager: "boss", members: [member("a1", "Batman"), member("a2", "Aquaman", { linked: true })] }));
    for (const id of ["a1", "a2", "boss"]) terminalStatusStore.getState().set(id, { state: "running" });
    // A linked agent is back to the user's own work: it does not count.
    for (const id of ["a2", "boss"]) agentActivityStore.getState().apply({ nodeId: id, activity: "working", since: 0 });
    const result = await fleetTool("chef", "clean_up_mission", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Not cleaned up: still at work: Manager. Try again in a moment.");
    expect(cleanMission).not.toHaveBeenCalled();
    agentActivityStore.getState().apply({ nodeId: "a1", activity: "working", since: 1 });
    expect(textOf(await fleetTool("chef", "clean_up_mission", {}))).toContain("still at work: Batman, Manager.");
  });

  it("refuses with a branch not merged or uncommitted work, names it, and cleans nothing", async () => {
    await setup(finished());
    unsaved = ["auth-batman (branch not merged)", "auth-aquaman (uncommitted changes)"];
    const result = await fleetTool("chef", "clean_up_mission", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "Not cleaned up: something is unsaved (auth-batman (branch not merged); auth-aquaman (uncommitted changes)). The user decides what to do with it, then cleans the mission up from the panel.",
    );
    expect(cleanMission).not.toHaveBeenCalled();
    expect(missionOf(nodesStore.getState().nodes.chef)?.state).toBe("terminee");
    expect(toast).not.toHaveBeenCalled();
  });

  it("refuses when git cannot say what the cleanup would leave: nothing is cleaned on a guess", async () => {
    await setup(finished());
    unsaved = new Error("The folder C:/code/proj is not a git repository.");
    const result = await fleetTool("chef", "clean_up_mission", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("dummyPlane could not check what the cleanup would leave behind");
    expect(textOf(result)).toContain("not a git repository");
    expect(cleanMission).not.toHaveBeenCalled();
  });

  describe("the board's open cards", () => {
    const board = (cards: Record<string, string[]>) =>
      nodesStore.getState().create("k1", {
        workspaceId: "w1",
        kind: "kanban",
        payload: {
          columns: [
            { id: "todo", title: "To do", cardIds: cards.todo ?? [] },
            { id: "doing", title: "In progress", cardIds: cards.doing ?? [] },
            { id: "done", title: "Done", cardIds: cards.done ?? [] },
          ],
          cards: Object.fromEntries(Object.values(cards).flat().map((id) => [id, { id, title: id, notes: "", priority: "none" }])),
          orchestrator: { nodeId: "chef", columnId: "todo" },
        },
      });
    // Unlinked: the next tests see no board.
    afterEach(() => void nodesStore.getState().update("k1", { orchestrator: undefined }));
    const tasks = [
      { title: "Login", brief: "b", agent: "nouveau", budgetMin: 10, card: "c1" },
      { title: "API", brief: "b", agent: "nouveau", budgetMin: 10, card: "c2" },
    ];

    it("refuses while a card of the mission's own tasks is not done, naming its task", async () => {
      await board({ done: ["c1"], doing: ["c2"], todo: ["other"] });
      await setup(finished({ plan: tasks, board: "k1" }));
      const result = await fleetTool("chef", "clean_up_mission", {});
      expect(result.isError).toBe(true);
      // Only the mission's: the user's own card on the same board is none of its business.
      expect(textOf(result)).toContain('something is unsaved (1 task not done or never started: "API")');
      expect(cleanMission).not.toHaveBeenCalled();
    });

    it("cleans up once every card of the mission is done, whatever else the board holds", async () => {
      await board({ done: ["c1", "c2"], todo: ["other"] });
      await setup(finished({ plan: tasks, board: "k1" }));
      expect(textOf(await fleetTool("chef", "clean_up_mission", {}))).toContain("cleaned up");
      expect(cleanMission).toHaveBeenCalledOnce();
    });

    it("refuses while tasks wait in the queue, cards or not", async () => {
      await setup(finished({ queue: [{ title: "Docs", brief: "b", budgetMin: 5 }, { title: "Tests", brief: "b", budgetMin: 5 }] }));
      const result = await fleetTool("chef", "clean_up_mission", {});
      expect(textOf(result)).toContain('(2 tasks not done or never started: "Docs", "Tests")');
      expect(cleanMission).not.toHaveBeenCalled();
    });
  });

  it("is in the Fleet's tools, with no argument, and in no one else's", () => {
    const fleet = fleetTools();
    expect(fleet.map((tool) => tool.name)).toContain("clean_up_mission");
    expect(fleet.map((tool) => tool.name).indexOf("clean_up_mission")).toBe(fleet.map((tool) => tool.name).indexOf("stop_mission") + 1);
    const tool = fleet.find((spec) => spec.name === "clean_up_mission")!;
    expect(tool.inputSchema).toEqual({ type: "object", properties: {} });
    expect(tool.description).toContain("Refused while a mission is running or was an overnight run");
    // A Codex fleet has it too: the cleanup is dummyPlane's, not Claude's.
    expect(fleetTools({ claude: false }).map((spec) => spec.name)).toContain("clean_up_mission");
  });
});

describe("propose_plan on a finished mission", () => {
  it("cleans it up first with the same cleanup, then drafts the new plan on the blank mission", async () => {
    await setup(finished({ router: true }));
    const result = await fleetTool("chef", "proposer_plan", { nom: plan.name, tache: plan.task, sous_taches: [{ titre: "Docs", consigne: "Write them", agent: "nouveau", budget_min: 5, niveau: "faible" }] });
    expect(result.isError).not.toBe(true);
    expect(cleanMission).toHaveBeenCalledOnce();
    const text = textOf(result);
    expect(text).toContain('Mission "Auth" cleaned up');
    expect(text).toContain("Summary: Login and API shipped.");
    expect(text).toContain("Plan proposed: 1 sub-task.");
    // The settings the cleanup keeps (Max agents, the router) are the new plan's.
    expect(missionOf(nodesStore.getState().nodes.chef)).toMatchObject({ state: "plan", name: "Next", maxAgents: 3, router: true, members: [] });
    expect(toast).toHaveBeenCalledWith("Mission Auth cleaned up");
  });

  it("keeps the old refusal, and names what is unsaved, so the user decides", async () => {
    await setup(finished());
    unsaved = ["auth-batman (uncommitted changes)"];
    const result = await fleetTool("chef", "proposer_plan", { nom: "Next", tache: "T", sous_taches: [{ titre: "Docs", consigne: "b", agent: "nouveau", budget_min: 5 }] });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "The mission is finished: the user cleans it up from the panel, then you can propose a new plan. " +
        "Not cleaned up: something is unsaved (auth-batman (uncommitted changes)). The user decides what to do with it, then cleans the mission up from the panel.",
    );
    expect(cleanMission).not.toHaveBeenCalled();
    expect(missionOf(nodesStore.getState().nodes.chef)).toMatchObject({ state: "terminee", name: "Auth" });
  });

  it("is refused while the mission runs, and for an overnight run, as before", async () => {
    await setup({ state: "en_cours", members: [] });
    expect(textOf(await fleetTool("chef", "proposer_plan", { nom: "N", tache: "T", sous_taches: [] }))).toBe("A mission is already under way: finish it before proposing another.");
    nodesStore.getState().update("chef", { mission: { ...NEW_MISSION, ...finished({ overnight: true, budgetMin: 60 }) } });
    const result = await fleetTool("chef", "proposer_plan", { nom: "N", tache: "T", sous_taches: [] });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("The mission is finished: the user cleans it up from the panel");
    expect(textOf(result)).toContain("overnight run");
    expect(cleanMission).not.toHaveBeenCalled();
  });

  it("says the mission was cleaned up when the plan itself is then refused, so it is not tried again on a finished one", async () => {
    await setup(finished());
    const result = await fleetTool("chef", "proposer_plan", { nom: "", tache: "T", sous_taches: [{ titre: "Docs", consigne: "b", agent: "nouveau", budget_min: 5 }] });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Mission "Auth" cleaned up');
    expect(textOf(result)).toContain("Give the mission a short name");
    expect(missionOf(nodesStore.getState().nodes.chef)?.state).toBe("redaction");
  });
});

describe("add_tasks on a finished mission", () => {
  it("still refuses, and says which tool cleans up: the Fleet's, not the Manager's", async () => {
    await setup(finished());
    const task = { title: "Docs", brief: "b", budget_min: 5 };
    const fleet = await fleetTool("chef", "add_tasks", { tasks: [task] });
    expect(fleet.isError).toBe(true);
    expect(textOf(fleet)).toBe("The mission is finished: call clean_up_mission (propose_plan cleans it up too, before it drafts), then plan again.");
    expect(cleanMission).not.toHaveBeenCalled();
    // Its Manager is told that its Fleet cleans the mission up: the tool is not the Manager's.
    await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: { title: "Manager", name: "Manager", agent: "claude", cwd: "C:/p", shell: "default", command: "", role: "manager", fleet: "chef" } });
    nodesStore.getState().update("chef", { mission: { ...NEW_MISSION, ...finished({ manager: "boss" }) } });
    const manager = await managerTool("boss", "add_tasks", { tasks: [task] });
    expect(manager.isError).toBe(true);
    expect(textOf(manager)).toBe("The mission is finished: its Fleet cleans it up before it plans again.");
    expect(textOf(await managerTool("boss", "clean_up_mission", {}))).toBe("This tool is for the fleet.");
  });
});
