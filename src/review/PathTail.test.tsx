// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CutHint, isCut, PathTail } from "./PathTail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** happy-dom lays nothing out: a cut text is one whose full width is said to pass its box. */
function widths(element: Element, scroll: number, client: number) {
  Object.defineProperty(element, "scrollWidth", { configurable: true, value: scroll });
  Object.defineProperty(element, "clientWidth", { configurable: true, value: client });
}

const row = (always = false) =>
  act(async () =>
    root.render(
      <CutHint label=".github/workflows/ci.yml" always={always}>
        <button type="button">
          <PathTail path=".github/workflows/ci.yml" />
        </button>
      </CutHint>,
    ),
  );
const hint = () => document.querySelector('[data-slot="tooltip-content"]');
const focusRow = () => act(async () => host.querySelector("button")!.focus());

it("cuts a path from its start but keeps it left-to-right (P2-40)", async () => {
  await row();
  const tail = host.querySelector<HTMLElement>("[data-path-tail]")!;
  expect(tail.style.direction).toBe("rtl");
  expect(tail.innerHTML).toBe("<bdi>.github/workflows/ci.yml</bdi>");
});

it("tells whether a truncated text is cut", async () => {
  await row();
  const tail = host.querySelector("[data-path-tail]")!;
  widths(tail, 100, 100);
  expect(isCut(host.querySelector("button"))).toBe(false);
  widths(tail, 240, 100);
  expect(isCut(host.querySelector("button"))).toBe(true);
});

it("shows the full text in the app's hint only when the row cuts it, on keyboard focus too (P2-20)", async () => {
  await row();
  widths(host.querySelector("[data-path-tail]")!, 100, 100);
  await focusRow();
  expect(hint()).toBeNull();
  await act(async () => host.querySelector("button")!.blur());

  widths(host.querySelector("[data-path-tail]")!, 240, 100);
  await focusRow();
  expect(hint()?.textContent).toContain(".github/workflows/ci.yml");
  // Never a native title on the row.
  expect(host.querySelector("[title]")).toBeNull();
});

it("shows the hint whole when asked to (what the row only shows as a sign)", async () => {
  await row(true);
  widths(host.querySelector("[data-path-tail]")!, 100, 100);
  await focusRow();
  expect(hint()?.textContent).toContain(".github/workflows/ci.yml");
});
