import { describe, expect, it } from "vitest";
import { displayColorFor, exportBackground, sceneColorFor, toDisplayColor, toSceneColor } from "./sceneColors";

describe("scene colors under Excalidraw's dark filter", () => {
  it("matches reference values", () => {
    expect(toDisplayColor("#1e1e1e")).toBe("#d3d3d3");
    expect(toDisplayColor("#ffffff")).toBe("#121212");
    expect(toSceneColor("#5E9A55")).toBe("#448a3a");
    expect(toSceneColor("#EDE8DF")).toBe("#0b0500");
  });

  it("round-trips colors the filter can show", () => {
    for (const color of ["#5e9a55", "#4b5675", "#12110e"]) {
      expect(toDisplayColor(toSceneColor(color))).toBe(color === "#12110e" ? "#121210" : color);
    }
  });

  it("leaves non-hex values alone", () => {
    expect(toSceneColor("transparent")).toBe("transparent");
    expect(toDisplayColor("transparent")).toBe("transparent");
  });
});

describe("colors in each theme", () => {
  it("shows a stored color as is in light, through Excalidraw's inversion in dark", () => {
    expect(displayColorFor("#C2603F", "light")).toBe("#C2603F");
    expect(displayColorFor("#C2603F", "dark")).toBe(toDisplayColor("#C2603F"));
  });

  it("stores what was picked as is in light, inverted back in dark", () => {
    expect(sceneColorFor("#3F74A8", "light")).toBe("#3F74A8");
    expect(sceneColorFor("#3F74A8", "dark")).toBe(toSceneColor("#3F74A8"));
  });

  it("exports a PNG in the palette on screen: its scheme and its canvas color", () => {
    expect(exportBackground("calm")).toEqual({ exportWithDarkMode: false, viewBackgroundColor: "#EDE3CC" });
    expect(exportBackground("electric")).toEqual({ exportWithDarkMode: true, viewBackgroundColor: toSceneColor("#263CF5") });
    expect(exportBackground("expressive")).toEqual({ exportWithDarkMode: true, viewBackgroundColor: toSceneColor("#101014") });
  });
});
