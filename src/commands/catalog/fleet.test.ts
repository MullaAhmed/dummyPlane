// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { arrive, showNode } from "@/canvas/arrive";
import { requestCloseFleet } from "@/fleet/fleets";
import { pasteIntoTerminal } from "@/nodes/terminal/registry";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { labelOf, sectionOf, type CommandContext } from "../command";
import { pendingUiRequest } from "../uiRequests";
import { FLEET } from "./fleet";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/canvas/arrive", () => ({ arrive: vi.fn(), showNode: vi.fn(), arrivingNode: vi.fn(() => null) }));
vi.mock("@/fleet/fleets", () => ({ requestCloseFleet: vi.fn() }));
vi.mock("@/nodes/terminal/registry", () => ({ pasteIntoTerminal: vi.fn() }));
vi.mock("@/radial/bridges", () => ({ readClipboardText: vi.fn(() => Promise.resolve("texte")) }));

const palette: CommandContext = { project: true, workspaceId: "w1", terminalCount: 0, terminalId: null };
const ring: CommandContext = { ...palette, fleetId: "chef" };
const find = (id: string) => FLEET.find((c) => c.id === id)!;

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "chef de backend" } });
});

describe("Fleet · <nom> (spec menu radial §4.4, §6.2)", () => {
  it("is the radial menu's only: the palette never points at a fleet", () => {
    expect(FLEET.filter((c) => c.available(palette))).toEqual([]);
    expect(FLEET.map((c) => labelOf(c, ring))).toEqual(["Write an instruction", "Rename", "Link", "Paste", "Delete", "Quick note on this Fleet", "Remove from group"]);
    expect(sectionOf(find("fleet.rename"), ring)).toBe("Fleet · chef de backend");
  });

  it("does what the fleet's own controls do", async () => {
    await find("fleet.write").run(ring);
    expect(arrive).toHaveBeenCalledWith("chef");
    await find("fleet.rename").run(ring);
    expect(showNode).toHaveBeenCalledWith("chef");
    expect(pendingUiRequest()).toEqual({ kind: "renameFleet", id: "chef" });
    await find("fleet.link").run(ring);
    expect(uiStore.getState().linking).toBe("chef");
    await find("fleet.paste").run(ring);
    expect(arrive).toHaveBeenCalledWith("chef");
    expect(pasteIntoTerminal).toHaveBeenCalledWith("chef", "texte");
    await find("fleet.remove").run(ring);
    expect(requestCloseFleet).toHaveBeenCalledWith("chef");
  });
});
