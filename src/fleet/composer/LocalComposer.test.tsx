// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerPrimitive, useAui, type AssistantClient } from "@assistant-ui/react";
import { LocalComposer } from "./LocalComposer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let aui: AssistantClient;
const onSend = vi.fn();

function Grab() {
  aui = useAui();
  return null;
}

beforeEach(async () => {
  onSend.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <LocalComposer onSend={onSend}>
        <ComposerPrimitive.Root>
          <ComposerPrimitive.Input aria-label="field" submitMode="none" cancelOnEscape={false} />
          <ComposerPrimitive.Send aria-label="Send" />
        </ComposerPrimitive.Root>
        <Grab />
      </LocalComposer>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

const field = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="field"]')!;
const send = () => host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;

it("renders assistant-ui's composer without a thread around it", () => {
  expect(host.querySelector('form[data-aui-composer-type="thread"]')).not.toBeNull();
  expect(field()).not.toBeNull();
  expect(send().disabled).toBe(true);
});

it("shows the text set on the composer, and enables Send", async () => {
  await act(async () => aui.composer.setText("run tests"));
  expect(field().value).toBe("run tests");
  expect(send().disabled).toBe(false);
});

it("hands the text to onSend at once on a send, and empties the field", async () => {
  await act(async () => aui.composer.setText("run tests"));
  act(() => aui.composer.send());
  expect(onSend).toHaveBeenCalledWith("run tests");
  await act(async () => undefined);
  expect(aui.composer.getState().text).toBe("");
  expect(field().value).toBe("");
});

it("sends again and again: the thread never runs, so Send never waits for a reply", async () => {
  for (const text of ["one", "two"]) {
    await act(async () => aui.composer.setText(text));
    expect(send().disabled).toBe(false);
    await act(async () => send().click());
  }
  expect(onSend.mock.calls).toEqual([["one"], ["two"]]);
});

it("still sends under StrictMode, whose double effects the app runs in development", async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () =>
    root.render(
      <StrictMode>
        <LocalComposer onSend={onSend}>
          <ComposerPrimitive.Root>
            <ComposerPrimitive.Input aria-label="field" submitMode="none" cancelOnEscape={false} />
            <ComposerPrimitive.Send aria-label="Send" />
          </ComposerPrimitive.Root>
          <Grab />
        </LocalComposer>
      </StrictMode>,
    ),
  );
  await act(async () => aui.composer.setText("run tests"));
  expect(field().value).toBe("run tests");
  await act(async () => send().click());
  expect(onSend).toHaveBeenCalledWith("run tests");
  expect(field().value).toBe("");
});

it("keeps what is typed when the user types into the field", async () => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(field(), "@thoth hi");
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(aui.composer.getState().text).toBe("@thoth hi");
  expect(field().value).toBe("@thoth hi");
});
