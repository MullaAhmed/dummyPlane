// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DRAFT_MS, TYPING_MS, userIsTyping, userIsWriting } from "./typing";

const press = (target: Element) => target.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

function add<K extends keyof HTMLElementTagNameMap>(tag: K, parent: Element = document.body): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  parent.appendChild(element);
  return element;
}

// Each test starts well past the keys the earlier ones pressed: the module remembers the last one for the page's life.
let clock = Date.now();

beforeEach(() => {
  vi.useFakeTimers();
  clock += 10 * TYPING_MS;
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it("is not typing before any key", () => {
  expect(userIsTyping()).toBe(false);
});

it("is typing for a few seconds after a key pressed in a field, then no more", () => {
  const field = add("input");
  press(field);
  expect(userIsTyping()).toBe(true);
  vi.advanceTimersByTime(TYPING_MS - 1);
  expect(userIsTyping()).toBe(true);
  vi.advanceTimersByTime(1);
  expect(userIsTyping()).toBe(false);
});

it("counts a key pressed in a terminal: xterm reads keys from a textarea", () => {
  const screen = add("div");
  screen.className = "xterm";
  press(add("textarea", screen));
  expect(userIsTyping()).toBe(true);
});

it("ignores keys that go to no field: the canvas's shortcuts are not typing", () => {
  press(add("div"));
  expect(userIsTyping()).toBe(false);
});

it("is typing while the keyboard sits in a field, even one that was quiet for long", () => {
  const field = add("input");
  field.focus();
  expect(userIsTyping()).toBe(true);
});

it("is not typing while a terminal merely holds the keyboard", () => {
  const screen = add("div");
  screen.className = "xterm";
  add("textarea", screen).focus();
  expect(userIsTyping()).toBe(false);
});

it("userIsWriting is not true before any key, nor for a field that merely rests focused", () => {
  expect(userIsWriting()).toBe(false);
  add("input").focus();
  expect(userIsWriting()).toBe(false);
  expect(userIsTyping()).toBe(true);
});

it("userIsWriting holds for 3 s after a key, as userIsTyping does, wherever it went", () => {
  press(add("input"));
  vi.advanceTimersByTime(TYPING_MS - 1);
  expect(userIsWriting()).toBe(true);
  vi.advanceTimersByTime(1);
  expect(userIsWriting()).toBe(false);
});

it("userIsWriting holds for a draft in the focused field until 10 s after the last key", () => {
  const field = add("input");
  field.value = "git push";
  field.focus();
  press(field);
  vi.advanceTimersByTime(DRAFT_MS - 1);
  expect(userIsWriting()).toBe(true);
  vi.advanceTimersByTime(1);
  expect(userIsWriting()).toBe(false);
});

it("userIsWriting lets go once the draft is gone, or when it is in another field than the focused one", () => {
  const field = add("input");
  field.value = "git push";
  field.focus();
  press(field);
  vi.advanceTimersByTime(TYPING_MS);
  expect(userIsWriting()).toBe(true);
  add("input").focus();
  expect(userIsWriting()).toBe(false);
  field.focus();
  field.value = " ";
  expect(userIsWriting()).toBe(false);
});

it("userIsWriting does not count a terminal's textarea nor a focused checkbox as a draft", () => {
  const screen = add("div");
  screen.className = "xterm";
  const textarea = add("textarea", screen);
  textarea.value = "ls";
  textarea.focus();
  press(textarea);
  vi.advanceTimersByTime(TYPING_MS);
  expect(userIsWriting()).toBe(false);
  const box = add("input");
  box.type = "checkbox";
  box.focus();
  expect(userIsWriting()).toBe(false);
});
