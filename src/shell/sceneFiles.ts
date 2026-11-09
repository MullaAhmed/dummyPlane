import { CaptureUpdateAction, exportToBlob, loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { messages } from "@/i18n";
import { nodeKindOf } from "@/canvas/nodeElement";
import type { ThemeChoice } from "@/app/theme";
import { exportBackground } from "@/theme/sceneColors";
import { shellMessages } from "./messages";

type SavePicker = (options: unknown) => Promise<FileSystemFileHandle>;

/** Saves with WebView2's native save dialog when it offers one, else as a download. */
async function saveBlob(blob: Blob, suggestedName: string, accept: Record<string, string[]>, description: string) {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName, types: [{ description, accept }] });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return false;
      throw error;
    }
  }
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: suggestedName }).click();
  URL.revokeObjectURL(url);
  return true;
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept });
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function exportScene(api: ExcalidrawImperativeAPI, name: string) {
  const json = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");
  return saveBlob(
    new Blob([json], { type: "application/json" }),
    `${name}.excalidraw`,
    { "application/json": [".excalidraw", ".json"] },
    messages(shellMessages).scene.excalidrawScene,
  );
}

export async function exportPng(api: ExcalidrawImperativeAPI, name: string, palette: ThemeChoice) {
  const blob = await exportToBlob({
    elements: api.getSceneElements(),
    appState: { ...api.getAppState(), exportBackground: true, ...exportBackground(palette) },
    files: api.getFiles(),
    mimeType: "image/png",
  });
  return saveBlob(blob, `${name}.png`, { "image/png": [".png"] }, messages(shellMessages).scene.pngImage);
}

/**
 * Adds the drawings of a scene file to the canvas. Elements already present and
 * OpenVibe nodes (their content lives in the database, not in the file) are skipped.
 */
export async function importScene(api: ExcalidrawImperativeAPI) {
  const file = await pickFile(".excalidraw,.json,application/json");
  if (!file) return false;
  const scene = await loadFromBlob(file, api.getAppState(), api.getSceneElements());
  const existing = new Set(api.getSceneElementsIncludingDeleted().map((e) => e.id));
  const added = scene.elements.filter((e) => !existing.has(e.id) && nodeKindOf(e) === null);
  api.addFiles(Object.values(scene.files));
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...added],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return true;
}
