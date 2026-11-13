// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { historyKey } from "@/agents/history";
import { launchFolderKey } from "@/agents/launchFolder";
import { setSetting } from "@/ipc/db";
import { LOOPS_KEY } from "@/loops/store";
import { NOTIFICATIONS_KEY } from "@/notifications/store";
import { PRESETS_KEY } from "@/presets/store";
import { installResetNotice } from "./resetNotice";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { warning: vi.fn(), error: vi.fn() }) }));

beforeEach(() => vi.mocked(toast.warning).mockClear());
afterEach(() => clearMocks());

/** What the user is told when a write over `key` kept its unreadable text as `aside`. */
async function toldFor(key: string, aside = `${key}.unreadable`) {
  mockIPC((cmd) => (cmd === "set_setting" ? aside : undefined));
  vi.mocked(toast.warning).mockClear();
  await setSetting(key, null);
  return vi.mocked(toast.warning).mock.calls;
}

it("says, once, which list was reset and where its old text is kept, in the app's words", async () => {
  installResetNotice();
  const calls = await toldFor(LOOPS_KEY);
  expect(calls).toEqual([["Your loops could not be read and start empty", { description: "The old text is kept in the settings as loops.list.unreadable" }]]);
});

it("names each list the stores keep, by its key", async () => {
  installResetNotice();
  const titles: [string, string][] = [
    [LOOPS_KEY, "Your loops could not be read and start empty"],
    [PRESETS_KEY, "Your team presets could not be read and start empty"],
    [historyKey("p1"), "A project's command history could not be read and starts empty"],
    [launchFolderKey("p1"), "A project's recent folders could not be read and start empty"],
    [NOTIFICATIONS_KEY, "Your notification history could not be read and starts empty"],
    ["ui.workspaceOrder.p1", "A project's workspace order could not be read and starts again"],
    ["agents.modelRouterLevels", "Your model router levels could not be read and start again"],
    ["ui.theme", "The setting ui.theme could not be read and starts again"],
  ];
  for (const [key, title] of titles) {
    const calls = await toldFor(key);
    expect(calls.map((call) => call[0]), key).toEqual([title]);
  }
});

it("says nothing when a write kept nothing", async () => {
  installResetNotice();
  mockIPC(() => null);
  await setSetting(LOOPS_KEY, []);
  expect(toast.warning).not.toHaveBeenCalled();
});
