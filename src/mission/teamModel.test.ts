import { beforeEach, describe, expect, it, vi } from "vitest";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { fleetSession } from "@/nodes/terminal/launch";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { NEW_MISSION, type Mission } from "./mission";
import { levelsRequired, teamModel } from "./teamModel";

// The router's state reads the mission store, which reaches the canvas.
vi.mock("@excalidraw/excalidraw", () => ({}));

/** A Fleet on Claude or Codex. */
function fleet(agent: "claude" | "codex" = "claude") {
  const session = fleetSession("Fleet", { cwd: "C:/code", shell: "pwsh" }, agent);
  nodesStore.setState({ nodes: { fleet: { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", session, mission: NEW_MISSION } } } });
}

const mission = (router?: boolean): Mission => ({ ...NEW_MISSION, ...(router === undefined ? {} : { router }) });
const linked = (extra: Partial<TerminalPayload> = {}): TerminalPayload => ({ title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "pwsh", command: "", ...extra });

beforeEach(() => {
  modelRouterStore.setState({ on: true, levels: {} });
  fleet();
});

describe("a mission's team under the model router", () => {
  it("follows Settings while the Fleet's switch is unset, and the Fleet's switch when set", () => {
    expect(teamModel("fleet", mission(), { level: "faible" })).toBe("claude-haiku-5-5");
    expect(teamModel("fleet", mission(false), { level: "faible" })).toBeUndefined();
    modelRouterStore.setState({ on: false });
    expect(teamModel("fleet", mission(), { level: "faible" })).toBeUndefined();
    expect(teamModel("fleet", mission(true), { level: "eleve" })).toBe("claude-opus-5-5");
    // No level, no model for a new agent.
    expect(teamModel("fleet", mission(true), {})).toBeUndefined();
  });

  it("lets a linked agent's own switch, when set, decide for it, and keeps its model where no level picks one", () => {
    expect(teamModel("fleet", mission(false), { level: "eleve" }, linked({ router: true }))).toBe("claude-opus-5-5");
    // Off for it: it keeps the model it has, whatever the mission's router says.
    expect(teamModel("fleet", mission(true), { level: "eleve" }, linked({ router: false, model: "opus" }))).toBe("opus");
    expect(teamModel("fleet", mission(true), { level: "eleve" }, linked({ router: false }))).toBeUndefined();
    // Off by what it follows (the Fleet's switch, Settings) it keeps its model too: only a new agent starts on its CLI's own.
    expect(teamModel("fleet", mission(false), { level: "eleve" }, linked({ model: "opus" }))).toBe("opus");
    modelRouterStore.setState({ on: false });
    expect(teamModel("fleet", mission(), { level: "eleve" }, linked({ model: "opus" }))).toBe("opus");
    expect(teamModel("fleet", mission(), { level: "eleve" })).toBeUndefined();
    modelRouterStore.setState({ on: true });
    expect(teamModel("fleet", mission(), { level: "eleve" }, linked())).toBe("claude-opus-5-5");
    expect(teamModel("fleet", mission(), {}, linked({ model: "claude-haiku-5-5" }))).toBe("claude-haiku-5-5");
  });

  it("gives a Codex team the models Settings maps for Codex, and none where the map is empty", () => {
    fleet("codex");
    expect(teamModel("fleet", mission(), { level: "faible" })).toBeUndefined();
    modelRouterStore.setState({ levels: { codex: { faible: "gpt-mini" } } });
    expect(teamModel("fleet", mission(), { level: "faible" })).toBe("gpt-mini");
    expect(teamModel("fleet", mission(), { level: "moyen" })).toBeUndefined();
    // A linked agent is routed on its own CLI: a Claude one on a Codex Fleet takes Claude's level.
    expect(teamModel("fleet", mission(), { level: "moyen" }, linked())).toBe("claude-sonnet-5-5");
  });

  it("needs a level for each task only where the router is on and a level picks the team's model", () => {
    expect(levelsRequired("fleet", mission())).toBe(true);
    expect(levelsRequired("fleet", mission(false))).toBe(false);
    modelRouterStore.setState({ on: false });
    expect(levelsRequired("fleet", mission())).toBe(false);
    expect(levelsRequired("fleet", mission(true))).toBe(true);
    // A Codex team with nothing mapped plans as it did, levels optional; once one is mapped, they are required.
    modelRouterStore.setState({ on: true });
    fleet("codex");
    expect(levelsRequired("fleet", mission())).toBe(false);
    modelRouterStore.setState({ levels: { codex: { eleve: "gpt-big" } } });
    expect(levelsRequired("fleet", mission())).toBe(true);
  });
});
