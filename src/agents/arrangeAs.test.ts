import { beforeEach, describe, expect, it, vi } from "vitest";
import { arrangeLayoutStore } from "@/app/arrangeLayoutSetting";
import { setSetting } from "@/ipc/db";
import { arrangeAs } from "./arrangeAs";
import { arrangeCoversCanvas, arrangeWorkspace } from "./arrangeCanvas";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/ipc/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn(() => Promise.resolve()) }));
vi.mock("./arrangeCanvas", () => ({ arrangeWorkspace: vi.fn(() => true), arrangeCoversCanvas: vi.fn(() => true) }));

const layout = () => arrangeLayoutStore.getState().layout;

beforeEach(() => {
  vi.clearAllMocks();
  arrangeLayoutStore.setState(arrangeLayoutStore.getInitialState());
  vi.mocked(arrangeCoversCanvas).mockReturnValue(true);
});

describe("arrangeAs", () => {
  it("arranges the whole canvas in the layout picked and keeps it as the Arrange layout setting, one undoable step", () => {
    let seen: string | null = null;
    vi.mocked(arrangeWorkspace).mockImplementation(() => ((seen = layout()), true));
    arrangeAs("w1", { kind: "scene", only: [] }, "tree");
    expect(arrangeWorkspace).toHaveBeenCalledTimes(1);
    expect(arrangeWorkspace).toHaveBeenCalledWith("w1", { only: [], layout: "tree", undoable: true });
    expect(layout()).toBe("tree");
    expect(setSetting).toHaveBeenCalledWith("canvas.arrangeLayout", "tree");
    // Auto-arrange, the next Arrange and the Settings row read it: it is in place before the arrange.
    expect(seen).toBe("tree");
  });

  it("keeps the layout picked for a canvas even when it is the one already saved", () => {
    arrangeAs("w1", { kind: "scene", only: ["a"] }, "grid");
    expect(setSetting).toHaveBeenCalledWith("canvas.arrangeLayout", "grid");
    expect(arrangeWorkspace).toHaveBeenCalledWith("w1", { only: ["a"], layout: "grid", undoable: true });
  });

  it("arranges a selection once, in the layout picked, and leaves the setting alone", () => {
    vi.mocked(arrangeCoversCanvas).mockReturnValue(false);
    arrangeAs("w1", { kind: "scene", only: ["a", "b"] }, "row");
    expect(arrangeCoversCanvas).toHaveBeenCalledWith("w1", ["a", "b"]);
    expect(arrangeWorkspace).toHaveBeenCalledWith("w1", { only: ["a", "b"], layout: "row", undoable: true });
    expect(layout()).toBe("grid");
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("arranges a group once, inside its frame, in the layout picked, and leaves the setting alone", () => {
    arrangeLayoutStore.setState({ layout: "column" });
    arrangeAs("w1", { kind: "group", id: "g1" }, "columns-3");
    expect(arrangeWorkspace).toHaveBeenCalledWith("w1", { only: ["g1"], layout: "columns-3", undoable: true });
    expect(arrangeCoversCanvas).not.toHaveBeenCalled();
    expect(layout()).toBe("column");
    expect(setSetting).not.toHaveBeenCalled();
  });
});
