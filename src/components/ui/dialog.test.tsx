// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { OVERLAY_TOP } from "@/shell/overlayBounds";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";

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

it("never grows past the window nor over the title bar: centred, capped at its height less OVERLAY_TOP above and below, it scrolls (P2-37)", async () => {
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
  expect(content.className).toContain(`max-h-[calc(100dvh-${2 * OVERLAY_TOP}px)]`);
  expect(content.className).toContain("top-1/2");
  expect(content.className).toContain("overflow-y-auto");
  await act(async () => root.unmount());
});

it("keeps the header and the footer of a tall dialog in view: its DialogBody scrolls between them", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>t</DialogTitle>
            <DialogDescription>d</DialogDescription>
          </DialogHeader>
          <DialogBody>sections</DialogBody>
          <DialogFooter>f</DialogFooter>
        </DialogContent>
      </Dialog>,
    ),
  );
  const content = document.querySelector("[data-slot='dialog-content']")!;
  // A column once it holds a body, so the body is what shrinks; a dialog without one stays a grid that scrolls whole.
  expect(content.className.split(/\s+/)).toEqual(expect.arrayContaining(["grid", "has-data-[slot=dialog-body]:flex", "has-data-[slot=dialog-body]:flex-col"]));
  const body = document.querySelector("[data-slot='dialog-body']")!;
  expect(body.className.split(/\s+/)).toEqual(expect.arrayContaining(["min-h-0", "overflow-y-auto", "-mx-4", "px-4"]));
  expect(body.contains(document.querySelector("[data-slot='dialog-footer']"))).toBe(false);
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

describe("the keyboard after a close (the focus contract)", () => {
  /** A dialog with no trigger of its own, opened as a command, a shortcut or a menu item opens one. */
  function Opened({ open, onClose, onCloseAutoFocus }: { open: boolean; onClose: () => void; onCloseAutoFocus?: (event: Event) => void }) {
    return (
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
          <DialogTitle>t</DialogTitle>
          <DialogDescription>d</DialogDescription>
          <input aria-label="field" autoFocus />
        </DialogContent>
      </Dialog>
    );
  }

  async function cycle(opener: HTMLElement | null, between?: () => void, onCloseAutoFocus?: (event: Event) => void) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    opener?.focus();
    await act(async () => root.render(<Opened open onClose={() => undefined} onCloseAutoFocus={onCloseAutoFocus} />));
    // The dialog has the keyboard: its field took it as it opened.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("field");
    between?.();
    await act(async () => root.render(<Opened open={false} onClose={() => undefined} onCloseAutoFocus={onCloseAutoFocus} />));
    // Radix gives the keyboard back once the content is gone, on a timer.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await act(async () => root.unmount());
    host.remove();
  }

  const button = (label: string) => {
    const element = document.createElement("button");
    element.textContent = label;
    document.body.append(element);
    return element;
  };

  it("gives the keyboard back to what had it when the dialog opened: a row, a button, the element the palette was opened from", async () => {
    const row = button("row");
    await cycle(row);
    expect(document.activeElement).toBe(row);
    row.remove();
  });

  it("gives it back to the menu's trigger when a menu item opened it: the item goes with its menu", async () => {
    const trigger = button("Settings");
    trigger.id = "settings-trigger";
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-labelledby", "settings-trigger");
    const item = document.createElement("div");
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    menu.append(item);
    document.body.append(menu);
    await cycle(item, () => menu.remove());
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("leaves the keyboard where something else took it as the dialog closed: a terminal a launch gave it to", async () => {
    const row = button("row");
    const terminal = document.createElement("textarea");
    document.body.append(terminal);
    // Taken during the close, once the dialog no longer holds it (a modal keeps it until it closes).
    await cycle(row, () => setTimeout(() => terminal.focus(), 0));
    expect(document.activeElement).toBe(terminal);
    row.remove();
    terminal.remove();
  });

  it("lets a dialog's own close handling decide: one that prevents it keeps the keyboard where it put it", async () => {
    const row = button("row");
    const elsewhere = button("elsewhere");
    await cycle(row, undefined, (event) => {
      event.preventDefault();
      elsewhere.focus();
    });
    expect(document.activeElement).toBe(elsewhere);
    row.remove();
    elsewhere.remove();
  });
});

it("gives the keyboard back to the menu's button when one of its items opened the dialog (Settings → Troubleshooting), with the app's own menu", async () => {
  function Menued() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button">Settings</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setOpen(true)}>Troubleshooting</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>t</DialogTitle>
            <DialogDescription>d</DialogDescription>
          </DialogContent>
        </Dialog>
      </>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Menued />));
  const trigger = host.querySelector("button")!;
  trigger.focus();
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  const item = document.querySelector<HTMLElement>('[role="menuitem"]')!;
  expect(item.closest('[role="menu"]')!.getAttribute("aria-labelledby")).toBe(trigger.id);
  item.focus();
  await act(async () => item.click());
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.contains(document.activeElement)).toBe(true);
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await act(async () => root.unmount());
  host.remove();
});
