// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { ModelLevelsDialog } from "./ModelLevelsDialog";
import { modelLevelsStore } from "./modelLevels";
import { SettingsMenu } from "./SettingsMenu";

vi.mock("@excalidraw/excalidraw", () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let saved: { key: string; value: unknown }[];

beforeEach(() => {
  saved = [];
  mockIPC((cmd, args) => {
    if (cmd === "set_setting") saved.push(args as { key: string; value: unknown });
    return cmd === "get_setting" ? null : undefined;
  });
  modelRouterStore.setState({ on: true, levels: {} });
  modelLevelsStore.setState({ open: false });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
});

const field = (level: string) => document.querySelector<HTMLInputElement>(`tr[data-level="${level}"] input[data-cli="codex"]`)!;

/** Types `text` into a field as React reads it, then leaves the field: what saves it. */
async function typeAndLeave(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("Settings' model router", () => {
  it("is a checked entry beside Sub-agents at once, on by default, that turns the global router off", async () => {
    await act(async () => root.render(<SettingsMenu trigger={<button type="button">Settings</button>} />));
    await act(async () => host.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    const entry = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((item) => item.textContent?.includes("Model router"))!;
    expect(entry.getAttribute("aria-checked")).toBe("true");
    const labels = [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')].map((item) => item.textContent?.trim());
    expect(labels.indexOf("Model router")).toBe(labels.findIndex((label) => label?.startsWith("Sub-agents at once")) + 1);
    expect(labels).toContain("Models by level…");
    await act(async () => entry.click());
    expect(modelRouterStore.getState().on).toBe(false);
    expect(saved).toEqual([{ key: "agents.modelRouter", value: false }]);
  });
});

describe("Models by level", () => {
  it("shows Claude's levels and a Codex field per level, empty until the user writes one", async () => {
    modelLevelsStore.setState({ open: true });
    await act(async () => root.render(<ModelLevelsDialog />));
    const rows = [...document.querySelectorAll<HTMLElement>("tr[data-level]")].map((row) => row.textContent);
    expect(rows).toEqual(["LowHaiku 5.5", "MediumSonnet 5.5", "HighOpus 5.5", "ExtremeFable 5.2"]);
    expect(field("faible").value).toBe("");
    expect(field("faible").placeholder).toBe("Its own");
    expect(field("faible").getAttribute("aria-label")).toBe("Codex model for the low level");
  });

  it("saves a model when its field is left, and refuses one its command line would not take", async () => {
    modelLevelsStore.setState({ open: true });
    await act(async () => root.render(<ModelLevelsDialog />));
    await typeAndLeave(field("eleve"), " gpt-big ");
    expect(modelRouterStore.getState().levels).toEqual({ codex: { eleve: "gpt-big" } });
    expect(field("eleve").value).toBe("gpt-big");
    expect(saved[saved.length - 1]).toEqual({ key: "agents.modelRouterLevels", value: { codex: { eleve: "gpt-big" } } });
    await typeAndLeave(field("moyen"), "gpt mid; rm");
    expect(field("moyen").getAttribute("aria-invalid")).toBe("true");
    expect(modelRouterStore.getState().levels).toEqual({ codex: { eleve: "gpt-big" } });
    await typeAndLeave(field("eleve"), "");
    expect(modelRouterStore.getState().levels).toEqual({});
  });

  it("says so while the global router is off", async () => {
    modelRouterStore.setState({ on: false });
    modelLevelsStore.setState({ open: true });
    await act(async () => root.render(<ModelLevelsDialog />));
    expect(document.body.textContent).toContain("The model router is off in Settings");
  });
});
