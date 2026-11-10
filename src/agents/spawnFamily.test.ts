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
    nodesStore.setState({ nodes: { robin: terminal("Robin") } });
    expect(spawnDepth("robin")).toBe(0);
    expect(spawnDepth("nobody")).toBe(0);
    expect(spawnedByOf("robin")).toBeUndefined();
  });

  it("counts the spawn_agent hops up to the top agent", () => {
    nodesStore.setState({ nodes: { robin: terminal("Robin"), batman: terminal("Batman", "robin"), aquaman: terminal("Aquaman", "batman") } });
    expect(spawnDepth("batman")).toBe(1);
    expect(spawnDepth("aquaman")).toBe(2);
    expect(spawnedByOf("aquaman")).toBe("batman");
  });

  it("counts a hop to a parent it no longer knows", () => {
    nodesStore.setState({ nodes: { batman: terminal("Batman", "gone") } });
    expect(spawnDepth("batman")).toBe(1);
  });

  it("stops on a cycle", () => {
    nodesStore.setState({ nodes: { batman: terminal("Batman", "aquaman"), aquaman: terminal("Aquaman", "batman") } });
    expect(spawnDepth("batman")).toBe(2);
    expect(spawnDepth("aquaman")).toBe(2);
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
      robin: terminal("Robin"),
      batman: terminal("Batman", "robin"),
      aquaman: terminal("Aquaman", "batman"),
      cyborg: terminal("Cyborg", "robin"),
      shazam: terminal("Shazam"),
    });
    expect(spawnedDescendants("robin")).toEqual(["batman", "cyborg", "aquaman"]);
    expect(spawnedDescendants("batman")).toEqual(["aquaman"]);
    expect(spawnedDescendants("shazam")).toEqual([]);
  });

  it("leaves out the closed ones, not their own sub-agents still open", () => {
    onCanvas({ robin: terminal("Robin"), batman: terminal("Batman", "robin"), aquaman: terminal("Aquaman", "batman"), cyborg: terminal("Cyborg", "robin") }, ["batman", "cyborg"]);
    expect(spawnedDescendants("robin")).toEqual(["aquaman"]);
  });

  it("leaves out one missing from its scene, or whose workspace's scene was never read", () => {
    onCanvas({ robin: terminal("Robin"), batman: terminal("Batman", "robin") });
    nodesStore.setState((s) => ({ nodes: { ...s.nodes, ghost: terminal("Ghost", "robin"), far: terminal("Far", "robin", "w2") } }));
    expect(spawnedDescendants("robin")).toEqual(["batman"]);
  });

  it("takes each sub-agent once, a cycle included", () => {
    onCanvas({ batman: terminal("Batman", "aquaman"), aquaman: terminal("Aquaman", "batman") });
    expect(spawnedDescendants("batman")).toEqual(["aquaman"]);
  });
});

describe("withSpawnedChildren", () => {
  beforeEach(() => {
    onCanvas({ robin: terminal("Robin"), batman: terminal("Batman", "robin"), aquaman: terminal("Aquaman", "batman"), cyborg: terminal("Cyborg", "robin") });
  });

  it("adds the sub-agents the closing agents opened", () => {
    expect(withSpawnedChildren({ agents: ["robin"], remove: ["robin"] })).toEqual({ agents: ["robin"], remove: ["robin"], children: ["batman", "cyborg", "aquaman"] });
  });

  it("skips those the closing takes already, and takes each once", () => {
    expect(withSpawnedChildren({ agents: ["robin"], remove: ["robin", "batman"] }).children).toEqual(["cyborg", "aquaman"]);
    expect(withSpawnedChildren({ agents: ["robin", "batman"], remove: ["robin"] }).children).toEqual(["batman", "cyborg", "aquaman"]);
  });

  it("returns the closing as it is when there are none to add", () => {
    const closing = { agents: ["aquaman"], remove: ["aquaman"] };
    expect(withSpawnedChildren(closing)).toBe(closing);
    const all = { agents: ["batman"], remove: ["batman", "aquaman"] };
    expect(withSpawnedChildren(all)).toBe(all);
  });
});

describe("runningSpawned", () => {
  const status = (id: string, state: "starting" | "running" | "stopped") => terminalStatusStore.getState().set(id, { state });

  beforeEach(() => {
    nodesStore.setState({
      nodes: {
        robin: terminal("Robin"),
        batman: terminal("Batman", "robin"),
        aquaman: terminal("Aquaman", "batman"),
        cyborg: terminal("Cyborg", "robin"),
        shazam: terminal("Shazam", "robin"),
        starfire: terminal("Starfire", "robin"),
      },
    });
  });

  it("counts the spawned terminals running or starting, not the top agents nor the stopped ones", () => {
    status("robin", "running");
    status("batman", "running");
    status("aquaman", "starting");
    status("cyborg", "stopped");
    terminalStatusStore.getState().set("shazam", { state: "exited", code: 0 });
    expect(runningSpawned()).toBe(2);
  });

  it("counts a sub-agent launching before its process runs, until it is unmarked", () => {
    status("batman", "running");
    marked.push("starfire", "robin");
    markLaunching("starfire", true);
    // A top agent launching is no sub-agent.
    markLaunching("robin", true);
    expect(runningSpawned()).toBe(2);
    markLaunching("starfire", false);
    expect(runningSpawned()).toBe(1);
  });

  it("frees the seat of a sub-agent that reported, though its terminal still runs", () => {
    // Its own ids: a reported mark stays for the module's life.
    nodesStore.setState((s) => ({ nodes: { ...s.nodes, flash: terminal("Flash", "robin"), batgirl: terminal("Batgirl", "robin") } }));
    status("flash", "running");
    status("batgirl", "running");
    expect(runningSpawned()).toBe(2);
    markReported("flash");
    expect(runningSpawned()).toBe(1);
  });
});
