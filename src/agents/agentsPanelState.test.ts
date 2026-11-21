// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import {
  NARROW_WINDOW,
  agentsPanelStore,
  holdAgentsPanel,
  loadAgentsPanel,
  readAgentsFilter,
  readAgentsPanel,
  releaseAgentsPanel,
  setAgentsFilter,
  setAgentsPanel,
  showAgents,
} from "./agentsPanelState";
import { errorToasts } from "@/lib/errorToast.testkit";

let saved: unknown[];

beforeEach(() => {
  saved = [];
  agentsPanelStore.setState({ open: false, filter: "all" });
});
afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe("the agents panel's state", () => {
  it("is open unless it was closed", () => {
    expect(readAgentsPanel("closed")).toBe(false);
    for (const raw of ["open", null, undefined, 3]) expect(readAgentsPanel(raw)).toBe(true);
  });

  it("comes back as it was left, open when nothing is saved", async () => {
    mockIPC((cmd) => (cmd === "get_setting" ? "closed" : undefined));
    await loadAgentsPanel(1440);
    expect(agentsPanelStore.getState().open).toBe(false);
    mockIPC((cmd) => (cmd === "get_setting" ? null : undefined));
    await loadAgentsPanel(1440);
    expect(agentsPanelStore.getState().open).toBe(true);
  });

  it("starts folded in a window narrower than 1100 px, whatever was saved, and saves nothing", async () => {
    const saved: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "set_setting") saved.push(args);
      return cmd === "get_setting" ? "open" : undefined;
    });
    await loadAgentsPanel(1099);
    expect(agentsPanelStore.getState().open).toBe(false);
    await loadAgentsPanel(960);
    expect(agentsPanelStore.getState().open).toBe(false);
    await loadAgentsPanel(NARROW_WINDOW);
    expect(agentsPanelStore.getState().open).toBe(true);
    expect(saved).toEqual([]);
  });

  it("starts folded in a narrow window when the setting cannot be read, and open in a wide one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockIPC(() => {
      throw new Error("unreadable");
    });
    agentsPanelStore.setState({ open: true });
    await loadAgentsPanel(900);
    expect(agentsPanelStore.getState().open).toBe(false);
    agentsPanelStore.setState({ open: true });
    await loadAgentsPanel(1440);
    expect(agentsPanelStore.getState().open).toBe(true);
  });

  it("remembers each opening and closing", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "set_setting") saved.push(args);
    });
    setAgentsPanel(true);
    setAgentsPanel(false);
    await vi.waitFor(() => expect(saved).toHaveLength(2));
    expect(saved).toEqual([
      { key: "ui.agentsPanel", value: "open" },
      { key: "ui.agentsPanel", value: "closed" },
    ]);
  });

  it("says so when the choice cannot be saved, and keeps it", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    mockIPC(() => {
      throw new Error("disque plein");
    });
    setAgentsPanel(true);
    await vi.waitFor(() => expect(errorToasts(error)).toEqual([{ title: "Could not save the setting", description: expect.stringContaining("disque plein") }]));
    expect(agentsPanelStore.getState().open).toBe(true);
  });
});

it("opens on what the title bar's Working count counts", () => {
  mockIPC(() => undefined);
  agentsPanelStore.setState({ open: false, filter: "all" });
  showAgents("working");
  expect(agentsPanelStore.getState()).toMatchObject({ open: true, filter: "working" });
});

it("forgets the filter when the panel is reopened from the rail", () => {
  mockIPC(() => undefined);
  setAgentsPanel(true);
  setAgentsFilter("working");
  expect(agentsPanelStore.getState().filter).toBe("working");
  setAgentsPanel(false);
  setAgentsPanel(true);
  expect(agentsPanelStore.getState().filter).toBe("all");
});

describe("folded by a work window", () => {
  let saved: unknown[];
  beforeEach(() => {
    saved = [];
    mockIPC((cmd, args) => {
      if (cmd === "set_setting") saved.push(args);
    });
  });

  it("folds an open panel and brings it back, filter kept, saving nothing", () => {
    agentsPanelStore.setState({ open: true, filter: "waiting" });
    holdAgentsPanel();
    expect(agentsPanelStore.getState()).toEqual({ open: false, filter: "waiting", held: true });
    releaseAgentsPanel();
    expect(agentsPanelStore.getState()).toEqual({ open: true, filter: "waiting", held: false });
    expect(saved).toEqual([]);
  });

  it("leaves a panel that was closed closed", () => {
    agentsPanelStore.setState({ open: false });
    holdAgentsPanel();
    expect(agentsPanelStore.getState()).toMatchObject({ open: false, held: false });
    releaseAgentsPanel();
    expect(agentsPanelStore.getState().open).toBe(false);
  });

  it("keeps the person's choice made while the window is open: a reopened panel stays open after it", async () => {
    agentsPanelStore.setState({ open: true });
    holdAgentsPanel();
    setAgentsPanel(true);
    expect(agentsPanelStore.getState()).toMatchObject({ open: true, held: false });
    releaseAgentsPanel();
    expect(agentsPanelStore.getState().open).toBe(true);
    await vi.waitFor(() => expect(saved).toEqual([{ key: "ui.agentsPanel", value: "open" }]));
  });

  it("keeps a panel the person closed again while the window is open closed after it", () => {
    agentsPanelStore.setState({ open: true });
    holdAgentsPanel();
    setAgentsPanel(true);
    setAgentsPanel(false);
    releaseAgentsPanel();
    expect(agentsPanelStore.getState().open).toBe(false);
  });

  it("is reopened by the title bar's Working count over a window", () => {
    agentsPanelStore.setState({ open: true });
    holdAgentsPanel();
    showAgents("working");
    releaseAgentsPanel();
    expect(agentsPanelStore.getState()).toMatchObject({ open: true, filter: "working", held: false });
  });

  it("does not come back twice, nor from a hold it did not make", () => {
    agentsPanelStore.setState({ open: true });
    holdAgentsPanel();
    holdAgentsPanel();
    expect(agentsPanelStore.getState()).toMatchObject({ open: false, held: true });
    releaseAgentsPanel();
    setAgentsPanel(false);
    releaseAgentsPanel();
    expect(agentsPanelStore.getState().open).toBe(false);
  });
});

describe("the panel's filter, as it is kept now", () => {
  it("keeps the four filters that exist", () => {
    for (const filter of ["all", "waiting", "working", "done"] as const) expect(readAgentsFilter(filter)).toBe(filter);
  });

  it("moves the removed Active filter to All, wherever a filter is read or set", () => {
    expect(readAgentsFilter("active")).toBe("all");
    mockIPC(() => undefined);
    setAgentsFilter("active" as never);
    expect(agentsPanelStore.getState().filter).toBe("all");
  });

  it("moves a filter that no longer exists to the one that took its place: Ready and Stopped to Done", () => {
    expect(readAgentsFilter("idle")).toBe("done");
    expect(readAgentsFilter("stopped")).toBe("done");
  });

  it("falls back to All on anything else", () => {
    for (const raw of [undefined, null, "", "Done", "nope", 3, {}]) expect(readAgentsFilter(raw)).toBe("all");
  });

  it("applies it wherever a filter is set, a former one's included", () => {
    mockIPC(() => undefined);
    setAgentsFilter("stopped" as never);
    expect(agentsPanelStore.getState().filter).toBe("done");
    showAgents("idle" as never);
    expect(agentsPanelStore.getState()).toMatchObject({ open: true, filter: "done" });
  });
});
