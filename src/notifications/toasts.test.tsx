// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { toastError } from "@/lib/errorToast";
import { onRecord, type Recorded } from "./capture";

// The notification panel keeps three kinds of news, recorded where they happen (`./capture`): a popup is sonner's own,
// shown as it is, and never lands in the panel, whatever kind it is.

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

describe("a popup", () => {
  it("shows in sonner, and lands nowhere in the notification panel", () => {
    listen();
    const ids = [
      toast("Link copied"),
      toast.success("Saved"),
      toast.info("FYI"),
      toast.warning("Careful"),
      toast.error("Failed", { description: "remote rejected", action: { label: "Retry", onClick: () => undefined } }),
      toast.message("Plain"),
      toast.custom(() => <div>component</div>, { id: "resume-w2" }),
    ];
    expect(seen).toEqual([]);
    for (const id of ids) expect(toast.getHistory().some((t) => t.id === id)).toBe(true);
  });

  it("an error toast included", () => {
    listen();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    toastError("Could not save the file", { error: new Error("disk full"), next: "Free some space." });
    expect(seen).toEqual([]);
    expect(toast.getHistory().some((t) => "title" in t && t.title === "Could not save the file")).toBe(true);
  });
});
