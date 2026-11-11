import { useId, useRef, useState } from "react";
import { Ellipsis, Folder } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { toastError } from "@/lib/errorToast";
import { confirmAction } from "@/components/confirm";
import { Button } from "@/components/ui/button";
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

const fail = (what: Failure) => (error: unknown) => toastError(messages(homeMessages).card[what], { error });

async function relocate(project: Project) {
  const picked = await open({ directory: true, defaultPath: project.path, title: messages(homeMessages).card.newFolder });
  if (typeof picked === "string") await projectsStore.getState().relocate(project.id, picked);
}

async function remove(project: Project) {
  const t = messages(homeMessages).card;
  const confirmed = await confirmAction({ title: t.removeTitle(project.name), description: t.removeConfirm, confirm: t.removeOk, cancel: t.cancel, destructive: true });
  if (confirmed) await projectsStore.getState().remove(project.id);
}

/** A project of the home screen (spec theme §5.1). */
export function ProjectCard({ project }: { project: Project }) {
  const t = useMessages(homeMessages).card;
  const [editing, setEditing] = useState(false);
  const ids = useId();
  const renaming = useRef(false);
  const openable = !project.missing && !editing;
  const openProject = () => {
    if (openable) void projectsStore.getState().open(project.id).catch(fail("openFailed"));
  };

  return (
    // The card opens through its name, a real button stretched over it (its ::after): the actions menu and the
    // name field sit above that layer as its siblings, never inside a button, which could not hold them.
    <div
      data-project-card
      className={cn(
        "dp-glass-strong group relative rounded-xl p-5 transition-[color,background-color,border-color] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none",
        openable && "cursor-pointer hover:bg-dp-hover",
      )}
    >
      <div className="mb-3 flex items-start gap-3">
        {/* The folder in the secondary text role on a surface step: the accent stays for what is chosen. */}
        <div className="grid size-9 shrink-0 place-items-center rounded-md bg-dp-hover text-dp-text-2">
          <Folder className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <>
              <Input
                autoFocus
                aria-label={t.nameField}
                defaultValue={project.name}
                className="relative z-10 h-7"
                onBlur={(e) => {
                  void projectsStore.getState().rename(project.id, e.currentTarget.value).catch(fail("renameFailed"));
                  setEditing(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <p className="truncate font-mono text-xs text-dp-text-2">{project.path}</p>
            </>
          ) : (
            <button
              type="button"
              data-open-project
              onClick={openProject}
              // A missing folder: the card stays in the list, says why it does not open, and does nothing.
              aria-disabled={project.missing || undefined}
              aria-describedby={project.missing ? `${ids}-path ${ids}-missing` : `${ids}-path`}
              className={cn(
                "block w-full min-w-0 text-left outline-none",
                "after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-dp-accent/70",
                project.missing ? "cursor-default" : "cursor-pointer",
              )}
            >
              <span className="block truncate font-medium text-dp-text">{project.name}</span>
              {/* Above the stretched layer, so its full text shows on hover; a click on it still opens the project. */}
              <span id={`${ids}-path`} aria-hidden className="relative z-10 block truncate font-mono text-xs text-dp-text-2" title={project.path}>
                {project.path}
              </span>
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t.actions}
              className="relative z-10 -mr-1 -mt-1 text-dp-text-2 opacity-0 transition-[color,background-color,opacity,scale] hover:text-dp-text focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          {/* Rename gives the keyboard to the name field: focus coming back to ⋯ would blur it and end the rename. */}
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(e) => {
              if (renaming.current) e.preventDefault();
              renaming.current = false;
            }}
          >
            {!project.missing && (
              <DropdownMenuItem
                // After the menu has let the keyboard go: while its focus trap holds, the field would lose focus and close.
                onSelect={() => {
                  renaming.current = true;
                  requestAnimationFrame(() => setEditing(true));
                }}
              >
                {t.rename}
              </DropdownMenuItem>
            )}
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
        <p id={`${ids}-missing`} className="text-xs text-dp-danger">
          {t.missing}
        </p>
      ) : (
        <div className="flex items-center gap-3 font-mono text-xs tabular-nums text-dp-text-2">
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
