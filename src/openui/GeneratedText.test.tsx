// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// Loaded once with the file, not in a test: the libraries it brings (radix-ui's whole barrel, by the button, takes
// a second cold and many under load) stay loaded through vi.resetModules, so each test reads again only the app's own
// modules, and never spends its 5 s waiting for them. OpenUI itself is not loaded: GeneratedText loads it lazily.
import "./GeneratedText";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEXT = 'root = Stack([Text("hello")])';
let unmount: (() => void) | null = null;

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  unmount?.();
  unmount = null;
  vi.doUnmock("./OpenUIView");
  vi.restoreAllMocks();
});

async function show() {
  const { GeneratedText } = await import("./GeneratedText");
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<GeneratedText text={TEXT} />));
  unmount = () => act(() => root.unmount());
  return host;
}

it("shows the raw text while OpenUI loads: never a blank", async () => {
  vi.doMock("./OpenUIView", () => new Promise(() => undefined));
  const host = await show();
  expect(host.querySelector("pre")?.textContent).toBe(TEXT);
});

it("shows the raw text when OpenUI cannot load", async () => {
  vi.doMock("./OpenUIView", () => {
    throw new Error("chunk failed to load");
  });
  const host = await show();
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(host.querySelector("pre")?.textContent).toBe(TEXT);
});

it("never loads OpenUI for plain text or Markdown", async () => {
  const loaded = vi.fn();
  vi.doMock("./OpenUIView", () => {
    loaded();
    return { default: () => null };
  });
  const { GeneratedText } = await import("./GeneratedText");
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<GeneratedText text={"# Done\n\n- a = b\n- all **good**"} />));
  unmount = () => act(() => root.unmount());
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(loaded).not.toHaveBeenCalled();
  expect(host.querySelector("h1")?.textContent).toBe("Done");
});
