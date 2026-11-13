// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useSaveKey } from "./sessionEffects";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const save = vi.fn();
function SaveKey() {
  useSaveKey(save);
  return null;
}

let unmount: (() => Promise<void>) | undefined;
async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SaveKey />));
  unmount = () => act(async () => root.unmount());
}

afterEach(async () => {
  await unmount?.();
  unmount = undefined;
  save.mockClear();
});

/** What the listener threw: an exception in a listener is reported on the window, not out of `dispatchEvent`. */
function thrown(event: Event): unknown[] {
  const errors: unknown[] = [];
  const report = (e: ErrorEvent) => {
    errors.push(e.error ?? e.message);
    e.preventDefault();
  };
  window.addEventListener("error", report);
  try {
    window.dispatchEvent(event);
  } catch (error) {
    errors.push(error);
  }
  window.removeEventListener("error", report);
  return errors;
}

it("saves on Ctrl+S, in either case, and takes the key from the page", async () => {
  await mount();
  const key = new KeyboardEvent("keydown", { key: "S", ctrlKey: true, cancelable: true });
  expect(thrown(key)).toEqual([]);
  expect(save).toHaveBeenCalledTimes(1);
  expect(key.defaultPrevented).toBe(true);
  await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" })));
  expect(save).toHaveBeenCalledTimes(1);
});

it("lets a keydown with no key through, as WebView2's autofill sends one: it is no save, and the listener does not throw", async () => {
  await mount();
  // As autofill sends it, a plain event: its modifiers are read first and are absent, so it never reached `key`.
  expect(thrown(new Event("keydown", { cancelable: true }))).toEqual([]);
  // The same event carrying a modifier did reach it: `key.toLowerCase()` threw a TypeError in the window's capture listener.
  const keyless = Object.assign(new Event("keydown", { cancelable: true }), { ctrlKey: true });
  expect(thrown(keyless)).toEqual([]);
  expect(keyless.defaultPrevented).toBe(false);
  expect(save).not.toHaveBeenCalled();
});
