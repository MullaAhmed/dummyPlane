import { describe, expect, it } from "vitest";
import { PALETTES, type ThemeChoice } from "@/app/theme";
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
    expect(exportBackground("electric")).toEqual({ exportWithDarkMode: true, viewBackgroundColor: "#4e99ff" });
    expect(exportBackground("expressive")).toEqual({ exportWithDarkMode: true, viewBackgroundColor: toSceneColor("#101014") });
  });

  it("shows each export background as close to its palette's canvas as the filter allows", () => {
    const shown = (palette: ThemeChoice) => {
      const { exportWithDarkMode, viewBackgroundColor } = exportBackground(palette);
      return exportWithDarkMode ? toDisplayColor(viewBackgroundColor) : viewBackgroundColor;
    };
    expect(shown("calm")).toBe("#EDE3CC");
    expect(shown("expressive")).toBe("#121212");
    expect(shown("electric")).toBe("#3878d0");
    expect(distance(shown("electric"), PALETTES.electric.canvas)).toBeLessThan(distance("#384e8a", PALETTES.electric.canvas));
  });
});

/** Squared RGB distance between two #rrggbb colors. */
function distance(a: string, b: string): number {
  const channels = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i + 1, i + 3), 16));
  return channels(a).reduce((sum, c, i) => sum + (c - channels(b)[i]) ** 2, 0);
}
