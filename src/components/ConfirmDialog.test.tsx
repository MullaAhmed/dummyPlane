// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { confirmAction } from "./confirm";
import { ConfirmDialog } from "./ConfirmDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ConfirmDialog />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

const request = { title: "Delete “API”?", description: "Batman will be stopped.", confirm: "Delete", cancel: "Cancel", destructive: true };
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;

it("asks in the app's own dialog, not the system's, and answers yes on its action", async () => {
  let answer: Promise<boolean> = Promise.resolve(false);
  await act(async () => {
    answer = confirmAction(request);
  });
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Delete “API”?");
  expect(dialog.textContent).toContain("Batman will be stopped.");
  await act(async () => button("Delete").click());
  await expect(answer).resolves.toBe(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("answers no on Cancel, and Cancel is where the keyboard starts", async () => {
  let answer: Promise<boolean> = Promise.resolve(true);
  await act(async () => {
    answer = confirmAction(request);
  });
  expect(document.activeElement?.textContent).toBe("Cancel");
  await act(async () => button("Cancel").click());
  await expect(answer).resolves.toBe(false);
});

it("answers no when dismissed with Escape", async () => {
  let answer: Promise<boolean> = Promise.resolve(true);
  await act(async () => {
    answer = confirmAction(request);
  });
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await expect(answer).resolves.toBe(false);
});

it("answers no to a question still open when another one comes", async () => {
  let first: Promise<boolean> = Promise.resolve(true);
  await act(async () => {
    first = confirmAction(request);
    confirmAction({ ...request, title: "Remove “Web”?" });
  });
  await expect(first).resolves.toBe(false);
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Remove “Web”?");
});
