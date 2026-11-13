import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importsRealSonner, routeSonner } from "./route-sonner.mjs";

const shim = fileURLToPath(new URL("../src/notifications/sonner.ts", import.meta.url));
const inShimFolder = fileURLToPath(new URL("../src/notifications/capture.ts", import.meta.url));
const elsewhere = fileURLToPath(new URL("../src/lib/errorToast.tsx", import.meta.url));

describe("importsRealSonner", () => {
  it("is true for the files of the shim's folder, and for nothing else", () => {
    expect(importsRealSonner(shim)).toBe(true);
    expect(importsRealSonner(inShimFolder)).toBe(true);
    expect(importsRealSonner(elsewhere)).toBe(false);
  });

  it("reads Windows paths, slashes either way, any case, and a query after the file", () => {
    expect(importsRealSonner(shim.replace(/\//g, "\\"))).toBe(true);
    expect(importsRealSonner(shim.toUpperCase())).toBe(true);
    expect(importsRealSonner(`${shim}?t=123`)).toBe(true);
    expect(importsRealSonner(`${elsewhere}?t=123`)).toBe(false);
  });

  it("does not take a folder that only has 'notifications' in its path: a worktree's own path holds it", () => {
    expect(importsRealSonner("D:/Projects/dummyPlane/.claude/worktrees/notifications/src/lib/errorToast.tsx")).toBe(false);
    expect(importsRealSonner("D:/x/src/notifications-other/a.ts")).toBe(false);
  });
});

describe("routeSonner", () => {
  const { resolveId, enforce } = routeSonner();

  it("runs before the other resolvers", () => {
    expect(enforce).toBe("pre");
  });

  it("sends the app's imports of sonner to the shim", () => {
    expect(resolveId("sonner", elsewhere)).toBe(shim);
  });

  it("leaves the shim's own folder the real package", () => {
    expect(resolveId("sonner", shim)).toBeNull();
    expect(resolveId("sonner", inShimFolder)).toBeNull();
  });

  it("leaves every other module, and an import with no importer, alone", () => {
    expect(resolveId("react", elsewhere)).toBeNull();
    expect(resolveId("sonner/dist/styles.css", elsewhere)).toBeNull();
    expect(resolveId("sonner", undefined)).toBeNull();
  });
});
