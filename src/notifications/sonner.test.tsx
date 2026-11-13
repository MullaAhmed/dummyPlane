// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { toastError } from "@/lib/errorToast";
import { onRecord, withPlane, type Recorded } from "./capture";
import { toast } from "./sonner";

// Imported here from the shim's own folder, the real sonner sits under it; `@/lib/errorToast` imports "sonner"
// from outside it, which `scripts/route-sonner.mjs` sends to the shim: the unmocked `toastError` below goes the
// way every popup of the app goes.

let seen: Recorded[] = [];
let stop: () => void = () => undefined;
const listen = () => {
  seen = [];
  stop = onRecord((n) => seen.push(n));
};
afterEach(() => {
  stop();
  toast.dismiss();
  vi.restoreAllMocks();
});

describe("the toast shim", () => {
  it("shows every popup in sonner, and lands none in the notification panel", () => {
    listen();
    const ids = [
      toast("Link copied"),
      toast.success("Saved"),
      toast.info("FYI"),
      toast.warning("Careful"),
      toast.error("Failed", { description: "remote rejected", action: { label: "Retry", onClick: () => undefined } }),
      toast.message("Plain"),
      withPlane({ nodeId: "n1" }, () => toast.warning("Past Max agents")),
      toast.custom(() => <div>component</div>, { id: "resume-w2" }),
    ];
    expect(seen).toEqual([]);
    for (const id of ids) expect(toast.getHistory().some((t) => t.id === id)).toBe(true);
  });

  it("passes the options to sonner as they came", () => {
    const id = toast("With options", { duration: 12_000, id: "kept" });
    expect(id).toBe("kept");
    expect(toast.getHistory().find((t) => t.id === "kept")).toMatchObject({ duration: 12_000, title: "With options" });
  });
});

describe("the routing", () => {
  it("sends the app's own imports of sonner to the shim, and an error toast no longer reaches the panel", () => {
    listen();
    toastError("Could not save the file", { error: new Error("disk full"), next: "Free some space." });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(seen).toEqual([]);
    expect(toast.getHistory().some((t) => "title" in t && t.title === "Could not save the file")).toBe(true);
  });
});
