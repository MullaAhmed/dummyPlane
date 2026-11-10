import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    // A field in look, a button in kind: it opens the palette, whose input takes the typing.
    <Button
      variant="outline"
      // The keyboard stays where it is: it goes back there when the palette closes.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => openPalette("goTo", commandContext())}
      className="h-7 w-[440px] min-w-0 max-w-[min(34vw,100%)] justify-start gap-2 rounded-md border-dp-line bg-dp-field px-3 text-xs font-normal text-dp-text-3 hover:bg-dp-hover hover:text-dp-text-2 active:scale-100"
    >
      <Search />
      <span className="truncate">{home ? t.project : t.inProject(name)}</span>
      <kbd className="ml-auto shrink-0 rounded-sm border border-dp-line px-1 font-mono text-xs leading-4 text-dp-text-3">Ctrl+P</kbd>
    </Button>
  );
}
