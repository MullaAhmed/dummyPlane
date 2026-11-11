import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { getSetting, setSetting } from "@/ipc/db";
import { readSource } from "@/theme/cssBlocks";
import { followWaitingStore, loadFollowWaiting, setFollowWaiting } from "./followWaitingSetting";
import { errorToasts } from "@/lib/errorToast.testkit";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/ipc/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn(() => Promise.resolve()) }));

const enabled = () => followWaitingStore.getState().enabled;

beforeEach(() => {
  vi.clearAllMocks();
  followWaitingStore.setState({ enabled: true });
});

describe("the \"Go to agents that ask\" setting", () => {
  it("is on until it is turned off", async () => {
    vi.mocked(getSetting).mockResolvedValue(undefined as never);
    await loadFollowWaiting();
    expect(enabled()).toBe(true);
  });

  it("stays off after a restart", async () => {
    vi.mocked(getSetting).mockResolvedValue(false as never);
    await loadFollowWaiting();
    expect(enabled()).toBe(false);
  });

  it("stays on when the setting cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(getSetting).mockRejectedValue(new Error("locked"));
    await loadFollowWaiting();
    expect(enabled()).toBe(true);
    warn.mockRestore();
  });

  it("saves the choice apart from the Windows notifications", async () => {
    await setFollowWaiting(false);
    expect(enabled()).toBe(false);
    expect(setSetting).toHaveBeenCalledWith("notifications.follow", false);
  });

  it("applies the choice for the session and says so when it cannot be saved", async () => {
    vi.mocked(setSetting).mockRejectedValue(new Error("disk full"));
    await setFollowWaiting(false);
    expect(enabled()).toBe(false);
    expect(errorToasts(vi.mocked(toast.error))).toEqual([{ title: "Could not save the setting", description: expect.stringContaining("disk full") }]);
    expect(errorToasts(vi.mocked(toast.error))[0].description).toContain("It applies for now");
  });

  it("is in the settings menu, read at boot, and the agent that asks is followed once the activity snapshot is known", () => {
    expect(readSource("shell/SettingsMenu.tsx")).toContain("setFollowWaiting(on === true)");
    const boot = readSource("app/boot.ts");
    expect(boot).toContain("await loadFollowWaiting()");
    expect(boot.indexOf("installFollowWaiting()")).toBeGreaterThan(boot.indexOf("agentActivityStore.getState().load"));
  });
});
