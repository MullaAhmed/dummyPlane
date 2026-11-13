import type { Project, Workspace } from "@/ipc/db";
import type { Plane } from "./store";

/** What the names are read from: the workspaces of the open project, which one it is, and every project. */
export interface PlaneSources {
  workspaces: readonly Workspace[];
  projectId: string | null;
  projects: readonly Project[];
}

/** The two names of a plane, as the panel shows them; null where the popup was about no project or workspace. */
export interface PlaneLabel {
  project: string | null;
  workspace: string | null;
}

/**
 * The names of a plane as they are now, so a renamed workspace shows its new name. A workspace or a project
 * that is gone reads `closed`. A workspace of a project that is not open cannot be looked up: it keeps the
 * name it had when the popup came, unless its project is gone too.
 */
export function planeLabel(plane: Plane, sources: PlaneSources, closed: string): PlaneLabel {
  const project = plane.projectId ? (sources.projects.find((p) => p.id === plane.projectId) ?? null) : null;
  // Projects not read yet (the first moments of a run) leave the names the popup came with.
  const projectsKnown = sources.projects.length > 0;
  const projectGone = plane.projectId !== null && projectsKnown && project === null;

  let workspace: string | null = null;
  if (plane.workspaceId) {
    const live = sources.workspaces.find((w) => w.id === plane.workspaceId);
    const open = plane.projectId !== null && plane.projectId === sources.projectId;
    if (live) workspace = live.name;
    else if (open || projectGone) workspace = closed;
    else workspace = plane.workspaceName ?? closed;
  }

  return {
    project: plane.projectId === null ? null : (project?.name ?? (projectGone ? closed : (plane.projectName ?? closed))),
    workspace,
  };
}

/** The label as one line: "Project › Workspace", or what there is of it. */
export function planeText(label: PlaneLabel, none: string): string {
  const parts = [label.project, label.workspace].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" › ") : none;
}
