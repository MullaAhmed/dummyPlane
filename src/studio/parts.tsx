import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import type { FileSession, SessionState } from "./fileSession";
import { studioMessages } from "./messages";

/** The dialog's own classes center a small box; a studio fills the window, 16 px from its edges. */
export const FULL_WINDOW: ComponentProps<typeof DialogContent>["style"] = {
  display: "flex",
  flexDirection: "column",
  gap: 0,
  padding: 0,
  top: 16,
  left: 16,
  right: 16,
  bottom: 16,
  width: "auto",
  maxWidth: "none",
  translate: "none",
  overflow: "hidden",
};

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The Input of a panel's bar (the file filter, the notes' search): shadcn's Input at h-7. */
export const BAR_FIELD = "h-7 px-2 text-xs";

/** A pane with nothing to show (no file picked, still reading): centred in what is left. */
export function Message({ children }: { children: ReactNode }) {
  return <p className="grid flex-1 place-items-center p-6 text-center text-xs text-dp-text-2">{children}</p>;
}

/** The same inside a list (the tree, the notes): a line among the rows, not a pane. */
export function ListMessage({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <p className={cn("px-3 py-4 text-center text-xs", danger ? "text-dp-danger" : "text-dp-text-2")}>{children}</p>;
}

/** The disk no longer holds what the buffer knows: only the user decides. */
export function DiskBanner({ session, disk, onDrop }: { session: FileSession; disk: NonNullable<SessionState["disk"]>; onDrop?: () => void }) {
  const t = useMessages(studioMessages);
  const { reload, overwrite, dropFile } = session.getState();
  const gone = disk.version === null;
  return (
    <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-dp-line bg-dp-wait/16 px-3 py-1 text-xs text-dp-text">
      <span className="min-w-0 flex-1">{gone ? t.deletedOnDisk : t.changedOnDisk}</span>
      {gone ? (
        <>
          <Button variant="ghost" size="xs" onClick={onDrop ?? dropFile}>
            {t.drop}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => void overwrite()}>
            {t.recreate}
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" size="xs" onClick={() => void reload()}>
            {t.reload}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => void overwrite()}>
            {t.overwrite}
          </Button>
        </>
      )}
    </div>
  );
}
