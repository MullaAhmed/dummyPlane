import { Check, ChevronDown, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toastError } from "@/lib/errorToast";
import { useMessages } from "@/i18n";
import { projectsStore, useProjects } from "@/store/projects";
import { shellMessages } from "./messages";

/** "mk-webapp ⌄" in the title bar: recent projects, the home screen, closing the project. */
export function ProjectPicker() {
  const t = useMessages(shellMessages).projectPicker;
  const projects = useProjects((s) => s.projects);
  const activeId = useProjects((s) => s.activeId);
  const active = projects.find((p) => p.id === activeId);
  const recent = [...projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 8);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 rounded-md px-2 text-(length:--text-ui) font-medium">
          <span className="max-w-48 truncate">{active?.name ?? t.project}</span>
          <ChevronDown className="text-dp-text-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {recent.map((project) => (
          <DropdownMenuItem
            key={project.id}
            disabled={project.missing}
            onSelect={() => {
              if (project.id === activeId) return;
              void projectsStore.getState().open(project.id).catch((error: unknown) => toastError(t.openFailed, { error }));
            }}
          >
            <Folder />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{project.name}</span>
              <span data-path className="truncate font-mono text-xs text-dp-text-3">
                {project.path}
              </span>
            </span>
            {project.id === activeId && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => projectsStore.getState().goHome()}>{t.allProjects}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void projectsStore.getState().close()}>{t.closeProject}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
