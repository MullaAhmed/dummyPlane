// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { OllamaPicker } from "./OllamaPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let models: string[] | Error;
let host: HTMLDivElement;
let root: Root;
const onPick = vi.fn();
const onPull = vi.fn();

beforeEach(() => {
  models = [];
  onPick.mockClear();
  onPull.mockClear();
  mockIPC((cmd) => {
    if (cmd !== "list_ollama_models") return;
    if (models instanceof Error) throw models;
    return models;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
});

const render = () => act(async () => root.render(<OllamaPicker aiderAvailable onBack={vi.fn()} onPick={onPick} onPull={onPull} />));
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
const field = () => host.querySelector("input")!;
const type = (value: string) =>
  act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
const submit = () => act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

it("keeps listing the installed models and picks one", async () => {
  models = ["llama3.2:3b"];
  await render();
  await act(async () => [...host.querySelectorAll<HTMLElement>("[data-model]")][0].click());
  expect(onPick).toHaveBeenCalledWith({ model: "llama3.2:3b", mode: "code" });
  expect(onPull).not.toHaveBeenCalled();
});

it("points to the download below when no model is installed", async () => {
  await render();
  expect(host.textContent).toContain("No model installed");
});

it("suggests models with their size, without the installed ones", async () => {
  models = ["llama3.2:3b"];
  await render();
  const names = [...host.querySelectorAll<HTMLElement>("[data-suggestion]")].map((b) => b.dataset.suggestion);
  expect(names).toEqual(["qwen2.5-coder:7b", "gemma3:4b", "deepseek-r1:8b", "devstral:24b"]);
  expect(button("qwen2.5-coder:7b")!.textContent).toContain("4.7 GB");
  await act(async () => button("gemma3:4b")!.click());
  expect(onPull).toHaveBeenCalledWith("gemma3:4b");
  expect(onPick).not.toHaveBeenCalled();
});

it("pulls a model by name, trimmed", async () => {
  await render();
  await type("  mistral:7b ");
  await submit();
  expect(onPull).toHaveBeenCalledWith("mistral:7b");
});

it("refuses a name that is not a model", async () => {
  await render();
  await type("a; calc");
  await submit();
  expect(onPull).not.toHaveBeenCalled();
  expect(host.textContent).toContain("This is not an Ollama model name.");
});

it("does nothing on an empty name", async () => {
  await render();
  await submit();
  expect(onPull).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("This name is not");
});

it("says the server is down, offers no download that would fail, and tries again (spec installation §5)", async () => {
  models = new Error("connection refused");
  await render();
  expect(host.textContent).toContain("The Ollama server is not responding: open the Ollama app, then try again.");
  expect(host.querySelector("[data-suggestion]")).toBeNull();
  expect(button("Download")!.disabled).toBe(true);
  await type("mistral:7b");
  await submit();
  expect(onPull).not.toHaveBeenCalled();
  models = ["llama3.2:3b"];
  await act(async () => button("Try again")!.click());
  expect(host.textContent).not.toContain("ne répond pas");
  expect(host.querySelector("[data-model]")).not.toBeNull();
  expect(button("Download")!.disabled).toBe(false);
});

it("speaks English", async () => {
  await render();
  expect(host.textContent).toContain("No model installed");
  expect(host.textContent).toContain("Download a model");
  models = new Error("connection refused");
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(host.textContent).toContain("The Ollama server is not responding: open the Ollama app, then try again.");
  models = [];
  await act(async () => button("Try again")!.click());
  expect(button("qwen2.5-coder:7b")!.textContent).toContain("4.7 GB");
});

it("reads again on Try again, and shows the server's own words (P2-5)", async () => {
  models = new Error("connection refused");
  await render();
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("The Ollama server is not responding");
  // The detail is on screen, not in a hover-only title.
  expect(host.querySelector("[data-ollama-error]")!.textContent).toContain("connection refused");
  expect(host.querySelector("[title]")).toBeNull();

  let answer: (list: string[]) => void = () => undefined;
  mockIPC((cmd) => (cmd === "list_ollama_models" ? new Promise<string[]>((done) => (answer = done)) : undefined));
  await act(async () => button("Try again")!.click());
  // The retry shows: the reading line is back while the server is asked again.
  expect(host.textContent).toContain("Reading the models…");
  expect(host.textContent).not.toContain("not responding");
  await act(async () => answer(["llama3.2:3b"]));
  expect(host.querySelector("[data-model]")).not.toBeNull();
});

it("keeps the latest answer when two reads cross (P2-5)", async () => {
  const answers: ((list: string[]) => void)[] = [];
  mockIPC((cmd) => (cmd === "list_ollama_models" ? new Promise<string[]>((done) => answers.push(done)) : undefined));
  // Strict mode runs the first read twice: the older answer arrives last.
  await act(async () =>
    root.render(
      <StrictMode>
        <OllamaPicker aiderAvailable onBack={vi.fn()} onPick={onPick} onPull={onPull} />
      </StrictMode>,
    ),
  );
  expect(answers).toHaveLength(2);
  await act(async () => answers[1](["new:1b"]));
  await act(async () => answers[0](["old:1b"]));
  expect([...host.querySelectorAll<HTMLElement>("[data-model]")].map((b) => b.dataset.model)).toEqual(["new:1b"]);
});

it("ties a refused name to the field (P2-5)", async () => {
  await render();
  expect(field().getAttribute("aria-invalid")).toBe("false");
  await type("a; calc");
  await submit();
  expect(field().getAttribute("aria-invalid")).toBe("true");
  const [reason, hint] = field().getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)!);
  expect(reason.textContent).toBe("This is not an Ollama model name.");
  expect(reason.getAttribute("role")).toBe("alert");
  expect(hint).not.toBeNull();
});
