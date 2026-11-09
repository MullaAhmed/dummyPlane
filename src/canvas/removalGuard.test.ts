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

describe("the removal guard (retours J8b: Annuler never ends a running agent unasked)", () => {
  it("lets a stopped agent go", () => {
    const isis = element("isis");
    const check = createRemovalGuard(isRunning, [isis]);
    expect(check([gone(isis)], ["isis"])).toEqual({ dispose: ["isis"], restore: [], ask: null });
  });

  it("lets a running agent go once its closing was confirmed, once only", () => {
    running.add("isis");
    const isis = element("isis");
    const check = createRemovalGuard(isRunning, [isis]);
    allowRemoval(["isis"]);
    expect(check([gone(isis)], ["isis"]).dispose).toEqual(["isis"]);
    expect(check([isis], []).dispose).toEqual([]);
    expect(check([gone(isis)], ["isis"]).ask).toEqual({ agents: ["isis"], remove: ["isis"] });
  });

  it("puts back a running agent that left unasked (Ctrl+Z, Rétablir, Suppr) as it was, and asks", () => {
    running.add("isis");
    const isis = element("isis", { x: 120 });
    const check = createRemovalGuard(isRunning, [isis]);
    const verdict = check([gone(isis)], ["isis"]);
    expect(verdict.dispose).toEqual([]);
    expect(verdict.restore).toEqual([isis]);
    expect(verdict.ask).toEqual({ agents: ["isis"], remove: ["isis"] });
  });

  it("brings a whole group back, frame and members, and asks to close the group (undoing a group launch)", () => {
    running.add("ra");
    const group = frame("g");
    const members = [element("ra", { frameId: "g" }), element("thot", { frameId: "g" }), element("note", { type: "text", frameId: "g" })];
    const check = createRemovalGuard(isRunning, [group, ...members]);
    const verdict = check([group, ...members].map(gone), ["ra", "thot"]);
    expect(ids(verdict.restore)).toEqual(["g", "note", "ra", "thot"]);
    expect(verdict.dispose).toEqual([]);
    expect(verdict.ask).toEqual({ group: "g" });
  });

  it("brings back the group's frame as it was when the undo shrank it, so the agent is not cut off", () => {
    running.add("ra");
    const group = frame("g", { width: 2000 });
    const ra = element("ra", { frameId: "g", x: 1700 });
    const check = createRemovalGuard(isRunning, [group, ra]);
    const verdict = check([frame("g", { width: 1400, version: 2 }), gone(ra)], ["ra"]);
    expect(verdict.restore).toEqual([ra, group]);
    expect(verdict.ask).toEqual({ agents: ["ra"], remove: ["ra"] });
  });

  it("asks for all the running agents at once when several left, without their group", () => {
    running.add("isis").add("thot");
    const loose = [element("isis"), element("thot"), element("anubis")];
    const check = createRemovalGuard(isRunning, loose);
    const verdict = check(loose.map(gone), ["isis", "thot", "anubis"]);
    expect(ids(verdict.restore)).toEqual(["isis", "thot"]);
    expect(verdict.dispose).toEqual(["anubis"]);
    expect(verdict.ask).toEqual({ agents: ["isis", "thot"], remove: ["isis", "thot"] });
  });

  it("puts back an agent a new scene replaced (Importer une scène), from the scene before", () => {
    running.add("isis");
    const isis = element("isis");
    const check = createRemovalGuard(isRunning, [isis]);
    const verdict = check([element("drawing", { type: "rectangle" })], ["isis"]);
    expect(verdict.restore).toEqual([isis]);
  });
});
