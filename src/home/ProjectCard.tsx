import { useState } from "react";
import { Ellipsis, Folder } from "lucide-react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { messages, useMessages } from "@/i18n";
import { formatAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { projectsStore, type Project } from "@/store/projects";
import { homeMessages } from "./messages";

type Failure = "openFailed" | "renameFailed" | "changeFailed" | "removeFailed";

const fail = (what: Failure) => (error: unknown) => toast.error(messages(homeMessages).card[what](String(error)));

async function relocate(project: Project) {
  const picked = await open({ directory: true, defaultPath: project.path, title: messages(homeMessages).card.newFolder });
  if (typeof picked === "string") await projectsStore.getState().relocate(project.id, picked);
}

async function remove(project: Project) {
  const t = messages(homeMessages).card;
  const confirmed = await ask(t.removeConfirm(project.name), { title: t.removeTitle, kind: "warning", okLabel: t.removeOk, cancelLabel: t.cancel });
  if (confirmed) await projectsStore.getState().remove(project.id);
}

/** A project of the home screen (spec theme §5.1). */
export function ProjectCard({ project }: { project: Project }) {
  const t = useMessages(homeMessages).card;
  const [editing, setEditing] = useState(false);
  const openable = !project.missing && !editing;
  const openProject = () => {
    if (openable) void projectsStore.getState().open(project.id).catch(fail("openFailed"));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openProject}
      onKeyDown={(e) => e.key === "Enter" && openProject()}
      className={cn(
        "dp-glass-strong group rounded-lg p-4 transition-[color,background-color,border-color] duration-150 ease-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50",
        openable && "cursor-pointer hover:border-dp-accent/60 hover:bg-dp-hover",
      )}
    >
      <div className="mb-3 flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-dp-accent-soft text-dp-accent-ink">
          <Folder className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              autoFocus
              defaultValue={project.name}
              className="h-7"
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                void projectsStore.getState().rename(project.id, e.currentTarget.value).catch(fail("renameFailed"));
                setEditing(false);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <p className="truncate font-semibold text-dp-text">{project.name}</p>
          )}
          <p className="truncate font-mono text-[11px] text-dp-text-2" title={project.path}>
            {project.path}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t.actions}
              onClick={(e) => e.stopPropagation()}
              className="grid size-7 place-items-center rounded-full text-dp-text-2 opacity-0 transition-[color,background-color,opacity] duration-150 ease-out hover:bg-dp-hover hover:text-dp-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50 active:scale-[0.97] group-hover:opacity-100 motion-reduce:transition-none data-[state=open]:opacity-100 [&_svg]:size-4"
            >
              <Ellipsis />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            {!project.missing && <DropdownMenuItem onSelect={() => setEditing(true)}>{t.rename}</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => void relocate(project).catch(fail("changeFailed"))}>
              {t.changeFolder}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => void remove(project).catch(fail("removeFailed"))}>
              {t.removeFromList}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {project.missing ? (
        <p className="text-xs text-dp-danger">{t.missing}</p>
      ) : (
        <div className="flex items-center gap-3 font-mono text-[11px] text-dp-text-2">
          <span>{t.workspaces(project.workspaceCount)}</span>
          {project.liveAgents > 0 && (
            <span className="flex items-center gap-1 text-dp-ok">
              <span className="size-1.5 rounded-full bg-dp-ok" />
              {t.liveAgents(project.liveAgents)}
            </span>
          )}
          <span className="ml-auto">{formatAgo(project.lastOpenedAt)}</span>
        </div>
      )}
    </div>
  );
}
