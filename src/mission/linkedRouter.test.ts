import { beforeEach, describe, expect, it, vi } from "vitest";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { fleetSession } from "@/nodes/terminal/launch";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { NEW_MISSION, type Mission, type SubTask } from "./mission";
import { routerAt, setRouter } from "./routerState";
import { subTaskModel, teamModel } from "./teamModel";

/**
 * A linked agent before the go-ahead: its switch shows what the go-ahead will apply to it. The plan that names it
 * puts it under its Fleet's switch (`./routerState`), and `teamModel` reads it the same way: its own switch, the
 * Fleet's, its spawner's, Settings. Bob is wired to the Fleet; the wires are scene work, tested elsewhere.
 */

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  linkedTeamAgents: vi.fn((fleetId: string) => (fleetId === "fleet" ? [{ nodeId: "bob", name: "Bob" }] : [])),
}));

const bob: TerminalPayload = { title: "Bob", name: "Bob", agent: "claude", cwd: "C:/code", shell: "pwsh", command: "", model: "claude-opus-5-5" };
const bobsTask: SubTask = { title: "Login", brief: "b", agent: "Bob", budgetMin: 20, level: "faible" };

/** The Fleet's mission, in plan, its plan naming Bob unless said, its switch as given. */
function fleet(router: boolean | undefined, plan: SubTask[] = [bobsTask]) {
  const session = fleetSession("Fleet", { cwd: "C:/code", shell: "pwsh" }, "claude");
  const mission: Mission = { ...NEW_MISSION, state: "plan", plan, ...(router === undefined ? {} : { router }) };
  nodesStore.getState().update("fleet", { name: "Fleet", session, mission });
}

const nodes = () => nodesStore.getState().nodes;
const bobNow = () => terminalOf(nodes().bob)!;
const missionNow = () => (nodes().fleet as { payload: { mission: Mission } }).payload.mission;

beforeEach(() => {
  modelRouterStore.setState({ on: true, levels: {} });
  const session = fleetSession("Fleet", { cwd: "C:/code", shell: "pwsh" }, "claude");
  nodesStore.setState({
    nodes: {
      fleet: { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", session, mission: NEW_MISSION } },
      bob: { workspaceId: "w1", kind: "terminal", payload: { ...bob } },
    },
  });
});

describe("a linked agent a pending plan names", () => {
  it("shows its Fleet's off with Settings on, and turned on for itself, the go-ahead routes it (case a)", () => {
    fleet(false, []);
    // Not named yet: it follows Settings.
    expect(routerAt(nodes(), "bob")).toEqual({ on: true });
    fleet(false);
    expect(routerAt(nodes(), "bob")).toEqual({ on: false, at: "fleet" });
    expect(teamModel("fleet", missionNow(), bobsTask, bobNow())).toBeUndefined();
    setRouter("bob", true);
    expect(bobNow().router).toBe(true);
    expect(routerAt(nodes(), "bob")).toEqual({ on: true, at: "bob" });
    expect(teamModel("fleet", missionNow(), { level: "eleve" }, bobNow())).toBe("claude-opus-5-5");
    expect(teamModel("fleet", missionNow(), { level: "faible" }, bobNow())).toBe("claude-haiku-5-5");
  });

  it("shows its Fleet's on with Settings off, and turned off for itself, keeps its own model (case b)", () => {
    modelRouterStore.setState({ on: false });
    fleet(true);
    expect(routerAt(nodes(), "bob")).toEqual({ on: true, at: "fleet" });
    expect(teamModel("fleet", missionNow(), { level: "faible" }, bobNow())).toBe("claude-haiku-5-5");
    setRouter("bob", false);
    expect(bobNow().router).toBe(false);
    expect(routerAt(nodes(), "bob").on).toBe(false);
    expect(teamModel("fleet", missionNow(), { level: "faible" }, bobNow())).toBe("claude-opus-5-5");
  });

  it("follows the agent that spawned it while the Fleet's switch is unset, as its switch shows (case c)", () => {
    nodesStore.setState({
      nodes: {
        ...nodes(),
        pam: { workspaceId: "w1", kind: "terminal", payload: { ...bob, name: "Pam", title: "Pam", router: false } },
        bob: { workspaceId: "w1", kind: "terminal", payload: { ...bob, spawnedBy: "pam" } },
      },
    });
    fleet(undefined);
    expect(routerAt(nodes(), "bob")).toEqual({ on: false, at: "pam" });
    // Not routed, as it shows: it starts on its CLI's own model, as any agent the router does not route.
    expect(teamModel("fleet", missionNow(), { level: "eleve" }, bobNow())).toBeUndefined();
    // Pam's veto lifted, Settings routes it.
    nodesStore.getState().update("pam", { router: undefined });
    expect(routerAt(nodes(), "bob")).toEqual({ on: true });
    expect(teamModel("fleet", missionNow(), { level: "eleve" }, bobNow())).toBe("claude-opus-5-5");
  });
});

describe("a plan's model labels", () => {
  it("name the model the go-ahead gives a linked agent, its switch and its own model included", () => {
    fleet(undefined);
    expect(subTaskModel("fleet", missionNow(), bobsTask)).toBe("claude-haiku-5-5");
    nodesStore.getState().update("bob", { router: false });
    expect(subTaskModel("fleet", missionNow(), bobsTask)).toBe("claude-opus-5-5");
    // A new agent follows the mission's router.
    expect(subTaskModel("fleet", missionNow(), { ...bobsTask, agent: "nouveau", level: "moyen" })).toBe("claude-sonnet-5-5");
    fleet(false);
    expect(subTaskModel("fleet", missionNow(), { ...bobsTask, agent: "nouveau", level: "moyen" })).toBeUndefined();
  });
});
