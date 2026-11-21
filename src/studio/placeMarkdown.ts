import { open } from "@tauri-apps/plugin-dialog";
import type { Point } from "@/agents/terminals";
import { messages } from "@/i18n";
import { toastError } from "@/lib/errorToast";
import { projectsStore } from "@/store/projects";
import { insertFileNode } from "./insert";
import { MARKDOWN_EXTENSIONS } from "./markdown";
import { studioMessages } from "./messages";

/** A Windows path ("D:\code", "\\server\share"): its case does not tell files apart. */
const WINDOWS_PATH = /^([a-z]:|\\\\|\/\/)/i;

/**
 * `file` relative to the project's folder `root`, with forward slashes as the code workspace names it; null when it is
 * not inside. Either separator is read, and on Windows either case: "D:\Code\API\docs\a.md" in "d:/code/api" is
 * "docs/a.md". A folder that only starts the same ("D:\code\api2") is another one.
 */
export function projectRelative(root: string, file: string): string | null {
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const path = file.replace(/\\/g, "/");
  if (!base || path.length <= base.length + 1 || path[base.length] !== "/") return null;
  const head = path.slice(0, base.length);
  const same = head === base || (WINDOWS_PATH.test(root) && head.toLowerCase() === base.toLowerCase());
  return same ? path.slice(base.length + 1) : null;
}

/**
 * The ＋ menu's "Markdown": a Markdown file of the project, picked in the system's dialog from the project's folder,
 * rendered read-only in a file node at `at`, else at the center of the view. A file outside the project is refused:
 * a file node reads the project's files only (`studio::resolve`).
 */
export async function placeMarkdown(at?: Point): Promise<void> {
  const { projects, activeId } = projectsStore.getState();
  const project = projects.find((p) => p.id === activeId);
  if (!project) return;
  const t = messages(studioMessages).markdown;
  const picked = await open({
    multiple: false,
    directory: false,
    defaultPath: project.path,
    title: t.pickTitle,
    filters: [{ name: t.filter, extensions: MARKDOWN_EXTENSIONS }],
  });
  if (typeof picked !== "string" || !picked) return;
  const path = projectRelative(project.path, picked);
  if (path) await insertFileNode(path, at);
  else toastError(t.outside, { next: t.outsideNext });
}
