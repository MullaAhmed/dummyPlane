import { describe, expect, it } from "vitest";
import { rebasePath } from "./paths";

describe("rebasePath", () => {
  it("moves a path inside the old folder, whatever the case or separators", () => {
    expect(rebasePath("C:\\code\\api", "c:/code/API/", "D:\\api")).toBe("D:\\api");
    expect(rebasePath("c:/code/API/web", "C:\\code\\api", "D:\\api")).toBe("D:\\api\\web");
    expect(rebasePath("C:\\code\\api\\web", "C:\\code\\api", "D:\\")).toBe("D:\\web");
  });

  it("moves a path out of a drive root", () => {
    expect(rebasePath("D:\\api\\web", "D:\\", "E:\\work")).toBe("E:\\work\\api\\web");
    expect(rebasePath("d:/api", "D:", "E:\\work\\")).toBe("E:\\work\\api");
    expect(rebasePath("D:\\", "D:", "E:\\work")).toBe("E:\\work");
  });

  it("keeps the rest of the path whole when a folder's name lowercases longer (İ)", () => {
    expect(rebasePath("C:\\İstanbul\\web\\src", "c:\\İstanbul", "D:\\ist")).toBe("D:\\ist\\web\\src");
    expect(rebasePath("C:\\İstanbul", "C:\\İSTANBUL\\", "D:\\ist")).toBe("D:\\ist");
  });

  it("leaves paths outside the folder alone", () => {
    expect(rebasePath("C:\\code\\apis", "C:\\code\\api", "D:\\api")).toBeNull();
    expect(rebasePath("E:\\other", "C:\\code\\api", "D:\\api")).toBeNull();
  });
});
