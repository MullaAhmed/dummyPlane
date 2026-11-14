// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_DESCRIPTION, MAX_TITLE, onRecord, recordNotification, type NewNotification, type Recorded } from "./capture";

afterEach(() => vi.restoreAllMocks());

/** What a listener receives while `record` runs. */
function received(record: () => void): Recorded[] {
  const seen: Recorded[] = [];
  const stop = onRecord((notification) => seen.push(notification));
  record();
  stop();
  return seen;
}

const finished = (extra: Partial<NewNotification> = {}): NewNotification => ({ type: "finished", kind: "success", title: "Batman · Done", ...extra });

describe("recordNotification", () => {
  it("hands over a notification as flat text, with its type, its tone, its plane, whether it is read, and the time", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const [n] = received(() => recordNotification(finished({ description: "  Login  fixed\n tests green ", context: { nodeId: "batman" } })));
    expect(n).toEqual({ type: "finished", kind: "success", title: "Batman · Done", description: "Login fixed tests green", context: { nodeId: "batman" }, read: false, at: 1_000 });
  });

  it("is unread with no plane unless told", () => {
    const [n] = received(() => recordNotification({ type: "board", kind: "success", title: "Board done: all 3 cards finished" }));
    expect(n).toMatchObject({ context: null, read: false, description: undefined });
    const [read] = received(() => recordNotification(finished({ read: true })));
    expect(read.read).toBe(true);
  });

  it("clips what is too long, to a sentence's length", () => {
    const [n] = received(() => recordNotification(finished({ title: "x".repeat(1000), description: "y".repeat(5000) })));
    expect(n.title).toHaveLength(MAX_TITLE);
    expect(n.title.endsWith("…")).toBe(true);
    expect(n.description).toHaveLength(MAX_DESCRIPTION);
  });

  it("never keeps half a character, its own cut or one that came cut: Rust refuses the saved list with one in it", () => {
    // Half of a UTF-16 pair: the JSON Rust reads (serde_json) refuses "\ud83c" alone, and the list is saved whole.
    const half = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    // 🎉 straddles the cut: its first half is the last unit kept.
    const [cut] = received(() => recordNotification(finished({ title: `${"x".repeat(MAX_TITLE - 2)}🎉 and more` })));
    expect(cut.title).toBe(`${"x".repeat(MAX_TITLE - 2)}…`);
    // A summary clipped before it came here, inside an emoji.
    const [came] = received(() => recordNotification(finished({ title: "Alan · Done \uD83C", description: "All 12 tests pass \uD83C" })));
    expect(came).toMatchObject({ title: "Alan · Done", description: "All 12 tests pass" });
    for (const text of [cut.title, came.title, came.description]) expect(text).not.toMatch(half);
    const [whole] = received(() => recordNotification(finished({ title: "Shipped 🎉" })));
    expect(whole.title).toBe("Shipped 🎉");
  });

  it("skips one with no words, never throwing", () => {
    expect(received(() => recordNotification(finished({ title: "  " })))).toEqual([]);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stop = onRecord(() => {
      throw new Error("listener broke");
    });
    expect(() => recordNotification(finished())).not.toThrow();
    stop();
  });

  it("waits for the panel to connect, then hands over what was recorded before it, in order", () => {
    recordNotification(finished({ title: "first" }));
    recordNotification(finished({ title: "second" }));
    const seen: string[] = [];
    const stop = onRecord((n) => seen.push(n.title));
    expect(seen).toEqual(["first", "second"]);
    recordNotification(finished({ title: "third" }));
    expect(seen).toEqual(["first", "second", "third"]);
    stop();
  });

  it("keeps only the latest few while nobody listens", () => {
    for (let i = 0; i < 80; i++) recordNotification(finished({ title: `n${i}` }));
    const seen: string[] = [];
    const stop = onRecord((n) => seen.push(n.title));
    stop();
    expect(seen).toHaveLength(50);
    expect(seen[0]).toBe("n30");
    expect(seen[49]).toBe("n79");
  });
});
