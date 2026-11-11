import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { savedImagePath, type PastedImage } from "@/nodes/terminal/imagePaste";
import { agentsMessages } from "../messages";

/**
 * An image pasted into the field: shown at once from what was pasted, sent as its saved file's path. The field
 * never shows the path; the send pastes it alone before the text, which the agent attaches as `[Image #N]`
 * (../broadcast.ts).
 */
export interface ImageAttachment {
  id: number;
  /** An object URL of the pasted image, for its thumbnail: revoked once the attachment is gone. */
  url: string;
  /** The saved file's path as pasted, once saved; null when the save failed (a toast said so). */
  path: Promise<string | null>;
}

/** The field's attachments: added on a paste, taken by a send, each URL revoked once its chip is gone. */
export function useImageAttachments() {
  const [images, setImages] = useState<readonly ImageAttachment[]>([]);
  const next = useRef(1);
  // What is shown, for the unmount: every URL still in use is revoked then.
  const shown = useRef(images);
  shown.current = images;
  useEffect(() => () => shown.current.forEach((image) => URL.revokeObjectURL(image.url)), []);

  const drop = (gone: readonly ImageAttachment[]) => {
    for (const image of gone) URL.revokeObjectURL(image.url);
    setImages((current) => current.filter((image) => !gone.includes(image)));
  };

  /** Shows the image as it is saved: a send waits for the save, never for the user. */
  const add = (pasted: PastedImage) => {
    const image: ImageAttachment = { id: next.current++, url: URL.createObjectURL(pasted.file), path: savedImagePath(pasted) };
    setImages((current) => [...current, image]);
    // A failed save would send nothing: its chip goes.
    void image.path.then((path) => path === null && drop([image]));
  };

  /** The paths of the images shown, once saved, in their order; the chips go at once. */
  const take = async (): Promise<string[]> => {
    const taken = shown.current;
    drop(taken);
    const paths = await Promise.all(taken.map((image) => image.path));
    return paths.filter((path) => path !== null);
  };

  return { images, add, remove: (image: ImageAttachment) => drop([image]), take };
}

/**
 * The attachments as chips, beside the targets' (CommandInput): a thumbnail, "Image 1", and its ✕ named after it.
 * The list adds no box (contents): the chips wrap with the field.
 */
export function ImageChips({
  images,
  onRemove,
  onMouseDown,
}: {
  images: readonly ImageAttachment[];
  onRemove: (image: ImageAttachment) => void;
  /** Keeps the caret in the field on a click on a ✕. */
  onMouseDown: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const t = useMessages(agentsMessages).command;
  if (images.length === 0) return null;
  return (
    <ul role="list" aria-label={t.images} className="contents">
      {images.map((image, i) => (
        <li
          key={image.id}
          role="listitem"
          data-image-chip
          className="flex h-6 items-center gap-1.5 rounded-sm bg-dp-hover pr-1 text-xs text-dp-text"
        >
          {/* Flush with the chip's left edge, so its corners are the chip's own. The label names it: the picture is decoration. */}
          <img src={image.url} alt="" draggable={false} className="h-6 w-8 shrink-0 rounded-l-sm object-cover" />
          {t.image(i + 1)}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t.remove(t.image(i + 1))}
            onMouseDown={onMouseDown}
            onClick={() => onRemove(image)}
            className="size-4 rounded-sm text-dp-text-2 hover:bg-dp-hover hover:text-dp-text"
          >
            <X className="size-3" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
