import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Project } from "@/ipc/db";
import { projectsStore, type ProjectsView } from "@/store/projects";

/** The window's title: the taskbar and Alt+Tab name the open project. */
export function titleFor(view: ProjectsView, projects: readonly Project[], activeId: string | null): string {
  const project = view === "project" ? projects.find((p) => p.id === activeId) : undefined;
  return project ? `dummyPlane — ${project.name}` : "dummyPlane";
}

/** Keeps the window title on the project shown; returns the function that stops it. */
export function syncWindowTitle(): () => void {
  let shown: string | null = null;
  const apply = () => {
    const { view, projects, activeId } = projectsStore.getState();
    const title = titleFor(view, projects, activeId);
    if (title === shown) return;
    shown = title;
    document.title = title;
    // A title that fails to change is only cosmetic: no toast.
    void getCurrentWindow()
      .setTitle(title)
      .catch((error: unknown) => console.warn(`window title: ${String(error)}`));
  };
  apply();
  return projectsStore.subscribe(apply);
}
