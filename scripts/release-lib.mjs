// The pure parts of `scripts/release.mjs` (spec première version §6.1): version
// bumps and the changelog, tested in `release.test.mjs`.

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

export function isSemver(version) {
  return SEMVER.test(version);
}

function requireSemver(version) {
  if (!isSemver(version)) throw new Error(`${version} is not a semver version (e.g. 1.0.0-beta.1)`);
}

/** Replaces `pattern`'s first match exactly once, or throws. */
function replaceOnce(text, pattern, replacement, what) {
  if (!pattern.test(text)) throw new Error(`${what} not found`);
  return text.replace(pattern, replacement);
}

export function bumpPackageJson(text, version) {
  requireSemver(version);
  return replaceOnce(text, /^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`, "package.json version");
}

export function bumpCargoToml(text, version) {
  requireSemver(version);
  return replaceOnce(text, /^(\[package\][\s\S]*?^version = ")[^"]*(")/m, `$1${version}$2`, "Cargo.toml [package] version");
}

export function bumpCargoLock(text, version) {
  requireSemver(version);
  return replaceOnce(text, /^(name = "dummyplane"\r?\nversion = ")[^"]*(")/m, `$1${version}$2`, "dummyplane package in Cargo.lock");
}

const UNRELEASED = "## [Unreleased]";

/** The lines between a `## [...]` heading and the next one, line ends dropped. */
function sections(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^## \[([^\]]+)\]/);
    if (heading) {
      current = { name: heading[1], heading: line, body: [] };
      out.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  return out;
}

const trimBlank = (lines) => lines.join("\n").replace(/^\s*\n/, "").replace(/\s+$/, "");

/** `## [Unreleased]` becomes `## [version] - date`, with a new empty Unreleased above it. */
export function releaseChangelog(text, version, date) {
  requireSemver(version);
  const all = sections(text);
  if (all.some((s) => s.name === version)) throw new Error(`Version ${version} already has a CHANGELOG section`);
  const unreleased = all.find((s) => s.name === "Unreleased");
  if (!unreleased || trimBlank(unreleased.body) === "") throw new Error("The CHANGELOG's Unreleased section is empty");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return text.replace(UNRELEASED, `${UNRELEASED}${eol}${eol}## [${version}] - ${date}`);
}

/** The body of a version's section, for the release notes. */
export function changelogSection(text, version) {
  const section = sections(text).find((s) => s.name === version);
  if (!section) throw new Error(`No ${version} section in the CHANGELOG`);
  return trimBlank(section.body);
}

/**
 * tauri-action writes a draft's latest.json with API asset URLs (a draft has
 * no download link yet): each becomes the release's own download link, which
 * works once published and counts against no API limit.
 */
export function directDownloadUrls(latest, assets, repo, tag) {
  const platforms = Object.fromEntries(
    Object.entries(latest.platforms).map(([platform, entry]) => {
      const asset = assets.find((a) => a.apiUrl === entry.url || a.url === entry.url);
      if (!asset) throw new Error(`No release asset for ${platform}: ${entry.url}`);
      return [platform, { ...entry, url: `https://github.com/${repo}/releases/download/${tag}/${asset.name}` }];
    }),
  );
  return { ...latest, platforms };
}
