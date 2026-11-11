// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { openLogDir } from "@/app/logs";
import { relaunchTerminal } from "@/nodes/terminal/registry";
import { nodesStore } from "@/store/nodes";
import { blend, contrast } from "@/theme/colorMath";
import { cssBlock, readSource } from "@/theme/cssBlocks";
import { ToolsUnavailable } from "./ToolsUnavailable";

vi.mock("@/nodes/terminal/registry", () => ({ relaunchTerminal: vi.fn(() => Promise.resolve()) }));
vi.mock("@/app/logs", () => ({ openLogDir: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("says why the fleet did not start, and retries it", async () => {
  mockIPC(() => undefined);
  const session = { title: "Fleet", name: "Fleet", agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "", role: "orchestrator" as const, claudeSessionId: "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10" };
  await nodesStore.getState().create("o", { workspaceId: "w", kind: "fleet", payload: { name: "Fleet", session } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const message = "dummyPlane tools unavailable: the local dummyPlane server did not start.";
  await act(async () => root.render(<ToolsUnavailable nodeId="o" message={message} />));
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("dummyPlane tools unavailable");
  expect(alert.textContent).toContain("the local dummyPlane server did not start");
  const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
  await act(async () => button("Try again").click());
  expect(relaunchTerminal).toHaveBeenCalledWith("o", session, "resume");
  await act(async () => button("Open the logs folder").click());
  expect(openLogDir).toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("reads at 4.5:1 in every palette, its focus ring at 3:1: each text on the ground it is drawn on (P1-11)", async () => {
  mockIPC(() => undefined);
  const tokens = readSource("theme/tokens.css");
  const palettes = {
    calm: ':root[data-palette="calm"]',
    electric: ':root[data-palette="electric"]',
    expressive: ':root, :root[data-palette="expressive"]',
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ToolsUnavailable nodeId="o" message="x" />));
  const classes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);
  /** The token an element's own `<prefix>-dp-…` class names, without a variant or an alpha. */
  const own = (el: Element, prefix: string) => classes(el).map((c) => new RegExp(`^${prefix}-dp-([\\w-]+)$`).exec(c)?.[1]).find(Boolean);
  /** The nearest opaque ground under an element: its own fill or an ancestor's. */
  const ground = (el: Element): string => {
    for (let at: Element | null = el; at; at = at.parentElement) {
      const fill = own(at, "bg");
      if (fill) return fill;
    }
    throw new Error(`no ground under ${el.outerHTML}`);
  };
  const texts = [...host.querySelectorAll("p, button")];
  expect(texts.length).toBe(5);
  for (const [palette, selector] of Object.entries(palettes)) {
    const t = cssBlock(tokens, selector);
    for (const el of texts) {
      const ink = own(el, "text")!;
      const bg = ground(el);
      expect(contrast(t[`--dp-${ink}`], t[`--dp-${bg}`]), `${palette}: ${el.textContent} in ${ink} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      if (el.tagName === "BUTTON") {
        const ring = classes(el).map((c) => /^focus-visible:ring-dp-accent\/(\d+)$/.exec(c)?.[1]).find(Boolean)!;
        const under = t[`--dp-${bg}`];
        expect(contrast(blend(under, t["--dp-accent"], Number(ring) / 100), under), `${palette} ring /${ring} on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  }
  await act(async () => root.unmount());
});
