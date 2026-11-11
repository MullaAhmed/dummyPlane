import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { getSetting, setSetting } from "@/ipc/db";
import { loadNativeNotifications, nativeNotificationsStore, setNativeNotifications } from "./nativeNotifications";
import { errorToasts } from "@/lib/errorToast.testkit";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/ipc/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn(() => Promise.resolve()) }));

const enabled = () => nativeNotificationsStore.getState().enabled;

beforeEach(() => {
  vi.clearAllMocks();
  nativeNotificationsStore.setState({ enabled: true });
});

describe("the Windows notifications setting", () => {
  it("is on until it is turned off", async () => {
    vi.mocked(getSetting).mockResolvedValue(undefined as never);
    await loadNativeNotifications();
    expect(enabled()).toBe(true);
  });

  it("stays off after a restart", async () => {
    vi.mocked(getSetting).mockResolvedValue(false as never);
    await loadNativeNotifications();
    expect(enabled()).toBe(false);
  });

  it("keeps notifications on when the setting cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(getSetting).mockRejectedValue(new Error("locked"));
    await loadNativeNotifications();
    expect(enabled()).toBe(true);
    warn.mockRestore();
  });

  it("saves the choice", async () => {
    await setNativeNotifications(false);
    expect(enabled()).toBe(false);
    expect(setSetting).toHaveBeenCalledWith("notifications.native", false);
  });

  it("applies the choice for the session and says so when it cannot be saved", async () => {
    vi.mocked(setSetting).mockRejectedValue(new Error("disk full"));
    await setNativeNotifications(false);
    expect(enabled()).toBe(false);
    expect(errorToasts(vi.mocked(toast.error))).toEqual([{ title: "Could not save the setting", description: expect.stringContaining("disk full") }]);
    expect(errorToasts(vi.mocked(toast.error))[0].description).toContain("It applies for now");
  });
});
