// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { HINT_DELAY_MS } from "@/components/ui/tooltip";
import { GreyedHint } from "./GreyedHint";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  cleanups.push(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  return host;
}

it("says why a greyed control is greyed, in the app's hint on a wrapper the pointer reaches", async () => {
  const host = await mount(
    <GreyedHint label="git not found in PATH">
      <button type="button" disabled>
        Pick
      </button>
    </GreyedHint>,
  );
  const button = host.querySelector("button")!;
  expect(button.hasAttribute("title")).toBe(false);
  const wrapper = button.parentElement!;
  expect(wrapper).not.toBe(host);
  await act(async () => {
    wrapper.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, HINT_DELAY_MS + 50)));
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("git not found in PATH");
});

it("leaves a control alone, with no wrapper and no empty hint, when there is nothing to say", async () => {
  const host = await mount(
    <GreyedHint label={null}>
      <button type="button">Pick</button>
    </GreyedHint>,
  );
  expect(host.querySelector("button")!.parentElement).toBe(host);
  expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
});

it("takes the wrapper's layout from the caller", async () => {
  const host = await mount(
    <GreyedHint label="No agent listens" className="flex w-fit max-w-full">
      <button type="button" disabled>
        Send
      </button>
    </GreyedHint>,
  );
  const wrapper = host.querySelector("button")!.parentElement!;
  expect([...wrapper.classList]).toEqual(expect.arrayContaining(["flex", "w-fit", "max-w-full"]));
  expect(wrapper.classList.contains("block")).toBe(false);
});
