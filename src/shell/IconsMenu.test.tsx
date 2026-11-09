// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IconsPanel } from "./IconsMenu";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/canvas/icons/thumbnail", () => ({ iconThumbnail: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@/canvas/icons/place", () => ({ insertIcon: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shape = (id: string) => ({ id, type: "rectangle", x: 0, y: 0, width: 10, height: 10 });
const LIBRARIES: Record<string, string[]> = {
  "rohanp__system-design": ["Load Balancer", "Cache"],
  "childishgirl__aws-architecture-icons": ["Amazon S3", "AWS Lambda"],
  "youritjang__azure-cloud-services": ["Azure Load Balancer"],
};

let host: HTMLDivElement;
let root: Root;
const pick = vi.fn();

beforeEach(async () => {
  pick.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const names = Object.entries(LIBRARIES).find(([file]) => url.includes(file))?.[1] ?? [];
      return { ok: true, json: async () => ({ type: "excalidrawlib", version: 2, libraryItems: names.map((name, i) => ({ name, elements: [shape(`${name}${i}`)] })) }) };
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<IconsPanel onPick={pick} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const tiles = () => [...host.querySelectorAll<HTMLButtonElement>("[data-icon]")].map((b) => b.getAttribute("aria-label"));
const tab = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === label)!;

it("shows the system design icons first, then each cloud's (spec maj §4)", async () => {
  expect([...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(["System design", "AWS", "Azure", "GCP"]);
  await vi.waitFor(() => expect(tiles()).toEqual(["Load Balancer", "Cache"]));
  await act(async () => tab("AWS").click());
  await vi.waitFor(() => expect(tiles()).toEqual(["Amazon S3", "AWS Lambda"]));
});

it("searches every category at once", async () => {
  const field = host.querySelector<HTMLInputElement>('[aria-label="Search for an icon"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "load bal");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await vi.waitFor(() => expect(tiles()).toEqual(["Load Balancer", "Azure Load Balancer"]));
});

it("puts the chosen icon on the canvas", async () => {
  await vi.waitFor(() => expect(tiles()).toHaveLength(2));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Cache"]')!.click());
  expect(pick).toHaveBeenCalledWith(expect.objectContaining({ name: "Cache", library: "System Design Components" }));
});
