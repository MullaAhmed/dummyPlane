// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { nodesStore, terminalOf } from "@/store/nodes";
import { carriedStep, followChildReport, markParentStep } from "./carriedSteps";

vi.mock("@excalidraw/excalidraw", () => ({}));

const steps = (id: string) => terminalOf(nodesStore.getState().nodes[id])?.steps?.map((s) => `${s.title}: ${s.state}`);
const terminal = (name: string, extra: Record<string, unknown> = {}) => ({ title: name, name, agent: "claude" as const, cwd: "C:/w", shell: "default" as const, command: "", ...extra });

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("hulk", { workspaceId: "w1", kind: "terminal", payload: terminal("Hulk") });
  await nodesStore.getState().create("batgirl", { workspaceId: "w1", kind: "terminal", payload: terminal("Batgirl", { spawnedBy: "hulk", forStep: "Runs & connections" }) });
  await nodesStore.getState().create("loner", { workspaceId: "w1", kind: "terminal", payload: terminal("Loner", { spawnedBy: "hulk" }) });
});

beforeEach(() => {
  nodesStore.getState().update("hulk", { steps: [{ title: "Graph & nodes", state: "en_cours" }, { title: "Runs & connections", state: "a_venir" }, { title: "Runtimes & extras", state: "a_venir" }] });
});

describe("a step a parent hands to a sub-agent", () => {
  it("is found by the title the parent declared, case aside, and no other is guessed", () => {
    expect(carriedStep("hulk", "runs & CONNECTIONS")).toBe("Runs & connections");
    expect(carriedStep("hulk", "Shared contracts: runs.ts + connections.ts")).toBeUndefined();
    expect(carriedStep("hulk", "")).toBeUndefined();
    expect(carriedStep("hulk", 12)).toBeUndefined();
  });

  it("goes in progress when the sub-agent opens, and follows its done report", () => {
    markParentStep("hulk", "Runs & connections", "en_cours");
    expect(steps("hulk")).toEqual(["Graph & nodes: en_cours", "Runs & connections: en_cours", "Runtimes & extras: a_venir"]);
    followChildReport("batgirl", "termine");
    expect(steps("hulk")).toEqual(["Graph & nodes: en_cours", "Runs & connections: fait", "Runtimes & extras: a_venir"]);
  });

  it("fails with a failed report and stays in progress on a blocked one", () => {
    markParentStep("hulk", "Runs & connections", "en_cours");
    followChildReport("batgirl", "bloque");
    expect(steps("hulk")![1]).toBe("Runs & connections: en_cours");
    followChildReport("batgirl", "echec");
    expect(steps("hulk")![1]).toBe("Runs & connections: echec");
  });

  it("leaves a parent's friezes alone when the sub-agent carried no step, or the parent redeclared its steps", () => {
    followChildReport("loner", "termine");
    expect(steps("hulk")).toEqual(["Graph & nodes: en_cours", "Runs & connections: a_venir", "Runtimes & extras: a_venir"]);
    nodesStore.getState().update("hulk", { steps: [{ title: "Something else", state: "en_cours" }] });
    followChildReport("batgirl", "termine");
    expect(steps("hulk")).toEqual(["Something else: en_cours"]);
  });
});
