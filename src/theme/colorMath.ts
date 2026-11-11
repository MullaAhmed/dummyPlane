/**
 * Test helpers: colour math for the opaque `#RRGGBB` colours the palettes and
 * the terminal themes use. WCAG 2 contrast, an sRGB mix (how xterm blends a
 * translucent color), and OKLab/OKLCH (Björn Ottosson's), to tell hues apart.
 */

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = channels(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `top` at `alpha` over `bottom`, per sRGB channel, rounded as xterm does. */
export function blend(bottom: string, top: string, alpha: number): string {
  const [b, t] = [channels(bottom), channels(top)];
  return "#" + b.map((v, i) => Math.round((v + (t[i] - v) * alpha) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** OKLab: lightness, then the green–red and blue–yellow axes. */
export function oklab(hex: string): [number, number, number] {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = channels(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLCH: lightness, chroma and hue in degrees (0–360). */
export function oklch(hex: string): { l: number; c: number; h: number } {
  const [l, a, b] = oklab(hex);
  return { l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

/** Euclidean distance in OKLab: about 0.02 is the least the eye tells apart side by side. */
export function oklabDistance(a: string, b: string): number {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
