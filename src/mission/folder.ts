import { nodesStore, sessionOf, useNodes } from "@/store/nodes";
import { knownWorkspaceFolder, useKnownWorkspaceFolder } from "@/store/workspaceFolder";

/**
 * The repository a Fleet's mission works from: the folder of the Fleet's workspace, else the
 * folder its own session started in (its workspace is not among the open project's). Read when
 * it is needed and recorded on the mission, so changing the workspace's folder later does not
 * move a mission that runs. A Fleet's session keeps the folder it started in.
 */
export function missionFolder(fleetId: string): string | undefined {
  const record = nodesStore.getState().nodes[fleetId];
  return (record && knownWorkspaceFolder(record.workspaceId)) || sessionOf(record)?.cwd;
}

/** `missionFolder`, kept up to date, for the dialogs that check it. */
export function useMissionFolder(fleetId: string): string | undefined {
  const workspaceId = useNodes((s) => s.nodes[fleetId]?.workspaceId);
  const own = useNodes((s) => sessionOf(s.nodes[fleetId])?.cwd);
  return useKnownWorkspaceFolder(workspaceId) || own;
}
