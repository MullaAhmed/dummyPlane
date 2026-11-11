import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSetting, setSetting } from "@/ipc/db";
import { autoArrangeStore, loadAutoArrange, setAutoArrange } from "./autoArrangeSetting";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/ipc/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn(() => Promise.resolve()) }));

const enabled = () => autoArrangeStore.getState().enabled;

beforeEach(() => {
  vi.clearAllMocks();
  autoArrangeStore.setState({ enabled: false });
});

describe("the \"Auto-arrange terminals\" setting", () => {
  it("is off until it is turned on, and stays on after a restart", async () => {
    vi.mocked(getSetting).mockResolvedValue(undefined as never);
    await loadAutoArrange();
    expect(enabled()).toBe(false);
    vi.mocked(getSetting).mockResolvedValue(true as never);
    await loadAutoArrange();
    expect(enabled()).toBe(true);
  });

  it("stays off when the setting cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(getSetting).mockRejectedValue(new Error("locked"));
    await loadAutoArrange();
    expect(enabled()).toBe(false);
    warn.mockRestore();
  });

  it("arranges the canvas once when turned on, not when it was already on nor when turned off", async () => {
    const arrange = vi.fn();
    await setAutoArrange(true, arrange);
    await setAutoArrange(true, arrange);
    await setAutoArrange(false, arrange);
    expect(arrange).toHaveBeenCalledTimes(1);
    expect(setSetting).toHaveBeenLastCalledWith("canvas.autoArrange", false);
  });
});
