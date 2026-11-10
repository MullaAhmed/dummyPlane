// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { savePastedImage } from "./pastedImages";

afterEach(() => clearMocks());

it("sends the image as raw bytes, its extension in a header", async () => {
  mockIPC((cmd) => (cmd === "save_pasted_image" ? String.raw`C:\cache\paste-1.png` : undefined));
  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (...args: unknown[]) => unknown } })
    .__TAURI_INTERNALS__;
  const invoke = vi.spyOn(internals, "invoke");
  const bytes = new Uint8Array([137, 80, 78, 71]);

  await expect(savePastedImage(bytes, "png")).resolves.toBe(String.raw`C:\cache\paste-1.png`);
  expect(invoke).toHaveBeenCalledWith("save_pasted_image", bytes, { headers: { "x-image-extension": "png" } });
});
