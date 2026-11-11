import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { getSetting, setSetting } from "@/ipc/db";
import { readSource } from "@/theme/cssBlocks";
import { finishAlertsStore, loadFinishAlerts, setFinishAlerts } from "./finishAlertsSetting";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/ipc/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn(() => Promise.resolve()) }));

const enabled = () => finishAlertsStore.getState().enabled;

beforeEach(() => {
  vi.clearAllMocks();
  finishAlertsStore.setState({ enabled: true });
});

describe("the \"Alert when an agent finishes\" setting", () => {
  it("is on until it is turned off", async () => {
    vi.mocked(getSetting).mockResolvedValue(undefined as never);
    await loadFinishAlerts();
    expect(enabled()).toBe(true);
  });

  it("stays off after a restart", async () => {
    vi.mocked(getSetting).mockResolvedValue(false as never);
    await loadFinishAlerts();
    expect(enabled()).toBe(false);
  });

  it("stays on when the setting cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(getSetting).mockRejectedValue(new Error("locked"));
    await loadFinishAlerts();
    expect(enabled()).toBe(true);
    warn.mockRestore();
  });

  it("saves the choice apart from the Windows notifications", async () => {
    await setFinishAlerts(false);
    expect(enabled()).toBe(false);
    expect(setSetting).toHaveBeenCalledWith("notifications.finish", false);
  });

  it("applies the choice for the session and says so when it cannot be saved", async () => {
    vi.mocked(setSetting).mockRejectedValue(new Error("disk full"));
    await setFinishAlerts(false);
    expect(enabled()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });

  it("is in the settings menu, read at boot, and finishes are heard once the activity snapshot is known", () => {
    expect(readSource("shell/SettingsMenu.tsx")).toContain("setFinishAlerts(on === true)");
    const boot = readSource("app/boot.ts");
    expect(boot).toContain("await loadFinishAlerts()");
    expect(boot.indexOf("installFinishAlerts()")).toBeGreaterThan(boot.indexOf("agentActivityStore.getState().load"));
  });
});
