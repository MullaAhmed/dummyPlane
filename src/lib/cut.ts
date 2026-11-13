// Imports nothing on purpose: the notification history's capture (src/notifications/capture.ts) sits under every
// toast and may import no part of the app but this.

/**
 * Half of a character: a UTF-16 surrogate without its pair, as a cut inside an emoji leaves it. JSON writes it as
 * "\ud83c", which Rust (serde_json) refuses: the IPC call or the saved setting that carries one fails whole.
 */
export const HALF_CHARACTER = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The first `length` UTF-16 units of `text`, without the half of a character the cut may leave. */
export function cutWhole(text: string, length: number): string {
  return text.slice(0, length).replace(HALF_CHARACTER, "");
}
