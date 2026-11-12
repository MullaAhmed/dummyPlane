import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebglPool, NEXT_GRANT_MS } from "./webglPool";

const SETTLE = 300;

function setup(cap = 2, available = true) {
  const attach = vi.fn((_id: string) => available);
  const detach = vi.fn((_id: string) => undefined);
  const pool = createWebglPool({ cap, settleMs: SETTLE, attach, detach });
  /** Waits until every context that can be made is. */
  const settle = () => vi.advanceTimersByTime(SETTLE + 10 * NEXT_GRANT_MS);
  return { pool, attach, detach, settle };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createWebglPool", () => {
  it("gives a terminal on screen its context once the view is still, not at once", () => {
    const { pool, attach } = setup();
    pool.show("a", true);
    expect(attach).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SETTLE);
    expect(attach).toHaveBeenCalledWith("a");
    expect(pool.holders()).toEqual(["a"]);
  });

  it("waits while the view moves", () => {
    const { pool, attach } = setup();
    pool.show("a", true);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(SETTLE - 50);
      pool.busy();
    }
    expect(attach).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SETTLE);
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("makes one context per turn, the terminal shown last first", () => {
    const { pool, attach } = setup(3);
    pool.show("a", true);
    pool.show("b", true);
    vi.advanceTimersByTime(SETTLE);
    expect(attach.mock.calls).toEqual([["b"]]);
    vi.advanceTimersByTime(NEXT_GRANT_MS);
    expect(attach.mock.calls).toEqual([["b"], ["a"]]);
  });

  it("never holds more contexts than its cap, however many terminals were shown", () => {
    const { pool, attach, detach, settle } = setup(3);
    for (let i = 0; i < 40; i++) {
      pool.show(`t${i}`, true);
      settle();
      // Scrolled off: it keeps its context until another terminal needs it.
      pool.show(`t${i}`, false);
      expect(attach.mock.calls.length - detach.mock.calls.length).toBeLessThanOrEqual(3);
    }
    expect(pool.holders()).toEqual(["t37", "t38", "t39"]);
  });

  it("keeps the DOM renderer for a terminal over the cap while every holder is on screen", () => {
    const { pool, attach, detach, settle } = setup(2);
    pool.show("a", true);
    pool.show("b", true);
    settle();
    pool.show("c", true);
    settle();
    expect(attach).not.toHaveBeenCalledWith("c");
    expect(detach).not.toHaveBeenCalled();
    // One leaves the screen: the terminal waiting takes its context.
    pool.show("a", false);
    settle();
    expect(detach).toHaveBeenCalledWith("a");
    expect(attach).toHaveBeenLastCalledWith("c");
    expect(pool.holders().sort()).toEqual(["b", "c"]);
  });

  it("takes the context of the terminal shown longest ago first", () => {
    const { pool, detach, settle } = setup(2);
    pool.show("a", true);
    settle();
    pool.show("b", true);
    settle();
    // Both scrolled off, then a back on screen and off again: b was on screen longest ago.
    pool.show("a", false);
    pool.show("b", false);
    pool.show("a", true);
    pool.show("a", false);
    pool.show("c", true);
    settle();
    expect(detach.mock.calls).toEqual([["b"]]);
  });

  it("creates no context again for a terminal back on screen that kept its own", () => {
    const { pool, attach, settle } = setup(2);
    pool.show("a", true);
    settle();
    pool.show("a", false);
    settle();
    pool.show("a", true);
    settle();
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("frees the slot of a lost context, and asks again only once shown anew", () => {
    const { pool, attach, settle } = setup(1);
    pool.show("a", true);
    pool.show("b", true);
    settle();
    expect(pool.holders()).toEqual(["b"]);
    pool.lost("b");
    settle();
    // a was waiting on screen: it takes the slot; b does not ask again in the same turn.
    expect(attach).toHaveBeenLastCalledWith("a");
    expect(attach).toHaveBeenCalledTimes(2);
    pool.show("a", false);
    pool.show("b", true);
    settle();
    expect(attach).toHaveBeenLastCalledWith("b");
  });

  it("frees the context of a terminal that is gone", () => {
    const { pool, detach, settle } = setup();
    pool.show("a", true);
    settle();
    pool.forget("a");
    expect(detach).toHaveBeenCalledWith("a");
    expect(pool.holders()).toEqual([]);
    pool.forget("b");
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it("stops asking once WebGL is not available", () => {
    const { pool, attach, settle } = setup(2, false);
    pool.show("a", true);
    pool.show("b", true);
    settle();
    pool.show("c", true);
    settle();
    expect(attach).toHaveBeenCalledTimes(1);
    expect(pool.holders()).toEqual([]);
  });
});
