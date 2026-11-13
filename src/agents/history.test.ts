// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { browseHistory, HISTORY_SIZE, historyLeftOut, historyStore, pushHistory } from "./history";

afterEach(() => clearMocks());

describe("pushHistory", () => {
  it("adds the command last, moves an earlier copy and keeps the last 50", () => {
    expect(pushHistory(["a", "b"], " a ")).toEqual(["b", "a"]);
    expect(pushHistory(["a"], "   ")).toEqual(["a"]);
    const full = Array.from({ length: HISTORY_SIZE }, (_, i) => `c${i}`);
    const next = pushHistory(full, "new");
    expect(next).toHaveLength(HISTORY_SIZE);
    expect(next[0]).toBe("c1");
    expect(next[next.length - 1]).toBe("new");
  });
});

describe("browseHistory", () => {
  it("walks up to the oldest command and down back to the draft", () => {
    const entries = ["a", "b", "c"];
    expect(browseHistory(entries, null, "up")).toBe(2);
    expect(browseHistory(entries, 2, "up")).toBe(1);
    expect(browseHistory(entries, 0, "up")).toBe(0);
    expect(browseHistory(entries, 1, "down")).toBe(2);
    expect(browseHistory(entries, 2, "down")).toBeNull();
    expect(browseHistory(entries, null, "down")).toBeNull();
    expect(browseHistory([], null, "up")).toBeNull();
  });
});

describe("historyStore", () => {
  it("loads a project's commands and saves each new one", async () => {
    const saved: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "get_setting") return (args as { key: string }).key === "command.history.p1" ? ["a", "b"] : null;
      if (cmd === "set_setting") saved.push(args);
    });
    await historyStore.getState().load("p1");
    expect(historyStore.getState().entries).toEqual(["a", "b"]);
    historyStore.getState().add("a");
    expect(historyStore.getState().entries).toEqual(["b", "a"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved).toEqual([{ key: "command.history.p1", value: ["b", "a"] }]);
  });
});

describe("historyStore, a command sent before the history is read", () => {
  it("saves nothing over a history it could not read (review)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const saved: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "get_setting") throw { kind: "db", message: "database is locked" };
      if (cmd === "set_setting") saved.push(args);
    });
    const loading = historyStore.getState().load("p9");
    historyStore.getState().add("vite");
    await loading;
    historyStore.getState().add("build");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved).toEqual([]);
    expect(historyStore.getState().entries).toEqual(["vite", "build"]);
    warn.mockRestore();
  });

  it("keeps the saved commands and the new one, and saves both", async () => {
    const saved: { key: string; value: unknown }[] = [];
    let release: (value: string[]) => void = () => undefined;
    mockIPC((cmd, args) => {
      if (cmd === "get_setting") return new Promise((resolve) => (release = resolve));
      if (cmd === "set_setting") saved.push(args as { key: string; value: unknown });
    });
    const loading = historyStore.getState().load("p2");
    historyStore.getState().add("vite");
    release(["a", "b"]);
    await loading;
    expect(historyStore.getState().entries).toEqual(["a", "b", "vite"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Never the new command alone over the saved history.
    expect(saved.every((s) => (s.value as string[]).length === 3)).toBe(true);
    expect(saved.length).toBeGreaterThan(0);
  });
});

describe("historyLeftOut", () => {
  it("says how much of a saved history is not read: nothing, some entries, or all of it", () => {
    expect(historyLeftOut(null)).toBe("none");
    expect(historyLeftOut([])).toBe("none");
    expect(historyLeftOut(["a", "b"])).toBe("none");
    // A command that is no text, and the oldest ones past the 50 kept.
    expect(historyLeftOut(["a", 3, "b"])).toBe("some");
    expect(historyLeftOut(Array.from({ length: HISTORY_SIZE + 1 }, (_, i) => `c${i}`))).toBe("some");
    for (const other of ["x", 4, { a: 1 }, true]) expect(historyLeftOut(other), JSON.stringify(other)).toBe("all");
  });
});

describe("historyStore, a history read only in part", () => {
  /** The IPC calls made, in order, with what `get_setting` answers for the project. */
  function backend(raw: unknown, keepFails = false) {
    const calls: [string, unknown][] = [];
    mockIPC((cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === "get_setting") return raw;
      if (cmd === "keep_setting") {
        if (keepFails) throw { kind: "db", message: "database is locked" };
        return "command.history.x.unreadable";
      }
    });
    return calls;
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("has its text kept aside before anything is saved over it: a damaged entry, another shape", async () => {
    const calls = backend(["a", 3, "b"]);
    await historyStore.getState().load("part-1");
    expect(historyStore.getState().entries).toEqual(["a", "b"]);
    historyStore.getState().add("c");
    await settle();
    expect(calls.map(([cmd]) => cmd)).toEqual(["get_setting", "keep_setting", "set_setting"]);
    expect(calls[1][1]).toEqual({ key: "command.history.part-1" });
    // Not an array at all: all of it is left out, kept all the same.
    const other = backend({ not: "a list" });
    await historyStore.getState().load("part-2");
    expect(historyStore.getState().entries).toEqual([]);
    expect(other.map(([cmd]) => cmd)).toEqual(["get_setting", "keep_setting"]);
  });

  it("keeps nothing aside for a history it reads whole, or that was never saved", async () => {
    const whole = backend(["a", "b"]);
    await historyStore.getState().load("part-3");
    const none = backend(null);
    await historyStore.getState().load("part-4");
    expect([...whole, ...none].map(([cmd]) => cmd)).toEqual(["get_setting", "get_setting"]);
  });

  it("stops the read when its text cannot be kept: nothing is saved over what was not kept", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const calls = backend(["a", 3], true);
    await historyStore.getState().load("part-5");
    historyStore.getState().add("vite");
    await settle();
    expect(historyStore.getState().loaded).toBe(false);
    expect(calls.map(([cmd]) => cmd)).toEqual(["get_setting", "keep_setting"]);
    warn.mockRestore();
  });
});
