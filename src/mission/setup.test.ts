// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { installCommands, newWorktreeLine, pathFromRoot, setupNote } from "./setup";

describe("pathFromRoot", () => {
  it("names a folder from the project's root, whatever the separators and the case", () => {
    expect(pathFromRoot("C:/code/proj", "C:/code/proj")).toBe("");
    expect(pathFromRoot("C:\\code\\proj\\", "c:/code/PROJ")).toBe("");
    expect(pathFromRoot("C:/code/proj", "C:\\code\\proj\\services\\api")).toBe("services/api");
    expect(pathFromRoot("C:/code/proj", "C:/code/project")).toBeUndefined();
    expect(pathFromRoot("C:/code/proj", "C:/elsewhere")).toBeUndefined();
  });
});

describe("installCommands", () => {
  it.each([
    [["pnpm-lock.yaml"], ["pnpm install --frozen-lockfile"]],
    [["package-lock.json"], ["npm ci"]],
    [["yarn.lock"], ["yarn install"]],
    [["bun.lock"], ["bun install"]],
    [["bun.lockb"], ["bun install"]],
    [["uv.lock"], ["uv sync"]],
    [["poetry.lock"], ["poetry install"]],
    [["Pipfile.lock"], ["pipenv sync"]],
    [["Gemfile.lock"], ["bundle install"]],
    [["composer.lock"], ["composer install"]],
  ])("reads %j as %j", (files, commands) => {
    expect(installCommands(files)).toEqual(commands);
  });

  it("needs nothing for a Cargo project, or a folder with no lockfile", () => {
    expect(installCommands(["Cargo.lock"])).toEqual([]);
    expect(installCommands([])).toEqual([]);
  });

  it("takes one command per ecosystem, the first lockfile by priority, and one for each ecosystem a project has", () => {
    expect(installCommands(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"])).toEqual(["pnpm install --frozen-lockfile"]);
    expect(installCommands(["uv.lock", "poetry.lock"])).toEqual(["uv sync"]);
    expect(installCommands(["uv.lock", "package-lock.json", "Cargo.lock"])).toEqual(["npm ci", "uv sync"]);
  });
});

describe("setupNote", () => {
  it("finds the note that says how to set the project up, by its name", () => {
    expect(setupNote(["architecture", "dev-setup", "release"])).toBe("dev-setup");
    expect(setupNote(["Installation", "setup"])).toBe("Installation");
    expect(setupNote(["getting-started"])).toBe("getting-started");
    expect(setupNote(["architecture", "release"])).toBeUndefined();
    expect(setupNote([])).toBeUndefined();
  });
});

describe("newWorktreeLine", () => {
  const workspace = (id: string, projectId: string) => ({ id, projectId, name: id, position: 0, pantheon: null, kind: "canvas" as const, folder: null });
  let lockfiles: string[] = [];
  let notes: { name: string; attached: boolean }[] = [];
  let probed: string[] = [];

  beforeEach(() => {
    lockfiles = [];
    notes = [];
    probed = [];
    workspacesStore.setState({ workspaces: [workspace("w1", "p1")] });
    mockIPC((cmd, raw) => {
      const args = raw as { projectId?: string; path?: string };
      if (cmd === "studio_version") {
        probed.push(`${args.projectId}:${args.path}`);
        return lockfiles.includes(args.path ?? "") ? "v1" : null;
      }
      if (cmd === "notes_agent_list") return notes;
      return undefined;
    });
  });

  afterEach(() => {
    workspacesStore.setState({ workspaces: [] });
    clearMocks();
  });

  it("names the install command its lockfiles give, read in the agent's project", async () => {
    lockfiles = ["pnpm-lock.yaml", "uv.lock"];
    expect(await newWorktreeLine("fleet", "w1")).toBe(
      "This worktree is new: its dependencies are not installed yet. Install them first, as the project's lockfiles say: pnpm install --frozen-lockfile; uv sync.",
    );
    expect(probed.every((probe) => probe.startsWith("p1:"))).toBe(true);
    expect(probed).toContain("p1:package-lock.json");
  });

  it("points to the project's note on its setup instead of guessing a command", async () => {
    lockfiles = ["pnpm-lock.yaml"];
    notes = [{ name: "architecture", attached: false }, { name: "dev-setup", attached: true }];
    expect(await newWorktreeLine("fleet", "w1")).toBe(
      'This worktree is new: its dependencies are not installed yet. The project\'s note "dev-setup" says how to set it up: read it first with notes (name "dev-setup").',
    );
  });

  it("says nothing when the project needs nothing installed, or is not known", async () => {
    lockfiles = ["Cargo.lock"];
    expect(await newWorktreeLine("fleet", "w1")).toBe("");
    expect(await newWorktreeLine("fleet", "elsewhere")).toBe("");
  });

  it("still says the dependencies are missing when the project cannot be read, with no command to give", async () => {
    mockIPC(() => {
      throw new Error("disk gone");
    });
    // Every probe fails: nothing is known, which is not that nothing is needed.
    expect(await newWorktreeLine("fleet", "w1")).toBe("This worktree is new: its dependencies are not installed yet. Install what the project needs before you run anything.");
  });

  describe("a mission whose folder is not the project's own", () => {
    const projectAt = (path: string) =>
      projectsStore.setState({ projects: [{ id: "p1", name: "P", path, position: 0, lastOpenedAt: 0, workspaceCount: 1, liveAgents: 0, missing: false }] });
    const fleetIn = async (folder: string | null) => {
      workspacesStore.setState({ workspaces: [{ ...workspace("w1", "p1"), kind: "canvas" as const, folder }] });
      await nodesStore.getState().create("fleet", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
    };

    afterEach(() => {
      projectsStore.setState({ projects: [] });
      nodesStore.getState().forgetWorkspace("w1");
    });

    it("reads the lockfiles of the project's folder when the mission works there", async () => {
      projectAt("C:/code/proj");
      await fleetIn(null);
      lockfiles = ["uv.lock"];
      expect(await newWorktreeLine("fleet", "w1")).toContain("uv sync");
      expect(probed).toContain("p1:uv.lock");
    });

    it("reads them from the mission's folder when it is inside the project's", async () => {
      projectAt("C:/code/proj");
      await fleetIn("C:\\code\\proj\\services\\api");
      lockfiles = ["services/api/uv.lock"];
      expect(await newWorktreeLine("fleet", "w1")).toContain("uv sync");
      expect(probed).toContain("p1:services/api/uv.lock");
      expect(probed).not.toContain("p1:uv.lock");
    });

    it("guesses nothing of a repository outside the project: its agent is told to install what it needs", async () => {
      projectAt("C:/code/proj");
      await fleetIn("C:/elsewhere/other");
      lockfiles = ["pnpm-lock.yaml"];
      expect(await newWorktreeLine("fleet", "w1")).toBe("This worktree is new: its dependencies are not installed yet. Install what the project needs before you run anything.");
      expect(probed).toEqual([]);
    });
  });

  it("gives the sentence without a command when the lookup runs long", async () => {
    mockIPC(() => new Promise(() => undefined));
    const line = await newWorktreeLine("fleet", "w1");
    expect(line).toBe("This worktree is new: its dependencies are not installed yet. Install what the project needs before you run anything.");
  }, 10_000);
});
