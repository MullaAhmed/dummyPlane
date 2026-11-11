import { describe, expect, it } from "vitest";
import capability from "../../src-tauri/capabilities/default.json";
import conf from "../../src-tauri/tauri.conf.json";

describe("window configuration", () => {
  it("lets the page set the window title", () => {
    expect(capability.permissions).toContain("core:window:allow-set-title");
  });

  it("draws its own title bar", () => {
    expect(conf.app.windows[0].decorations).toBe(false);
  });

  it("lets the page move, minimize, maximize and close the window", () => {
    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "core:window:allow-start-dragging",
        "core:window:allow-minimize",
        "core:window:allow-toggle-maximize",
        "core:window:allow-close",
      ]),
    );
  });

  it("ships as a per-user NSIS installer in English", () => {
    expect(conf.bundle.targets).toEqual(["nsis"]);
    expect(conf.bundle.windows.nsis).toEqual({ installMode: "currentUser", languages: ["English"] });
    expect(conf.identifier).toBe("dev.dummyplane.app");
  });
});
