import { call } from "./invoke";

/** A worktree dummyPlane made for a mission, on its own branch. */
export interface Worktree {
  slug: string;
  branch: string;
  path: string;
}

export type Merge = { kind: "merged" } | { kind: "empty" } | { kind: "conflict"; files: string[] };

export interface MergeReport {
  merge: Merge;
  /** Changes left uncommitted in the agent's worktree: not merged. */
  uncommitted: boolean;
  /** The merge's commit went unsigned where the user signs: the signing program is set in the repository only. */
  unsigned?: boolean;
  /** The agent's branch head the merge looked at: what its squash took in (`Member.squashed`). */
  head: string;
}

/**
 * An agent as the cleanups name it, with the head its last merge took in: a squashed branch is no ancestor of the
 * mission's, so git alone cannot tell it is in.
 */
export interface AgentBranch {
  name: string;
  squashed?: string;
}

export interface Cleanup {
  removed: string[];
  kept: string[];
}

export const missionPrepare = (project: string, name: string) => call<Worktree>("mission_prepare", { project, name });
/** `mission`: the mission's slug; `agent`: the agent's name. */
export const missionAddAgent = (project: string, mission: string, agent: string) => call<Worktree>("mission_add_agent", { project, mission, agent });
/**
 * Squashes an agent's branch into the mission's, one commit of `message`. `mission`, `agent`: their worktrees' paths;
 * `since`: the head the agent's last merge took in, so that only what came after it is taken.
 */
export const missionMerge = (mission: string, agent: string, branch: string, message: string, since?: string) =>
  call<MergeReport>("mission_merge", { mission, agent, branch, message, since: since ?? null });
export const missionCleanup = (project: string, mission: string, agents: AgentBranch[]) => call<Cleanup>("mission_cleanup", { project, mission, agents });
/**
 * An agent whose work is squashed in cleans up after itself: its worktree, then its branch while it still holds only
 * what the squash took in (`agent.squashed`). What git refuses is kept, as "name (why)"; a branch's name starts
 * with `dummyplane/`.
 */
export const missionRemoveAgent = (project: string, mission: string, agent: AgentBranch) => call<Cleanup>("mission_remove_agent", { project, mission, agent });
/**
 * What `missionCleanup` would leave in place, found without touching anything: the worktrees whose branch is not
 * merged into the mission's or that hold uncommitted changes, each as "name (reason)". Empty: nothing is unsaved.
 */
export const missionCleanupUnsaved = (project: string, mission: string, agents: AgentBranch[]) => call<string[]>("mission_cleanup_unsaved", { project, mission, agents });
/** What a night needs of the project. */
export interface ProjectChecks {
  git: boolean;
  gh: boolean;
}

export const missionChecks = (project: string) => call<ProjectChecks>("mission_checks", { project });
export const setKeepAwake = (on: boolean) => call<void>("set_keep_awake", { on });
export const missionBacklog = (project: string) => call<string>("mission_backlog", { project });
/** The open issues with `label`, in `gh`'s JSON. */
export const missionIssues = (project: string, label: string) => call<string>("mission_issues", { project, label });
/** Undoes a launch that failed: its fresh worktrees and branches, never forced. */
export const missionDiscard = (project: string, trees: Worktree[]) => call<Cleanup>("mission_discard", { project, trees });
