import { useState } from "react";
import { Code2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useUiRequest } from "@/commands/uiRequests";
import { messages, useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { useRunningCount } from "@/store/running";
import { canRemove as removable, isCode, useWorkspaces, workspacesStore, type Workspace } from "@/store/workspaces";
import { IconButton } from "./buttons";
import { TABS_HEIGHT } from "./layout";
import { shellMessages } from "./messages";
import { removeWorkspace } from "./workspaceActions";

type Failure = "renameFailed" | "deleteFailed" | "createFailed";

const fail = (what: Failure) => (error: unknown) => {
  const t = messages(shellMessages);
  toast.error(t.failed(t.tabs[what], String(error)));
};

/** The tab being dragged (a drag stays inside this row). */
let dragged: string | null = null;

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50";
const PRESS = "transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out motion-reduce:transition-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

function WorkspaceTab(props: { workspace: Workspace; active: boolean; canRemove: boolean; index: number; count: number }) {
  const { workspace, active, canRemove, index, count } = props;
  const t = useMessages(shellMessages).tabs;
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const running = useRunningCount([workspace.id]);
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
        "group relative top-px flex h-8 shrink-0 items-center rounded-t-md border border-b-0 pl-3 pr-1 text-[13px] transition-[color,background-color,border-color] duration-150 ease-out motion-reduce:transition-none",
        active
          ? "border-[color:var(--dp-glass-line)] bg-dp-tab-on text-dp-text before:absolute before:inset-x-2.5 before:-top-px before:h-0.5 before:rounded-full before:bg-dp-accent"
          : "border-transparent text-dp-text-2 hover:bg-dp-hover hover:text-dp-text",
      )}
    >
      {/* The whole tab selects, padding and badge included, like a browser tab. */}
      <button
        type="button"
        className={cn("flex items-center self-stretch rounded-md", PRESS, FOCUS)}
        onClick={() => workspacesStore.getState().select(workspace.id)}
        onDoubleClick={() => setEditing(true)}
        // Alt+←/→: the keyboard's way to reorder (the drag's alternative).
        onKeyDown={(e) => {
          if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
          e.preventDefault();
          void workspacesStore.getState().move(workspace.id, index + (e.key === "ArrowLeft" ? -1 : 1));
        }}
      >
        {isCode(workspace) && <Code2 data-code-icon aria-hidden className="mr-1.5 size-3.5 shrink-0 text-dp-accent-ink" />}
        <span className="max-w-40 truncate">{workspace.name}</span>
        {(active || running > 0) && (
          <span
            data-badge
            title={t.activeAgents(running)}
            className={cn(
              "ml-2 rounded-full px-1.5 font-mono text-[11px]",
              active ? "bg-dp-accent-soft text-dp-accent-ink" : "bg-dp-field text-dp-text-2",
            )}
          >
            {running}
          </span>
        )}
      </button>
      {canRemove && (
        <button
          type="button"
          aria-label={t.deleteWorkspace}
          title={t.deleteWorkspace}
          onClick={() => void removeWorkspace(workspace, running).catch(fail("deleteFailed"))}
          className={cn(
            "ml-1 grid size-5 place-items-center rounded-md text-dp-text-2 opacity-0 transition-[color,background-color,opacity,transform] duration-150 ease-out motion-reduce:transition-none group-hover:opacity-100 hover:bg-dp-hover hover:text-dp-text focus-visible:opacity-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dp-accent/50",
          )}
        >
          <X className="size-3.5" />
        </button>
      )}
      {/* The context menu (right click) anchors on the tab itself. */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <span aria-hidden className="pointer-events-none absolute inset-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setEditing(true)}>{t.rename}</DropdownMenuItem>
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
          active={workspace.id === activeId}
          canRemove={removable(workspaces, workspace)}
        />
      ))}
      <IconButton
        label={t.newWorkspace}
        className={cn("mb-0.5 size-7 rounded-md", PRESS, FOCUS)}
        onClick={() => void workspacesStore.getState().create().catch(fail("createFailed"))}
      >
        <Plus />
      </IconButton>
      <div data-tauri-drag-region="" className="h-full min-w-6 flex-1" />
    </div>
  );
}
