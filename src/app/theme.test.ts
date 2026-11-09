// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import {
  DEFAULT_THEME,
  PALETTES,
  currentPalette,
  currentTheme,
  loadThemeSettings,
  readThemeChoice,
  readTransparency,
  setThemeChoice,
  setTransparency,
  startTheme,
  themeStore,
} from "./theme";

const root = document.documentElement;

beforeEach(() => {
  themeStore.setState({ choice: "expressive", transparency: true });
  delete root.dataset.palette;
  delete root.dataset.theme;
  delete root.dataset.transparency;
  localStorage.clear();
});
afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe("palettes", () => {
  it("are three, each with its English name and the color scheme it declares", () => {
    expect(Object.keys(PALETTES).sort()).toEqual(["calm", "electric", "expressive"]);
    expect(PALETTES.calm).toMatchObject({ name: "Calm and Playful", scheme: "light" });
    expect(PALETTES.electric).toMatchObject({ name: "Electric and Energetic", scheme: "dark" });
    expect(PALETTES.expressive).toMatchObject({ name: "Dark and Expressive", scheme: "dark" });
  });

  it("default to expressive", () => {
    expect(DEFAULT_THEME).toBe("expressive");
    expect(themeStore.getState().choice).toBe("expressive");
    expect(currentTheme()).toBe("dark");
  });
});

describe("reading the saved settings", () => {
  it("reads each palette id as it is", () => {
    expect(readThemeChoice("calm")).toBe("calm");
    expect(readThemeChoice("electric")).toBe("electric");
    expect(readThemeChoice("expressive")).toBe("expressive");
  });

  it("falls back to expressive for anything else, including the old system, light and dark choices", () => {
    for (const old of ["system", "light", "dark"]) expect(readThemeChoice(old)).toBe("expressive");
    for (const junk of ["bleu", 3, null, undefined, {}]) expect(readThemeChoice(junk)).toBe("expressive");
  });

  it("keeps transparency on unless it was turned off", () => {
    expect(readTransparency("off")).toBe(false);
    for (const value of ["on", null, 0, "OFF", undefined]) expect(readTransparency(value)).toBe(true);
  });
});

describe("startTheme", () => {
  it("paints the default palette and its scheme", () => {
    startTheme();
    expect(root.dataset.palette).toBe("expressive");
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
  });

  it("writes the palette and the scheme it declares when the choice changes", () => {
    startTheme();
    themeStore.setState({ choice: "calm" });
    expect(root.dataset.palette).toBe("calm");
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
    themeStore.setState({ choice: "electric" });
    expect(root.dataset.palette).toBe("electric");
    expect(root.dataset.theme).toBe("dark");
  });

  it("does not follow Windows: the scheme is the palette's", () => {
    startTheme();
    themeStore.setState({ choice: "calm" });
    expect(currentPalette()).toBe("calm");
    expect(currentTheme()).toBe("light");
  });

  it("marks the root when transparency is off, and only then", () => {
    startTheme();
    themeStore.setState({ transparency: false });
    expect(root.dataset.transparency).toBe("off");
    themeStore.setState({ transparency: true });
    expect(root.dataset.transparency).toBeUndefined();
  });
});

describe("loadThemeSettings", () => {
  it("reads the saved palette and transparency", async () => {
    mockIPC((cmd, args) => {
      if (cmd !== "get_setting") return;
      return (args as { key: string }).key === "ui.theme" ? "calm" : "off";
    });
    await loadThemeSettings();
    expect(themeStore.getState()).toMatchObject({ choice: "calm", transparency: false });
  });

  it("maps an old saved choice to expressive", async () => {
    mockIPC((cmd, args) => {
      if (cmd !== "get_setting") return;
      return (args as { key: string }).key === "ui.theme" ? "light" : null;
    });
    await loadThemeSettings();
    expect(themeStore.getState()).toMatchObject({ choice: "expressive", transparency: true });
  });

  it("keeps the defaults, without error, when the settings are unreadable or cannot be read", async () => {
    mockIPC((cmd) => (cmd === "get_setting" ? 42 : undefined));
    await loadThemeSettings();
    expect(themeStore.getState()).toMatchObject({ choice: "expressive", transparency: true });
    mockIPC(() => {
      throw new Error("base locked");
    });
    await expect(loadThemeSettings()).resolves.toBeUndefined();
    expect(themeStore.getState()).toMatchObject({ choice: "expressive", transparency: true });
  });
});

describe("changing the settings", () => {
  it("applies at once, saves the choice and mirrors it for the first paint", async () => {
    const saved: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "set_setting") saved.push(args);
    });
    startTheme();
    await setThemeChoice("calm");
    await setTransparency(false);
    expect(root.dataset.palette).toBe("calm");
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.transparency).toBe("off");
    expect(localStorage.getItem("ov.theme")).toBe("calm");
    expect(localStorage.getItem("ov.transparency")).toBe("off");
    expect(saved).toEqual([
      { key: "ui.theme", value: "calm" },
      { key: "ui.transparency", value: "off" },
    ]);
  });

  it("keeps the choice for the session and says so when it cannot be saved", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    mockIPC(() => {
      throw new Error("disk full");
    });
    startTheme();
    await setThemeChoice("electric");
    expect(root.dataset.palette).toBe("electric");
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Setting not saved: .*disk full/));
  });
});
