import { useState } from "react";
import { createStore, useStore } from "zustand";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n";
import { TITLE_BAR_HEIGHT } from "@/shell/layout";
import { projectsStore } from "@/store/projects";
import { isCode, useWorkspaces, workspacesStore } from "@/store/workspaces";
import { parseLineTarget } from "./fileSearch";
import { studioMessages } from "./messages";
import { studioStore } from "./studioStore";

/** Ctrl+G's field, and where the keyboard goes back when it closes. */
const goToLineStore = createStore<{ open: boolean; returnFocus: HTMLElement | null }>()(() => ({ open: false, returnFocus: null }));

/** The workspace on screen is a Code workspace (it has no canvas: the command context does not tell it). */
export function inCodeWorkspace(): boolean {
  const { workspaces, activeId } = workspacesStore.getState();
  return projectsStore.getState().view === "project" && isCode(workspaces.find((w) => w.id === activeId));
}

export function openGoToLine() {
  const active = document.activeElement;
  goToLineStore.setState({ open: true, returnFocus: active instanceof HTMLElement ? active : null });
}

function closeGoToLine(restore: boolean) {
  const { returnFocus } = goToLineStore.getState();
  goToLineStore.setState({ open: false, returnFocus: null });
  if (restore && returnFocus?.isConnected) returnFocus.focus();
}

/** Puts the active file's cursor at `42` or `42:7`; false when the text is not a line or no file is open. */
export function goToLine(input: string): boolean {
  const target = parseLineTarget(input);
  const { active } = studioStore.getState();
  if (!target || !active) return false;
  studioStore.setState({ pendingLine: { path: active, ...target } });
  return true;
}

/** "Go to line" (Ctrl+G), under the title bar like the palette; rendered only while open. */
export function GoToLine() {
  const open = useStore(goToLineStore, (s) => s.open);
  // A workspace left for another closes it.
  const activeId = useWorkspaces((s) => s.activeId);
  return open ? <GoToLineField key={activeId} /> : null;
}

function GoToLineField() {
  const t = useMessages(studioMessages);
  const [text, setText] = useState("");
  const invalid = text.trim() !== "" && parseLineTarget(text) === null;
  return (
    <div data-goto-line className="fixed inset-0 z-50" onPointerDown={(e) => e.target === e.currentTarget && closeGoToLine(true)}>
      <form
        className="dp-glass-strong absolute left-1/2 -translate-x-1/2 overflow-hidden rounded-lg"
        style={{ top: TITLE_BAR_HEIGHT + 6, width: "min(320px, calc(100vw - 32px))", boxShadow: "var(--dp-shadow)" }}
        onSubmit={(e) => {
          e.preventDefault();
          // The editor takes the keyboard when it reaches the line.
          if (goToLine(text)) closeGoToLine(false);
        }}
      >
        <Input
          autoFocus
          aria-label={t.goToLine}
          aria-invalid={invalid}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closeGoToLine(true);
            }
          }}
          placeholder={t.goToLinePlaceholder}
          // The window is the field's frame, as in the palette: no border of its own, its ring inside.
          className="h-10 rounded-none border-0 px-4 text-sm focus-visible:ring-inset aria-invalid:ring-inset md:text-sm"
        />
        {invalid && <div className="border-t border-dp-line px-4 py-2 text-xs text-dp-text-2">{t.goToLineInvalid}</div>}
      </form>
    </div>
  );
}
