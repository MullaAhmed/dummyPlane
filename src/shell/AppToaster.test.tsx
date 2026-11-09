// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { expect, it } from "vitest";
import { themeStore } from "@/app/theme";
import { AppToaster, TOAST_BOTTOM } from "./AppToaster";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps every toast in the bottom-right corner, above the zoom control (spec identité §5.8)", async () => {
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
