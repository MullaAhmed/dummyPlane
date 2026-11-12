// Decides the next release from the commits since the last one, and stages it
// (release.yml). It follows dummyIndex's scripts/release.py.
//
//   node scripts/release-decide.mjs [--channel stable|beta] [--dry-run] [--expect-version X.Y.Z]
//
// It reads the commits since the last stable `vX.Y.Z` tag, decides the bump from
// their conventional-commit types, and, when a release is due, bumps
// package.json, src-tauri/Cargo.toml and Cargo.lock (and dates the CHANGELOG for
// a stable release) and writes release-notes.md. The commit, the tag, the push
// and the GitHub Release belong to the workflow, so every step that touches
// history is visible in one place. `--dry-run` writes nothing and prints the
// decision and the notes.
//
// stable (a push to main): the next X.Y.Z; the first release is 0.1.0.
// beta (a push to development): X.Y.Z-beta.N for the same bump, written for the
// tag only, never committed to the branch.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { FIRST_RELEASE, decideBump, effectiveSubjects, nextBetaVersion, nextVersion, releaseNotes, renderNotes } from "./release-commits.mjs";
import { bumpCargoLock, bumpCargoToml, bumpPackageJson, releaseChangelog, unreleasedNotes } from "./release-lib.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const channelAt = args.indexOf("--channel");
const channel = channelAt >= 0 ? args[channelAt + 1] : "stable";
if (!["stable", "beta"].includes(channel)) {
  console.error("Usage: node scripts/release-decide.mjs [--channel stable|beta] [--dry-run]");
  process.exit(1);
}

const git = (...gitArgs) => execFileSync("git", gitArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The nearest stable `vX.Y.Z` tag: a pre-release tag (a `-` in it) is skipped. */
function lastStableTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v*", "--exclude", "v*-*");
  } catch {
    return null; // no release yet: the first one covers all the history
  }
}

/** `{ subject, body }` of each commit after `tag` (all of them without one). */
function commitsSince(tag) {
  // \x1e ends a commit, \x1f separates its subject from its body.
  const raw = git("log", tag ? `${tag}..HEAD` : "HEAD", "--no-merges", "--format=%s%x1f%b%x1e");
  return raw
    .split("\x1e")
    .map((chunk) => chunk.replace(/^\n+|\n+$/g, ""))
    .filter(Boolean)
    .map((chunk) => {
      const [subject, ...rest] = chunk.split("\x1f");
      return { subject: subject.trim(), body: rest.join("\x1f").trim() };
    });
}

function emit(pairs) {
  console.log(Object.entries(pairs).map(([key, value]) => `${key}=${value}`).join(" "));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${Object.entries(pairs).map(([key, value]) => `${key}=${value}\n`).join("")}`);
  }
}

const tag = lastStableTag();
const commits = commitsSince(tag);
const subjects = effectiveSubjects(commits);
const bump = decideBump(subjects, commits.map((commit) => commit.body));

if (!bump) {
  console.log(`No releasable commits since ${tag ?? "the start"}: skipping.`);
  emit({ released: "false", channel });
  process.exit(0);
}

// The base is the last release, not package.json: the code started at OpenVibe's
// version, and a development branch may lag behind main.
const target = tag ? nextVersion(tag.slice(1), bump) : FIRST_RELEASE;
let version = target;
if (channel === "beta") {
  const allTags = git("tag", "--list", "v*").split(/\r?\n/).filter(Boolean);
  version = nextBetaVersion(target, allTags);
  if (!version) {
    console.log(`v${target} is already released: merge main into development first.`);
    emit({ released: "false", channel });
    process.exit(0);
  }
}

// The workflow decides first, runs its checks, then stages: the same commits must give the same version.
const expectAt = args.indexOf("--expect-version");
if (expectAt >= 0 && args[expectAt + 1] !== version) {
  console.error(`The checks ran for v${args[expectAt + 1]}, but the commits now say v${version}: not releasing.`);
  process.exit(1);
}

const prerelease = channel === "beta";
const changelog = readFileSync("CHANGELOG.md", "utf8");
// Notes written by hand under Unreleased come first; the commits fill in when there are none.
const changes = unreleasedNotes(changelog) || renderNotes(subjects);
const notes = releaseNotes(changes, version, prerelease);

const date = new Date().toISOString().slice(0, 10);
const bumps = {
  "package.json": bumpPackageJson,
  "src-tauri/Cargo.toml": bumpCargoToml,
  "src-tauri/Cargo.lock": bumpCargoLock,
  ...(prerelease ? {} : { "CHANGELOG.md": (text, v) => releaseChangelog(text, v, date, changes) }),
};

// Everything is computed before anything is written: a refusal changes nothing.
const next = Object.entries(bumps).map(([path, apply]) => [path, apply(readFileSync(path, "utf8"), version)]);
console.log(`Releasing v${version} (${channel}, ${bump} bump, ${commits.length} commits since ${tag ?? "the start"}).`);

if (dryRun) {
  console.log(`\n--- release notes ---\n${notes}`);
} else {
  for (const [path, text] of next) writeFileSync(path, text);
  writeFileSync("release-notes.md", notes);
}
emit({ released: "true", version, tag: `v${version}`, channel });
