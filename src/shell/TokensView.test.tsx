// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { accountsStore } from "@/accounts/store";
import { nodesStore } from "@/store/nodes";
import { TokensView } from "./TokensView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => clearMocks());

const counts = (input: number, output: number) => ({ input, output, cacheRead: 0, cacheWrite: 0 });
const report = {
  days: [
    { date: "2026-10-30", counts: counts(0, 0) },
    { date: "2026-10-31", counts: counts(500, 500) },
  ],
  sessions: [
    { sessionId: "s-batman", model: "claude-opus-5-5", counts: counts(400, 400) },
    { sessionId: "s-ext", model: "claude-haiku-5-5", counts: counts(100, 100) },
  ],
  models: [{ model: "claude-opus-5-5", counts: counts(400, 400) }],
  filesScanned: 3,
  truncated: true,
};

async function show(answer: () => unknown) {
  mockIPC((cmd) => (cmd === "token_usage" ? answer() : undefined));
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "", claudeSessionId: "s-batman" },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const back = vi.fn();
  await act(async () => root.render(<TokensView onBack={back} />));
  return { host, back, done: () => act(async () => root.unmount()) };
}

it("shows a column per day and the part of each agent, named by dummyPlane's own agents", async () => {
  const { host, done } = await show(() => report);
  expect(host.querySelectorAll("[data-day]")).toHaveLength(2);
  const rows = [...host.querySelectorAll("[data-agent-row]")].map((row) => row.textContent);
  expect(rows[0]).toContain("Batman");
  expect(rows[0]).toContain("800");
  expect(rows[1]).toContain("Other Claude sessions");
  expect(host.textContent).toContain("3 files read");
  expect(host.textContent).toContain("reading cut short");
  expect(host.textContent).toContain("nothing is sent");
  await done();
});

it("says so when the logs cannot be read, and goes back", async () => {
  const { host, back, done } = await show(() => {
    throw new Error("boom");
  });
  expect(host.textContent).toContain("Could not read");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Usage"]')!.click());
  expect(back).toHaveBeenCalled();
  await done();
});

const profile = { id: "work", name: "Travail", configDir: "C:/profiles/work" };

it("says it covers the default folder only, when profiles exist (review)", async () => {
  accountsStore.setState({ profiles: [profile] });
  const { host, done } = await show(() => report);
  expect(host.querySelector("[data-tokens-scope]")?.textContent).toBe("Default account only: Claude profiles are not counted here");
  await done();
  accountsStore.setState({ profiles: [] });
});

it("says nothing of it without profiles (review)", async () => {
  accountsStore.setState({ profiles: [] });
  const { host, done } = await show(() => report);
  expect(host.querySelector("[data-tokens-scope]")).toBeNull();
  await done();
});
