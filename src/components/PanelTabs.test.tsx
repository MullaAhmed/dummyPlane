// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PanelTabs, PanelTabsContent, PanelTabsList, PanelTabsTrigger, PanelToggleItem } from "./PanelTabs";
import { ToggleGroup } from "./ui/toggle-group";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function mount(look: "soft" | "line", onValueChange = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <PanelTabs value="one" onValueChange={onValueChange}>
        <PanelTabsList look={look}>
          <PanelTabsTrigger value="one">One</PanelTabsTrigger>
          <PanelTabsTrigger value="two">Two</PanelTabsTrigger>
        </PanelTabsList>
        <PanelTabsContent value="one">First</PanelTabsContent>
        <PanelTabsContent value="two">Second</PanelTabsContent>
      </PanelTabs>,
    ),
  );
  return onValueChange;
}

const tab = (name: string) => [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name)!;
const classes = (el: Element) => [...el.classList];

it("draws soft tabs on the control scale, tinting on hover with --dp-hover and keeping the chosen tab's tint under the pointer", async () => {
  await mount("soft");
  for (const name of ["One", "Two"]) {
    expect(classes(tab(name))).toEqual(expect.arrayContaining(["h-7", "hover:bg-dp-hover", "focus-visible:ring-2", "focus-visible:ring-dp-accent/70", "active:scale-[0.97]"]));
  }
  expect(tab("One").dataset.state).toBe("active");
  expect(classes(tab("One"))).toEqual(expect.arrayContaining(["data-active:bg-dp-accent-soft", "data-active:hover:bg-dp-accent-soft"]));
});

it("moves on the motion tokens, listing the properties it transitions, and shifts nothing on hover", async () => {
  await mount("soft");
  const all = [...classes(tab("One")), ...classes(tab("Two"))].join(" ");
  expect(all).not.toMatch(/transition-all|(?<![\w-])duration-\d|(?<![\w-])ease-(out|in|in-out|linear)\b/);
  expect(classes(tab("Two"))).toEqual(expect.arrayContaining(["transition-[background-color,color,scale]", "duration-(--dp-dur-fast)", "ease-(--dp-ease-out)", "motion-reduce:transition-none"]));
  // No hover rule touches the size, the border or the weight: nothing moves when the pointer arrives.
  expect(classes(tab("Two")).filter((c) => /^hover:(p|m|border|font|w-|h-|size)/.test(c))).toEqual([]);
});

it("draws line tabs on a hairline, the chosen one underlined in the accent, as wide as its label", async () => {
  await mount("line");
  expect(classes(document.body.querySelector('[role="tablist"]')!)).toEqual(expect.arrayContaining(["border-b", "border-dp-line"]));
  expect(classes(tab("One"))).toEqual(
    expect.arrayContaining(["h-8", "px-0", "after:bg-dp-accent", "after:duration-(--dp-dur-fast)", "after:ease-(--dp-ease-out)", "focus-visible:ring-2", "focus-visible:ring-dp-accent/70", "hover:text-dp-text", "transition-[color]"]),
  );
  expect(classes(tab("One")).join(" ")).not.toContain("transition-all");
});

it("picks a tab on a bare click too, for assistive tech and scripts", async () => {
  const pick = await mount("soft");
  await act(async () => tab("Two").click());
  expect(pick).toHaveBeenCalledWith("two");
});

it("draws a panel's single-choice items like soft tabs", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <ToggleGroup type="single" value="a">
        <PanelToggleItem value="a">A</PanelToggleItem>
        <PanelToggleItem value="b">B</PanelToggleItem>
      </ToggleGroup>,
    ),
  );
  const items = [...document.body.querySelectorAll("button")];
  expect(items).toHaveLength(2);
  for (const item of items) {
    expect(classes(item)).toEqual(expect.arrayContaining(["h-7", "hover:bg-dp-hover", "focus-visible:ring-2", "focus-visible:ring-dp-accent/70", "duration-(--dp-dur-fast)", "data-[state=on]:bg-dp-accent-soft"]));
  }
});
