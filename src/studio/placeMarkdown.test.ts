import { beforeEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { toastError } from "@/lib/errorToast";
import { projectsStore } from "@/store/projects";
import { insertFileNode } from "./insert";
import { placeMarkdown, projectRelative } from "./placeMarkdown";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/lib/errorToast", () => ({ toastError: vi.fn() }));
vi.mock("./insert", () => ({ insertFileNode: vi.fn(() => Promise.resolve()) }));

describe("projectRelative", () => {
  it("names a file of the project from its folder, with forward slashes", () => {
    expect(projectRelative("D:\\code\\api", "D:\\code\\api\\README.md")).toBe("README.md");
    expect(projectRelative("D:\\code\\api", "D:\\code\\api\\docs\\guide\\setup.md")).toBe("docs/guide/setup.md");
    expect(projectRelative("D:/code/api", "D:\\code\\api\\docs\\a.md")).toBe("docs/a.md");
    expect(projectRelative("/home/me/api", "/home/me/api/docs/a.md")).toBe("docs/a.md");
  });

  it("reads dot-folders and names with spaces", () => {
    expect(projectRelative("D:\\code\\api", "D:\\code\\api\\.context\\architecture\\overview.md")).toBe(".context/architecture/overview.md");
    expect(projectRelative("D:\\code\\api", "D:\\code\\api\\my notes\\a b.md")).toBe("my notes/a b.md");
  });

  it("ignores the case of a Windows path, and a separator at the end of the folder", () => {
    expect(projectRelative("d:\\Code\\API", "D:\\code\\api\\a.md")).toBe("a.md");
    expect(projectRelative("D:\\code\\api\\", "D:\\code\\api\\a.md")).toBe("a.md");
    expect(projectRelative("\\\\server\\share\\api", "\\\\SERVER\\share\\api\\a.md")).toBe("a.md");
  });

  it("keeps the case of a Unix path: another case is another folder", () => {
    expect(projectRelative("/home/me/api", "/home/me/API/a.md")).toBeNull();
  });

  it("refuses what is outside the project, a folder that only starts the same included", () => {
    expect(projectRelative("D:\\code\\api", "D:\\code\\api2\\a.md")).toBeNull();
    expect(projectRelative("D:\\code\\api", "D:\\code\\web\\a.md")).toBeNull();
    expect(projectRelative("D:\\code\\api", "D:\\code\\api")).toBeNull();
    expect(projectRelative("D:\\code\\api", "D:\\code\\api\\")).toBeNull();
    expect(projectRelative("", "D:\\a.md")).toBeNull();
  });
});

describe("placeMarkdown", () => {
  const project = { id: "p1", name: "api", path: "D:\\code\\api", position: 0, lastOpenedAt: 0, workspaceCount: 1 };

  beforeEach(() => {
    vi.clearAllMocks();
    projectsStore.setState({ projects: [project] as never, activeId: "p1" });
  });

  it("asks for a Markdown file from the project's folder, and shows the one picked where asked", async () => {
    vi.mocked(open).mockResolvedValueOnce("D:\\code\\api\\docs\\a.md");
    await placeMarkdown({ x: 10, y: 20 });
    expect(open).toHaveBeenCalledWith({
      multiple: false,
      directory: false,
      defaultPath: "D:\\code\\api",
      title: "Open a Markdown file",
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }],
    });
    expect(insertFileNode).toHaveBeenCalledWith("docs/a.md", { x: 10, y: 20 });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("places nothing when the dialog is cancelled", async () => {
    vi.mocked(open).mockResolvedValueOnce(null);
    await placeMarkdown();
    expect(insertFileNode).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("says why a file outside the project is not shown", async () => {
    vi.mocked(open).mockResolvedValueOnce("C:\\Users\\me\\Downloads\\notes.md");
    await placeMarkdown();
    expect(insertFileNode).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("This file is not in the project", { next: "Pick a Markdown file inside the project's folder" });
  });

  it("asks nothing outside a project", async () => {
    projectsStore.setState({ projects: [], activeId: null });
    await placeMarkdown();
    expect(open).not.toHaveBeenCalled();
  });
});
