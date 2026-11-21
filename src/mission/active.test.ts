// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { agentMessages } from "@/mcp/messages";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { activeCount, activeMembers, holdSeat, seatsOf } from "./active";
import { NEW_MISSION, type Member, type Mission } from "./mission";

// `closedNode` reads the canvas's scene (`sceneAccess`), which pulls Excalidraw in.
vi.mock("@excalidraw/excalidraw", () => ({ newElementWith: (e: { version: number }, fields: object) => ({ ...e, ...fields, version: e.version + 1 }) }));

const member = (nodeId: string, name: string, extra: Partial<Member> = {}): Member => ({ nodeId, name, task: `Task of ${name}`, budgetMin: 20, linked: false, branch: `b-${name}`, worktree: `w-${name}`, ...extra });

const mission = (members: Member[], maxAgents = 2): Mission => ({ ...NEW_MISSION, state: "en_cours", maxAgents, members });

beforeEach(async () => {
  mockIPC(() => undefined);
  nodesStore.getState().forgetWorkspace("w1");
  nodesStore.setState({ nodes: {} });
  for (const id of Object.keys(terminalStatusStore.getState().statuses)) terminalStatusStore.getState().remove(id);
  for (const id of ["a1", "a2", "a3"]) {
    await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { title: id, name: id, agent: "claude", cwd: "C:/code", shell: "pwsh", command: "" } });
  }
});

describe("the seats of a mission's team", () => {
  it("counts an agent whose task is not typed yet, and no more once its terminal is closed: it never starts, and would hold its seat for good", () => {
    const team = mission([member("a1", "Aquaman"), member("a2", "Batman", { sentAt: 1 })]);
    terminalStatusStore.getState().set("a2", { state: "running" });
    expect(activeMembers(team).map((m) => m.name)).toEqual(["Aquaman", "Batman"]);
    nodesStore.getState().close("a1");
    expect(activeMembers(team).map((m) => m.name)).toEqual(["Batman"]);
    // Closed while running, a late status or not, it holds nothing either.
    nodesStore.getState().close("a2");
    expect(activeMembers(team)).toEqual([]);
    expect(activeCount("chef", team)).toBe(0);
  });

  it("names the seats a refusal speaks of: the agents at work, then the new ones on their way", () => {
    const team = mission([member("a1", "Aquaman"), member("a2", "Batman", { sentAt: 1 })]);
    terminalStatusStore.getState().set("a2", { state: "running" });
    expect(seatsOf("chef", team)).toEqual({ held: 2, max: 2, who: "Aquaman, Batman" });
    holdSeat("chef-seats", "Docs");
    expect(seatsOf("chef-seats", mission([member("a3", "Flash", { sentAt: 1 })], 3))).toEqual({ held: 1, max: 3, who: "a new agent on its way" });
  });
});

describe("a refusal for want of a seat", () => {
  it("is worded and ordered alike for the sub-agents' cap and a mission's own limit", () => {
    const m = agentMessages;
    const spawn = m.spawn.tooMany({ held: 6, max: 6, who: "Superman, Aquaman (BOS-Mono); Shazam (dummyPlane)" }, "queue");
    const team = m.fleet.relaunchTeamFull("Hulk", { held: 4, max: 4, who: "Thor, Freya, Sif, Loki" });
    // What is at work against which limit, who holds the seats, then what to do next: the same words.
    expect(spawn).toMatch(/^No seat is free: 6 of 6 sub-agents at work \(.+\): Superman, Aquaman \(BOS-Mono\); Shazam \(dummyPlane\)\. /);
    expect(team).toMatch(/^No seat is free: 4 of 4 agents at work \(.+\): Thor, Freya, Sif, Loki\. /);
    // Each says whose limit it is: the user's setting, shared by every project, or the mission's own.
    expect(spawn).toContain("set in dummyPlane's Settings and shared by every project");
    expect(team).toContain("this mission's own limit");
    // A Fleet or a Manager has no shell: it waits for a report or queues the task, never does the work itself.
    expect(spawn).toContain("Wait for a report to free a seat");
    expect(spawn).toContain("add_tasks");
    expect(spawn).not.toMatch(/do this task yourself/);
  });
});
