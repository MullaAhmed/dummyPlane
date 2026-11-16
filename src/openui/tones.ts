/**
 * The colours generated output is drawn in: the palette's own roles, so an
 * agent's output follows calm, electric and expressive like the rest of the
 * app. Every ink here reads at 4.5:1 on every ground in every palette
 * (src/theme/legibility.test.ts checks these very tables).
 */

export const TONES = ["neutral", "info", "success", "warning", "danger"] as const;
export type Tone = (typeof TONES)[number];

/** Each tone's ink, as a palette token: its text, its icon and its border. */
export const TONE_TOKEN: Record<Tone, string> = {
  neutral: "--dp-text-2",
  info: "--dp-accent-ink",
  success: "--dp-ok",
  warning: "--dp-wait",
  danger: "--dp-danger",
};

/** The same inks as text classes (Tailwind reads class names whole: they are spelt out). */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-dp-text-2",
  info: "text-dp-accent-ink",
  success: "text-dp-ok",
  warning: "text-dp-wait",
  danger: "text-dp-danger",
};

/** How much of a tone's ink tints the ground under a callout or a badge, as the danger button does (`bg-dp-danger/10`). */
export const TONE_SOFT_ALPHA = 0.1;

/** The same inks as that tint, over whatever ground the part sits on: a callout's and a badge's ground. */
export const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-dp-text-2/10",
  info: "bg-dp-accent-ink/10",
  success: "bg-dp-ok/10",
  warning: "bg-dp-wait/10",
  danger: "bg-dp-danger/10",
};

/** The text roles the library writes in. */
export const TEXT_TOKENS = ["--dp-text", "--dp-text-2", "--dp-text-3"] as const;

/**
 * The grounds it writes on: the output's body and the edit panel
 * (`bg-dp-surface`), a Card (`bg-dp-card`), and the Fleet's mission panel, on
 * its frame's head colour (`bg-dp-terminal-head`). Never on a terminal's body
 * (`--dp-terminal`, 1.3:1 in calm): a subagent's answer gets a surface of its
 * own. Code always sits on the surface, even inside a card: its syntax colours
 * are measured there (src/studio/syntaxTheme.test.ts).
 */
export const GROUND_TOKENS = ["--dp-surface", "--dp-card", "--dp-terminal-head"] as const;

/** A line chart's series, in order: the palette's syntax hues (`@/studio/syntaxHues`), each 4.5:1 or more on the surface. */
export const SERIES_HUES = ["blue", "green", "magenta", "yellow", "cyan", "red"] as const;

/** A bar's fill, and a progress bar's: the accent's ink and the accent, as palette tokens. */
export const BAR_TOKEN = "--dp-accent-ink";
export const PROGRESS_TOKEN = "--dp-accent";

export const isTone = (value: unknown): value is Tone => typeof value === "string" && (TONES as readonly string[]).includes(value);
