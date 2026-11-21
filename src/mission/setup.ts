import { studioVersion } from "@/ipc/studio";
import { messages } from "@/i18n";
import { agentMessages } from "@/mcp/messages";
import { notesAgentList } from "@/notes/ipc";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { missionFolder } from "./folder";
import { missionOf } from "./store";

/**
 * What the agents of a new worktree are told about its dependencies (#29): a worktree is a bare checkout, so every
 * agent used to find out alone that its `node_modules` or virtualenv was missing, and how to fill it. Nothing is
 * installed for them: the brief names the command, or the project's own note on its setup.
 */

/**
 * Each ecosystem's lockfiles, the one that wins first, with the command that installs what it locks. A project
 * with two ecosystems (a web front and a Python back) gets one command for each. A `Cargo.lock` needs nothing:
 * cargo fetches what it builds with.
 */
const LOCKFILES: readonly (readonly (readonly [file: string, command: string])[])[] = [
  [
    ["pnpm-lock.yaml", "pnpm install --frozen-lockfile"],
    ["bun.lock", "bun install"],
    ["bun.lockb", "bun install"],
    ["yarn.lock", "yarn install"],
    ["package-lock.json", "npm ci"],
  ],
  [
    ["uv.lock", "uv sync"],
    ["poetry.lock", "poetry install"],
    ["Pipfile.lock", "pipenv sync"],
  ],
  [["Gemfile.lock", "bundle install"]],
  [["composer.lock", "composer install"]],
];

/** The files of the project root worth probing. */
const PROBED: readonly string[] = LOCKFILES.flatMap((family) => family.map(([file]) => file));

/** The install commands the lockfiles in `present` (file names of the project root) call for, one per ecosystem. */
export function installCommands(present: Iterable<string>): string[] {
  const have = new Set(present);
  return LOCKFILES.flatMap((family) => {
    const found = family.find(([file]) => have.has(file));
    return found ? [found[1]] : [];
  });
}

/** A note whose name says it is about setting the project up: `setup`, `dev-setup`, `Installation`, `getting-started`… */
const SETUP_NOTE = /setup|install|onboard|getting[-_ ]?started|bootstrap/i;

/** The first note about the project's setup, by name. */
export function setupNote(names: readonly string[]): string | undefined {
  return names.find((name) => SETUP_NOTE.test(name));
}

/** How long the lookup may take: a brief is sent when the worktree is ready, not when a slow disk has answered. */
const LOOKUP_MS = 3000;

const slashes = (path: string) => path.replace(/[\\/]+/g, "/").replace(/\/$/, "");

/** `folder` as a path from `root`: "" at the root itself; undefined when it lies elsewhere, in another repository. */
export function pathFromRoot(root: string, folder: string): string | undefined {
  const [r, f] = [slashes(root), slashes(folder)];
  if (f.toLowerCase() === r.toLowerCase()) return "";
  return f.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? f.slice(r.length + 1) : undefined;
}

/** The project's names for what a worktree lacks: its setup note, else the install commands its lockfiles give. `from`: the mission's folder from the project's root. */
async function lookup(fleetId: string, projectId: string, from: string): Promise<{ note?: string; commands: string[] }> {
  const [notes, versions] = await Promise.all([
    notesAgentList([fleetId]).catch(() => []),
    // undefined: the probe itself failed, which is not a file that is missing.
    Promise.all(PROBED.map((file) => studioVersion(projectId, from ? `${from}/${file}` : file).then((version) => (version == null ? null : file), () => undefined))),
  ]);
  // Nothing could be looked at (the project is unreadable): nothing is known, which is not that nothing is needed.
  if (versions.every((found) => found === undefined)) throw new Error("project unreadable");
  const note = setupNote((Array.isArray(notes) ? notes : []).map((n) => n.name));
  return { ...(note ? { note } : {}), commands: installCommands(versions.filter((file): file is string => typeof file === "string")) };
}

/**
 * The sentence a brief carries when its agent starts in a new worktree, or "" when the project needs nothing
 * installed (no lockfile, Cargo's alone) or when it is not known which project this is. A lookup that fails or runs
 * long gives the sentence without a command: the agent still knows to install before it runs anything.
 */
export async function newWorktreeLine(fleetId: string, workspaceId: string): Promise<string> {
  const line = messages(agentMessages).lines;
  const projectId = workspacesStore.getState().workspaces.find((w) => w.id === workspaceId)?.projectId;
  if (!projectId) return "";
  // The probes read the project's folder: a mission that works in another one (its workspace's own folder, outside the project) is not described by it.
  const root = projectsStore.getState().projects.find((p) => p.id === projectId)?.path;
  const folder = missionOf(nodesStore.getState().nodes[fleetId])?.project || missionFolder(fleetId);
  const from = root && folder ? pathFromRoot(root, folder) : "";
  if (from === undefined) return line.newWorktreeUnknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), LOOKUP_MS)));
    const found = await Promise.race([lookup(fleetId, projectId, from), late]);
    if (found === "late") return line.newWorktreeUnknown;
    // The project's own words on it come first: a command guessed from a lockfile may be missing a step (a build, a service).
    if (found.note) return line.newWorktreeNote(found.note);
    return found.commands.length > 0 ? line.newWorktree(found.commands) : "";
  } catch {
    return line.newWorktreeUnknown;
  } finally {
    clearTimeout(timer);
  }
}
