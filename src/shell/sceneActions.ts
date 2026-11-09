import { toast } from "sonner";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { currentTheme } from "@/app/theme";
import { messages } from "@/i18n";
import { canvasStore } from "@/canvas/canvasStore";
import { workspacesStore } from "@/store/workspaces";
import { shellMessages } from "./messages";
import { exportPng, exportScene, importScene } from "./sceneFiles";

function run(action: (api: ExcalidrawImperativeAPI) => Promise<boolean>, failure: "exportFailed" | "importFailed") {
  const api = canvasStore.getState().api;
  if (!api) return;
  action(api).catch((error: unknown) => toast.error(messages(shellMessages).failed(messages(shellMessages).scene[failure], String(error))));
}

/** The file name of the scene on screen: its workspace's. */
function sceneName(): string {
  const { workspaces, activeId } = workspacesStore.getState();
  return workspaces.find((w) => w.id === activeId)?.name ?? "scene";
}

/** "Export the scene…" of the settings menu and the palette. */
export const exportCurrentScene = () => run((api) => exportScene(api, sceneName()), "exportFailed");

/** "Import a scene…". */
export const importIntoScene = () => run(importScene, "importFailed");

/** "Export as PNG…", in the app's theme. */
export const exportCurrentPng = () => run((api) => exportPng(api, sceneName(), currentTheme()), "exportFailed");
