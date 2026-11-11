// Excalidraw's dark theme draws the canvas through `invert(93%) hue-rotate(180deg)`
//. These convert between a stored element color and the
// color seen on screen; saturated colors cannot all be shown and come out duller.
import { PALETTES, type Theme, type ThemeChoice } from "@/app/theme";

type Rgb = [number, number, number];

// hue-rotate(180deg) as defined by the Filter Effects spec; it is its own inverse.
const HUE_180: Rgb[] = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const clamp = (v: number) => Math.min(1, Math.max(0, v));

function apply(v: Rgb): Rgb {
  return HUE_180.map((row) => clamp(row[0] * v[0] + row[1] * v[1] + row[2] * v[2])) as Rgb;
}

function parse(hex: string): Rgb {
  let digits = hex.replace("#", "");
  if (digits.length === 3) digits = [...digits].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255) as Rgb;
}

function format(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(clamp(c) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** The color to store so that the canvas shows `displayHex`, or the closest it can. */
export function toSceneColor(displayHex: string): string {
  if (!HEX.test(displayHex)) return displayHex;
  return format(apply(parse(displayHex).map((d) => (0.93 - d) / 0.86) as Rgb));
}

/** The color the canvas shows for a stored element color. */
export function toDisplayColor(sceneHex: string): string {
  if (!HEX.test(sceneHex)) return sceneHex;
  return format(apply(parse(sceneHex).map((c) => 0.93 - 0.86 * c) as Rgb));
}

/** The color the canvas shows, in `theme`, for a stored element color. */
export function displayColorFor(sceneHex: string, theme: Theme): string {
  return theme === "dark" ? toDisplayColor(sceneHex) : sceneHex;
}

/** The color to store so that the canvas shows `displayHex` in `theme`. */
export function sceneColorFor(displayHex: string, theme: Theme): string {
  return theme === "dark" ? toSceneColor(displayHex) : displayHex;
}

/**
 * Electric's canvas (#263CF5) cannot be reached through the dark filter: no stored
 * color shows as it. The nearest one, of all 8-bit colors, shows as #3878d0; the
 * plain inverse of the canvas, #a0baff, would show as #384e8a.
 */
const ELECTRIC_EXPORT_SCENE = "#4e99ff";

/** A PNG export looks like the canvas on screen, in the palette's scheme and on its canvas color. */
export function exportBackground(palette: ThemeChoice): { exportWithDarkMode: boolean; viewBackgroundColor: string } {
  const { scheme, canvas } = PALETTES[palette];
  if (scheme === "light") return { exportWithDarkMode: false, viewBackgroundColor: canvas };
  const viewBackgroundColor = palette === "electric" ? ELECTRIC_EXPORT_SCENE : toSceneColor(canvas);
  return { exportWithDarkMode: true, viewBackgroundColor };
}
