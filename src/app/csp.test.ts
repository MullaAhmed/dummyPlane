import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));

function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...values]) => [name, values]),
  );
}

it("loads nothing from the network and runs no injected script", () => {
  expect(typeof config.app.security.csp).toBe("string");
  const csp = directives(config.app.security.csp);
  expect(csp["default-src"]).toEqual(["'self'"]);
  expect(csp["script-src"]).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  expect(csp["frame-src"]).toEqual(["'none'"]);
  expect(csp["object-src"]).toEqual(["'none'"]);
  const remote = Object.values(csp)
    .flat()
    .filter((source) => /^(https?|wss?):/.test(source) && source !== "http://ipc.localhost");
  expect(remote).toEqual([]);
});

it("keeps index.html free of inline scripts, which the policy would block", () => {
  const html = readFileSync("index.html", "utf8");
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
});
