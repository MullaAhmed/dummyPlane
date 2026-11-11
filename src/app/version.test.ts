import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("has one version: package.json, read by tauri.conf.json, copied into Cargo.toml", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as { version: string };
  const cargo = readFileSync("src-tauri/Cargo.toml", "utf8").match(/^\[package\][\s\S]*?^version = "([^"]+)"/m)?.[1];
  expect(tauri.version).toBe("../package.json");
  expect(cargo).toBe(pkg.version);
});
