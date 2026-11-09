import { open } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, FolderOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { messages, useMessages } from "@/i18n";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ShellKind } from "@/ipc/pty";
import { SHELL_LABELS } from "@/nodes/terminal/launch";
import type { LaunchOptions } from "./launchAgent";
import { fleetMessages } from "./messages";

/** Folder, shell, title and custom command of the next agents (spec theme §10.1). */
export function LaunchOptionsForm(props: {
  value: LaunchOptions;
  shells: ShellKind[];
  onChange: (value: LaunchOptions) => void;
  onBack?: () => void;
  footer?: React.ReactNode;
}) {
  const { value, shells, onChange, onBack, footer } = props;
  const t = useMessages(fleetMessages).options;
  const set = (patch: Partial<LaunchOptions>) => onChange({ ...value, ...patch });
  const browse = async () => {
    const picked = await open({ directory: true, defaultPath: value.cwd || undefined, title: messages(fleetMessages).options.workingFolder });
    if (typeof picked === "string") set({ cwd: picked });
  };

  return (
    <div className="grid gap-3 p-1">
      {onBack && (
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs text-ov-text-2 hover:text-ov-text">
          <ArrowLeft className="size-3.5" /> {t.title}
        </button>
      )}
      <div className="grid gap-1.5">
        <Label className="ov-label">{t.folder}</Label>
        <div className="flex gap-1.5">
          <Input value={value.cwd} onChange={(e) => set({ cwd: e.target.value })} className="h-8 font-mono text-xs" />
          <button
            type="button"
            aria-label={t.browse}
            onClick={() => void browse()}
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-ov-line bg-ov-card hover:bg-ov-hover"
          >
            <FolderOpen className="size-4" />
          </button>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label className="ov-label">{t.shell}</Label>
        <Select value={value.shell} onValueChange={(shell) => set({ shell: shell as ShellKind })}>
          <SelectTrigger className="h-8 w-full">
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
        <Label className="ov-label">{t.titleField}</Label>
        <Input value={value.title} onChange={(e) => set({ title: e.target.value })} placeholder={t.automatic} className="h-8" />
      </div>
      <div className="grid gap-1.5">
        <Label className="ov-label">{t.customCommand}</Label>
        <Input
          value={value.command}
          onChange={(e) => set({ command: e.target.value })}
          placeholder="npm run dev"
          className="h-8 font-mono text-xs"
        />
      </div>
      {footer}
    </div>
  );
}
