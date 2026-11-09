import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { nodesStore, type NodeRecord } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import {
  MAX_SPAWN_DEPTH,
  markLaunching,
  markReported,
  runningSpawned,
  spawnDepth,
  spawnedByOf,
  spawnedDescendants,
  withSpawnedChildren,
} from "./spawnFamily";

// The scenes of the workspaces, by id: no canvas, no Excalidraw.
const scenes: Record<string, ExcalidrawElement[]> = {};
vi.mock("./sceneAccess", () => ({
  sceneAccess: vi.fn((workspaceId: string) =>
    scenes[workspaceId] ? { shown: true, elements: () => scenes[workspaceId], write: vi.fn() } : null,
  ),
}));

const terminal = (name: string, spawnedBy?: string, workspaceId = "w1"): NodeRecord => ({
  workspaceId,
  kind: "terminal",
  payload: { title: name, name, agent: "claude", cwd: "C:/code", shell: "default", command: "", ...(spawnedBy ? { spawnedBy } : {}) },
});
const element = (id: string, isDeleted = false) => ({ id, type: "embeddable", isDeleted, customData: { kind: "terminal" } }) as unknown as ExcalidrawElement;

/** Each node on its workspace's canvas, unless named in `closed`. */
function onCanvas(nodes: Record<string, NodeRecord>, closed: string[] = []) {
  nodesStore.setState({ nodes });
  for (const [id, record] of Object.entries(nodes)) (scenes[record.workspaceId] ??= []).push(element(id, closed.includes(id)));
}

/** Ids marked launching or reported by a test, unmarked after it. */
const marked: string[] = [];

beforeEach(() => {
  for (const id of Object.keys(scenes)) delete scenes[id];
  nodesStore.setState({ nodes: {} });
  terminalStatusStore.setState({ statuses: {} });
});
afterEach(() => {
  for (const id of marked.splice(0)) markLaunching(id, false);
});

describe("spawnDepth", () => {
  it("is 0 for an agent nobody spawned, and for a node it does not know", () => {
    nodesStore.setState({ nodes: { ra: terminal("Ra") } });
    expect(spawnDepth("ra")).toBe(0);
    expect(spawnDepth("nobody")).toBe(0);
    expect(spawnedByOf("ra")).toBeUndefined();
  });

  it("counts the spawn_agent hops up to the top agent", () => {
    nodesStore.setState({ nodes: { ra: terminal("Ra"), isis: terminal("Isis", "ra"), horus: terminal("Horus", "isis") } });
    expect(spawnDepth("isis")).toBe(1);
    expect(spawnDepth("horus")).toBe(2);
    expect(spawnedByOf("horus")).toBe("isis");
  });

  it("counts a hop to a parent it no longer knows", () => {
    nodesStore.setState({ nodes: { isis: terminal("Isis", "gone") } });
    expect(spawnDepth("isis")).toBe(1);
  });

  it("stops on a cycle", () => {
    nodesStore.setState({ nodes: { isis: terminal("Isis", "horus"), horus: terminal("Horus", "isis") } });
    expect(spawnDepth("isis")).toBe(2);
    expect(spawnDepth("horus")).toBe(2);
  });

  it("stops past the limit, reading deeper than it", () => {
    const nodes: Record<string, NodeRecord> = { n0: terminal("N0") };
    for (let i = 1; i <= 8; i++) nodes[`n${i}`] = terminal(`N${i}`, `n${i - 1}`);
    nodesStore.setState({ nodes });
    expect(spawnDepth(`n${MAX_SPAWN_DEPTH}`)).toBe(MAX_SPAWN_DEPTH);
    expect(spawnDepth("n8")).toBeGreaterThan(MAX_SPAWN_DEPTH);
  });
});

