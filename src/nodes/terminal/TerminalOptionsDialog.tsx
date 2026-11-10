import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAgents } from "@/fleet/agentsStore";
import { LaunchOptionsForm } from "@/fleet/LaunchOptionsForm";
import type { LaunchOptions } from "@/fleet/launchAgent";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { useMessages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";

/** Folder, shell and title of one terminal, and the command of a Custom one, used at its next launch. */
export function TerminalOptionsDialog(props: { nodeId: string; payload: TerminalPayload; onClose: () => void }) {
  const { nodeId, payload, onClose } = props;
  const t = useMessages(nodesMessages).options;
  const shells = useAgents((s) => s.shells);
  // Every other agent ignores the command: it is neither shown nor written for them, so a stored one stays as it was.
  const custom = payload.agent === "custom";
  const [value, setValue] = useState<LaunchOptions>({
    cwd: payload.cwd,
    shell: payload.shell,
    title: payload.title,
    command: payload.command,
  });

  const apply = (event: FormEvent) => {
    event.preventDefault();
    nodesStore.getState().update(nodeId, {
      cwd: value.cwd.trim() || payload.cwd,
      shell: value.shell,
      title: value.title.trim() || payload.title,
      ...(custom ? { command: value.command.trim() } : {}),
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.title(payload.name || t.thisTerminal)}</DialogTitle>
        </DialogHeader>
        {/* A form, so Enter in a field applies like the button. */}
        <form onSubmit={apply} className="grid gap-4">
          <LaunchOptionsForm value={value} shells={shells.length ? shells : [payload.shell]} showCommand={custom} onChange={setValue} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit">{t.apply}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
