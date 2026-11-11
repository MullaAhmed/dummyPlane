// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { usageStore } from "@/usage/usageStore";
import { UsageMeter } from "./UsageMeter";

vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STATUS = {
  session_id: "s1",
  model: { id: "claude-haiku-5-5", display_name: "Haiku 5.5" },
  cost: { total_api_duration_ms: 95_000, total_cost_usd: 0.00738, total_duration_ms: 3_900_000, total_lines_added: 12, total_lines_removed: 3 },
  context_window: { total_input_tokens: 67_785, total_output_tokens: 4_200, used_percentage: 7 },
  rate_limits: { five_hour: { resets_at: 4102444800, used_percentage: 29 }, seven_day: { resets_at: 4102531200, used_percentage: 93 } },
  prompt_cache: { warm: true, hit_ratio: 0.48, expires_at: 4102444800, ttl: "1h" },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  mockIPC(() => undefined);
  usageStore.setState({ sessions: {}, limits: null });
  terminalStatusStore.setState({ statuses: {} });
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<UsageMeter />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.replaceChildren();
});

const meter = () => host.querySelector<HTMLButtonElement>("[data-usage]")!;
const hint = () => document.querySelector('[role="tooltip"]')?.textContent ?? null;

it("says no Claude session yet when none is running, whatever the Git Bash state", async () => {
  mockIPC((cmd) => (cmd === "diagnostics" ? { gitBash: null } : undefined));
  await act(async () => root.render(<UsageMeter />));
  expect(meter().textContent).toBe("Usage· no Claude session yet");
  expect(meter().hasAttribute("title"), "a hint, not a native title").toBe(false);
  await act(async () => meter().focus());
  expect(hint()).toContain("first reply");
});

it("waits for a Claude session's first answer before showing the limits (spec maj §6)", async () => {
  await act(async () => terminalStatusStore.getState().set("batman", { state: "running" }));
  expect(meter().textContent).toBe("Usage· waiting for the first answer");
  await act(async () => meter().focus());
  expect(hint()).toContain("first reply");
});

it("says usage needs Git Bash when a running Claude session has none", async () => {
  mockIPC((cmd) => (cmd === "diagnostics" ? { gitBash: null } : undefined));
  await act(async () => terminalStatusStore.getState().set("batman", { state: "running" }));
  expect(meter().textContent).toBe("Usage· usage needs Git Bash");
});

it("keeps waiting for the first answer when Git Bash is found", async () => {
  mockIPC((cmd) => (cmd === "diagnostics" ? { gitBash: "C:/Git/bin/bash.exe" } : undefined));
  await act(async () => terminalStatusStore.getState().set("batman", { state: "running" }));
  expect(meter().textContent).toBe("Usage· waiting for the first answer");
});

it("shows the session's and the week's use of the plan in the title bar, then the detail on a click", async () => {
  await act(async () => usageStore.getState().apply({ nodeId: "batman", status: STATUS }, 1_000));
  expect(meter().textContent).toContain("Session 29%");
  expect(meter().textContent).toContain("Week 93%");
  expect(meter().querySelector('[data-tone="over"]')).not.toBeNull();
  await act(async () => meter().click());
  const detail = document.querySelector("[data-usage-detail]")!.textContent!;
  for (const piece of ["Session (5 h)", "Week (all models)", "Week (Fable)", "Total cost", "$0.0074", "API time", "1 min", "Elapsed time", "1 h 05", "+12", "−3", "Haiku 5.5", "67.8 k", "CO₂", "Batman", "warm", "48%"]) {
    expect(detail).toContain(piece);
  }
});

it("opens the 30-day tokens from the detail, and comes back to it", async () => {
  mockIPC((cmd) => (cmd === "token_usage" ? { days: [], sessions: [], models: [], filesScanned: 0, truncated: false } : undefined));
  await act(async () => meter().click());
  const link = [...document.querySelectorAll<HTMLButtonElement>("[data-usage-detail] button")].find((b) => b.textContent?.includes("Tokens over 30 days"))!;
  await act(async () => link.click());
  expect(document.querySelector("[data-tokens]")).not.toBeNull();
  expect(document.querySelector("[data-usage-detail]")).toBeNull();
  // The link is gone: the keyboard is on Back, not on the page behind the popover.
  expect(document.activeElement).toBe(document.querySelector('[data-tokens] [aria-label="Usage"]'));
  await act(async () => document.querySelector<HTMLButtonElement>('[data-tokens] [aria-label="Usage"]')!.click());
  expect(document.querySelector("[data-usage-detail]")).not.toBeNull();
  // Back gives it to the link that opened the tokens.
  expect(document.activeElement).toBe(document.querySelector("[data-tokens-link]"));
});
