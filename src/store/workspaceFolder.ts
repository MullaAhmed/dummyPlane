import { projectsStore, useProjects } from "./projects";
import { isCode, useWorkspaces, workspacesStore, type Workspace } from "./workspaces";

/** The path of a project; empty when it is unknown. */
const projectPath = (projectId: string | null | undefined) => projectsStore.getState().projects.find((p) => p.id === projectId)?.path ?? "";

/** The folder a workspace picked for itself; null for the project's own. The code workspace stays on the project. */
export const ownFolder = (workspace: Workspace | undefined): string | null => (workspace && !isCode(workspace) ? workspace.folder || null : null);

/**
 * The folder everything started in a workspace uses: terminals, Fleet sessions, installs, sign-in,
 * the git chip and the missions' repository. The active workspace, unless one is named; the active
 * project's folder while there is none. A null folder follows a moved project.
 */
export function workspaceFolder(workspaceId?: string | null): string {
  const { workspaces, activeId } = workspacesStore.getState();
  const workspace = workspaces.find((w) => w.id === (workspaceId ?? activeId));
  return ownFolder(workspace) ?? projectPath(workspace?.projectId ?? projectsStore.getState().activeId);
}

/** Like `workspaceFolder`, but null for a workspace that is not among the open project's. */
export function knownWorkspaceFolder(workspaceId: string): string | null {
  return workspacesStore.getState().workspaces.some((w) => w.id === workspaceId) ? workspaceFolder(workspaceId) : null;
}

/** `knownWorkspaceFolder`, kept up to date. */
export function useKnownWorkspaceFolder(workspaceId: string | undefined): string | null {
  const workspace = useWorkspaces((s) => s.workspaces.find((w) => w.id === workspaceId));
  const projectFolder = useProjects((s) => s.projects.find((p) => p.id === workspace?.projectId)?.path ?? "");
  return workspace ? (ownFolder(workspace) ?? projectFolder) : null;
}

/** The folder of the active workspace and the project's, for what shows them. */
export interface ActiveFolder {
  /** Null while there is no workspace. */
  workspaceId: string | null;
  folder: string;
  projectFolder: string;
  /** The workspace works in a folder of its own. */
  custom: boolean;
}

export function useActiveFolder(): ActiveFolder {
  const workspace = useWorkspaces((s) => s.workspaces.find((w) => w.id === s.activeId));
  const projectFolder = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.path ?? "");
  const own = ownFolder(workspace);
  return { workspaceId: workspace?.id ?? null, folder: own ?? projectFolder, projectFolder, custom: own !== null };
}
