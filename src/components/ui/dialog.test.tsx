// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "./dialog";

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
