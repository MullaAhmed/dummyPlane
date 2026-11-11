// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { TITLE_BAR_HEIGHT } from "./layout";
import { TitleBar } from "./TitleBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockWindows("main");
  mockIPC((cmd) => (cmd === "plugin:window|is_maximized" ? false : undefined), { shouldMockEvents: true });
});
afterEach(() => clearMocks());

it("moves the window from its empty space only, with the logo, its content and the window buttons", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<TitleBar leading={<button type="button">mk-webapp</button>} trailing={<span>3</span>} />));
  const bar = host.firstElementChild as HTMLElement;
  expect(bar.style.height).toBe(`${TITLE_BAR_HEIGHT}px`);
  // Bare attributes: Tauri drags only on clicks aimed at the bar, its columns or their spacers.
  const regions = [...host.querySelectorAll("[data-tauri-drag-region]")];
  expect(regions.map((r) => r.getAttribute("data-tauri-drag-region"))).toEqual(["", "", "", "", ""]);
  expect(regions[0]).toBe(bar);
  expect(regions[1]).toBe(bar.querySelector("[data-title-columns]"));
  // Past the bar and its columns, the regions are spacers and the logo: no button in them.
  for (const spacer of regions.slice(2)) expect(spacer.querySelector("button")).toBeNull();
  expect(bar.querySelector("svg rect")!.getAttribute("fill")).toBe("currentColor");
  for (const label of ["Minimize", "Maximize", "Close dummyPlane"]) expect(host.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
  await act(async () => root.unmount());
  host.remove();
});

it("centers its middle element between equal sides, which never cover it, and the middle does not drag", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<TitleBar leading={<span>dummyPlane</span>} center={<button type="button">Search</button>} />));
  const bar = host.firstElementChild as HTMLElement;
  const columns = bar.querySelector<HTMLElement>("[data-title-columns]")!;
  // The sides take at least their content's width, the middle what remains:
  // the usage meter no longer runs over the search field (README review).
  expect(columns.style.gridTemplateColumns).toBe("minmax(max-content, 1fr) minmax(0, auto) minmax(max-content, 1fr)");
  const center = [...host.querySelectorAll("button")].find((b) => b.textContent === "Search")!;
  expect(center.parentElement!.parentElement).toBe(columns);
  expect(center.parentElement!.className).toContain("min-w-0");
  expect(center.closest("[data-tauri-drag-region]")).toBe(columns);
  await act(async () => root.unmount());
  host.remove();
});

it("keeps Minimize, Maximize and Close out of the columns: a side too wide is cut, never the window buttons", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<TitleBar leading={<span>dummyPlane</span>} trailing={<span>usage</span>} />));
  const bar = host.firstElementChild as HTMLElement;
  const columns = bar.querySelector<HTMLElement>("[data-title-columns]")!;
  const close = host.querySelector('[aria-label="Close dummyPlane"]')!;
  // The columns shrink and clip (a 960 px window with an update and a model limit); the buttons sit beside them.
  expect(columns.className).toContain("min-w-0");
  expect(columns.className).toContain("overflow-hidden");
  expect(columns.contains(close)).toBe(false);
  expect(bar.lastElementChild!.contains(close)).toBe(true);
  expect((bar.lastElementChild as HTMLElement).className).toContain("shrink-0");
  await act(async () => root.unmount());
  host.remove();
});
