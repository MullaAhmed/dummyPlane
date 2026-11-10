import { call } from "./invoke";

/** One of the extensions Rust accepts (Claude Code's image types). */
export type ImageExtension = "png" | "jpg" | "gif" | "webp";

/**
 * Saves a pasted image in the app's cache folder and returns its path. The
 * bytes travel raw: as JSON, a screenshot's would weigh megabytes.
 */
export const savePastedImage = (bytes: Uint8Array, extension: ImageExtension) =>
  call<string>("save_pasted_image", bytes, { headers: { "x-image-extension": extension } });
