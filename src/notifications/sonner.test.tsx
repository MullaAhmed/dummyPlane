// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { toastError } from "@/lib/errorToast";
import { onCapture, withPlane, type Captured } from "./capture";
import { toast } from "./sonner";

// Imported here from the shim's own folder, the real sonner sits under it; `@/lib/errorToast` imports "sonner"
// from outside it, which `scripts/route-sonner.mjs` sends to the shim: the unmocked `toastError` below is the proof
// that the routing works under Vitest, as the build's grep is for the bundle.

let seen: Captured[] = [];
let stop: () => void = () => undefined;
const listen = () => {
  seen = [];
  stop = onCapture((t) => seen.push(t));
};
afterEach(() => {
  stop();
  toast.dismiss();
  vi.restoreAllMocks();
});

describe("the toast shim", () => {
  it("records a plain popup, and returns the id sonner gave it", () => {
    listen();
    const id = toast("Link copied");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "plain", title: "Link copied", toastId: id, context: null });
  });

  it("records each kind under its own", () => {
    listen();
    toast.success("Saved");
    toast.info("FYI");
    toast.warning("Careful");
    toast.error("Failed");
    toast.message("Plain");
    expect(seen.map((t) => t.kind)).toEqual(["success", "info", "warning", "error", "plain"]);
  });

  it("records an error popup's detail and the label of its action", () => {
    listen();
    toast.error("Could not push", { description: "remote rejected", action: { label: "Retry", onClick: () => undefined } });
    expect(seen[0]).toMatchObject({ title: "Could not push", description: "remote rejected", action: "Retry" });
  });

  it("records the id a call names, so showing it again can replace it", () => {
    listen();
    toast.info("Moving", { id: "folder-move:n1" });
    expect(seen[0].toastId).toBe("folder-move:n1");
  });

  it("records the plane a call is shown under", () => {
    listen();
    withPlane({ nodeId: "n1" }, () => toast.warning("Past Max agents"));
    expect(seen[0].context).toEqual({ nodeId: "n1" });
  });

  it("speaks for a custom popup with the text its call site gave", () => {
    listen();
    withPlane({ workspaceId: "w2", text: "Resume all conversations?" }, () => toast.custom(() => <div>component</div>, { id: "resume-w2" }));
    expect(seen[0]).toMatchObject({ title: "Resume all conversations?", toastId: "resume-w2", context: { workspaceId: "w2" } });
  });

  it("still shows the popup in sonner: its history holds it", () => {
    const id = toast.success("Shown");
    expect(toast.getHistory().some((t) => t.id === id)).toBe(true);
  });

  it("passes the options to sonner as they came", () => {
    const id = toast("With options", { duration: 12_000, id: "kept" });
    expect(id).toBe("kept");
    expect(toast.getHistory().find((t) => t.id === "kept")).toMatchObject({ duration: 12_000, title: "With options" });
  });

  it("does not break the popup when recording fails", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stopBroken = onCapture(() => {
      throw new Error("listener broke");
    });
    expect(() => toast("Still shown")).not.toThrow();
    stopBroken();
  });
});

describe("the routing", () => {
  it("sends the app's own imports of sonner to the shim: toastError, unmocked, reaches the history as an error with its detail", () => {
    listen();
    toastError("Could not save the file", { error: new Error("disk full"), next: "Free some space." });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "error", title: "Could not save the file", description: "Free some space. disk full" });
  });
});
