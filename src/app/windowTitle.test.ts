// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Project } from "@/ipc/db";
import { projectsStore } from "@/store/projects";
import { syncWindowTitle, titleFor } from "./windowTitle";

const hermes: Project = {
  id: "p1",
  name: "Hermes",
  path: "C:\\hermes",
  position: 0,
  lastOpenedAt: 0,
  workspaceCount: 1,
  missing: false,
  liveAgents: 0,
};

describe("titleFor", () => {
  it("names the open project after the app", () => {
    expect(titleFor("project", [hermes], "p1")).toBe("dummyPlane — Hermes");
  });

  it("is the app's name outside a project, or when the project is gone", () => {
    expect(titleFor("home", [hermes], "p1")).toBe("dummyPlane");
    expect(titleFor("loading", [], null)).toBe("dummyPlane");
    expect(titleFor("project", [hermes], "gone")).toBe("dummyPlane");
  });
});

describe("syncWindowTitle", () => {
  let titles: string[];

  beforeEach(() => {
    titles = [];
    mockWindows("main");
    mockIPC((cmd, args) => {
      if (cmd === "plugin:window|set_title") titles.push((args as { value: string }).value);
    });
  });
  afterEach(() => clearMocks());

  it("follows the project opened, renamed and closed, until stopped", () => {
    projectsStore.setState({ view: "home", projects: [hermes], activeId: null });
    const stop = syncWindowTitle();
    projectsStore.setState({ view: "project", activeId: "p1" });
    projectsStore.setState({ projects: [{ ...hermes }] }); // same title: not set again
    projectsStore.setState({ projects: [{ ...hermes, name: "Hermes 2" }] });
    projectsStore.setState({ view: "home", activeId: null });
    stop();
    projectsStore.setState({ view: "project", activeId: "p1" });
    expect(titles).toEqual(["dummyPlane", "dummyPlane — Hermes", "dummyPlane — Hermes 2", "dummyPlane"]);
    expect(document.title).toBe("dummyPlane");
  });
});
