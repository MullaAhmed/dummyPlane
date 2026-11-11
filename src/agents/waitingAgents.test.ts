import { beforeEach, describe, expect, it } from "vitest";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, type NodeRecord } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { currentWaitingAgents, nextWaiting, waitingAgents, type WaitingAgent } from "./waitingAgents";

const terminal = (workspaceId: string, name: string): NodeRecord => ({
  workspaceId,
  kind: "terminal",
  payload: { title: name, name, agent: "claude", cwd: "C:/code", shell: "default", command: "" },
});
const fleet = (workspaceId: string, name: string) => ({ workspaceId, kind: "fleet", payload: { name } }) as NodeRecord;
const running = { state: "running" };
const waiting = (since: number) => ({ activity: "waiting", since });
const agent = (id: string): WaitingAgent => ({ id, kind: "terminal", name: id, workspaceId: "w1", since: 0 });

describe("waitingAgents", () => {
  it("names the running agents waiting for an answer, the one waiting longest first", () => {
    const nodes = { batman: terminal("w1", "Batman"), cyborg: terminal("w2", "Cyborg") };
    const list = waitingAgents(["w1", "w2"], nodes, { batman: running, cyborg: running }, { batman: waiting(20), cyborg: waiting(10) });
    expect(list).toEqual([
      { id: "cyborg", kind: "terminal", name: "Cyborg", workspaceId: "w2", since: 10 },
      { id: "batman", kind: "terminal", name: "Batman", workspaceId: "w1", since: 20 },
    ]);
  });

  it("leaves out an agent that works, is stopped, has no node or belongs to another project", () => {
    const nodes = { busy: terminal("w1", "Busy"), gone: terminal("w1", "Gone"), other: terminal("w9", "Other") };
    const statuses = { busy: running, gone: { state: "exited" }, other: running, closed: running };
    const activities = { busy: { activity: "working", since: 0 }, gone: waiting(0), other: waiting(0), closed: waiting(0) };
    expect(waitingAgents(["w1"], nodes, statuses, activities)).toEqual([]);
  });

  it("counts a fleet: its session asks questions too", () => {
    const list = waitingAgents(["w1"], { chef: fleet("w1", "Chef") }, { chef: running }, { chef: waiting(0) });
    expect(list).toEqual([{ id: "chef", kind: "fleet", name: "Chef", workspaceId: "w1", since: 0 }]);
  });

  it("names a terminal without a first name after its agent", () => {
    const list = waitingAgents(["w1"], { t: terminal("w1", "") }, { t: running }, { t: waiting(0) });
    expect(list[0].name).toBe("Claude");
  });

  it("carries what the agent says it waits for, when it says so", () => {
    const nodes = { a: terminal("w1", "A"), b: terminal("w1", "B") };
    const activities = { a: { activity: "waiting", since: 1, message: "May I?" }, b: waiting(2) };
    const [first, second] = waitingAgents(["w1"], nodes, { a: running, b: running }, activities);
    expect(first.message).toBe("May I?");
    expect(second.message).toBeUndefined();
  });

  it("keeps a stable order when two agents started waiting at the same time", () => {
    const nodes = { b: terminal("w1", "B"), a: terminal("w1", "A") };
    const list = waitingAgents(["w1"], nodes, { a: running, b: running }, { b: waiting(5), a: waiting(5) });
    expect(list.map((a) => a.id)).toEqual(["a", "b"]);
  });
});

describe("currentWaitingAgents", () => {
  beforeEach(() => {
    agentActivityStore.setState({ activities: {} });
    terminalStatusStore.setState({ statuses: {} });
  });

  it("reads the open project's workspaces from the stores", () => {
    workspacesStore.setState({ workspaces: [{ id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder: null }] });
    nodesStore.setState({ nodes: { batman: terminal("w1", "Batman"), cyborg: terminal("w9", "Cyborg") } });
    terminalStatusStore.setState({ statuses: { batman: { state: "running" }, cyborg: { state: "running" } } });
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "waiting", since: 1 });
    agentActivityStore.getState().apply({ nodeId: "cyborg", activity: "waiting", since: 2 });
    expect(currentWaitingAgents().map((a) => a.id)).toEqual(["batman"]);
  });
});

describe("nextWaiting", () => {
  const agents = [agent("a"), agent("b"), agent("c")];

  it("takes the agent after the current one, then loops", () => {
    expect(nextWaiting(agents, "a")?.id).toBe("b");
    expect(nextWaiting(agents, "c")?.id).toBe("a");
  });

  it("takes the first one when the current node does not wait", () => {
    expect(nextWaiting(agents, "other")?.id).toBe("a");
    expect(nextWaiting(agents, null)?.id).toBe("a");
  });

  it("stays on the only agent waiting, and finds nobody in an empty list", () => {
    expect(nextWaiting([agent("a")], "a")?.id).toBe("a");
    expect(nextWaiting([], "a")).toBeUndefined();
  });
});
