import { toast } from "sonner";
import { createStore, useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { messages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { appMessages } from "./messages";

/** Spec identité §4.2: three palettes, each 60% canvas, 30% text and surfaces, 10% accent. */
export type ThemeChoice = "calm" | "electric" | "expressive";
/** The color scheme a palette declares: `data-theme` on <html>, read by Tailwind's `dark:` and Excalidraw. */
export type Theme = "light" | "dark";

export const THEME_KEY = "ui.theme";
export const TRANSPARENCY_KEY = "ui.transparency";
export const DEFAULT_THEME: ThemeChoice = "expressive";

/** English names and schemes, as the Theme radio group shows them. `canvas` is the palette's 60%. */
export const PALETTES: Record<ThemeChoice, { name: string; scheme: Theme; canvas: string }> = {
  calm: { name: "Calm and Playful", scheme: "light", canvas: "#EDE3CC" },
  electric: { name: "Electric and Energetic", scheme: "dark", canvas: "#263CF5" },
  expressive: { name: "Dark and Expressive", scheme: "dark", canvas: "#101014" },
};

/** What public/first-paint.js reads before the first paint (the settings live in SQLite, read later). */
function mirror() {
  const { choice, transparency } = themeStore.getState();
  try {
    localStorage.setItem("ov.theme", choice);
    localStorage.setItem("ov.transparency", transparency ? "on" : "off");
  } catch {
    // No storage: the next start paints the default palette until the settings are read.
  }
}

/** Anything but a known palette (missing, corrupted, an older choice) means the default palette. */
export function readThemeChoice(raw: unknown): ThemeChoice {
  return raw === "calm" || raw === "electric" || raw === "expressive" ? raw : DEFAULT_THEME;
}

/** Transparency stays on unless it was explicitly turned off. */
export function readTransparency(raw: unknown): boolean {
  return raw !== "off";
}

interface ThemeState {
  choice: ThemeChoice;
  transparency: boolean;
}

export const themeStore = createStore<ThemeState>()(() => ({ choice: DEFAULT_THEME, transparency: true }));

export function currentPalette(): ThemeChoice {
  return themeStore.getState().choice;
}

export function currentTheme(): Theme {
  return PALETTES[currentPalette()].scheme;
}

export function useTheme(): Theme {
  return useStore(themeStore, (s) => PALETTES[s.choice].scheme);
}

export function useThemeSettings(): { choice: ThemeChoice; transparency: boolean } {
  return useStore(themeStore, useShallow((s) => ({ choice: s.choice, transparency: s.transparency })));
}

/**
 * The theme on the root element: the palette (`data-palette`, the tokens), its
 * scheme (`data-theme`, Tailwind's `dark:`), the WebView's own scrollbars and
 * form controls (`color-scheme`), the opaque fallback (`data-transparency`).
 * The window's Tauri theme is left alone.
 */
export function applyTheme(root: HTMLElement = document.documentElement) {
  const { choice, transparency } = themeStore.getState();
  const scheme = PALETTES[choice].scheme;
  root.dataset.palette = choice;
  root.dataset.theme = scheme;
  root.style.colorScheme = scheme;
  if (transparency) delete root.dataset.transparency;
  else root.dataset.transparency = "off";
}

/** At startup, before the first render: keeps the root in step with the store. */
export function startTheme() {
  themeStore.subscribe(() => applyTheme());
  applyTheme();
}

/** At boot. Unreadable or unreachable settings keep the defaults, silently (spec identité §9). */
export async function loadThemeSettings() {
  try {
    const [choice, transparency] = await Promise.all([getSetting<unknown>(THEME_KEY), getSetting<unknown>(TRANSPARENCY_KEY)]);
    themeStore.setState({ choice: readThemeChoice(choice), transparency: readTransparency(transparency) });
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

export async function setTransparency(on: boolean) {
  themeStore.setState({ transparency: on });
  mirror();
  await save(TRANSPARENCY_KEY, on ? "on" : "off");
}
