// The pure parts of automatic releases (scripts/release-decide.mjs, release.yml):
// what the commits since the last release say about the next version, and the
// notes. A port of dummyIndex's scripts/release.py, tested in
// `release-commits.test.mjs`.
//
// Version policy (pre-1.0, as in dummyIndex):
//   "release" as a whole word in a commit or PR title -> minor
//   feat / BREAKING                                     -> minor
//   fix                                                 -> patch
//   perf, refactor, docs, chore, ci, test alone         -> no release

/** `type(scope)!:`, the header of a conventional commit. */
const HEADER = /^(?<type>\w+)(?<scope>\([^)]*\))?(?<bang>!)?:/;

/**
 * One commit inside a squash-merge body. GitHub's "Squash and merge" titles the
 * commit after the PR (often its branch name, not a conventional header) and
 * lists the real commits as `* ` bullets. Asterisks only: prose inside a commit
 * message uses `- `, and counting those would inflate the bump and the notes.
 */
const SQUASH_BULLET = /^[ \t]*\*[ \t]+(?<subject>.+?)[ \t]*$/gm;

/** An explicit release signal, as a whole word: `release:`, `chore(release):`, `Release 0.2.0`. */
const RELEASE_SIGNAL = /\brelease\b/i;

/** Changelog sections, in render order; test, chore and ci stay out of the notes. */
const SECTIONS = [
  ["feat", "Added"],
  ["fix", "Fixed"],
  ["perf", "Performance"],
  ["refactor", "Changed"],
  ["docs", "Documentation"],
];

/** The first release, whatever number the code carried before (it came from OpenVibe). */
export const FIRST_RELEASE = "0.1.0";

/** `{ type, breaking }` of a commit subject; `type` is null when it is not a conventional header. */
export function commitType(subject) {
  const match = HEADER.exec(subject);
  return match ? { type: match.groups.type, breaking: Boolean(match.groups.bang) } : { type: null, breaking: false };
}

/** The conventional subjects among a squash-merge body's `* ` bullets. */
export function squashedSubjects(body) {
  return [...body.matchAll(SQUASH_BULLET)].map((m) => m.groups.subject).filter((subject) => commitType(subject).type !== null);
}

/**
 * The subjects a release decision should see. A commit whose own subject is
 * conventional is taken as it is (a written PR title already describes the
 * squash, and expanding it too would list everything twice). One that is not is
 * most likely a squash titled after its branch: its body's bullets are added.
 */
export function effectiveSubjects(commits) {
  const subjects = [];
  for (const { subject, body } of commits) {
    subjects.push(subject);
    if (commitType(subject).type === null) subjects.push(...squashedSubjects(body));
  }
  return subjects;
}

/** `"minor"`, `"patch"`, or null when nothing in the commits warrants a release. */
export function decideBump(subjects, bodies) {
  let breaking = bodies.some((body) => body.includes("BREAKING CHANGE") || body.includes("BREAKING-CHANGE"));
  let hasFeat = false;
  let hasFix = false;
  let releaseSignal = false;
  for (const subject of subjects) {
    if (RELEASE_SIGNAL.test(subject)) releaseSignal = true;
    const { type, breaking: bang } = commitType(subject);
    breaking = breaking || bang;
    if (type === "feat") hasFeat = true;
    else if (type === "fix") hasFix = true;
  }
  if (releaseSignal || breaking || hasFeat) return "minor";
  if (hasFix) return "patch";
  return null;
}

/** `current` is `X.Y.Z` (a pre-release suffix is ignored); the bump is `"minor"` or `"patch"`. */
export function nextVersion(current, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!match) throw new Error(`${current} is not a version`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump: ${bump}`);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `{target}-beta.N`, N one past the highest `v{target}-beta.N` tag; null when
 * `v{target}` is already released (the development branch is behind main, and a
 * beta of a shipped version would sort below it).
 */
export function nextBetaVersion(target, tags) {
  if (tags.includes(`v${target}`)) return null;
  const pattern = new RegExp(`^v${escapeRegExp(target)}-beta\\.(\\d+)$`);
  const numbers = tags.map((tag) => pattern.exec(tag)).filter(Boolean).map((m) => Number(m[1]));
  return `${target}-beta.${Math.max(0, ...numbers) + 1}`;
}

/** A changelog line: the description, with the scope (if any) as a bold lead. */
export function describe(subject) {
  const match = HEADER.exec(subject);
  if (!match) return subject.trim();
  const rest = subject.slice(match[0].length).trim();
  const scope = (match.groups.scope ?? "").replace(/^\(|\)$/g, "");
  return scope ? `**${scope}:** ${rest}` : rest;
}

/** The subjects grouped into changelog sections; hidden types are dropped. */
export function renderNotes(subjects) {
  const grouped = new Map();
  for (const subject of subjects) {
    const { type } = commitType(subject);
    if (type !== null) grouped.set(type, [...(grouped.get(type) ?? []), subject]);
  }
  const blocks = SECTIONS.filter(([type]) => grouped.has(type)).map(
    ([type, heading]) => `### ${heading}\n\n${grouped.get(type).map((subject) => `- ${describe(subject)}`).join("\n")}`,
  );
  return blocks.join("\n\n").trim() || "Maintenance release.";
}

/** How to install, appended to every release's notes. */
export function installNotes(version, prerelease) {
  return [
    "---",
    "",
    `**Windows (10/11):** download \`dummyPlane_${version}_x64-setup.exe\` below and run it. It installs for your user only and needs no administrator rights. It is not code-signed yet: if Windows SmartScreen stops the installer, choose **More info**, then **Run anyway**.`,
    "",
    `**macOS (Apple Silicon, experimental):** download \`dummyPlane_${version}_aarch64.dmg\`, open it and drag dummyPlane to Applications. It is not signed or notarized yet: right-click it, choose **Open**, then **Open** again.`,
    "",
    prerelease
      ? "This is a pre-release: installed copies are not offered it, so download it by hand."
      : "Installed copies update themselves.",
    "",
  ].join("\n");
}

/** The release's notes: what changed, then how to install. */
export function releaseNotes(changes, version, prerelease) {
  const lead = prerelease ? "Pre-release: the in-app updater does not offer it.\n\n" : "";
  return `${lead}${changes}\n\n${installNotes(version, prerelease)}`;
}
