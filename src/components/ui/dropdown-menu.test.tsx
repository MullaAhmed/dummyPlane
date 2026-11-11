// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function openMenu(className?: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <DropdownMenu open>
        <DropdownMenuTrigger>⋯</DropdownMenuTrigger>
        <DropdownMenuContent className={className}>
          <DropdownMenuItem>Move to payments-service-migration-runner</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    ),
  );
  const content = document.querySelector("[data-slot='dropdown-menu-content']")!;
  return { classes: [...content.classList], unmount: () => act(async () => root.unmount()) };
}

it("sizes a menu to its rows, at least its trigger's width and 8rem, at most the room beside it (P2-39)", async () => {
  const { classes, unmount } = await openMenu();
  expect(classes).toEqual(expect.arrayContaining(["w-max", "min-w-[max(8rem,var(--radix-dropdown-menu-trigger-width))]", "max-w-(--radix-dropdown-menu-content-available-width)"]));
  // No longer pinned to the trigger: an icon's menu was exactly 128 px, its rows wrapped or clipped.
  expect(classes).not.toContain("w-(--radix-dropdown-menu-trigger-width)");
  expect(classes).not.toContain("min-w-32");
  await unmount();
});

it("still takes a call site's own width", async () => {
  const { classes, unmount } = await openMenu("w-56");
  expect(classes).toContain("w-56");
  expect(classes).not.toContain("w-max");
  await unmount();
});
