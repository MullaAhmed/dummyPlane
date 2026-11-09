// Prepares a release (docs/RELEASING.md): bumps the version, dates the
// changelog, commits and tags. It pushes nothing.
//
//   node scripts/release.mjs 1.0.0-beta.1
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { bumpCargoLock, bumpCargoToml, bumpPackageJson, isSemver, releaseChangelog } from "./release-lib.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function fail(message) {
  console.error(message);
  process.exit(1);
}

const version = process.argv[2];
if (!version || !isSemver(version)) fail("Usage: node scripts/release.mjs <semver version, e.g. 1.0.0-beta.1>");
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") fail("Release from main.");
// Untracked files never reach the release commit: only changes to tracked ones block it.
if (git("status", "--porcelain", "--untracked-files=no")) fail("The working tree has uncommitted changes.");
if (git("tag", "-l", `v${version}`)) fail(`Tag v${version} already exists.`);

const date = new Date().toISOString().slice(0, 10);
const bumps = {
  "package.json": bumpPackageJson,
  "src-tauri/Cargo.toml": bumpCargoToml,
  "src-tauri/Cargo.lock": bumpCargoLock,
  "CHANGELOG.md": (text, v) => releaseChangelog(text, v, date),
};
// Everything is computed before anything is written: a refusal changes nothing.
let next;
try {
  next = Object.entries(bumps).map(([path, bump]) => [path, bump(readFileSync(path, "utf8"), version)]);
} catch (error) {
  fail(error.message);
}
for (const [path, text] of next) writeFileSync(path, text);
git("add", ...Object.keys(bumps));
git("commit", "-m", `chore(release): v${version}`);
git("tag", "-a", `v${version}`, "-m", `dummyPlane ${version}`);
console.log(`v${version} is ready. Push it with: git push origin main v${version}`);
