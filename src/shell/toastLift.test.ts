import { describe, expect, it } from "vitest";
import { OVERLAY_TOP } from "./overlayBounds";
import { workWindowPlace } from "./layout";
import { clearOfWindows, TOAST_GAP, TOAST_IN_BAND, TOAST_ROOM, TOAST_WIDTH, toastOffset } from "./toastLift";

const base = { bottom: 58, right: 12 };
const window960 = { width: 960, height: 600 };
const box = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height });

describe("the toasts beside an open rail popover", () => {
  it("stay in their corner while none is open", () => {
    expect(toastOffset(null, window960, base)).toBe(base);
  });

  it("lift above the notifications at 960x600, clear of its rows (the stress frame: 85 % of two toasts over it)", () => {
    const notifications = box(511, 315, 384, 197);
    const offset = toastOffset(notifications, window960, base);
    expect(offset).toEqual({ bottom: 600 - 315 + TOAST_GAP, right: 12 });
    // The front toast's foot is a gap above the popover, its head still under the title bar's gap.
    expect(600 - offset.bottom).toBe(notifications.top - TOAST_GAP);
    expect(600 - offset.bottom - TOAST_ROOM).toBeGreaterThanOrEqual(OVERLAY_TOP);
  });

  it("step left of a popover too tall to stand above (Settings at 960x600), at their usual height", () => {
    const settings = box(634, OVERLAY_TOP, 256, 600 - OVERLAY_TOP - 8);
    const offset = toastOffset(settings, window960, base);
    expect(offset.bottom).toBe(base.bottom);
    // Their right edge is a gap left of the menu, their left edge still inside the window.
    expect(960 - offset.right).toBe(settings.left - TOAST_GAP);
    expect(960 - offset.right - TOAST_WIDTH).toBeGreaterThanOrEqual(TOAST_GAP);
  });

  it("stay put under a popover that does not reach their corner", () => {
    // High up the rail: its foot above where the front toast stands.
    expect(toastOffset(box(511, 100, 384, 300), window960, base)).toBe(base);
    // Left of where the toasts stand.
    expect(toastOffset(box(100, 300, 300, 290), window960, base)).toBe(base);
  });
});

describe("the toasts beside an open work window (review, git)", () => {
  // At the lane's foot and on its edge (AppToaster): 72 up, 70 in.
  const lane = { bottom: 72, right: 70 };
  const window1440 = { width: 1440, height: 900 };
  /** A work window's box where workWindowPlace puts it, under the bars (84) and above the command band (72 up). */
  const windowAt = (size: { width: number; height: number }, occupied: boolean) => {
    const place = workWindowPlace(size.width, occupied);
    return { left: size.width - place.right - place.width, right: size.width - place.right, top: 84, bottom: size.height - 72 };
  };
  /** The front toast's box for an offset, as tall as TOAST_ROOM. */
  const toastAt = (size: { width: number; height: number }, offset: { bottom: number; right: number }, height = TOAST_ROOM) => ({
    left: size.width - offset.right - TOAST_WIDTH,
    right: size.width - offset.right,
    top: size.height - offset.bottom - height,
    bottom: size.height - offset.bottom,
  });
  const meet = (a: ReturnType<typeof toastAt>, b: ReturnType<typeof toastAt>) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  it("stay at the lane's foot with no window open", () => {
    expect(clearOfWindows([], window960, lane)).toBe(lane);
  });

  it("stay in the occupied lane, the lane's width, beside a work window that starts left of it (1440 and 960)", () => {
    expect(TOAST_WIDTH).toBe(336);
    for (const size of [window1440, window960]) expect(clearOfWindows([windowAt(size, true)], size, lane)).toBe(lane);
  });

  it("step left of a work window at their height where they fit (1440, the lane free)", () => {
    const review = windowAt(window1440, false);
    const offset = clearOfWindows([review], window1440, lane);
    expect(offset).toEqual({ bottom: lane.bottom, right: 1440 - review.left + TOAST_GAP });
    expect(meet(toastAt(window1440, offset), review)).toBe(false);
    // Clear of the tool rail's room.
    expect(toastAt(window1440, offset).left).toBeGreaterThanOrEqual(70);
  });

  it("stand above a Fleet's mission panel in view, over its own terminal, off its rows and actions (fleet-plan-and-go 08, 960x600)", () => {
    // The panel where the re-render drew it: 162 to 798, from its status line (256) to its foot (522).
    const panel = { left: 162, top: 256, right: 798, bottom: 522 };
    const offset = clearOfWindows([panel], window960, lane);
    expect(offset).toEqual({ bottom: 600 - 256 + TOAST_GAP, right: lane.right });
    // The toast QA measured there: 73 px, wrapped, with Show. Off the panel, under the title bar's overlay line.
    expect(meet(toastAt(window960, offset, 73), panel)).toBe(false);
    expect(toastAt(window960, offset).top).toBeGreaterThanOrEqual(OVERLAY_TOP);
    // At 1440 the same panel stands left of the toasts' place: they stay.
    expect(clearOfWindows([{ left: 162, top: 556, right: 798, bottom: 822 }], window1440, lane)).toBe(lane);
  });

  it("go down into the band under a panel too tall to stand above", () => {
    const tall = { left: 162, top: 90, right: 798, bottom: 522 };
    expect(clearOfWindows([tall], window960, lane)).toEqual({ bottom: TOAST_IN_BAND, right: lane.right });
  });

  it("go down into the bottom band under a window that spans the canvas (960x600), off its fields and Send", () => {
    const review = windowAt(window960, false);
    const offset = clearOfWindows([review], window960, lane);
    expect(offset).toEqual({ bottom: TOAST_IN_BAND, right: lane.right });
    // A one-line toast (up to 64 px) stands wholly under the window's foot.
    expect(meet(toastAt(window960, offset, 64), review)).toBe(false);
  });
});
