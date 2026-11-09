import { ArrowDownCircle } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { installUpdate, updatesStore, useUpdates } from "@/app/updates";
import { messages, useMessages } from "@/i18n";
import { nodeNameOf, useNodes } from "@/store/nodes";
import { isRunning, terminalStatusStore } from "@/store/terminalStatus";
import { shellMessages } from "./messages";
import { ReleaseNotes } from "./ReleaseNotes";

const buttonBase =
  "rounded-md transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out motion-reduce:transition-none active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50";

/** "Version x available" in the title bar, once a check found one (spec première version §6.4). */
export function UpdateChip() {
  const t = useMessages(shellMessages).update;
  const available = useUpdates((s) => s.available);
  if (!available) return null;
  return (
    <button
      type="button"
      onClick={() => updatesStore.setState({ dialogOpen: true })}
      className="flex h-6 items-center gap-1 rounded-full bg-dp-accent-soft px-2 text-[11px] font-medium text-dp-accent transition-[filter,transform] duration-150 ease-out motion-reduce:transition-none hover:brightness-110 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50"
    >
      <ArrowDownCircle className="size-3.5" />
      {t.chip(available.version)}
    </button>
  );
}

/** What an update will stop, then download, save and install. */
export function UpdateDialog() {
  const t = useMessages(shellMessages).update;
  const { available, dialogOpen, progress } = useUpdates((s) => s);
  const nodes = useNodes((s) => s.nodes);
  useStore(terminalStatusStore, (s) => s.statuses);
  const running = Object.entries(nodes)
    .filter(([id]) => isRunning(id))
    .map(([, record]) => nodeNameOf(record) || ("title" in record.payload ? record.payload.title : "") || "Agent");
  const close = () => updatesStore.setState({ dialogOpen: false });
  const busy = progress !== null;
  const install = () =>
    void installUpdate().catch((error: unknown) => {
      updatesStore.setState({ progress: null });
      toast.error(messages(shellMessages).update.failed, { description: error instanceof Error ? error.message : String(error) });
    });

  return (
    <Dialog open={dialogOpen && available !== null} onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent showCloseButton={false} className="rounded-xl bg-dp-surface text-dp-text ring-dp-line sm:max-w-md">
        <DialogHeader>
          <DialogTitle>dummyPlane {available?.version}</DialogTitle>
          <DialogDescription className="text-dp-text-2">
            {running.length > 0 ? t.willStop(running) : t.willClose}
          </DialogDescription>
        </DialogHeader>
        {available?.notes && <ReleaseNotes notes={available.notes} />}
        <DialogFooter className="border-dp-line bg-dp-hover">
          <Button
            variant="ghost"
            onClick={close}
            disabled={busy}
            className={cn(buttonBase, "text-dp-text-2 hover:bg-dp-hover hover:text-dp-text")}
          >
            {t.later}
          </Button>
          <Button
            onClick={install}
            disabled={busy}
            className={cn(buttonBase, "bg-dp-accent text-dp-on-accent hover:brightness-110")}
          >
            {busy ? t.downloading(Math.round((progress ?? 0) * 100)) : t.install}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
