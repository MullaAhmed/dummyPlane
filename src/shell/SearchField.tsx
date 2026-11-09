import { Search } from "lucide-react";
import { openPalette } from "@/commands/paletteState";
import { commandContext } from "@/commands/registry";
import { useMessages } from "@/i18n";
import { useProjects } from "@/store/projects";
import { shellMessages } from "./messages";

/**
 * "⌕ Search in <project>   Ctrl+P" at the center of a project's title
 * bar, « Rechercher un projet » at home (spec identité §5.1, §5.9): it opens "Go to".
 */
export function SearchField() {
  const t = useMessages(shellMessages).searchField;
  const home = useProjects((s) => s.view !== "project");
  const name = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.name ?? "");
  return (
    <button
      type="button"
      // The keyboard stays where it is: it goes back there when the palette closes.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => openPalette("goTo", commandContext())}
      className="flex h-6.5 w-[440px] min-w-0 max-w-[min(34vw,100%)] items-center gap-2 rounded-md border border-[color:var(--dp-glass-line)] bg-dp-field px-2.5 text-xs text-dp-text-3 transition-[color,background-color,border-color,transform] duration-150 ease-out hover:bg-dp-hover hover:text-dp-text-2 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 motion-reduce:transition-none"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="truncate">{home ? t.project : t.inProject(name)}</span>
      <span className="ml-auto shrink-0 font-mono text-[11px]">Ctrl+P</span>
    </button>
  );
}
