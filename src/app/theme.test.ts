// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import {
  loadThemeSettings,
  readThemeChoice,
  readTransparency,
  resolveTheme,
  setThemeChoice,
  setTransparency,
  startTheme,
  themeStore,
  type SystemScheme,
} from "./theme";

class FakeScheme implements SystemScheme {
  private listeners: ((event: { matches: boolean }) => void)[] = [];
  constructor(public matches: boolean) {}
  addEventListener(_type: "change", listener: (event: { matches: boolean }) => void) {
    this.listeners.push(listener);
  }
  /** Windows switches between light and dark apps. */
  switch(dark: boolean) {
    this.matches = dark;
    for (const listener of this.listeners) listener({ matches: dark });
  }
}

const root = document.documentElement;

beforeEach(() => {
  themeStore.setState({ choice: "system", systemDark: true, transparency: true });
  delete root.dataset.theme;
  delete root.dataset.transparency;
});
afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe("resolveTheme", () => {
  it("follows Windows in System mode and ignores it when forced", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("reading the saved settings", () => {
  it("falls back to System for anything but light or dark", () => {
    expect(readThemeChoice("light")).toBe("light");
    expect(readThemeChoice("dark")).toBe("dark");
    expect(readThemeChoice("system")).toBe("system");
    for (const junk of ["bleu", 3, null, undefined, {}]) expect(readThemeChoice(junk)).toBe("system");
  });

  it("keeps transparency on unless it was turned off", () => {
    expect(readTransparency("off")).toBe(false);
    for (const value of ["on", null, 0, "OFF", undefined]) expect(readTransparency(value)).toBe(true);
  });
});

describe("startTheme", () => {
  it("follows Windows live in System mode: tokens and native controls", () => {
    const scheme = new FakeScheme(true);
    startTheme(scheme);
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    scheme.switch(false);
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("stays on a forced theme when Windows changes", () => {
    const scheme = new FakeScheme(false);
    startTheme(scheme);
    themeStore.setState({ choice: "dark" });
    scheme.switch(false);
    expect(root.dataset.theme).toBe("dark");
  });

  it("marks the root when transparency is off, and only then", () => {
    startTheme(new FakeScheme(true));
    themeStore.setState({ transparency: false });
    expect(root.dataset.transparency).toBe("off");
    themeStore.setState({ transparency: true });
    expect(root.dataset.transparency).toBeUndefined();
  });
});

describe("loadThemeSettings", () => {
  it("reads the saved choice and transparency", async () => {
    mockIPC((cmd, args) => {
      if (cmd !== "get_setting") return;
      return (args as { key: string }).key === "ui.theme" ? "light" : "off";
    });
    await loadThemeSettings();
    expect(themeStore.getState()).toMatchObject({ choice: "light", transparency: false });
  });

  it("keeps the defaults, without error, when the settings are unreadable or cannot be read", async () => {
    mockIPC((cmd) => (cmd === "get_setting" ? 42 : undefined));
    await loadThemeSettings();
    expect(themeStore.getState()).toMatchObject({ choice: "system", transparency: true });
    mockIPC(() => {
      throw new Error("base verrouillée");
    });
    await expect(loadThemeSettings()).resolves.toBeUndefined();
    expect(themeStore.getState()).toMatchObject({ choice: "system", transparency: true });
  });
});

describe("changing the settings", () => {
  it("applies at once and saves the choice", async () => {
    const saved: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "set_setting") saved.push(args);
    });
    startTheme(new FakeScheme(true));
    await setThemeChoice("light");
    await setTransparency(false);
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.transparency).toBe("off");
    expect(saved).toEqual([
      { key: "ui.theme", value: "light" },
      { key: "ui.transparency", value: "off" },
    ]);
  });

  it("keeps the choice for the session and says so when it cannot be saved", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    mockIPC(() => {
      throw new Error("disk full");
    });
    startTheme(new FakeScheme(true));
    await setThemeChoice("light");
    expect(root.dataset.theme).toBe("light");
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Setting not saved: .*disk full/));
  });
});
