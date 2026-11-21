import { ArrowLeft, Check, GitBranch, SquareChevronRight, SquareTerminal, Terminal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import type { ShellKind } from "@/ipc/pty";
import { cn } from "@/lib/utils";
import { SHELL_LABELS } from "@/nodes/terminal/launch";
import { agentInk, AGENTS } from "./catalog";
import { BACK } from "./InstallPrompt";
import { agentsMessages } from "./messages";

/** A shell of the list: a full-width row, so no press scale. */
const ROW = "h-auto w-full justify-start gap-2.5 rounded-md border-0 px-2 py-1.5 text-left font-normal whitespace-normal active:scale-100";

/** What each shell is drawn with: PowerShell's prompt, cmd's window, Git's branch, a plain prompt for the Unix ones. */
const SHELL_ICONS: Record<ShellKind, LucideIcon> = {
  default: Terminal,
  powershell: SquareChevronRight,
  pwsh: SquareChevronRight,
  cmd: SquareTerminal,
  gitbash: GitBranch,
  wsl: Terminal,
};

/** A shell's icon, in the Shell agent's chip: the same as its row in the ＋ menu. */
export function ShellIcon({ shell, className }: { shell: ShellKind; className?: string }) {
  const Icon = SHELL_ICONS[shell];
  const tint = AGENTS.shell.tint;
  return (
    <span
      className={cn("grid size-7 shrink-0 place-items-center rounded-md", className)}
      style={{ backgroundColor: `color-mix(in srgb, ${tint} 18%, transparent)`, color: agentInk(tint) }}
    >
      <Icon className="size-4" />
    </span>
  );
}

/**
 * The ＋ menu's "Shell": the shells this machine has, one row each. `chosen` (the last one picked, else the
 * launch options' shell) has the check and the keyboard, so Enter opens it again.
 */
export function ShellPicker(props: { shells: readonly ShellKind[]; chosen: ShellKind; hint: string; onBack: () => void; onPick: (shell: ShellKind) => void }) {
  const { shells, chosen, hint, onBack, onPick } = props;
  const t = useMessages(agentsMessages).shellPicker;
  return (
    <div className="grid gap-2 p-1">
      <Button type="button" variant="ghost" size="xs" onClick={onBack} className={BACK}>
        <ArrowLeft className="size-3.5" /> {t.title}
      </Button>
      <div role="group" aria-label={t.title} className="grid gap-0.5">
        {shells.map((shell) => (
          <Button
            key={shell}
            type="button"
            variant="ghost"
            data-shell-pick={shell}
            // Focused on mount: the menu's own focus rule leaves a control a view focused itself.
            autoFocus={shell === chosen}
            onClick={() => onPick(shell)}
            className={ROW}
          >
            <ShellIcon shell={shell} />
            <span className="min-w-0 flex-1">
              <span className="block text-(length:--text-ui) font-medium text-dp-text">{SHELL_LABELS[shell]}</span>
              <span className="block text-xs text-dp-text-2">{t.hints[shell]}</span>
            </span>
            {shell === chosen && <Check className="size-3.5 text-dp-accent-ink" />}
          </Button>
        ))}
      </div>
      <p className="border-t border-dp-line px-2 pt-2 text-xs text-dp-text-2">{hint}</p>
    </div>
  );
}
