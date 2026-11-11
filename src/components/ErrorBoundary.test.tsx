// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ErrorBoundary, QuietBoundary } from "./ErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function Bomb({ explode }: { explode: { current: boolean } }) {
  if (explode.current) throw new Error("render failed");
  return <p>fine</p>;
}

it("shows the fallback instead of blanking, logs the error, and retries", async () => {
  const explode = { current: true };
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await act(async () =>
    root.render(
      <ErrorBoundary scope="node" fallback={(error, retry) => <button onClick={retry}>{error.message}</button>}>
        <Bomb explode={explode} />
      </ErrorBoundary>,
    ),
  );
  expect(host.textContent).toBe("render failed");
  expect(logged.mock.calls.some((args) => String(args[0]).includes("[ui] node"))).toBe(true);
  explode.current = false;
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toBe("fine");
});

it("keeps a sibling alive when one child fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await act(async () =>
    root.render(
      <>
        <ErrorBoundary scope="a" fallback={() => <i>a down</i>}>
          <Bomb explode={{ current: true }} />
        </ErrorBoundary>
        <p>b alive</p>
      </>,
    ),
  );
  expect(host.textContent).toBe("a downb alive");
});

it("tries its children again when its reset key changes, and only then", async () => {
  const explode = { current: true };
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const render = (resetKey: unknown) =>
    act(async () =>
      root.render(
        <ErrorBoundary scope="dialog" fallback={() => null} resetKey={resetKey}>
          <Bomb explode={explode} />
        </ErrorBoundary>,
      ),
    );
  await render(false);
  expect(host.textContent).toBe("");
  explode.current = false;
  // The same key: the fallback stays, nothing asked for the part again.
  await render(false);
  expect(host.textContent).toBe("");
  // The dialog is asked for again: it renders.
  await render(true);
  expect(host.textContent).toBe("fine");
  expect(logged).toHaveBeenCalled();
});

it("reads a quiet boundary's key from its hook: a failed dialog opens again on the next request", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { createStore, useStore } = await import("zustand");
  const store = createStore<{ openings: number }>()(() => ({ openings: 0 }));
  const useOpenings = () => useStore(store, (s) => s.openings);
  const explode = { current: true };
  await act(async () =>
    root.render(
      <QuietBoundary scope="palette" useResetKey={useOpenings}>
        <Bomb explode={explode} />
      </QuietBoundary>,
    ),
  );
  expect(host.textContent).toBe("");
  explode.current = false;
  await act(async () => store.setState({ openings: 1 }));
  expect(host.textContent).toBe("fine");
});
