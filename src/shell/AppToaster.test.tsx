// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { expect, it } from "vitest";
import { themeStore } from "@/app/theme";
import { buttonVariants } from "@/components/ui/button";
import { TOAST_CLASSES } from "@/components/ui/sonner";
import { readSource } from "@/theme/cssBlocks";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { AppToaster, TOAST_BOTTOM, TOAST_RIGHT } from "./AppToaster";
import { LANE_BOTTOM, LANE_RIGHT } from "./layout";
import { TOAST_IN_BAND, TOAST_WIDTH, useKeepToastsOff } from "./toastLift";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps every toast in the bottom-right corner, above the zoom control", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AppToaster />));
  await act(async () => {
    toast.custom(() => <div>Resume all conversations?</div>, { duration: Infinity });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  const toaster = host.querySelector<HTMLElement>('[data-sonner-toaster][data-y-position="bottom"][data-x-position="right"]');
  expect(toaster).not.toBeNull();
  expect(parseFloat(toaster!.style.getPropertyValue("--offset-bottom"))).toBe(TOAST_BOTTOM);
  expect(TOAST_BOTTOM).toBeGreaterThanOrEqual(14 + 32 + 12);
  // At the right lane's foot, on its edge: clear of the activity rail (shell/layout.ts).
  expect([TOAST_BOTTOM, TOAST_RIGHT]).toEqual([LANE_BOTTOM, LANE_RIGHT]);
  expect(parseFloat(toaster!.style.getPropertyValue("--offset-right"))).toBe(TOAST_RIGHT);
  await act(async () => root.unmount());
  host.remove();
});

it("follows the app's theme, live", async () => {
  themeStore.setState({ choice: "calm" });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AppToaster />));
  await act(async () => {
    toast("Instruction sent");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  const toaster = () => host.querySelector<HTMLElement>("[data-sonner-toaster]")!;
  expect(toaster().dataset.sonnerTheme).toBe("light");
  await act(async () => themeStore.setState({ choice: "expressive" }));
  expect(toaster().dataset.sonnerTheme).toBe("dark");
  await act(async () => root.unmount());
  host.remove();
});

it("draws each type in its tone and its own icon, the text in the app's text roles (Alerts)", async () => {
  themeStore.setState({ choice: "expressive" });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AppToaster />));
  await act(async () => {
    toast.success("Synced with owner/repo");
    toast.info("Codex signs in to Linear in its terminal");
    toast.warning("Update on hold");
    toast.error("Could not save the canvas", { description: "Access is denied." });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  const ofType = (type: string) => host.querySelector<HTMLElement>(`[data-sonner-toast][data-type="${type}"]`)!;
  const icons = new Set<string>();
  for (const [type, tone] of Object.entries({ success: "text-dp-ok", info: "text-dp-accent-ink", warning: "text-dp-wait", error: "text-dp-danger" })) {
    const icon = ofType(type).querySelector("[data-icon] svg")!;
    expect(icon.getAttribute("class"), type).toContain(tone);
    // Never the colour alone: each type has its own shape.
    icons.add(icon.getAttribute("class")!.split(/\s+/).find((c) => c.startsWith("lucide-") && c !== "lucide-icon")!);
    // The title stays the text role, whatever the tone.
    expect(ofType(type).querySelector("[data-title]")!.className, type).toContain("text-dp-text");
    expect(ofType(type).querySelector("[data-title]")!.className, type).not.toMatch(/text-dp-(ok|wait|danger|accent)/);
  }
  expect(icons.size).toBe(4);
  expect(ofType("error").querySelector("[data-description]")!.className).toContain("text-dp-text-2");
  await act(async () => root.unmount());
  host.remove();
});

