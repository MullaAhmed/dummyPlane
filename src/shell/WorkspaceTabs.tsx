import { useState } from "react";
import { Code2, Folder, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useUiRequest } from "@/commands/uiRequests";
import { folderName, launchFolderStore, pickFolder } from "@/agents/launchFolder";
import { messages, useMessages } from "@/i18n";
import { errorText } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useProjects } from "@/store/projects";
import { useRunningCount } from "@/store/running";
import { ownFolder } from "@/store/workspaceFolder";
import { canRemove as removable, isCode, useWorkspaces, workspacesStore, type Workspace } from "@/store/workspaces";
import { HintedButton, IconButton } from "./buttons";
import { TABS_HEIGHT } from "./layout";
import { shellMessages } from "./messages";
import { removeWorkspace } from "./workspaceActions";

type Failure = "renameFailed" | "deleteFailed" | "createFailed" | "folderFailed";

const fail = (what: Failure) => (error: unknown) => {
  const t = messages(shellMessages);
  toast.error(t.failed(t.tabs[what], errorText(error)));
};

/** The tab being dragged (a drag stays inside this row). */
let dragged: string | null = null;

function WorkspaceTab(props: { workspace: Workspace; projectFolder: string; active: boolean; canRemove: boolean; index: number; count: number }) {
  const { workspace, projectFolder, active, canRemove, index, count } = props;
  const t = useMessages(shellMessages).tabs;
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const running = useRunningCount([workspace.id]);
  // The folder it picked is shown after its name; the project's own is only in the hint.
  const own = ownFolder(workspace);
  const folder = own ?? projectFolder;
  const chooseFolder = async () => {
    const picked = await pickFolder(folder);
    if (picked) await launchFolderStore.getState().choose(picked, workspace.id);
  };
  // "Rename the workspace" of the palette.
  useUiRequest("renameWorkspace", (request) => {
    if (request.id !== workspace.id) return false;
    setEditing(true);
    return true;
  });

  if (editing) {
    return (
      <Input
        autoFocus
        defaultValue={workspace.name}
        className="mb-0.5 h-8 w-40 rounded-md"
        onBlur={(e) => {
          void workspacesStore.getState().rename(workspace.id, e.currentTarget.value).catch(fail("renameFailed"));
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <div
      data-tab={workspace.id}
      data-active={active}
      draggable
      onDragStart={(e) => {
        dragged = workspace.id;
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (dragged && dragged !== workspace.id) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (dragged && dragged !== workspace.id) void workspacesStore.getState().move(dragged, index);
        dragged = null;
      }}
      onDragEnd={() => (dragged = null)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      className={cn(
        "group relative top-px flex h-8 shrink-0 items-center rounded-t-md border border-b-0 pl-3 pr-1 text-(length:--text-ui) transition-[color,background-color,border-color] duration-(--dp-dur-fast) ease-(--dp-ease-out) motion-reduce:transition-none",
        active
          ? "border-dp-line bg-dp-tab-on text-dp-text before:absolute before:inset-x-2.5 before:-top-px before:h-0.5 before:rounded-full before:bg-dp-accent"
          : "border-transparent text-dp-text-2 hover:bg-dp-hover hover:text-dp-text",
      )}
    >
      {/*
        The whole tab selects, padding and badge included, like a browser tab. A
        document tab, not a Tabs trigger: it closes, drags and moves on Alt+arrows,
        which Radix's own arrow keys would fight. The tab draws its states itself.
      */}
      <HintedButton
        hint={
          <span className="flex flex-col">
            <span>{workspace.name}</span>
            {folder && <span className="break-all font-mono opacity-70">{folder}</span>}
            {/* The count's own hint, in the tab's: a native title on the badge would stack on it. */}
            {running > 0 && <span className="opacity-70">{t.activeAgents(running)}</span>}
          </span>
        }
        variant="ghost"
        // No press scale: a tab selects like a browser tab, inside a frame that does not move.
        className="h-auto gap-0 self-stretch rounded-md px-0 text-(length:--text-ui) font-normal text-inherit hover:bg-transparent hover:text-inherit active:scale-100"
        onClick={() => workspacesStore.getState().select(workspace.id)}
        onDoubleClick={() => setEditing(true)}
        // Alt+←/→: the keyboard's way to reorder (the drag's alternative).
        onKeyDown={(e) => {
          if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
          e.preventDefault();
          void workspacesStore.getState().move(workspace.id, index + (e.key === "ArrowLeft" ? -1 : 1));
        }}
      >
        {isCode(workspace) && <Code2 data-code-icon aria-hidden className="mr-2 size-4 shrink-0 text-dp-text-2" />}
        <span className="max-w-40 truncate">{workspace.name}</span>
        {own && (
          <span data-tab-folder className="ml-2 flex max-w-24 items-center gap-1 text-xs text-dp-text-3">
            <Folder aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{folderName(own)}</span>
          </span>
        )}
        {(active || running > 0) && (
          // A count is quiet text, not a pill: mono, tabular, a step under the name.
          <span
            data-badge
            className={cn("ml-2 font-mono text-xs tabular-nums", active ? "text-dp-text-2" : "text-dp-text-3")}
          >
            {running}
          </span>
        )}
      </HintedButton>
      {canRemove && (
        <IconButton
          label={t.deleteWorkspace}
          onClick={() => void removeWorkspace(workspace, running).catch(fail("deleteFailed"))}
          className="ml-1 size-6 opacity-0 transition-[color,background-color,opacity,scale] group-hover:opacity-100 focus-visible:opacity-100 focus-visible:transition-none [&_svg:not([class*='size-'])]:size-3.5"
        >
          <X />
        </IconButton>
      )}
      {/* The context menu (right click) anchors on the tab itself. */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <span aria-hidden className="pointer-events-none absolute inset-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setEditing(true)}>{t.rename}</DropdownMenuItem>
          {/* The code workspace stays on the project: no folder of its own. */}
          {!isCode(workspace) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void chooseFolder().catch(fail("folderFailed"))}>
                {t.folder}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={own === null}
                onSelect={() => void launchFolderStore.getState().useProjectFolder(workspace.id).catch(fail("folderFailed"))}
              >
                {t.useProjectFolder}
              </DropdownMenuItem>
              <DropdownMenuLabel className="max-w-56 whitespace-normal font-normal normal-case tracking-normal">{t.folderNote}</DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem disabled={index === 0} onSelect={() => void workspacesStore.getState().move(workspace.id, index - 1)}>
            {t.moveLeft}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === count - 1} onSelect={() => void workspacesStore.getState().move(workspace.id, index + 1)}>
            {t.moveRight}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canRemove}
            variant="destructive"
            onSelect={() => void removeWorkspace(workspace, running).catch(fail("deleteFailed"))}
          >
            {t.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Workspace tabs of the open project, then "+", then the empty space that
 * moves the window (spec identité §5.2). The row scrolls sideways, by the
 * wheel, without a scrollbar: it must not drag itself, or a press on it would
 * move the window instead of scrolling.
 */
export function WorkspaceTabs() {
  const t = useMessages(shellMessages).tabs;
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  const projectFolder = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.path ?? "");
  return (
    <div
      onWheel={(e) => {
        if (e.deltaX === 0) e.currentTarget.scrollLeft += e.deltaY;
      }}
      className="dp-glass-strong flex w-full items-end gap-0.5 overflow-x-auto overflow-y-hidden rounded-none border-x-0 border-t-0 px-2.5 [scrollbar-width:none]"
      style={{ height: TABS_HEIGHT }}
    >
      {workspaces.map((workspace, index) => (
        <WorkspaceTab
          key={workspace.id}
          index={index}
          count={workspaces.length}
          workspace={workspace}
          projectFolder={projectFolder}
          active={workspace.id === activeId}
          canRemove={removable(workspaces, workspace)}
        />
      ))}
      <IconButton
        label={t.newWorkspace}
        className="mb-0.5 size-7"
        onClick={() => void workspacesStore.getState().create().catch(fail("createFailed"))}
      >
        <Plus />
      </IconButton>
      <div data-tauri-drag-region="" className="h-full min-w-6 flex-1" />
    </div>
  );
}
