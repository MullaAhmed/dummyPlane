// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("labels the close button in English", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>t</DialogTitle>
          <DialogDescription>d</DialogDescription>
        </DialogContent>
      </Dialog>,
    ),
  );
  expect(document.querySelector("[data-slot='dialog-close'] .sr-only")?.textContent).toBe("Close");
  await act(async () => root.unmount());
});

it("gives every dialog the same footer and description by default, so no dialog has to re-set them", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>t</DialogTitle>
          <DialogDescription>d</DialogDescription>
          <DialogFooter>f</DialogFooter>
        </DialogContent>
      </Dialog>,
    ),
  );
  const footer = document.querySelector("[data-slot='dialog-footer']")!;
  expect(footer.className).toContain("bg-dp-hover");
  expect(footer.className).toContain("border-dp-line");
  expect(document.querySelector("[data-slot='dialog-description']")!.className).toContain("text-dp-text-2");
  await act(async () => root.unmount());
});

it("never grows past the window: capped at its height, it scrolls, so the title and the buttons stay reachable (P2-37)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>t</DialogTitle>
          <DialogDescription>d</DialogDescription>
        </DialogContent>
      </Dialog>,
    ),
  );
  const content = document.querySelector("[data-slot='dialog-content']")!;
  expect(content.className).toContain("max-h-[calc(100dvh-2rem)]");
  expect(content.className).toContain("overflow-y-auto");
  await act(async () => root.unmount());
});

it("keeps a long title out of the close button's corner, and lets its lines breathe (P2-38)", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (showCloseButton: boolean) =>
    root.render(
      <Dialog open>
        <DialogContent showCloseButton={showCloseButton}>
          <DialogHeader>
            <DialogTitle>Options of payments-service-migration-runner-for-the-staging-cluster</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
  await act(async () => render(true));
  const content = () => document.querySelector("[data-slot='dialog-content']")!;
  const header = () => document.querySelector("[data-slot='dialog-header']")!;
  expect(content().hasAttribute("data-close-button")).toBe(true);
  expect(header().className).toContain("in-data-close-button:pr-8");
  const title = document.querySelector("[data-slot='dialog-title']")!;
  expect(title.className).toContain("leading-snug");
  expect(title.className).toContain("break-words");
  expect(title.className).not.toContain("leading-none");
  // Without the button, nothing to make room for.
  await act(async () => render(false));
  expect(content().hasAttribute("data-close-button")).toBe(false);
  await act(async () => root.unmount());
});
