import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Project, Workspace } from "@/ipc/db";
import type { NodeRecord } from "@/store/nodes";
import { goToItems, goToSections, type GoToInput } from "./goTo";

const element = (fields: Record<string, unknown>) =>
  ({ x: 0, y: 0, width: 300, height: 200, isDeleted: false, frameId: null, ...fields }) as unknown as ExcalidrawElement;
const terminal = (id: string, x: number, frameId: string | null = null) =>
  element({ id, type: "embeddable", customData: { kind: "terminal" }, x, y: 40, frameId });
const orchestrator = (id: string) => element({ id, type: "embeddable", customData: { kind: "orchestrator" }, x: 2000, y: 0 });
const group = (id: string, name: string) =>
  element({ id, type: "frame", name, x: 0, y: 0, width: 1400, height: 400, customData: { openvibe: { kind: "group", role: "backend", pantheon: "egypt" } } });
const node = (workspaceId: string, name: string, agent = "claude"): NodeRecord =>
  ({ workspaceId, kind: "terminal", payload: { title: name, name, agent, cwd: "C:/code", shell: "default", command: "" } }) as NodeRecord;

const workspaces = [
  { id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null },
  { id: "w2", projectId: "p1", name: "Backend", position: 1, pantheon: null },
] as Workspace[];
const projects = [
  { id: "p1", name: "mk-webapp", path: "C:/code/mk-webapp", lastOpenedAt: 3, missing: false },
  { id: "p2", name: "api", path: "C:/code/api", lastOpenedAt: 1, missing: false },
  { id: "p3", name: "site", path: "C:/code/site", lastOpenedAt: 2, missing: false },
  { id: "p4", name: "vieux", path: "C:/code/vieux", lastOpenedAt: 9, missing: true },
] as Project[];

const input = (fields: Partial<GoToInput> = {}): GoToInput => ({
  home: false,
  projects,
  activeProjectId: "p1",
  workspaces,
  activeWorkspaceId: "w2",
  scenes: {
    w1: [terminal("isis", 0), orchestrator("chef")],
    w2: [group("g", "Serveurs"), terminal("thot", 500, "g"), terminal("hermes", 0, "g")],
  },
  nodes: {
    isis: node("w1", "Isis"),
    thot: node("w2", "Thot", "codex"),
    hermes: node("w2", "Hermès"),
    chef: { workspaceId: "w1", kind: "orchestrator", payload: { name: "chef de backend" } } as NodeRecord,
  },
  live: { w1: 1, w2: 2 },
  ...fields,
});

describe("goToItems (spec fenêtre §7.2)", () => {
  it("lists the workspace on screen first, then the others in tab order, terminals in Ctrl+Tab order", () => {
    const items = goToItems(input());
    expect(items.filter((i) => i.kind === "terminal").map((i) => i.label)).toEqual(["Hermès", "Thot", "Isis"]);
    expect(items.map((i) => i.kind)).toEqual(["terminal", "terminal", "terminal", "group", "orchestrator", "workspace", "workspace", "project", "project"]);
  });

  it("names the workspace of an item only when it is not the one on screen", () => {
    const items = goToItems(input());
    expect(items.find((i) => i.label === "Thot")!.elsewhere).toBeUndefined();
    expect(items.find((i) => i.label === "Isis")!.elsewhere).toBe("Workspace 1");
    expect(items.find((i) => i.kind === "orchestrator")!).toMatchObject({ label: "chef de backend", elsewhere: "Workspace 1", targetId: "chef", workspaceId: "w1" });
  });

  it("tells a terminal's agent and group, a group's members, a workspace's live agents and whether it is on screen", () => {
    const items = goToItems(input());
    expect(items.find((i) => i.label === "Thot")).toMatchObject({ agent: "codex", group: { name: "Serveurs" }, targetId: "thot", workspaceId: "w2" });
    expect(items.find((i) => i.label === "Thot")!.keywords).toEqual(expect.arrayContaining(["Codex", "Serveurs", "Backend"]));
    expect(items.find((i) => i.kind === "group")).toMatchObject({ label: "Serveurs", members: 2, targetId: "g" });
    expect(items.filter((i) => i.kind === "workspace").map((i) => [i.label, i.live, i.current])).toEqual([
      ["Workspace 1", 1, false],
      ["Backend", 2, true],
    ]);
  });

  it("offers the other projects, most recently opened first, never one whose folder is gone", () => {
    expect(goToItems(input()).filter((i) => i.kind === "project").map((i) => i.label)).toEqual(["site", "api"]);
  });

  it("lists a workspace's items once its scene is read", () => {
    const items = goToItems(input({ scenes: { w2: input().scenes.w2 } }));
    expect(items.some((i) => i.label === "Isis")).toBe(false);
  });

  it("at home, only the projects", () => {
    const items = goToItems(input({ home: true, activeProjectId: null }));
    expect(items.map((i) => i.label)).toEqual(["mk-webapp", "site", "api"]);
    expect(items[0]).toMatchObject({ kind: "project", projectId: "p1", path: "C:/code/mk-webapp" });
  });
});

describe("goToSections", () => {
  it("puts the items in their sections, in the spec's order, empty sections left out", () => {
    const sections = goToSections(goToItems(input({ home: true, activeProjectId: null })), "");
    expect(sections.map((s) => s.label)).toEqual(["Projects"]);
    expect(goToSections(goToItems(input()), "").map((s) => s.label)).toEqual(["Terminals", "Groups", "Orchestrators", "Workspaces", "Projects"]);
  });

  it("ranks each section by the search", () => {
    const sections = goToSections(goToItems(input()), "isis cl");
    expect(sections.map((s) => [s.label, s.items.map((i) => i.label)])).toEqual([["Terminals", ["Isis"]]]);
  });

  it("puts the section of the best match first while searching", () => {
    // Thot and Hermès are found by their group's name, the group by its own.
    expect(goToSections(goToItems(input()), "servers").map((s) => s.label)).toEqual(["Terminals", "Groups"]);
  });
});
