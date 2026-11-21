import { beforeEach, describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { allowRemoval, createRemovalGuard } from "./removalGuard";

const element = (id: string, fields: Record<string, unknown> = {}) =>
  ({ id, type: "embeddable", x: 0, y: 0, width: 300, height: 200, isDeleted: false, frameId: null, version: 1, ...fields }) as unknown as ExcalidrawElement;
const frame = (id: string, fields: Record<string, unknown> = {}) => element(id, { type: "frame", width: 1400, ...fields });
const gone = (e: ExcalidrawElement) => ({ ...e, isDeleted: true, version: e.version + 1 }) as ExcalidrawElement;
const ids = (elements: readonly ExcalidrawElement[]) => elements.map((e) => e.id).sort();

let running: Set<string>;
const isRunning = (id: string) => running.has(id);

beforeEach(() => {
  running = new Set();
});

describe("the removal guard (Annuler never ends a running agent unasked)", () => {
  it("lets a stopped agent go", () => {
    const batman = element("batman");
    const check = createRemovalGuard(isRunning, [batman]);
    expect(check([gone(batman)], ["batman"])).toEqual({ dispose: ["batman"], restore: [], ask: null });
  });

  it("lets a running agent go once its closing was confirmed, once only", () => {
    running.add("batman");
    const batman = element("batman");
    const check = createRemovalGuard(isRunning, [batman]);
    allowRemoval(["batman"]);
    expect(check([gone(batman)], ["batman"]).dispose).toEqual(["batman"]);
    expect(check([batman], []).dispose).toEqual([]);
    expect(check([gone(batman)], ["batman"]).ask).toEqual({ agents: ["batman"], remove: ["batman"] });
  });

  it("puts back a running agent that left unasked (Ctrl+Z, Rétablir, Suppr) as it was, and asks", () => {
    running.add("batman");
    const batman = element("batman", { x: 120 });
    const check = createRemovalGuard(isRunning, [batman]);
    const verdict = check([gone(batman)], ["batman"]);
    expect(verdict.dispose).toEqual([]);
    expect(verdict.restore).toEqual([batman]);
    expect(verdict.ask).toEqual({ agents: ["batman"], remove: ["batman"] });
  });

  // Suppr on a running agent: Excalidraw deletes it and frees the ends of the arrows bound to it, which the guard
  // used to leave so: the wires became orphans, deleted by the upkeep while the user was still being asked (09:21 on 19 Nov).
  it("puts back the arrows that joined a running agent put back, with their ends as they were", () => {
    running.add("batman");
    const batman = element("batman", { boundElements: [{ id: "link", type: "arrow" }, { id: "spawn", type: "arrow" }] });
    const robin = element("robin", { boundElements: [{ id: "link", type: "arrow" }] });
    const chef = element("chef", { boundElements: [{ id: "spawn", type: "arrow" }] });
    const link = element("link", { type: "arrow", startBinding: { elementId: "batman" }, endBinding: { elementId: "robin" } });
    const spawn = element("spawn", { type: "arrow", startBinding: { elementId: "chef" }, endBinding: { elementId: "batman" } });
    const unrelated = element("other", { type: "arrow", startBinding: { elementId: "robin" }, endBinding: { elementId: "chef" } });
    const check = createRemovalGuard(isRunning, [batman, robin, chef, link, spawn, unrelated]);
    // What Excalidraw leaves after its delete: the agent gone, the arrows alive and freed at its end.
    const freed = (e: ExcalidrawElement, side: "startBinding" | "endBinding") => ({ ...e, [side]: null, version: e.version + 1 }) as unknown as ExcalidrawElement;
    const verdict = check([gone(batman), robin, chef, freed(link, "startBinding"), freed(spawn, "endBinding"), unrelated], ["batman"]);
    expect(ids(verdict.restore)).toEqual(["batman", "link", "spawn"]);
    expect(verdict.restore.find((e) => e.id === "link")).toBe(link);
    expect(verdict.restore.find((e) => e.id === "spawn")).toBe(spawn);
    expect(verdict.ask).toEqual({ agents: ["batman"], remove: ["batman"] });
  });

  it("puts back an arrow the same removal deleted, and leaves one it did not touch", () => {
    running.add("batman");
    const batman = element("batman");
    const link = element("link", { type: "arrow", startBinding: { elementId: "batman" }, endBinding: { elementId: "robin" } });
    const check = createRemovalGuard(isRunning, [batman, link]);
    expect(ids(check([gone(batman), gone(link)], ["batman"]).restore)).toEqual(["batman", "link"]);
    const again = createRemovalGuard(isRunning, [batman, link]);
    expect(ids(again([gone(batman), link], ["batman"]).restore)).toEqual(["batman"]);
  });

  it("brings a whole group back, frame and members, and asks to close the group (undoing a group launch)", () => {
    running.add("robin");
    const group = frame("g");
    const members = [element("robin", { frameId: "g" }), element("superman", { frameId: "g" }), element("note", { type: "text", frameId: "g" })];
    const check = createRemovalGuard(isRunning, [group, ...members]);
    const verdict = check([group, ...members].map(gone), ["robin", "superman"]);
    expect(ids(verdict.restore)).toEqual(["g", "note", "robin", "superman"]);
    expect(verdict.dispose).toEqual([]);
    expect(verdict.ask).toEqual({ group: "g" });
  });

  it("brings back the group's frame as it was when the undo shrank it, so the agent is not cut off", () => {
    running.add("robin");
    const group = frame("g", { width: 2000 });
    const robin = element("robin", { frameId: "g", x: 1700 });
    const check = createRemovalGuard(isRunning, [group, robin]);
    const verdict = check([frame("g", { width: 1400, version: 2 }), gone(robin)], ["robin"]);
    expect(verdict.restore).toEqual([robin, group]);
    expect(verdict.ask).toEqual({ agents: ["robin"], remove: ["robin"] });
  });

  it("puts a parent the undo of its first sub-agent let out of their group back in it, and asks for the sub-agent, not the group", () => {
    running.add("robin");
    const group = frame("g");
    const batman = element("batman", { frameId: "g" });
    const robin = element("robin", { frameId: "g" });
    const check = createRemovalGuard(isRunning, [batman, robin, group]);
    // One step undone: the sub-agent and the group gone, the parent loose again.
    const verdict = check([element("batman", { version: 2 }), gone(robin), gone(group)], ["robin"]);
    expect(ids(verdict.restore)).toEqual(["batman", "g", "robin"]);
    expect(verdict.restore.find((e) => e.id === "batman")!.frameId).toBe("g");
    expect(verdict.dispose).toEqual([]);
    // Closing the group would close the parent too: the closing is the sub-agent's, the parent let out of the group then.
    expect(verdict.ask).toEqual({ agents: ["robin"], remove: ["robin", "g"], release: ["batman"] });
  });

  it("asks for all the running agents at once when several left, without their group", () => {
    running.add("batman").add("cyborg");
    const loose = [element("batman"), element("cyborg"), element("flash")];
    const check = createRemovalGuard(isRunning, loose);
    const verdict = check(loose.map(gone), ["batman", "cyborg", "flash"]);
    expect(ids(verdict.restore)).toEqual(["batman", "cyborg"]);
    expect(verdict.dispose).toEqual(["flash"]);
    expect(verdict.ask).toEqual({ agents: ["batman", "cyborg"], remove: ["batman", "cyborg"] });
  });

  it("puts back an agent a new scene replaced (Importer une scène), from the scene before", () => {
    running.add("batman");
    const batman = element("batman");
    const check = createRemovalGuard(isRunning, [batman]);
    const verdict = check([element("drawing", { type: "rectangle" })], ["batman"]);
    expect(verdict.restore).toEqual([batman]);
  });
});
