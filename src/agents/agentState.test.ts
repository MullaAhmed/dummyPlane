import { describe, expect, it } from "vitest";
import type { Activity } from "@/ipc/activity";
import { pillActivity, pillOf } from "@/nodes/terminal/pill";
import type { TerminalPayload, TerminalReportStatus } from "@/nodes/types";
import type { AgentActivity } from "@/store/agentActivity";
import type { NodeRecord } from "@/store/nodes";
import type { TerminalStatus } from "@/store/terminalStatus";
import { agentStateOf, isAgentNode, isLive, tallyAgents, workspaceNodeIds, type AgentState } from "./agentState";

const terminal = (agent: TerminalPayload["agent"], workspaceId = "w1", report?: TerminalReportStatus): NodeRecord => ({
  workspaceId,
  kind: "terminal",
  payload: {
    title: agent,
    name: agent,
    agent,
    cwd: "C:/code",
    shell: "default",
    command: "",
    ...(report ? { lastReport: { status: report, summary: "", at: 0 } } : {}),
  } as TerminalPayload,
});
const fleet = (workspaceId = "w1"): NodeRecord => ({ workspaceId, kind: "fleet", payload: { name: "Fleet" } });
const act = (activity: Activity, left = false): AgentActivity => ({ activity, since: 1, ...(left ? { left } : {}) });
const RUNNING: TerminalStatus = { state: "running" };

describe("agentStateOf", () => {
  it("reads a running agent's activity, its report once it rests, and active while nothing is known", () => {
    expect(agentStateOf(RUNNING, act("working"))).toBe("working");
    expect(agentStateOf(RUNNING, act("waiting"), "done")).toBe("waiting");
    expect(agentStateOf(RUNNING, act("idle"))).toBe("ready");
    expect(agentStateOf(RUNNING, act("idle"), "blocked")).toBe("done");
    expect(agentStateOf(RUNNING, undefined, "done")).toBe("done");
    expect(agentStateOf(RUNNING)).toBe("active");
  });

  it("tells an agent that exited, even when its shell is busy: no agent is there", () => {
    expect(agentStateOf(RUNNING, act("working", true))).toBe("left");
    expect(agentStateOf(RUNNING, act("idle", true), "done")).toBe("left");
  });

  it("gives no activity to a process that does not run: an activity can outlive it", () => {
    expect(agentStateOf({ state: "starting" }, act("working"))).toBe("starting");
    expect(agentStateOf({ state: "stopped" }, act("working"))).toBe("stopped");
    expect(agentStateOf({ state: "exited", code: 0 }, act("waiting"))).toBe("stopped");
    expect(agentStateOf({ state: "error", message: "x" })).toBe("stopped");
    expect(agentStateOf(undefined, act("working"))).toBe("stopped");
  });

  it("reads every agent as its status pill does", () => {
    // The pill's tone for each state: a count and a pill never disagree.
    const TONE: Record<AgentState, string[]> = {
      starting: ["stopped"],
      active: ["live"],
      working: ["working"],
      waiting: ["waiting"],
      ready: ["ready"],
      done: ["done", "waiting", "failed"],
      left: ["stopped"],
      stopped: ["stopped", "done", "failed"],
    };
    const statuses: TerminalStatus[] = [{ state: "starting" }, RUNNING, { state: "stopped" }, { state: "exited", code: 1 }];
    const activities = [undefined, act("working"), act("waiting"), act("idle"), act("working", true), act("idle", true)];
    for (const status of statuses) {
      for (const activity of activities) {
        for (const report of [undefined, "done", "blocked", "failed"] as const) {
          const state = agentStateOf(status, activity, report);
          const pill = pillOf(status, pillActivity(status, activity), false, report);
          expect(TONE[state], `${status.state} ${JSON.stringify(activity)} ${report}`).toContain(pill.tone);
          if (state === "left") expect(pill.label).toBe("Agent exited");
        }
      }
    }
  });
});

describe("isAgentNode", () => {
  it("counts every agent and the Fleets, never a plain shell nor a board", () => {
    expect(isAgentNode(terminal("claude"))).toBe(true);
    expect(isAgentNode(terminal("codex"))).toBe(true);
    expect(isAgentNode(fleet())).toBe(true);
    expect(isAgentNode(terminal("shell"))).toBe(false);
    expect(isAgentNode({ workspaceId: "w1", kind: "note", payload: {} } as never)).toBe(false);
    expect(isAgentNode(undefined)).toBe(false);
  });
});

describe("tallyAgents", () => {
  const nodes: Record<string, NodeRecord> = {
    working: terminal("claude"),
    waiting: terminal("codex"),
    ready: terminal("claude"),
    reported: terminal("claude", "w1", "done"),
    fleetWorking: fleet(),
    fleetWaiting: fleet(),
    unknown: terminal("claude"),
    exitedBusy: terminal("claude"),
    shellBusy: terminal("shell"),
    starting: terminal("claude"),
    stopped: terminal("claude"),
    elsewhere: terminal("claude", "w2"),
  };
  const statuses: Record<string, TerminalStatus> = Object.fromEntries(Object.keys(nodes).map((id) => [id, RUNNING]));
  statuses.starting = { state: "starting" };
  statuses.stopped = { state: "stopped" };
  const activities: Record<string, AgentActivity> = {
    working: act("working"),
    waiting: act("waiting"),
    ready: act("idle"),
    reported: act("idle"),
    fleetWorking: act("working"),
    fleetWaiting: act("waiting"),
    exitedBusy: act("working", true),
    shellBusy: act("working"),
    starting: act("working"),
    stopped: act("working"),
    elsewhere: act("working"),
  };

  it("counts the agents at work, waiting and live alike: Fleets in, shells and exited agents out", () => {
    expect(tallyAgents(workspaceNodeIds(nodes, "w1"), nodes, statuses, activities)).toEqual({ working: 2, waiting: 2, active: 7 });
    expect(tallyAgents(workspaceNodeIds(nodes, "w2"), nodes, statuses, activities)).toEqual({ working: 1, waiting: 0, active: 1 });
  });

  it("never counts more agents at work and waiting than active, whatever the states", () => {
    const states = ["starting", "running", "stopped"] as const;
    const kinds = [terminal("claude"), terminal("shell"), fleet()];
    const all = [undefined, act("working"), act("waiting"), act("idle"), act("working", true), act("waiting", true)];
    const mixNodes: Record<string, NodeRecord> = {};
    const mixStatuses: Record<string, TerminalStatus> = {};
    const mixActivities: Record<string, AgentActivity> = {};
    let n = 0;
    for (const state of states)
      for (const record of kinds)
        for (const activity of all) {
          const id = `n${n++}`;
          mixNodes[id] = record;
          mixStatuses[id] = { state } as TerminalStatus;
          if (activity) mixActivities[id] = activity;
          const ids = Object.keys(mixNodes);
          const { working, waiting, active } = tallyAgents(ids, mixNodes, mixStatuses, mixActivities);
          expect(working + waiting).toBeLessThanOrEqual(active);
          // Active is exactly the agents whose process runs with their agent in it.
          const live = ids.filter((i) => {
            const s = agentStateOf(mixStatuses[i], mixActivities[i]);
            return isAgentNode(mixNodes[i]) && isLive(s);
          });
          expect(active).toBe(live.length);
        }
  });
});
