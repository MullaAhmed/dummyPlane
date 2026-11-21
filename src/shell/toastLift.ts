import { useCallback, useEffect, useState, type RefCallback, type RefObject } from "react";
import { createStore, useStore } from "zustand";
import { useCanvas } from "@/canvas/canvasStore";
import { LANE_WIDTH, RAIL_ROOM } from "./layout";
import { OVERLAY_MARGIN, OVERLAY_TOP } from "./overlayBounds";

/** A toast's width: the lane's (sonner's `--width`, set by AppToaster; its own is 356), so the toasts stand in it. */
export const TOAST_WIDTH = LANE_WIDTH;

/** The gap between the toasts and an open rail popover. */
export const TOAST_GAP = 12;

/** What the front toast needs above a rail popover for the toasts to stand there: its height and a gap. */
export const TOAST_ROOM = 80;

/** Marks the content of a popover or menu opened from the right rail, which the toasts keep clear of. */
export const RAIL_OVERLAY = "data-rail-overlay";

export interface ToastOffset {
  bottom: number;
  right: number;
}

/** Where an open rail popover stands in the window. */
export interface OverlayBox {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/**
 * Where the toasts stand while a rail popover (notifications, Settings) is open: the toasts in the bottom-right
 * corner would cover its rows. They lift above it while one toast fits between it and the title bar; under a
 * popover that tall (Settings at 960x600) they step left of it instead, at their usual height. Away from it, or
 * where neither fits, they stay put.
 */
export function toastOffset(overlay: OverlayBox | null, window: { width: number; height: number }, base: ToastOffset): ToastOffset {
  if (!overlay) return base;
  const toastsLeft = window.width - base.right - TOAST_WIDTH;
  const toastsTop = window.height - base.bottom - TOAST_ROOM;
  if (overlay.right <= toastsLeft || overlay.bottom <= toastsTop) return base;
  if (overlay.top - TOAST_GAP - OVERLAY_TOP >= TOAST_ROOM) return { bottom: Math.max(base.bottom, window.height - overlay.top + TOAST_GAP), right: base.right };
  const beside = window.width - overlay.left + TOAST_GAP;
  if (beside + TOAST_WIDTH <= window.width - TOAST_GAP) return { bottom: base.bottom, right: Math.max(base.right, beside) };
  return base;
}

/** What the toasts keep off, mounted now: the work windows (review, git) and a Fleet's actions row on the canvas. */
const windowsStore = createStore<{ windows: readonly HTMLElement[] }>()(() => ({ windows: [] }));

/** Registers a surface the toasts keep off while it is mounted. Returns the stop. */
function workWindow(element: HTMLElement): () => void {
  windowsStore.setState((s) => ({ windows: [...s.windows, element] }));
  return () => windowsStore.setState((s) => ({ windows: s.windows.filter((w) => w !== element) }));
}

/**
 * The ref of a surface the toasts keep off, stable: it fills `ref` and registers the surface while it is mounted. A work
 * window's frame (a review warning landed on the review's Send for four seconds), and a Fleet's actions row, which
 * moves with the canvas ("joined the mission" landed on Clean up and Stop the mission at 960x600).
 */
export function useKeepToastsOff<T extends HTMLElement>(ref: RefObject<T | null>): RefCallback<T> {
  return useCallback(
    (element: T | null) => {
      ref.current = element;
      if (!element) return;
      const stop = workWindow(element);
      return () => {
        ref.current = null;
        stop();
      };
    },
    [ref],
  );
}

/** The toasts' foot down in the bottom band, under a work window's foot (72 up): the overlay margin. */
export const TOAST_IN_BAND = OVERLAY_MARGIN;

/**
 * The toasts' offset `base`, kept off every open work window and Fleet mission panel (`windows`, where they stand).
 * Where the front toast would meet one, the first place that meets none: left of them at their height, while the
 * toasts keep the tool rail's room; else above them, while one toast fits under the title bar (over a Fleet's own
 * terminal, above its panel); else down in the bottom band, under the windows' foot, on the same edge, over the
 * command bar's end for their few seconds rather than on a window's fields (a work window spans the canvas at 960 px).
 */
export function clearOfWindows(windows: readonly OverlayBox[], window: { width: number; height: number }, base: ToastOffset): ToastOffset {
  const front = (offset: ToastOffset): OverlayBox => ({
    left: window.width - offset.right - TOAST_WIDTH,
    right: window.width - offset.right,
    top: window.height - offset.bottom - TOAST_ROOM,
    bottom: window.height - offset.bottom,
  });
  const meets = (offset: ToastOffset) => {
    const toast = front(offset);
    return windows.filter((w) => w.left < toast.right && toast.left < w.right && w.top < toast.bottom && toast.top < w.bottom);
  };
  const met = meets(base);
  if (met.length === 0) return base;
  const beside = { bottom: base.bottom, right: window.width - Math.min(...met.map((w) => w.left)) + TOAST_GAP };
  if (front(beside).left >= RAIL_ROOM && meets(beside).length === 0) return beside;
  const above = { bottom: window.height - Math.min(...met.map((w) => w.top)) + TOAST_GAP, right: base.right };
  if (front(above).top >= OVERLAY_TOP && meets(above).length === 0) return above;
  return { bottom: TOAST_IN_BAND, right: base.right };
}

const boxOf = (element: HTMLElement): OverlayBox => {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom };
};

