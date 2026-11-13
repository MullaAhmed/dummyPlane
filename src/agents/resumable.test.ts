import { describe, expect, it } from "vitest";
import { MANAGER_ROLE } from "@/ipc/pty";
import type { TerminalPayload } from "@/nodes/types";
import type { NodeRecord } from "@/store/nodes";
import type { TerminalStatus } from "@/store/terminalStatus";
import { isFinishedSubAgent, resumableTerminals, workspaceResumeOffer } from "./resumable";

const node = (workspaceId: string) => ({ workspaceId, kind: "terminal", payload: {} }) as unknown as NodeRecord;
const terminal = (payload: Partial<TerminalPayload>, workspaceId = "w1") => ({ workspaceId, kind: "terminal", payload }) as unknown as NodeRecord;
const report = { status: "done", summary: "Fixed." } as const;

describe("resumableTerminals", () => {
  it("lists the stopped terminals of a workspace, unknown status counting as stopped", () => {
    const nodes = { a: node("w1"), b: node("w1"), c: node("w1"), d: node("w1"), e: node("w2"), f: node("w1") };
    const statuses: Record<string, TerminalStatus> = {
      a: { state: "stopped" },
      b: { state: "running" },
      c: { state: "exited", code: 0 },
      d: { state: "error", message: "x" },
      e: { state: "stopped" },
    };
    const onScene = new Set(Object.keys(nodes));
    expect(resumableTerminals(nodes, statuses, "w1", new Set(), onScene)).toEqual(["a", "f"]);
  });

  it("never counts a one-shot command: resuming would run the installer again", () => {
    const nodes = { install: { ...node("w1"), payload: { oneShot: true } } as unknown as NodeRecord, agent: node("w1") };
    expect(resumableTerminals(nodes, {}, "w1", new Set(), new Set(["install", "agent"]))).toEqual(["agent"]);
  });

  it("skips terminals still running in Rust after a webview reload", () => {
    const nodes = { a: node("w1") };
    expect(resumableTerminals(nodes, {}, "w1", new Set(["a"]), new Set(["a"]))).toEqual([]);
  });

  it("skips terminals closed from the canvas, whose record stays in memory for undo", () => {
    const nodes = { kept: node("w1"), closed: node("w1") };
    expect(resumableTerminals(nodes, {}, "w1", new Set(), new Set(["kept"]))).toEqual(["kept"]);
  });
});

describe("after a restart, finished sub-agents stay stopped", () => {
  // A top agent, its sub-agents (one at work, one that reported) and a Fleet's, a mission's Manager and its team.
  const nodes: Record<string, NodeRecord> = {
    top: terminal({ name: "Batman" }),
    reportedTop: terminal({ name: "Robin", lastReport: report }),
    working: terminal({ name: "Flash", spawnedBy: "top" }),
    done: terminal({ name: "Cyborg", spawnedBy: "top", lastReport: report }),
    fleet: { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", mission: { state: "en_cours", maxAgents: 3, members: [{ nodeId: "orphan" }] } } } as unknown as NodeRecord,
    fleetChild: terminal({ name: "Storm", spawnedBy: "fleet", lastReport: report }),
    manager: terminal({ name: "Zeus", role: MANAGER_ROLE, fleet: "fleet" }),
    member: terminal({ name: "Hera", spawnedBy: "manager", lastReport: report }),
    // A team member whose Manager was closed: its Fleet's mission still names it.
    orphan: terminal({ name: "Ares", spawnedBy: "gone", lastReport: report }),
  };
  const all = new Set(Object.keys(nodes));

  it("tells a finished sub-agent from a working one, a top agent and a mission's team", () => {
    expect(isFinishedSubAgent(nodes, "done")).toBe(true);
    expect(isFinishedSubAgent(nodes, "fleetChild")).toBe(true);
    for (const id of ["top", "reportedTop", "working", "manager", "member", "orphan", "fleet", "missing"]) {
      expect(isFinishedSubAgent(nodes, id), id).toBe(false);
    }
  });

  it("resumes the top agents, the working sub-agents and the mission's team, and sets the finished sub-agents apart", () => {
    expect(workspaceResumeOffer(nodes, {}, "w1", new Set(), all)).toEqual({
      resume: ["top", "reportedTop", "working", "manager", "member", "orphan"],
      stayStopped: ["done", "fleetChild"],
    });
    expect(resumableTerminals(nodes, {}, "w1", new Set(), all)).not.toContain("done");
  });

  it("counts only the finished sub-agents the offer would otherwise have resumed: stopped, on this canvas, in this workspace", () => {
    const more: Record<string, NodeRecord> = {
      ...nodes,
      elsewhere: terminal({ spawnedBy: "top", lastReport: report }, "w2"),
      closed: terminal({ spawnedBy: "top", lastReport: report }),
      running: terminal({ spawnedBy: "top", lastReport: report }),
      reattached: terminal({ spawnedBy: "top", lastReport: report }),
    };
    const onScene = new Set([...all, "elsewhere", "running", "reattached"]);
    const offer = workspaceResumeOffer(more, { running: { state: "running" } }, "w1", new Set(["reattached"]), onScene);
    expect(offer.stayStopped).toEqual(["done", "fleetChild"]);
  });

  it("leaves stopped a finished agent whose process dummyPlane stopped, a mission's team agent included: it is no unfinished work", () => {
    const more: Record<string, NodeRecord> = {
      ...nodes,
      // Its Manager's team agent, stopped once it reported done (`./finishedStop`).
      asleepMember: terminal({ name: "Athena", spawnedBy: "manager", lastReport: report, stoppedFinished: true }),
      asleep: terminal({ name: "Raven", spawnedBy: "top", lastReport: report, stoppedFinished: true }),
    };
    expect(isFinishedSubAgent(more, "asleepMember")).toBe(true);
    const offer = workspaceResumeOffer(more, {}, "w1", new Set(), new Set(Object.keys(more)));
    expect(offer.resume).not.toContain("asleepMember");
    expect(offer.stayStopped).toEqual(["done", "fleetChild", "asleepMember", "asleep"]);
    // Stopped since in this run, it reads exited: the offer never takes it either.
    expect(workspaceResumeOffer(more, { asleepMember: { state: "exited", code: 1 } }, "w1", new Set(), new Set(Object.keys(more))).resume).not.toContain("asleepMember");
  });
});
