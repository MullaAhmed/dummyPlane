// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { LaunchOptions } from "./launchAgent";
import { LaunchOptionsForm } from "./LaunchOptionsForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VALUE: LaunchOptions = { cwd: "D:/wt/isis", shell: "powershell", title: "Isis", command: "" };

let root: Root;
const onChange = vi.fn();

beforeEach(() => {
  onChange.mockClear();
  mockIPC(() => undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  clearMocks();
  document.body.replaceChildren();
});

async function mount(folderLocked?: string) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<LaunchOptionsForm value={VALUE} shells={["powershell"]} showCommand={false} folderLocked={folderLocked} onChange={onChange} />));
}

/** The field the "Folder" label names, through its `for`. */
const folder = () => {
  const label = [...document.body.querySelectorAll("label")].find((l) => l.textContent === "Folder")!;
  return document.getElementById(label.htmlFor) as HTMLInputElement;
};
const browse = () => document.body.querySelector('[aria-label="Browse"]');

it("edits the launch folder and offers Browse, with no hint, unless it is locked", async () => {
  await mount();
  expect(folder().value).toBe("D:/wt/isis");
  expect(folder().readOnly).toBe(false);
  expect(folder().hasAttribute("aria-describedby")).toBe(false);
  expect(browse()).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(folder(), "D:/other");
    folder().dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith({ ...VALUE, cwd: "D:/other" });
});

it("shows a locked folder as it is, read-only and still focusable, with the reason under it and no Browse", async () => {
  await mount("Fixed while its mission runs");
  expect(folder().value).toBe("D:/wt/isis");
  expect(folder().readOnly).toBe(true);
  expect(folder().disabled).toBe(false);
  expect(document.getElementById(folder().getAttribute("aria-describedby")!)!.textContent).toBe("Fixed while its mission runs");
  expect(browse()).toBeNull();
  // The other fields stay as they were.
  expect([...document.body.querySelectorAll("label")].map((l) => l.textContent)).toEqual(["Folder", "Shell", "Title"]);
});
