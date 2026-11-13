// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arrangeLayoutStore } from "@/app/arrangeLayoutSetting";
import { requestUi } from "@/commands/uiRequests";
import { arrangeAs, type ArrangeTarget } from "./arrangeAs";
import { ArrangeLayoutMenu } from "./ArrangeLayoutMenu";

vi.mock("./arrangeAs", () => ({ arrangeAs: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.clearAllMocks();
  arrangeLayoutStore.setState({ layout: "grid" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ArrangeLayoutMenu />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const scene: ArrangeTarget = { kind: "scene", only: ["a", "b"] };
const ask = (target: ArrangeTarget = scene, at = { x: 120, y: 80 }) => act(async () => requestUi({ kind: "arrangeMenu", workspaceId: "w1", target, at }));
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitemradio"]')];
/** A key, and the tick Radix takes to move the focus a roving key asks for. */
const key = (target: Element, name: string) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("the layout list", () => {
  it("opens where it is asked, with the seven layouts in the Settings order", async () => {
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await ask(scene, { x: 120, y: 80 });
    expect(items().map((i) => i.textContent)).toEqual(["Grid", "One row", "One column", "2 columns", "3 columns", "4 columns", "Tree"]);
    const anchor = document.querySelector<HTMLElement>("[data-arrange-anchor]")!;
    expect([anchor.style.left, anchor.style.top]).toEqual(["120px", "80px"]);
    expect(document.querySelector('[role="menu"]')!.getAttribute("aria-label")).toBe("Arrange as");
  });

  it("ticks the saved default and puts the keyboard on it first", async () => {
    arrangeLayoutStore.setState({ layout: "columns-3" });
    await ask();
    expect(items().map((i) => i.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "false", "true", "false", "false"]);
    expect(document.activeElement).toBe(items()[4]);
  });

  it("moves with Up and Down and picks with Enter: the layout, for the target it was asked for, once, and closes", async () => {
    arrangeLayoutStore.setState({ layout: "row" });
    const target: ArrangeTarget = { kind: "group", id: "g1" };
    await ask(target);
    expect(document.activeElement).toBe(items()[1]);
    await key(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(items()[2]);
    await key(document.activeElement!, "ArrowUp");
    await key(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(items()[0]);
    await key(document.activeElement!, "ArrowDown");
    await key(document.activeElement!, "ArrowDown");
    await key(document.activeElement!, "Enter");
    expect(arrangeAs).toHaveBeenCalledTimes(1);
    expect(arrangeAs).toHaveBeenCalledWith("w1", target, "column");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("picks with a click, the saved default too", async () => {
    await ask();
    await act(async () => void items()[6].click());
    expect(arrangeAs).toHaveBeenLastCalledWith("w1", scene, "tree");
    await ask();
    await act(async () => void items()[0].click());
    expect(arrangeAs).toHaveBeenLastCalledWith("w1", scene, "grid");
    expect(arrangeAs).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape and moves nothing", async () => {
    await ask();
    await key(document.activeElement!, "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(arrangeAs).not.toHaveBeenCalled();
    expect(arrangeLayoutStore.getState().layout).toBe("grid");
  });
});
