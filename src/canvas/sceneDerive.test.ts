import { expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createSceneDerivation } from "./sceneDerive";

const element = (id: string, version = 1) => ({ id, version, isDeleted: false }) as unknown as ExcalidrawElement;

function setup() {
  const scene = vi.fn();
  const selection = vi.fn();
  return { scene, selection, derive: createSceneDerivation({ scene, selection }) };
}

it("derives the scene on the first change, then not again while only the view moves: a pan's frames (P2 #58)", () => {
  const { scene, selection, derive } = setup();
  const elements = [element("a"), element("b")];
  const selected = {};
  derive(elements, 2, selected);
  expect(scene).toHaveBeenCalledTimes(1);
  expect(selection).toHaveBeenCalledTimes(1);
  // A pan: Excalidraw hands the same array, the same version, the same selection, frame after frame.
  for (let frame = 0; frame < 60; frame++) derive(elements, 2, selected);
  expect(scene).toHaveBeenCalledTimes(1);
  expect(selection).toHaveBeenCalledTimes(1);
});

it("derives again when an element changes in place (its version moves), or the array is another one", () => {
  const { scene, derive } = setup();
  const elements = [element("a"), element("b")];
  const selected = {};
  derive(elements, 2, selected);
  // A drag: the same array, an element's version bumped.
  derive(elements, 3, selected);
  expect(scene).toHaveBeenCalledTimes(2);
  expect(scene).toHaveBeenLastCalledWith(elements);
  // Another array of the same version and length (a scene replaced): derived too.
  const replaced = [element("a", 2), element("b")];
  derive(replaced, 3, selected);
  expect(scene).toHaveBeenCalledTimes(3);
  expect(scene).toHaveBeenLastCalledWith(replaced);
});

it("derives again when the length moves at the same version: an element gone and another bumped by as much", () => {
  const { scene, derive } = setup();
  const elements = [element("a"), element("b")];
  derive(elements, 5, {});
  elements.pop();
  derive(elements, 5, {});
  expect(scene).toHaveBeenCalledTimes(2);
});

it("derives the drawn selection again when only the selection changes, not the scene", () => {
  const { scene, selection, derive } = setup();
  const elements = [element("a")];
  derive(elements, 1, {});
  const picked = { a: true as const };
  derive(elements, 1, picked);
  expect(selection).toHaveBeenCalledTimes(2);
  expect(selection).toHaveBeenLastCalledWith(elements, picked);
  expect(scene).toHaveBeenCalledTimes(1);
});

it("derives again after a reset: an emptied store gets the scene back on the next change", () => {
  const { scene, selection, derive } = setup();
  const elements = [element("a")];
  const selected = {};
  derive(elements, 1, selected);
  derive.reset();
  derive(elements, 1, selected);
  expect(scene).toHaveBeenCalledTimes(2);
  expect(selection).toHaveBeenCalledTimes(2);
});

it("keeps each canvas's memory apart", () => {
  const first = setup();
  const second = setup();
  const elements = [element("a")];
  first.derive(elements, 1, {});
  second.derive(elements, 1, {});
  expect(second.scene).toHaveBeenCalledTimes(1);
});
