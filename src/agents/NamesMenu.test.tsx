// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NamesMenu } from "./NamesMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const onPick = vi.fn();

async function open(current?: string) {
  await act(async () =>
    root.render(
      <DropdownMenu open>
        <DropdownMenuTrigger />
        <DropdownMenuContent>
          <NamesMenu current={current} onPick={onPick} />
        </DropdownMenuContent>
      </DropdownMenu>,
    ),
  );
  const trigger = document.querySelector('[data-slot="dropdown-menu-sub-trigger"]')!;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
}

const radios = () => [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-content"] [role="menuitemradio"]')];

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("lists the pantheons, and says which one is in force next to its title", async () => {
  await open("marvel");
  expect(document.querySelector('[data-slot="dropdown-menu-sub-trigger"]')!.textContent).toBe("PantheonMarvel");
  expect(radios().map((r) => r.textContent)).toEqual(["DC", "Marvel", "Throne of Glass", "Star Wars", "Lord of the Rings"]);
  expect(radios().map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false", "false"]);
});

it("checks the pantheon an old mythology reads as", async () => {
  await open("norse");
  expect(radios().map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false", "true", "false", "false"]);
});

it("tells the pantheon picked, and that it only applies to the agents added next", async () => {
  await open("dc");
  await act(async () => radios()[3].click());
  expect(onPick).toHaveBeenCalledWith("star-wars");
  expect(document.querySelector('[data-slot="dropdown-menu-sub-content"]')!.textContent).toContain("Applies to agents added from now on.");
});