describe("spawnedDescendants", () => {
  it("lists the sub-agents spawned from an agent, then theirs", () => {
    onCanvas({
      ra: terminal("Ra"),
      isis: terminal("Isis", "ra"),
      horus: terminal("Horus", "isis"),
      thot: terminal("Thot", "ra"),
      seth: terminal("Seth"),
    });
    expect(spawnedDescendants("ra")).toEqual(["isis", "thot", "horus"]);
    expect(spawnedDescendants("isis")).toEqual(["horus"]);
    expect(spawnedDescendants("seth")).toEqual([]);
  });

  it("leaves out the closed ones, not their own sub-agents still open", () => {
    onCanvas({ ra: terminal("Ra"), isis: terminal("Isis", "ra"), horus: terminal("Horus", "isis"), thot: terminal("Thot", "ra") }, ["isis", "thot"]);
    expect(spawnedDescendants("ra")).toEqual(["horus"]);
  });

  it("leaves out one missing from its scene, or whose workspace's scene was never read", () => {
    onCanvas({ ra: terminal("Ra"), isis: terminal("Isis", "ra") });
    nodesStore.setState((s) => ({ nodes: { ...s.nodes, ghost: terminal("Ghost", "ra"), far: terminal("Far", "ra", "w2") } }));
    expect(spawnedDescendants("ra")).toEqual(["isis"]);
  });

  it("takes each sub-agent once, a cycle included", () => {
    onCanvas({ isis: terminal("Isis", "horus"), horus: terminal("Horus", "isis") });
    expect(spawnedDescendants("isis")).toEqual(["horus"]);
  });
});

describe("withSpawnedChildren", () => {
  beforeEach(() => {
    onCanvas({ ra: terminal("Ra"), isis: terminal("Isis", "ra"), horus: terminal("Horus", "isis"), thot: terminal("Thot", "ra") });
  });

  it("adds the sub-agents the closing agents opened", () => {
    expect(withSpawnedChildren({ agents: ["ra"], remove: ["ra"] })).toEqual({ agents: ["ra"], remove: ["ra"], children: ["isis", "thot", "horus"] });
  });

  it("skips those the closing takes already, and takes each once", () => {
    expect(withSpawnedChildren({ agents: ["ra"], remove: ["ra", "isis"] }).children).toEqual(["thot", "horus"]);
    expect(withSpawnedChildren({ agents: ["ra", "isis"], remove: ["ra"] }).children).toEqual(["isis", "thot", "horus"]);
  });

  it("returns the closing as it is when there are none to add", () => {
    const closing = { agents: ["horus"], remove: ["horus"] };
    expect(withSpawnedChildren(closing)).toBe(closing);
    const all = { agents: ["isis"], remove: ["isis", "horus"] };
    expect(withSpawnedChildren(all)).toBe(all);
  });
});

describe("runningSpawned", () => {
  const status = (id: string, state: "starting" | "running" | "stopped") => terminalStatusStore.getState().set(id, { state });

  beforeEach(() => {
    nodesStore.setState({
      nodes: {
        ra: terminal("Ra"),
        isis: terminal("Isis", "ra"),
        horus: terminal("Horus", "isis"),
        thot: terminal("Thot", "ra"),
        seth: terminal("Seth", "ra"),
        nut: terminal("Nut", "ra"),
      },
    });
  });

  it("counts the spawned terminals running or starting, not the top agents nor the stopped ones", () => {
    status("ra", "running");
    status("isis", "running");
    status("horus", "starting");
    status("thot", "stopped");
    terminalStatusStore.getState().set("seth", { state: "exited", code: 0 });
    expect(runningSpawned()).toBe(2);
  });

  it("counts a sub-agent launching before its process runs, until it is unmarked", () => {
    status("isis", "running");
    marked.push("nut", "ra");
    markLaunching("nut", true);
    // A top agent launching is no sub-agent.
    markLaunching("ra", true);
    expect(runningSpawned()).toBe(2);
    markLaunching("nut", false);
    expect(runningSpawned()).toBe(1);
  });

  it("frees the seat of a sub-agent that reported, though its terminal still runs", () => {
    // Its own ids: a reported mark stays for the module's life.
    nodesStore.setState((s) => ({ nodes: { ...s.nodes, anubis: terminal("Anubis", "ra"), bastet: terminal("Bastet", "ra") } }));
    status("anubis", "running");
    status("bastet", "running");
    expect(runningSpawned()).toBe(2);
    markReported("anubis");
    expect(runningSpawned()).toBe(1);
  });
});
