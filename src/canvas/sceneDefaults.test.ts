import { describe, expect, it } from "vitest";
import { COMIC_SHANNS, SCENE_DEFAULTS, withSceneDefaults } from "./sceneDefaults";

describe("withSceneDefaults", () => {
  it("adds the dummyPlane defaults and keeps the saved viewport", () => {
    const data = withSceneDefaults({ elements: [], appState: { scrollX: 4, scrollY: 2 } });
    expect(data.appState).toMatchObject({ scrollX: 4, scrollY: 2, viewBackgroundColor: "transparent" });
    expect(data.appState?.currentItemFontFamily).toBe(COMIC_SHANNS);
    expect(COMIC_SHANNS).toBe(8);
    expect(SCENE_DEFAULTS.currentItemStrokeColor).toBe("#29261B");
  });
});

it("lets dummyPlane draw frame outlines and group labels", () => {
  expect(SCENE_DEFAULTS.frameRendering).toEqual({ enabled: true, name: true, outline: false, clip: true });
});

it("draws new connection strokes clean and elbowed, and lets a saved view keep its own settings", () => {
  expect(SCENE_DEFAULTS.currentItemRoughness).toBe(0);
  expect(SCENE_DEFAULTS.currentItemArrowType).toBe("elbow");
  const data = withSceneDefaults({ elements: [], appState: { currentItemRoughness: 2 } });
  expect(data.appState).toMatchObject({ currentItemRoughness: 2, currentItemArrowType: "elbow" });
});