it("draws a toast's action and cancel as the app's buttons: the outline and the quiet ghost, with the ring and the press", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AppToaster />));
  await act(async () => {
    toast("Card deleted", { action: { label: "Undo", onClick: () => undefined }, cancel: { label: "Keep it", onClick: () => undefined } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  const action = host.querySelector<HTMLButtonElement>("[data-button][data-action]")!;
  const cancel = host.querySelector<HTMLButtonElement>("[data-button][data-cancel]")!;
  expect(action.className).toBe(buttonVariants({ variant: "outline", size: "sm" }));
  expect(cancel.className).toBe(TOAST_CLASSES.cancelButton);
  expect(cancel.className.split(/\s+/)).toEqual(expect.arrayContaining(["text-dp-text-2", "hover:text-dp-text", "hover:bg-dp-hover"]));
  for (const button of [action, cancel]) {
    for (const part of ["h-7", "rounded-md", "focus-visible:ring-2", "focus-visible:ring-dp-accent/70", "active:scale-[0.97]", "motion-reduce:active:scale-100"]) {
      expect(button.className.split(/\s+/), `${button.textContent}: ${part}`).toContain(part);
    }
  }
  await act(async () => root.unmount());
  host.remove();
});

it("hands every toast's parts back to the app's classes: a plain Undo toast as much as a typed one (index.css)", async () => {
  const index = readSource("index.css");
  const at = index.indexOf("revert-layer");
  const rule = index.slice(index.lastIndexOf("}", at) + 1, index.indexOf("{", index.lastIndexOf("}", at) + 1)).replace(/\/\*[\s\S]*?\*\//g, "").trim();
  // The toast's own part of the selector, before the parts it hands back.
  const toastPart = rule.slice(0, rule.indexOf(" :is(")).trim();
  expect(toastPart).toContain("[data-sonner-toast]");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AppToaster />));
  await act(async () => {
    toast("Card deleted", { action: { label: "Undo", onClick: () => undefined } });
    toast.error("Could not save the canvas", { description: "Access is denied." });
    toast.loading("Updating…");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  // Sonner keeps the earlier tests' toasts: these three, by their text.
  const all = [...host.querySelectorAll<HTMLElement>("[data-sonner-toast]")];
  const toasts = ["Card deleted", "Could not save the canvas", "Updating…"].map((text) => all.find((item) => item.textContent?.includes(text))!);
  expect(toasts.every(Boolean)).toBe(true);
  for (const item of toasts) {
    expect(item.matches(toastPart), `${item.textContent}: ${toastPart}`).toBe(true);
  }
  // A plain toast has no data-type: the rule must not ask for one.
  expect(toasts.find((item) => item.textContent?.includes("Card deleted"))!.hasAttribute("data-type")).toBe(false);
  await act(async () => root.unmount());
  host.remove();
});

it("lifts the toasts clear of a rail popover while it is open, and lets them down when it closes", async () => {
  const size = { innerWidth: window.innerWidth, innerHeight: window.innerHeight };
  Object.assign(window, { innerWidth: 960, innerHeight: 600 });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AppToaster />));
  await act(async () => {
    toast("Instruction sent", { duration: Infinity });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  const offset = () => parseFloat(host.querySelector<HTMLElement>("[data-sonner-toaster]")!.style.getPropertyValue("--offset-bottom"));
  expect(offset()).toBe(TOAST_BOTTOM);
  // A portal on <body>, as Radix mounts the notifications' popover: 384x197 at (511, 315).
  const portal = document.createElement("div");
  const panel = document.createElement("div");
  panel.setAttribute("data-rail-overlay", "");
  panel.getBoundingClientRect = () => ({ x: 511, y: 315, left: 511, top: 315, right: 895, bottom: 512, width: 384, height: 197, toJSON: () => ({}) });
  portal.append(panel);
  await act(async () => {
    document.body.append(portal);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  });
  expect(offset()).toBe(600 - 315 + 12);
  await act(async () => {
    portal.remove();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  expect(offset()).toBe(TOAST_BOTTOM);
  await act(async () => root.unmount());
  host.remove();
  Object.assign(window, size);
});

it("keeps off an open work window: down in the bottom band under one that spans the window, back when it closes", async () => {
  const size = { innerWidth: window.innerWidth, innerHeight: window.innerHeight };
  Object.assign(window, { innerWidth: 960, innerHeight: 600 });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  // The review panel at 960x600: 108 to 890, under the bars (84) to the command band (528).
  const Review = () => {
    const aside = useRef<HTMLElement>(null);
    const ref = useKeepToastsOff(aside);
    return (
      <aside
        ref={(element) => {
          if (element) element.getBoundingClientRect = () => ({ x: 108, y: 84, left: 108, top: 84, right: 890, bottom: 528, width: 782, height: 444, toJSON: () => ({}) });
          return ref(element);
        }}
      />
    );
  };
  const toaster = () => host.querySelector<HTMLElement>("[data-sonner-toaster]")!;
  const offset = () => parseFloat(toaster().style.getPropertyValue("--offset-bottom"));
  await act(async () => root.render(<AppToaster />));
  await act(async () => {
    toast.warning("Batman is waiting for an answer", { duration: Infinity });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  expect(offset()).toBe(TOAST_BOTTOM);
  // The lane's width, the kit's own variables kept.
  expect(toaster().style.getPropertyValue("--width")).toBe(`${TOAST_WIDTH}px`);
  expect(toaster().style.getPropertyValue("--normal-bg")).toBe("var(--dp-surface)");
  await act(async () => root.render(<><AppToaster /><Review /></>));
  expect(offset()).toBe(TOAST_IN_BAND);
  await act(async () => root.render(<AppToaster />));
  expect(offset()).toBe(TOAST_BOTTOM);
  await act(async () => root.unmount());
  host.remove();
  Object.assign(window, size);
});

it("follows a Fleet's mission panel as the canvas moves it, keeping off it where it meets the toasts", async () => {
  const size = { innerWidth: window.innerWidth, innerHeight: window.innerHeight };
  Object.assign(window, { innerWidth: 960, innerHeight: 600 });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  // The row on screen follows the view's scroll, as Excalidraw moves the node.
  const rowAt = () => {
    const top = 477 + canvasStore.getState().view.scrollY;
    return { x: 162, y: top, left: 162, top, right: 798, bottom: top + 45, width: 636, height: 45, toJSON: () => ({}) };
  };
  const Actions = () => {
    const row = useRef<HTMLDivElement>(null);
    const ref = useKeepToastsOff(row);
    return (
      <div
        ref={(element) => {
          if (element) element.getBoundingClientRect = rowAt;
          return ref(element);
        }}
      />
    );
  };
  const offset = () => parseFloat(host.querySelector<HTMLElement>("[data-sonner-toaster]")!.style.getPropertyValue("--offset-bottom"));
  canvasStore.setState({ view: { ...EMPTY_VIEW, width: 960, height: 600, scrollY: -300 } });
  await act(async () => root.render(<><AppToaster /><Actions /></>));
  await act(async () => {
    toast("Batman, Superman and 1 other joined the mission", { duration: Infinity });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  // Scrolled up out of the toasts' way: they stand at the lane's foot.
  expect(offset()).toBe(TOAST_BOTTOM);
  // The view moves it down onto their place: they stand above it.
  await act(async () => canvasStore.setState({ view: { ...canvasStore.getState().view, scrollY: 0 } }));
  expect(offset()).toBe(600 - 477 + 12);
  await act(async () => root.unmount());
  host.remove();
  canvasStore.setState({ view: EMPTY_VIEW });
  Object.assign(window, size);
});
