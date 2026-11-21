import { call } from "./invoke";

/** A worktree dummyPlane made for a mission, on its own branch. */
export interface Worktree {
  slug: string;
  branch: string;
  path: string;
  /** The user's branch the mission was cut from (the mission's own worktree only): where `land` brings its work. */
  base?: string;
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
  /** "name (why)": a worktree's name, or a branch's (it starts with `dummyplane/`). */
  kept: string[];
  /** The mission's cleanup only: uncommitted work committed before its worktree went, "<branch> (<short sha>)". */
  saved?: string[];
  /** The mission's cleanup and the leftovers': what a removed worktree held that nothing makes again, moved first. */
  moved?: Moved[];
}

/** The files a cleanup moved out of a worktree before removing it: ignored files nothing makes again, and `.env*`. */
export interface Moved {
  worktree: string;
  /** `<project>.worktrees\.kept\<worktree>`. */
  folder: string;
  /** The first few, as git names them (a folder moved whole ends in `/`); `count` counts them all. */
  files: string[];
  count: number;
}

/** A worktree of a past mission, and what "Clean up leftovers" would do with it. */
export interface LeftoverWorktree {
  name: string;
  branch: string;
  /** Why it stays as it is; none when it goes. */
  kept?: string;
  /** Its uncommitted work goes into a WIP commit on its branch first. */
  wip: boolean;
  /** What moves to the kept folder before it goes, the first few; `moveCount` counts them all. */
  moves: string[];
  moveCount: number;
  /** git lists it, but its folder is gone: only git's record goes. */
  gone: boolean;
}

/** A `dummyplane/*` branch of a past mission: deleted when `kept` is none, its work being on the user's branch. */
export interface LeftoverBranch {
  name: string;
  head: string;
  kept?: string;
}

/** What "Clean up leftovers" would do in a project, read without writing anything. */
export interface Leftovers {
  /** The branch the user's checkout is on; none on a detached HEAD. */
  target?: string;
  keptFolder: string;
  worktrees: LeftoverWorktree[];
  branches: LeftoverBranch[];
  /** What a clean-up took away and did not finish deleting: it goes. */
  trash: string[];
  /** Folders beside the worktrees that git does not list: left as they are. */
  strays: string[];
}

/** What the user's click covers: what they were shown. */
export interface LeftoversChosen {
  worktrees: string[];
  branches: LeftoverBranch[];
  trash: string[];
}

/** A terminal the mission's cleanup leaves open: the worktree its folder (`path`) is in stays, with `why`. */
export interface HeldOpen {
  path: string;
  why: string;
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
/** What landing a mission brings onto the user's branch, read without touching anything: what the user is asked. */
export interface Landing {
  /** The user's branch. */
  target: string;
  /** The mission's branch, and its head: the commit a Land click brings. */
  branch: string;
  tip: string;
  /** The newest commits it brings, each "<short sha> <subject>"; `count` counts them all. */
  commits: string[];
  count: number;
  /** The user's branch has not moved since: Land fast-forwards it. */
  fastForward: boolean;
}

export type Landed =
  | { kind: "landed"; target: string; from: string; to: string }
  | { kind: "upToDate" }
  /** Uncommitted changes in tracked files of the user's checkout: nothing was touched. */
  | { kind: "dirty"; checkout: string; files: string[] }
  /** The user's branch moved: merged into the mission's, in its worktree, for the checks to run again. */
  | { kind: "merged"; commit: string }
  /** That merge conflicted, and was undone. */
  | { kind: "conflict"; files: string[] };

/** `base`: the branch the mission was cut from; without it, the one the project's checkout is on. Read-only. */
export const missionLanding = (project: string, worktree: string, base?: string) => call<Landing>("mission_landing", { project, worktree, base: base ?? null });
/** The user's Land click, never an agent's call: `tip` onto `target`, by fast-forward (`./land.ts` in `@/mission`). */
export const missionLand = (project: string, worktree: string, target: string, tip: string) => call<Landed>("mission_land", { project, worktree, target, tip });
/** What a merge reads first of an agent: whether its worktree holds changes not committed, and its branch's head. */
export interface Probe {
  uncommitted: boolean;
  head: string;
}
/**
 * `missionMerge`'s first reads for all `agents` (`path`: the agent's worktree) at once, the answers in the same order:
 * null for an agent whose branch could not be read. The merge of agents already in, with nothing new, takes this one
 * call, not the status of a worktree after another's.
 */
export const missionProbe = (mission: string, agents: { path: string; branch: string }[]) => call<(Probe | null)[]>("mission_probe", { mission, agents });
/**
 * "Clean up the mission", which never loses work: each worktree goes, its uncommitted work committed first on its own
 * branch (`saved`, never an `.env*`), what nothing makes again of its ignored files and its `.env*` moved to the kept
 * folder (`moved`), unless a terminal left open is in it (`open`); then each of the mission's branches whose work is
 * all on the user's branch (`base`, else the one their checkout is on) is deleted, the others kept, with why.
 */
export const missionCleanup = (project: string, mission: string, agents: AgentBranch[], base: string | undefined, open: HeldOpen[]) =>
  call<Cleanup>("mission_cleanup", { project, mission, agents, base: base ?? null, open });
/** What "Clean up leftovers" would do in `project`, read only. `live`: the slugs of the missions a Fleet holds. */
export const missionLeftovers = (project: string, live: string[], open: HeldOpen[]) => call<Leftovers>("mission_leftovers", { project, live, open });
/** The user's "Clean up" click on the leftovers, never an agent's call: only what they were shown (`chosen`). */
export const missionCleanLeftovers = (project: string, live: string[], open: HeldOpen[], chosen: LeftoversChosen) =>
  call<Cleanup>("mission_clean_leftovers", { project, live, open, chosen });
/**
 * An agent whose work is squashed in cleans up after itself: its worktree, then its branch while it still holds only
 * what the squash took in (`agent.squashed`). What git refuses is kept, as "name (why)"; a branch's name starts
 * with `dummyplane/`.
 */
export const missionRemoveAgent = (project: string, mission: string, agent: AgentBranch) => call<Cleanup>("mission_remove_agent", { project, mission, agent });
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
