import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { AccentButton } from "@/shell/buttons";
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

/**
 * Where a tab's close question lies: under the tab strip, over the file's own bar (path, Save) and its disk question,
 * so the code under the pointer never moves down to make room for it. The parent holding the strip is `relative`.
 */
export const OVER_THE_FILE = "absolute inset-x-0 top-full z-10";

/**
 * The one form of a decision about an open file: the disk moved under its changes, or a tab with unsaved changes is
 * closing. One line on the panel's surface, the question first, then its answers in the dialogs' order: the one that
 * dismisses (when there is one), the one that loses something (destructive), the one that keeps it (the accent), all
 * at `sm`. In the flow under the tab strip, or over it there (`OVER_THE_FILE`): one question shows at a time.
 */
export function DecisionBar({ question, className, children }: { question: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div role="alert" data-decision-bar className={cn("flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-dp-line bg-dp-surface px-3 py-1 text-sm text-dp-text", className)}>
      <span className="mr-auto min-w-0">{question}</span>
      {children}
    </div>
  );
}

/**
 * The disk no longer holds what the buffer knows: only the user decides, in the decision bar. The buttons say what each
 * one costs: the one that drops the buffer is destructive, the one that writes it the accent.
 */
export function DiskBanner({ session, disk, onDrop, className }: { session: FileSession; disk: NonNullable<SessionState["disk"]>; onDrop?: () => void; className?: string }) {
  const t = useMessages(studioMessages);
  const { reload, overwrite, dropFile } = session.getState();
  const gone = disk.version === null;
  return (
    <DecisionBar question={gone ? t.deletedOnDisk : t.changedOnDisk} className={className}>
      <Button variant="destructive" size="sm" onClick={gone ? (onDrop ?? dropFile) : () => void reload()}>
        {gone ? t.drop : t.reload}
      </Button>
      <AccentButton size="sm" onClick={() => void overwrite()}>
        {gone ? t.recreate : t.overwrite}
      </AccentButton>
    </DecisionBar>
  );
}
