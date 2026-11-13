// @vitest-environment happy-dom
import { Fragment } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capture, currentPlane, MAX_DESCRIPTION, MAX_TITLE, onCapture, plainText, withPlane, type Captured } from "./capture";

afterEach(() => vi.restoreAllMocks());

describe("plainText", () => {
  it("reads a string, a number and a function that returns either", () => {
    expect(plainText("  Saved \n  the file ")).toBe("Saved the file");
    expect(plainText(3)).toBe("3");
    expect(plainText(() => "From a function")).toBe("From a function");
    expect(plainText(() => {
      throw new Error("no");
    })).toBe("");
  });

  it("reads the words of a React node, as toastError's description writes them", () => {
    const node = (
      <>
        <span className="block">Try again later.</span>
        <span className="mt-0.5 font-mono">disk full</span>
        {false}
      </>
    );
    expect(plainText(node)).toBe("Try again later. disk full");
    expect(plainText(<Fragment>{["a", <b key="b">b</b>]}</Fragment>)).toBe("a b");
  });

  it("has nothing to read in what is not text", () => {
    for (const value of [undefined, null, true, {}, Symbol.iterator]) expect(plainText(value)).toBe("");
  });
});

/** The popups the history receives while `run` shows them. */
function received(run: () => void): Captured[] {
  const seen: Captured[] = [];
  const stop = onCapture((toast) => seen.push(toast));
  try {
    run();
  } finally {
    stop();
  }
  return seen;
}

describe("capture", () => {
  it("hands over a popup as flat text, with its kind, its action label and the time", () => {
    const [toast] = received(() =>
      capture({ kind: "warning", title: "Heads up", description: <span>Details here</span>, action: { label: "Undo", onClick: () => undefined }, toastId: "t1" }),
    );
    expect(toast).toMatchObject({ kind: "warning", title: "Heads up", description: "Details here", action: "Undo", toastId: "t1", context: null });
    expect(toast.at).toBeGreaterThan(0);
  });

  it("has no description or action when the popup has none", () => {
    const [toast] = received(() => capture({ kind: "plain", title: "Copied" }));
    expect(toast.description).toBeUndefined();
    expect(toast.action).toBeUndefined();
  });

  it("clips what is too long, to a sentence's length", () => {
    const [toast] = received(() => capture({ kind: "error", title: "x".repeat(1000), description: "y".repeat(5000) }));
    expect(toast.title).toHaveLength(MAX_TITLE);
    expect(toast.title.endsWith("…")).toBe(true);
    expect(toast.description).toHaveLength(MAX_DESCRIPTION);
  });

  it("never keeps half a character, its own cut or one that came cut: Rust refuses the saved history with one in it", () => {
    // Half of a UTF-16 pair: the JSON Rust reads (serde_json) refuses "\ud83c" alone, and the history is saved whole.
    const half = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    // 🎉 straddles the cut: its first half is the last unit kept.
    const [cut] = received(() => capture({ kind: "plain", title: `${"x".repeat(MAX_TITLE - 2)}🎉 and more` }));
    expect(cut.title).toBe(`${"x".repeat(MAX_TITLE - 2)}…`);
    // A summary or an error detail clipped before it came here, inside an emoji.
    const [came] = received(() => capture({ kind: "success", title: "Alan done \uD83C", description: "All 12 tests pass \uD83C", action: "Show\uDF89" }));
    expect(came).toMatchObject({ title: "Alan done", description: "All 12 tests pass", action: "Show" });
    for (const text of [cut.title, came.title, came.description, came.action]) expect(text).not.toMatch(half);
    // A whole emoji stays.
    const [whole] = received(() => capture({ kind: "plain", title: "Shipped 🎉" }));
    expect(whole.title).toBe("Shipped 🎉");
  });

  it("skips a popup with no words of its own, never throwing", () => {
    expect(received(() => capture({ kind: "plain", title: undefined }))).toEqual([]);
  });

  it("waits for the history to connect, then hands over the popups shown before it, in order", () => {
    capture({ kind: "info", title: "first" });
    capture({ kind: "info", title: "second" });
    const seen: string[] = [];
    const stop = onCapture((toast) => seen.push(toast.title));
    expect(seen).toEqual(["first", "second"]);
    capture({ kind: "info", title: "third" });
    expect(seen).toEqual(["first", "second", "third"]);
    stop();
  });

  it("keeps only the latest few popups while nobody listens", () => {
    for (let i = 0; i < 80; i++) capture({ kind: "plain", title: `n${i}` });
    const seen: string[] = [];
    const stop = onCapture((toast) => seen.push(toast.title));
    stop();
    expect(seen).toHaveLength(50);
    expect(seen[0]).toBe("n30");
    expect(seen[49]).toBe("n79");
  });
});

describe("withPlane", () => {
  it("records the popups shown inside it under the plane it names, and only those", () => {
    const seen = received(() => {
      capture({ kind: "plain", title: "before" });
      withPlane({ nodeId: "n1" }, () => capture({ kind: "plain", title: "inside" }));
      capture({ kind: "plain", title: "after" });
    });
    expect(seen.map((t) => t.context)).toEqual([null, { nodeId: "n1" }, null]);
    expect(currentPlane()).toBeNull();
  });

  it("gives back the call's own result, and restores the plane when it throws", () => {
    expect(withPlane({ workspaceId: "w1" }, () => 42)).toBe(42);
    expect(() =>
      withPlane({ workspaceId: "w1" }, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(currentPlane()).toBeNull();
  });

  it("speaks for a popup that is only a component: its text becomes the entry's title", () => {
    const [toast] = received(() => withPlane({ workspaceId: "w1", text: "Resume all conversations?" }, () => capture({ kind: "plain", title: undefined })));
    expect(toast).toMatchObject({ title: "Resume all conversations?", context: { workspaceId: "w1" } });
  });
});
