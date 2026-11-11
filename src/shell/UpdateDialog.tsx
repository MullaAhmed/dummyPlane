import { CircleArrowDown } from "lucide-react";
import { toastError } from "@/lib/errorToast";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { AccentButton, QuietButton } from "./buttons";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { installUpdate, updatesStore, useUpdates } from "@/app/updates";
import { messages, useMessages } from "@/i18n";
import { nodeNameOf, useNodes } from "@/store/nodes";
import { isRunning, terminalStatusStore } from "@/store/terminalStatus";
import { shellMessages } from "./messages";
import { ReleaseNotes } from "./ReleaseNotes";

/** "Version x available" in the title bar, once a check found one (spec première version §6.4): accent text, no pill. */
export function UpdateChip() {
  const t = useMessages(shellMessages).update;
  const available = useUpdates((s) => s.available);
  if (!available) return null;
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={() => updatesStore.setState({ dialogOpen: true })}
      className="gap-1.5 rounded-md px-2 font-normal text-dp-accent-ink hover:text-dp-accent-ink"
    >
      <CircleArrowDown />
      {t.chip(available.version)}
    </Button>
  );
}

/** What an update will stop, then download, save and install. */
export function UpdateDialog() {
  const all = useMessages(shellMessages);
  const t = all.update;
  const { available, dialogOpen, progress, step } = useUpdates((s) => s);
  const nodes = useNodes((s) => s.nodes);
  useStore(terminalStatusStore, (s) => s.statuses);
  const running = Object.entries(nodes)
    .filter(([id]) => isRunning(id))
    .map(([, record]) => nodeNameOf(record) || ("title" in record.payload ? record.payload.title : "") || all.fallbackAgent);
  const close = () => updatesStore.setState({ dialogOpen: false });
  const busy = progress !== null;
  const install = () =>
    void installUpdate().catch((error: unknown) => {
      updatesStore.setState({ progress: null, step: null });
      toastError(messages(shellMessages).update.failed, { error });
    });

  return (
    <Dialog open={dialogOpen && available !== null} onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>dummyPlane {available?.version}</DialogTitle>
          <DialogDescription>{running.length > 0 ? t.willStop(running) : t.willClose}</DialogDescription>
        </DialogHeader>
        {available?.notes && <ReleaseNotes notes={available.notes} />}
        {/* The button's label shows the figure; this says the stage once, for a screen reader. Mounted while empty. */}
        <p role="status" data-update-status className="sr-only">
          {step?.kind === "downloading" ? t.downloadingStatus : step?.kind === "installing" ? t.installingStatus : ""}
        </p>
        <DialogFooter>
          <QuietButton onClick={close} disabled={busy}>
            {t.later}
          </QuietButton>
          <AccentButton size="lg" onClick={install} disabled={busy} className="tabular-nums">
            {!busy
              ? t.install
              : step?.kind === "installing"
                ? t.installing
                : t.downloading(step?.kind === "downloading" && step.share !== null ? Math.round(step.share * 100) : null)}
          </AccentButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
