import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARRANGE_LAYOUTS, readArrangeLayout, type ArrangeLayout } from "@/agents/arrangeLayout";
import { getSetting, setSetting } from "@/ipc/db";
import { arrangeLayoutStore, loadArrangeLayout, setArrangeLayout } from "./arrangeLayoutSetting";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/ipc/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn(() => Promise.resolve()) }));

const layout = () => arrangeLayoutStore.getState().layout;

beforeEach(() => {
  vi.clearAllMocks();
  arrangeLayoutStore.setState(arrangeLayoutStore.getInitialState());
});

describe("the \"Arrange layout\" setting", () => {
  it("is the grid until another is chosen", async () => {
    expect(arrangeLayoutStore.getInitialState()).toEqual({ layout: "grid" });
    vi.mocked(getSetting).mockResolvedValue(undefined as never);
    await loadArrangeLayout();
    expect(layout()).toBe("grid");
    expect(getSetting).toHaveBeenCalledWith("canvas.arrangeLayout");
  });

  it("reads back every layout saved, after a restart", async () => {
    expect(ARRANGE_LAYOUTS).toEqual(["grid", "row", "column", "columns-2", "columns-3", "columns-4", "tree"]);
    for (const saved of ARRANGE_LAYOUTS) {
      vi.mocked(getSetting).mockResolvedValue(saved as never);
      await loadArrangeLayout();
      expect(layout()).toBe(saved);
    }
  });

  for (const saved of ["columns-5", "columns-1", "Grid", "rows", 3, true, null, {}]) {
    it(`falls back to the grid for an unknown value (${JSON.stringify(saved)})`, async () => {
      arrangeLayoutStore.setState({ layout: "row" });
      vi.mocked(getSetting).mockResolvedValue(saved as never);
      await loadArrangeLayout();
      expect(layout()).toBe("grid");
      expect(readArrangeLayout(saved)).toBe("grid");
    });
  }

  it("keeps the grid when the setting cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(getSetting).mockRejectedValue(new Error("locked"));
    await loadArrangeLayout();
    expect(layout()).toBe("grid");
    warn.mockRestore();
  });

  it("saves the layout chosen, and calls back only when it changed", async () => {
    const changed = vi.fn();
    await setArrangeLayout("columns-3", changed);
    expect(layout()).toBe("columns-3");
    expect(setSetting).toHaveBeenLastCalledWith("canvas.arrangeLayout", "columns-3");
    await setArrangeLayout("columns-3", changed);
    expect(changed).toHaveBeenCalledTimes(1);
    await setArrangeLayout("row", changed);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(setSetting).toHaveBeenLastCalledWith("canvas.arrangeLayout", "row");
  });

  it("saves the grid for a value it does not know", async () => {
    arrangeLayoutStore.setState({ layout: "row" });
    await setArrangeLayout("diagonal" as ArrangeLayout);
    expect(layout()).toBe("grid");
    expect(setSetting).toHaveBeenLastCalledWith("canvas.arrangeLayout", "grid");
  });
});
