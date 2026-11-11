import { toast } from "sonner";
import { messages } from "@/i18n";
import { savePastedImage, type ImageExtension } from "@/ipc/pastedImages";
import { nodesMessages } from "@/nodes/messages";

/**
 * Pasting an image into a terminal or a message field (an agent's, a Fleet's,
 * the command bar): neither carries an image, so it is saved in the app's
 * cache and its path pasted instead. Claude Code (like Codex) reads an image
 * path pasted alone as an attached image, `[Image #N]`, and reads one written
 * in a message with its Read tool; on Windows it never reads the clipboard on
 * an empty paste, only on Alt+V.
 */

/** The image types an agent attaches from a pasted path (Claude Code's list). */
const EXTENSIONS: Record<string, ImageExtension> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export interface PastedImage {
  file: Blob;
  extension: ImageExtension;
}

type ClipboardItem = Pick<DataTransferItem, "kind" | "type" | "getAsFile">;
type ClipboardData = Pick<DataTransfer, "getData"> & { items: ArrayLike<ClipboardItem>; types?: readonly string[] };

/** The part of a paste event, native or React's, that taking it over needs. */
export type PasteEventLike = { clipboardData: ClipboardData | null; preventDefault: () => void; stopPropagation: () => void };

/** What the clipboard can still give once the paste event is over (`navigator.clipboard.read`). */
type ClipboardRead = () => Promise<readonly Pick<globalThis.ClipboardItem, "types" | "getType">[]>;

/**
 * The image a paste hands to the agent, or null to let the target paste as
 * before. Text wins, even next to an image (a copy from Office carries both);
 * only non-empty plain text counts, as it is what xterm or a field would
 * paste. A browser's "Copy image" (an image and HTML, no plain text) is an
 * image.
 */
export function pastedImage(data: ClipboardData | null): PastedImage | null {
  if (!data || data.getData("text/plain") !== "") return null;
  for (const item of Array.from(data.items)) {
    const extension = EXTENSIONS[item.type];
    if (item.kind !== "file" || !extension) continue;
    const file = item.getAsFile();
    if (file) return { file, extension };
  }
  return null;
}

/**
 * The path as typed into the terminal or the field: in double quotes when it
 * holds a space (a user name with one), which Claude Code strips. No newline:
 * it would send the message before the user writes it.
 */
export function pastedPath(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

/**
 * `value` with `path` in place of its selection `start`..`end`, a space
 * between it and a word it would touch, and one after it to type on; and
 * the caret after that space.
 */
export function withPathAt(value: string, start: number, end: number, path: string): { text: string; caret: number } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const inserted = `${before === "" || /\s$/.test(before) ? "" : " "}${path}${/^\s/.test(after) ? "" : " "}`;
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

/** Saves the image, then hands its path to `paste`; a failed save says so, in a toast and in the log, instead of doing nothing. */
export async function pasteImage(image: PastedImage, paste: (text: string) => void): Promise<void> {
  try {
    const path = await savePastedImage(new Uint8Array(await image.file.arrayBuffer()), image.extension);
    paste(pastedPath(path));
  } catch (error) {
    console.error("image paste failed", error);
    toast.error(messages(nodesMessages).terminal.imagePasteFailed, {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The first image of the clipboard an agent reads, read again after the paste event; null when it has none or cannot be read. */
export async function clipboardImage(read: ClipboardRead = () => navigator.clipboard.read()): Promise<PastedImage | null> {
  try {
    for (const item of await read()) {
      for (const type of item.types) {
        const extension = EXTENSIONS[type];
        if (extension) return { file: await item.getType(type), extension };
      }
    }
  } catch (error) {
    console.warn("image paste: the clipboard could not be read", error);
  }
  return null;
}

/** What a paste carried, for the log: its types and items, never their contents. */
function describe(data: ClipboardData): string {
  const items = Array.from(data.items, (item) => `${item.kind}:${item.type}`).join(", ");
  return `types [${(data.types ?? []).join(", ")}], items [${items}]`;
}

/**
 * A paste in a terminal or a message field. Text is left to the target
 * (false): xterm or the field pastes it as before. An image is taken over:
 * saved, its path handed to `paste`. A paste with neither text nor an image
 * (the event may not expose the clipboard's image) is taken over too: the
 * clipboard is read again for an image, and the log keeps what the event
 * carried; with no image there either, a toast says there was nothing to
 * paste. The clipboard data is read here, synchronously: it is emptied once
 * the event is over.
 */
export function takeOverPaste(event: PasteEventLike, paste: (text: string) => void, read?: ClipboardRead): boolean {
  const data = event.clipboardData;
  if (!data || data.getData("text/plain") !== "") return false;
  event.preventDefault();
  event.stopPropagation();
  const image = pastedImage(data);
  if (image) {
    void pasteImage(image, paste);
    return true;
  }
  console.warn(`image paste: no text and no image in the paste event, reading the clipboard (${describe(data)})`);
  void clipboardImage(read).then((found) => {
    if (found) return pasteImage(found, paste);
    const text = messages(nodesMessages).terminal;
    toast(text.nothingToPaste, { description: text.nothingToPasteDetail });
  });
  return true;
}
