import { toast } from "sonner";
import { createStore, useStore } from "zustand";
import { messages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { appMessages } from "./messages";

/** Spec identité §4.2: three palettes of two colors each, a canvas and an ink that is also the accent. */
export type ThemeChoice = "calm" | "electric" | "expressive";
/** The color scheme a palette declares: `data-theme` on <html>, read by Tailwind's `dark:` and Excalidraw. */
export type Theme = "light" | "dark";

export const THEME_KEY = "ui.theme";
export const DEFAULT_THEME: ThemeChoice = "expressive";

/**
 * English names and schemes, as the Theme radio group shows them, and the
 * palette's two colors: `canvas`, and `accent`, its ink (`--dp-accent` of
 * tokens.css, kept in step by tokens.test.ts): what scene elements that follow
 * the palette, the wires, are drawn in.
 */
export const PALETTES: Record<ThemeChoice, { name: string; scheme: Theme; canvas: string; accent: string }> = {
  calm: { name: "Calm and Playful", scheme: "light", canvas: "#EDE3CC", accent: "#173F32" },
  electric: { name: "Electric and Energetic", scheme: "dark", canvas: "#263CF5", accent: "#F4F4F1" },
  expressive: { name: "Dark and Expressive", scheme: "dark", canvas: "#101014", accent: "#F4F4F1" },
};

/** What public/first-paint.js reads before the first paint (the settings live in SQLite, read later). */
function mirror() {
  try {
    localStorage.setItem("dp.theme", themeStore.getState().choice);
  } catch {
    // No storage: the next start paints the default palette until the settings are read.
  }
}

/** Anything but a known palette (missing, corrupted, an older choice) means the default palette. */
export function readThemeChoice(raw: unknown): ThemeChoice {
  return raw === "calm" || raw === "electric" || raw === "expressive" ? raw : DEFAULT_THEME;
}

/**
 * The palette is the only theme setting: every surface is opaque. The
 * Transparency effects option of older versions is gone, and what they saved
 * (`ui.transparency`, `dp.transparency`) is never read.
 */
interface ThemeState {
  choice: ThemeChoice;
}

export const themeStore = createStore<ThemeState>()(() => ({ choice: DEFAULT_THEME }));

export function currentPalette(): ThemeChoice {
  return themeStore.getState().choice;
}

export function currentTheme(): Theme {
  return PALETTES[currentPalette()].scheme;
}

export function usePalette(): ThemeChoice {
  return useStore(themeStore, (s) => s.choice);
}

export function useTheme(): Theme {
  return useStore(themeStore, (s) => PALETTES[s.choice].scheme);
}

/**
 * The theme on the root element: the palette (`data-palette`, the tokens), its
 * scheme (`data-theme`, Tailwind's `dark:`), the WebView's own scrollbars and
 * form controls (`color-scheme`). The window's Tauri theme is left alone.
 */
export function applyTheme(root: HTMLElement = document.documentElement) {
  const { choice } = themeStore.getState();
  const scheme = PALETTES[choice].scheme;
  root.dataset.palette = choice;
  root.dataset.theme = scheme;
  root.style.colorScheme = scheme;
}

/** At startup, before the first render: keeps the root in step with the store. */
export function startTheme() {
  themeStore.subscribe(() => applyTheme());
  applyTheme();
}

/** At boot. Unreadable or unreachable settings keep the defaults, silently (spec identité §9). */
export async function loadThemeSettings() {
  try {
    themeStore.setState({ choice: readThemeChoice(await getSetting<unknown>(THEME_KEY)) });
    mirror();
  } catch (error) {
    console.warn(`theme settings: ${String(error)}`);
  }
}

async function save(key: string, value: string) {
  await setSetting(key, value).catch((error: unknown) => {
    toast.error(messages(appMessages).settingNotSaved(String(error)));
  });
}

/** Applies at once; the choice stays for the session even if it cannot be saved. */
export async function setThemeChoice(choice: ThemeChoice) {
  themeStore.setState({ choice });
  mirror();
  await save(THEME_KEY, choice);
}
