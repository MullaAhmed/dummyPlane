import { useId, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, FolderOpen } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { messages, useMessages } from "@/i18n";
import type { ShellKind } from "@/ipc/pty";
import { SHELL_LABELS } from "@/nodes/terminal/launch";
import type { LaunchOptions } from "./launchAgent";
import { fleetMessages } from "./messages";

// dp-label sits in the components layer: Label's own text-sm would win over its 12 px, so the size is said again.
const LABEL = "dp-label text-xs";

/** Folder, shell and title of the next launch (spec theme §10.1), and the command of a Custom one. */
export function LaunchOptionsForm(props: {
  value: LaunchOptions;
  shells: ShellKind[];
  onChange: (value: LaunchOptions) => void;
  /** Only a Custom terminal runs its command (pty `agent_command`): every other agent ignores it, so the field is not shown for them. */
  showCommand: boolean;
  onBack?: () => void;
  /** The back button's label, which names the view. */
  title?: string;
  footer?: ReactNode;
  className?: string;
}) {
  const { value, shells, onChange, showCommand, onBack, title, footer, className } = props;
  const t = useMessages(fleetMessages).options;
  const id = useId();
  const set = (patch: Partial<LaunchOptions>) => onChange({ ...value, ...patch });
  const browse = async () => {
    const picked = await open({ directory: true, defaultPath: value.cwd || undefined, title: messages(fleetMessages).options.workingFolder });
    if (typeof picked === "string") set({ cwd: picked });
  };

  return (
    <div className={cn("grid gap-3", className)}>
      {onBack && (
        <Button type="button" variant="ghost" size="xs" onClick={onBack} className="-ml-2 justify-self-start text-dp-text-2 hover:text-dp-text">
          <ArrowLeft className="size-3.5" /> {title ?? t.title}
        </Button>
      )}
      {/* What a Custom terminal is for comes first; the rest only says where and how it runs. */}
      {showCommand && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-command`} className={LABEL}>
            {t.command}
          </Label>
          <Input
            id={`${id}-command`}
            autoFocus
            value={value.command}
            onChange={(e) => set({ command: e.target.value })}
            placeholder="npm run dev"
            spellCheck={false}
            autoComplete="off"
            aria-describedby={`${id}-command-hint`}
            className="h-8 font-mono text-xs"
          />
          <p id={`${id}-command-hint`} className="text-xs text-dp-text-2">
            {t.commandHint}
          </p>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-folder`} className={LABEL}>
          {t.folder}
        </Label>
        <div className="flex gap-1.5">
          <Input
            id={`${id}-folder`}
            value={value.cwd}
            onChange={(e) => set({ cwd: e.target.value })}
            spellCheck={false}
            autoComplete="off"
            className="h-8 font-mono text-xs"
          />
          <Button type="button" variant="outline" size="icon" aria-label={t.browse} title={t.browse} onClick={() => void browse()}>
            <FolderOpen />
          </Button>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-shell`} className={LABEL}>
          {t.shell}
        </Label>
        <Select value={value.shell} onValueChange={(shell) => set({ shell: shell as ShellKind })}>
          <SelectTrigger id={`${id}-shell`} className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {shells.map((shell) => (
              <SelectItem key={shell} value={shell}>
                {SHELL_LABELS[shell]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-title`} className={LABEL}>
          {t.titleField}
        </Label>
        <Input id={`${id}-title`} value={value.title} onChange={(e) => set({ title: e.target.value })} placeholder={t.automatic} autoComplete="off" className="h-8" />
      </div>
      {footer}
    </div>
  );
}
