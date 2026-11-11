// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { agentsStore } from "@/agents/agentsStore";
import { answerFleetAgent, chooseFleetAgent, ensureFleetAgent, fleetAgent, fleetAgentStore, loadFleetAgent, whyNot } from "./fleetAgent";
import { FleetAgentDialog } from "./FleetAgentDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let settings: Map<string, unknown>;

beforeEach(() => {
  settings = new Map();
  mockIPC((cmd, args) => {
    const a = args as { key: string; value: unknown };
    if (cmd === "get_setting") return settings.get(a.key) ?? null;
    if (cmd === "set_setting") settings.set(a.key, a.value);
    return undefined;
  });
  fleetAgentStore.setState({ agent: null, asking: null });
  installed(["claude", "codex", "opencode"]);
});

/** The CLIs found on the PATH. */
function installed(ids: string[]) {
  agentsStore.setState({ loaded: true, agents: ["claude", "codex", "gemini", "opencode"].map((id) => ({ id, available: ids.includes(id) })) } as never);
}

describe("the CLI the Fleet runs on", () => {
  it("is Claude until a choice is made, Codex once chosen, and a choice that cannot carry a Fleet falls back to Claude", async () => {
    expect(fleetAgent()).toBe("claude");
    settings.set("fleet.agent", "codex");
    await loadFleetAgent();
    expect(fleetAgent()).toBe("codex");
    settings.set("fleet.agent", "opencode");
    await loadFleetAgent();
    expect(fleetAgentStore.getState().agent).toBe("opencode");
    expect(fleetAgent()).toBe("claude");
    settings.set("fleet.agent", "nonsense");
    await loadFleetAgent();
    expect(fleetAgentStore.getState().agent).toBeNull();
  });

  it("says why the other CLIs cannot carry a Fleet yet", () => {
    expect(whyNot("claude")).toBeNull();
    expect(whyNot("codex")).toBeNull();
    expect(whyNot("opencode")).toBe("noTools");
  });

  it("asks before a first Fleet when Claude and Codex are both installed", async () => {
    const asked = ensureFleetAgent();
    await Promise.resolve();
    await Promise.resolve();
    expect(fleetAgentStore.getState().asking).not.toBeNull();
    answerFleetAgent("codex");
    await expect(asked).resolves.toBe("codex");
  });

  it("asks nothing before a first Fleet when only one installed CLI can carry it, and runs it on that one", async () => {
    installed(["codex", "opencode"]);
    await expect(ensureFleetAgent()).resolves.toBe("codex");
    expect(fleetAgent()).toBe("codex");
    expect(fleetAgentStore.getState().asking).toBeNull();
    installed([]);
    expect(fleetAgent()).toBe("claude");
  });

  it("resolves the question with the CLI picked, saved, or with nothing when closed", async () => {
    const first = chooseFleetAgent();
    answerFleetAgent("claude");
    await expect(first).resolves.toBe("claude");
    expect(settings.get("fleet.agent")).toBe("claude");
    const second = chooseFleetAgent();
    answerFleetAgent(null);
    await expect(second).resolves.toBeNull();
  });
});

describe("the dialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<FleetAgentDialog />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const option = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

  it("lists the CLIs, installed or not, and keeps those that cannot carry a Fleet from being picked, with why", async () => {
    let answer: Promise<unknown> = Promise.resolve();
    await act(async () => {
      answer = chooseFleetAgent();
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("Agent for the Fleet");
    expect(text).toContain("dummyPlane cannot give it its tools");
    expect(text).toContain("Not installed · and not supported for a Fleet yet");
    expect(option("Claude").disabled).toBe(false);
    expect(option("Codex").disabled).toBe(false);
    expect(option("OpenCode").disabled).toBe(true);
    await act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Use Claude")!.click());
    await expect(answer).resolves.toBe("claude");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