const sameBoxes = (a: readonly OverlayBox[], b: readonly OverlayBox[]) =>
  a.length === b.length && a.every((box, i) => box.top === b[i].top && box.left === b[i].left && box.right === b[i].right && box.bottom === b[i].bottom);

/**
 * Where the surfaces the toasts keep off stand, measured as they come and go, as they or the window change size, and
 * as the canvas view moves (a Fleet's actions row moves with it): only while one is mounted.
 */
function useWindows(): OverlayBox[] {
  const windows = useStore(windowsStore, (s) => s.windows);
  const camera = useCanvas((s) => (windows.length === 0 ? "" : `${s.view.scrollX} ${s.view.scrollY} ${s.view.zoom} ${s.view.width} ${s.view.height}`));
  const [boxes, setBoxes] = useState<OverlayBox[]>([]);
  const measure = useCallback(() => {
    const next = windows.map(boxOf);
    setBoxes((last) => (sameBoxes(last, next) ? last : next));
  }, [windows]);
  useEffect(() => {
    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    windows.forEach((w) => resize?.observe(w));
    window.addEventListener("resize", measure);
    return () => {
      resize?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [windows, measure]);
  // A move of the view only measures again: the observers stay.
  useEffect(() => {
    if (camera) measure();
  }, [camera, measure]);
  return boxes;
}

/**
 * The toasts' offset, kept off the open work windows and clear of the rail popover open now. A portal mounting or leaving `<body>` is when
 * one opens or closes; it is measured once placed, again when its open animation ends (it grows from 95 %),
 * when it changes size and when the window does.
 */
export function useToastOffset(base: ToastOffset): ToastOffset {
  const windows = useWindows();
  const [overlay, setOverlay] = useState<OverlayBox | null>(null);
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    let element: HTMLElement | null = null;
    let frame = 0;
    let resize: ResizeObserver | null = null;
    const measure = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
      const rect = element?.getBoundingClientRect();
      setOverlay(rect ? { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom } : null);
    };
    const detach = () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      resize = null;
      element?.removeEventListener("animationend", measure);
    };
    const attach = () => {
      const next = document.querySelector<HTMLElement>(`[${RAIL_OVERLAY}]`);
      if (next === element) return;
      detach();
      element = next;
      if (!element) {
        setOverlay(null);
        return;
      }
      element.addEventListener("animationend", measure);
      if (typeof ResizeObserver !== "undefined") {
        resize = new ResizeObserver(measure);
        resize.observe(element);
      }
      // Radix places it on the next frame.
      frame = requestAnimationFrame(measure);
    };
    const portals = new MutationObserver(attach);
    portals.observe(document.body, { childList: true });
    window.addEventListener("resize", measure);
    attach();
    return () => {
      portals.disconnect();
      window.removeEventListener("resize", measure);
      detach();
    };
  }, []);
  return toastOffset(overlay, size, clearOfWindows(windows, size, base));
}
