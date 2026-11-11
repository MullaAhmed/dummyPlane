// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { readSource } from "@/theme/cssBlocks";
import { CodeEditor, revealLine } from "./CodeEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  // Only the flash's own timers: CodeMirror measures on animation frames.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<CodeEditor path="a.ts" text={"one\ntwo\nthree\n"} revision={{ id: 0, kind: "open" }} theme="dark" onChange={() => {}} onSave={() => {}} />),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const view = () => EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!;
/**
 * Go to `line`. The editor is blurred first: happy-dom fires selectionchange at once, inside
 * CodeMirror's update, where a browser fires it later; unfocused, the update writes no selection.
 */
const reveal = (line: number) =>
  act(async () => {
    view().contentDOM.blur();
    revealLine(view(), line);
  });
const lit = () => [...host.querySelectorAll(".cm-dp-flash")].map((line) => line.textContent);
const fading = () => [...host.querySelectorAll(".cm-dp-flash-out")].map((line) => line.textContent);

it("lights the line reached at once, holds it, fades it out, then puts it out", async () => {
  await reveal(2);
  expect(lit()).toEqual(["two"]);
  await act(async () => vi.advanceTimersByTime(1199));
  expect(lit()).toEqual(["two"]);
  await act(async () => vi.advanceTimersByTime(1));
  expect([lit(), fading()]).toEqual([[], ["two"]]);
  await act(async () => vi.advanceTimersByTime(200));
  expect([lit(), fading()]).toEqual([[], []]);
});

it("keeps a new reveal lit its full time: the last reveal's timer is cleared", async () => {
  await reveal(1);
  await act(async () => vi.advanceTimersByTime(1000));
  await reveal(3);
  await act(async () => vi.advanceTimersByTime(1000));
  // The first reveal's 1200 ms have passed: its timer must not fade the second.
  expect([lit(), fading()]).toEqual([["three"], []]);
});

it("clears its flash's timer when the editor goes", async () => {
  const set = vi.spyOn(globalThis, "setTimeout");
  await reveal(2);
  // The flash's step is the last timer the reveal sets.
  const flashTimer = set.mock.results[set.mock.results.length - 1].value;
  const clear = vi.spyOn(globalThis, "clearTimeout");
  await act(async () => root.render(<></>));
  expect(clear).toHaveBeenCalledWith(flashTimer);
  set.mockRestore();
  clear.mockRestore();
});

it("fades on a one-shot class, never a transition on the editor's lines", () => {
  const editor = readSource("studio/CodeEditor.tsx");
  expect(editor).toContain('".cm-dp-flash-out": { animation: "dp-flash-out var(--dp-dur) var(--dp-ease-out) both" }');
  expect(editor).not.toMatch(/"\.cm-(line|activeLine)[^"]*":\s*\{[^}]*transition/);
  expect(readSource("index.css")).toMatch(/@keyframes dp-flash-out \{\s*from \{\s*background-color: var\(--dp-accent-soft\);\s*\}\s*\}/);
});
