import { toast } from "sonner";
import { messages } from "@/i18n";
import { savePastedImage, type ImageExtension } from "@/ipc/pastedImages";
import { nodesMessages } from "@/nodes/messages";

/**
 * Pasting an image into a terminal: no terminal carries an image, so it is
 * saved in the app's cache and its path pasted instead. Claude Code (like
 * Codex) reads an image path pasted alone as an attached image, `[Image #N]`;
 * on Windows it never reads the clipboard on an empty paste, only on Alt+V.
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
type ClipboardData = Pick<DataTransfer, "getData"> & { items: ArrayLike<ClipboardItem> };

/**
 * The image a paste hands to the agent, or null to let xterm paste as before.
 * Text wins, even next to an image (a copy from Office carries both); only
 * non-empty plain text counts, as it is what xterm would paste. A browser's
 * "Copy image" (an image and HTML, no plain text) is an image.
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
 * The path as typed into the terminal: in double quotes when it holds a space
 * (a user name with one), which Claude Code strips. No newline: it would send
 * the message before the user writes it.
 */
export function pastedPath(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

/** Saves the image, then hands its path to `paste`; a failed save says so instead of doing nothing. */
export async function pasteImage(image: PastedImage, paste: (text: string) => void): Promise<void> {
  try {
    const path = await savePastedImage(new Uint8Array(await image.file.arrayBuffer()), image.extension);
    paste(pastedPath(path));
  } catch (error) {
    toast.error(messages(nodesMessages).terminal.imagePasteFailed, {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * A terminal's paste event: an image is taken over, anything else left to
 * xterm. Listen in the capture phase, before xterm's own listener, which reads
 * text only and would send an empty paste. The clipboard data is read here,
 * synchronously: it is emptied once the event is over.
 */
export function onTerminalPaste(event: ClipboardEvent, paste: (text: string) => void) {
  const image = pastedImage(event.clipboardData);
  if (!image) return;
  event.preventDefault();
  event.stopPropagation();
  void pasteImage(image, paste);
}
