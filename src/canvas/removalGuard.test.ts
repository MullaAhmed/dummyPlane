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
