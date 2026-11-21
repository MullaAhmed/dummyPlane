// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { pillOf, pillActivity } from "@/nodes/terminal/pill";
import { agentState } from "@/mission/store";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, sessionOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { stateMinutes, stateWord } from "./teamState";

vi.mock("@excalidraw/excalidraw", () => ({}));

const MINUTE = 60_000;
const status = (state: "running" | "starting" | "stopped") => terminalStatusStore.getState().set("sif", state === "stopped" ? { state: "stopped" } : { state });
const activity = (value: "idle" | "working" | "waiting" | null, since = 0, left = false) => {
  agentActivityStore.getState().remove("sif");
  if (value) agentActivityStore.getState().apply({ nodeId: "sif", activity: value, since, ...(left ? { left } : {}) });
};

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("sif", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Sif", name: "Sif", agent: "claude", cwd: "C:/w", shell: "default", command: "" },
  });
});

describe("the state `team` tells", () => {
  it("is the canvas pill's reading, whatever the agent does", () => {
    const words = (): string => {
      const record = nodesStore.getState().nodes.sif;
      const pill = pillOf(terminalStatusStore.getState().statuses.sif, pillActivity(terminalStatusStore.getState().statuses.sif, agentActivityStore.getState().activities.sif), false, sessionOf(record)?.lastReport?.status);
      return pill.label.toLowerCase();
    };
    const table: [string, () => void, string][] = [
      ["working", () => (status("running"), activity("working")), "working"],
      ["waiting", () => (status("running"), activity("waiting")), "waiting"],
      // Its turn over: the pill says Ready, `team` says idle (its old word, which merge's lines and the prompts use).
      ["ready", () => (status("running"), activity("idle")), "idle"],
      ["starting", () => (status("starting"), activity(null)), "starting"],
      ["stopped", () => (status("stopped"), activity(null)), "stopped"],
    ];
    for (const [pill, set, word] of table) {
      set();
      expect(words()).toBe(pill);
      expect(stateWord("sif")).toBe(word);
    }
  });

  it("says what an agent rests on once it reported, as its pill does (blocked is not idle)", () => {
    status("running");
    activity("idle");
    for (const reported of ["done", "blocked", "failed"] as const) {
      nodesStore.getState().update("sif", { lastReport: { status: reported, summary: "x" } });
      expect(stateWord("sif")).toBe(reported);
    }
    // At work again, it works.
    activity("working", 1);
    expect(stateWord("sif")).toBe("working");
    nodesStore.getState().update("sif", { lastReport: undefined });
  });

  it("reads an agent that exited back to its shell as stopped, and a process with no activity yet as starting", () => {
    status("running");
    activity("idle", 0, true);
    expect(stateWord("sif")).toBe("stopped");
    activity(null);
    expect(stateWord("sif")).toBe("starting");
  });

  it("drives the fleet's own reading, so the two cannot drift apart", () => {
    const set = (run: "working" | "waiting" | "idle" | null) => (status("running"), activity(run));
    set("working");
    expect(agentState("sif")).toBe("travaille");
    set("waiting");
    expect(agentState("sif")).toBe("attend");
    set("idle");
    expect(agentState("sif")).toBe("inactif");
    status("starting");
    expect(agentState("sif")).toBe("arrêté");
  });

  it("tells how long it has been in its activity, so an idle agent behind a background command can be told from a stalled one", () => {
    status("running");
    activity("idle", 1_000_000);
    expect(stateMinutes("sif", 1_000_000 + 14 * MINUTE + 5000)).toBe(14);
    status("stopped");
    expect(stateMinutes("sif", 1_000_000 + 14 * MINUTE)).toBeNull();
  });
});
