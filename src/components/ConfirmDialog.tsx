import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AccentButton, QuietButton } from "@/shell/buttons";
import { answerConfirm, usePendingConfirm } from "./confirm";

/**
 * The question `confirmAction` asks, built like the close dialogs
 * (shell/CloseGroupDialog.tsx): Cancel first, so the keyboard starts on the
 * safe answer, and a destructive action in the danger tone.
 */
export function ConfirmDialog() {
  const pending = usePendingConfirm();
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && answerConfirm(false)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{pending?.title}</DialogTitle>
          <DialogDescription>{pending?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <QuietButton onClick={() => answerConfirm(false)}>{pending?.cancel}</QuietButton>
          {pending?.destructive ? (
            <Button variant="destructive" size="lg" onClick={() => answerConfirm(true)}>
              {pending.confirm}
            </Button>
          ) : (
            <AccentButton size="lg" onClick={() => answerConfirm(true)}>
              {pending?.confirm}
            </AccentButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
