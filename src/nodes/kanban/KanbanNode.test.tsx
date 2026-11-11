// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement } from "@/canvas/nodeElement";
import { sendCardToTerminal } from "@/kanban/dropOnTerminal";
import { nodesStore } from "@/store/nodes";
import { KanbanNode } from "./KanbanNode";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/kanban/dropOnTerminal", () => ({ endCardDrag: vi.fn(), startCardDrag: vi.fn(), sendCardToTerminal: vi.fn(() => Promise.resolve(true)) }));
const opened = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: opened }));
const github = vi.hoisted(() => ({ syncBoard: vi.fn(() => Promise.resolve(true)) }));
vi.mock("@/kanban/github", async (importOriginal) => ({ ...(await importOriginal<object>()), syncBoard: github.syncBoard }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Types into a React-controlled field. */
function type(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;

it("shows its columns with their counts, and adds a card through the dialog (issue #29)", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("board", {
    workspaceId: "w1",
    kind: "kanban",
    payload: {
      columns: [
        { id: "todo", title: "À faire", cardIds: ["c1"] },
        { id: "done", title: "Fait", cardIds: [] },
      ],
      cards: { c1: { id: "c1", title: "Écrire le test", notes: "", priority: "high" } },
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<KanbanNode nodeId="board" />));

  const columns = [...host.querySelectorAll("[data-column-id]")];
  expect(columns.map((c) => c.querySelector("h3")!.textContent)).toEqual(["À faire", "Fait"]);
  expect(columns.map((c) => c.querySelector('[data-testid="column-count"]')!.textContent)).toEqual(["1", "0"]);
  expect(host.querySelector('[data-card-id="c1"]')!.textContent).toContain("Écrire le test");

  const add = columns[1].querySelector<HTMLButtonElement>('button[aria-label="New card"]')!;
  // The column's buttons name themselves in the app's hint, never a native title.
  expect(add.hasAttribute("title")).toBe(false);
  await act(async () => add.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  // One way out, the footer's Cancel; and every choice pill, due date or priority, is one height.
  expect(dialog.querySelector('[data-slot="dialog-close"]')).toBeNull();
  expect(button("Cancel").getAttribute("data-variant")).toBe("ghost");
  const pills = [...dialog.querySelectorAll('[data-slot="toggle-group-item"]')];
  expect(pills).toHaveLength(8);
  for (const pill of pills) expect(pill.className).toMatch(/\bh-7\b/);
  const title = document.querySelector<HTMLInputElement>("#kanban-card-title")!;
  await act(async () => type(title, "Relire la PR"));
  await act(async () => button("High").click());
  await act(async () => button("Save").click());

  const record = nodesStore.getState().nodes.board;
  if (record?.kind !== "kanban") throw new Error("not a kanban");
  const done = record.payload.columns.find((c) => c.id === "done")!;
  expect(done.cardIds).toHaveLength(1);
  expect(record.payload.cards[done.cardIds[0]]).toMatchObject({ title: "Relire la PR", notes: "", priority: "high" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelectorAll('[data-column-id="done"] [data-card-id]')).toHaveLength(1);

  await act(async () => root.unmount());
  document.body.replaceChildren();
});

it("renders nothing for a node that is not a board", async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<KanbanNode nodeId="chef" />));
  expect(host.innerHTML).toBe("");
  await act(async () => root.unmount());
});

it("opens a linked card's issue from its chip, and syncs a linked board (issue #29)", async () => {
  mockIPC(() => undefined);
  const url = "https://github.com/o/r/issues/7";
  await nodesStore.getState().create("linked", {
    workspaceId: "w1",
    kind: "kanban",
    payload: {
      columns: [{ id: "todo", title: "À faire", cardIds: ["c1"] }],
      cards: { c1: { id: "c1", title: "Bug", notes: "", priority: "none", github: { repo: "o/r", number: 7, url, state: "open" } } },
      github: { repo: "o/r" },
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<KanbanNode nodeId="linked" />));

  const chip = [...host.querySelectorAll("button")].find((b) => b.textContent === "#7")!;
  // A control: its name is its label and its hint, never a native title.
  expect(chip.getAttribute("aria-label")).toBe("Issue o/r#7");
  expect(chip.hasAttribute("title")).toBe(false);
  await act(async () => chip.click());
  expect(opened).toHaveBeenCalledWith(url);
  // The chip opens the issue, not the card's dialog.
  expect(document.querySelector('[role="dialog"]')).toBeNull();

  await act(async () => button("Sync").click());
  expect(github.syncBoard).toHaveBeenCalledWith("linked");

  await act(async () => root.unmount());
  document.body.replaceChildren();
});

it("tints the column a dragged card would land in, and clears the drag on every dragend", async () => {
  mockIPC(() => undefined);
  const { endCardDrag } = await import("@/kanban/dropOnTerminal");
  await nodesStore.getState().create("drag-board", {
    workspaceId: "w1",
    kind: "kanban",
    payload: {
      columns: [
        { id: "todo", title: "To do", cardIds: ["c1"] },
        { id: "done", title: "Done", cardIds: [] },
      ],
      cards: { c1: { id: "c1", title: "Drag me", notes: "", priority: "none" } },
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<KanbanNode nodeId="drag-board" />));
  const data: Record<string, string> = {};
  const transfer = { types: [] as string[], setData: (k: string, v: string) => ((data[k] = v), transfer.types.push(k)), dropEffect: "none", effectAllowed: "all" };
  const fire = (target: Element, type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { dataTransfer: { value: transfer }, clientX: { value: 10 }, clientY: { value: 10 } });
    target.dispatchEvent(event);
  };
  const card = host.querySelector('[data-card-id="c1"]')!;
  expect(card.className).toContain("active:cursor-grabbing");
  const column = (id: string) => host.querySelector(`[data-column-id="${id}"]`)!;
  await act(async () => fire(card, "dragstart"));
  await act(async () => fire(column("done"), "dragover"));
  expect(column("done").hasAttribute("data-drop-target")).toBe(true);
  expect(column("todo").hasAttribute("data-drop-target")).toBe(false);
  expect(column("done").className).toContain("data-drop-target:bg-dp-hover");
  // No fade on the tint: it follows the pointer.
  expect(column("done").className).not.toMatch(/transition/);
  await act(async () => fire(host.querySelector('[data-card-id="c1"]')!, "dragend"));
  expect(column("done").hasAttribute("data-drop-target")).toBe(false);
  expect(endCardDrag).toHaveBeenCalled();
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

/** A key pressed on `target` the way the webview sends it: a native keydown that bubbles and can be cancelled. */
function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

async function mountBoard(id: string, columns: { id: string; title: string; cardIds: string[] }[]) {
  mockIPC(() => undefined);
  const titles: Record<string, string> = { c1: "Write the test", c2: "Review the PR" };
  const cards = Object.fromEntries(columns.flatMap((c) => c.cardIds).map((cardId) => [cardId, { id: cardId, title: titles[cardId] ?? cardId, notes: "", priority: "none" as const }]));
  await nodesStore.getState().create(id, { workspaceId: "w1", kind: "kanban", payload: { columns, cards } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<KanbanNode nodeId={id} />));
  const columnOf = (cardId: string) => {
    const record = nodesStore.getState().nodes[id];
    return record?.kind === "kanban" ? record.payload.columns.find((c) => c.cardIds.includes(cardId)) : undefined;
  };
  const cardButton = (cardId: string) => host.querySelector<HTMLButtonElement>(`[data-card-id="${cardId}"] [data-card-open]`)!;
  const unmount = async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  };
  return { host, columnOf, cardButton, unmount };
}

it("opens a card from the keyboard: its title is a real button, Enter and Space open it, and its keys stay off the canvas (P1-7)", async () => {
  const view = await mountBoard("keys-board", [{ id: "todo", title: "To do", cardIds: ["c1"] }]);
  const canvasKeys = vi.fn();
  view.host.addEventListener("keydown", canvasKeys);
  const open = view.cardButton("c1");
  expect(open.tagName).toBe("BUTTON");
  expect(open.textContent).toBe("Write the test");
  // The card no longer is a "button" holding other buttons; its ring follows its button's keyboard focus.
  const card = view.host.querySelector('[data-card-id="c1"]')!;
  expect(card.getAttribute("role")).toBeNull();
  expect(card.className).toContain("has-[[data-card-open]:focus-visible]:ring-dp-accent/70");
  open.focus();
  const enter = await act(async () => press(open, "Enter"));
  expect(enter.defaultPrevented).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Edit the card");
  expect(canvasKeys).not.toHaveBeenCalled();
  await act(async () => button("Cancel").click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => press(open, " "));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => button("Cancel").click());
  await view.unmount();
});

it("moves a card a column or a place with Alt and the arrows, keeps the keyboard on it and says where it went (P1-7)", async () => {
  const view = await mountBoard("step-board", [
    { id: "todo", title: "To do", cardIds: ["c1", "c2"] },
    { id: "doing", title: "Doing", cardIds: [] },
    { id: "done", title: "Done", cardIds: [] },
  ]);
  const status = () => view.host.querySelector('[role="status"]')!.textContent;
  view.cardButton("c1").focus();
  // A plain arrow is not a move.
  await act(async () => press(view.cardButton("c1"), "ArrowRight"));
  expect(view.columnOf("c1")?.id).toBe("todo");

  const right = await act(async () => press(view.cardButton("c1"), "ArrowRight", { altKey: true }));
  // Alt+Left and Alt+Right are the webview's Back and Forward too.
  expect(right.defaultPrevented).toBe(true);
  expect(view.columnOf("c1")?.id).toBe("doing");
  // The card was mounted again in its new column: the keyboard is back on it there.
  expect(view.host.querySelector('[data-column-id="doing"] [data-card-id="c1"]')).not.toBeNull();
  expect(document.activeElement).toBe(view.cardButton("c1"));
  expect(status()).toBe("Moved to Doing, 1 of 1");

  // Twice in a row, from where the first move left the focus.
  await act(async () => press(document.activeElement!, "ArrowRight", { altKey: true }));
  expect(view.columnOf("c1")?.id).toBe("done");
  expect(document.activeElement).toBe(view.cardButton("c1"));
  // The last column has no right: nothing moves.
  await act(async () => press(document.activeElement!, "ArrowRight", { altKey: true }));
  expect(view.columnOf("c1")?.id).toBe("done");
  await act(async () => press(document.activeElement!, "ArrowLeft", { altKey: true }));
  await act(async () => press(document.activeElement!, "ArrowLeft", { altKey: true }));
  // Back in its first column, at its end.
  expect(view.columnOf("c1")?.cardIds).toEqual(["c2", "c1"]);
  expect(status()).toBe("Moved to To do, 2 of 2");
  expect(document.activeElement).toBe(view.cardButton("c1"));

  await act(async () => press(document.activeElement!, "ArrowUp", { altKey: true }));
  expect(view.columnOf("c1")?.cardIds).toEqual(["c1", "c2"]);
  expect(status()).toBe("Moved to To do, 1 of 2");
  expect(document.activeElement).toBe(view.cardButton("c1"));
  await act(async () => press(document.activeElement!, "ArrowDown", { altKey: true }));
  expect(view.columnOf("c1")?.cardIds).toEqual(["c2", "c1"]);
  expect(document.activeElement).toBe(view.cardButton("c1"));
  // A move never opens the card.
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await view.unmount();
});

it("moves a card and sends it to a terminal from its menu, without a drag and without opening it (P1-7, WCAG 2.5.7)", async () => {
  const view = await mountBoard("menu-board", [
    { id: "todo", title: "To do", cardIds: ["c1", "c2"] },
    { id: "done", title: "Done", cardIds: [] },
  ]);
  const terminal = { ...createNodeElement("terminal", { x: 0, y: 0 }), id: "batman" } as unknown as ExcalidrawElement;
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  canvasStore.setState({ api: { getSceneElements: () => [terminal], getSceneElementsIncludingDeleted: () => [terminal] } as never });
  const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const item = (text: string) => items().find((i) => i.textContent?.startsWith(text))!;
  const subItems = () => [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-content"] [role="menuitem"]')];
  const openMenu = async (cardId: string) => {
    const trigger = view.host.querySelector<HTMLButtonElement>(`[data-card-id="${cardId}"] button[aria-label="Card actions"]`)!;
    // The keyboard opens it from its own button, which Tab reaches after the card's.
    await act(async () => press(trigger, "Enter"));
  };

  await openMenu("c1");
  expect(items().map((i) => i.textContent)).toEqual(["Move to", "Move upAlt+↑", "Move downAlt+↓", "Send to"]);
  // The first card cannot go up.
  expect(item("Move up").hasAttribute("data-disabled")).toBe(true);
  await act(async () => press(item("Move to"), "ArrowRight"));
  // The other columns only, the next one with its key.
  expect(subItems().map((i) => i.textContent)).toEqual(["DoneAlt+→"]);
  await act(async () => subItems()[0].click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(view.columnOf("c1")?.id).toBe("done");
  // The menu's click bubbled through React to the card: it must not have opened it.
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(view.cardButton("c1"));

  await openMenu("c1");
  await act(async () => press(item("Send to"), "ArrowRight"));
  expect(subItems().map((i) => i.textContent)).toEqual(["Batman"]);
  await act(async () => subItems()[0].click());
  expect(sendCardToTerminal).toHaveBeenCalledWith("menu-board", "c1", "batman");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  // With no terminal on the canvas, the submenu says so.
  canvasStore.setState({ api: { getSceneElements: () => [], getSceneElementsIncludingDeleted: () => [] } as never });
  await openMenu("c2");
  await act(async () => press(item("Send to"), "ArrowRight"));
  expect(subItems().map((i) => i.textContent)).toEqual(["No terminal on this canvas"]);
  expect(subItems()[0].hasAttribute("data-disabled")).toBe(true);
  canvasStore.setState({ api: null });
  await view.unmount();
});
