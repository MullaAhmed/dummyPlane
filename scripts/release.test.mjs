import { describe, expect, it } from "vitest";
import { bumpCargoLock, bumpCargoToml, bumpPackageJson, changelogSection, directDownloadUrls, isSemver, releaseChangelog } from "./release-lib.mjs";

describe("isSemver", () => {
  it("takes a version with or without a pre-release, never a leading v", () => {
    expect(isSemver("1.0.0")).toBe(true);
    expect(isSemver("1.0.0-beta.1")).toBe(true);
    expect(isSemver("v1.0.0")).toBe(false);
    expect(isSemver("1.0")).toBe(false);
    expect(isSemver("01.0.0")).toBe(false);
  });
});

describe("version bumps", () => {
  it("changes the package's version only", () => {
    const text = '{\n  "name": "dummyplane",\n  "version": "0.1.0",\n  "dependencies": { "x": "0.1.0" }\n}\n';
    expect(bumpPackageJson(text, "1.0.0-beta.1")).toBe('{\n  "name": "dummyplane",\n  "version": "1.0.0-beta.1",\n  "dependencies": { "x": "0.1.0" }\n}\n');
  });

  it("changes the crate's version, not a dependency's", () => {
    const text = '[package]\nname = "dummyplane"\nversion = "0.1.0"\n\n[dependencies]\nlog = { version = "0.1.0" }\n';
    expect(bumpCargoToml(text, "1.0.0-beta.1")).toBe('[package]\nname = "dummyplane"\nversion = "1.0.0-beta.1"\n\n[dependencies]\nlog = { version = "0.1.0" }\n');
  });

  it("changes the dummyplane entry of Cargo.lock, not its neighbours", () => {
    const text = '[[package]]\nname = "num"\nversion = "0.1.0"\n\n[[package]]\nname = "dummyplane"\nversion = "0.1.0"\ndependencies = [\n "num",\n]\n';
    expect(bumpCargoLock(text, "1.0.0")).toBe('[[package]]\nname = "num"\nversion = "0.1.0"\n\n[[package]]\nname = "dummyplane"\nversion = "1.0.0"\ndependencies = [\n "num",\n]\n');
  });

  it("keeps Windows line ends", () => {
    expect(bumpCargoToml('[package]\r\nname = "dummyplane"\r\nversion = "0.1.0"\r\n', "1.0.0")).toBe('[package]\r\nname = "dummyplane"\r\nversion = "1.0.0"\r\n');
  });
});

const CHANGELOG = `# Changelog

All notable changes to dummyPlane are documented here.

## [Unreleased]

### Added
- A log file.

### Fixed
- Resuming a session that never had a conversation.

## [0.1.0] - 2026-10-23

### Added
- First preview.
`;

describe("the changelog", () => {
  it("moves Unreleased into the new version and leaves an empty Unreleased", () => {
    const out = releaseChangelog(CHANGELOG, "1.0.0-beta.1", "2026-10-28");
    expect(out).toContain("## [Unreleased]\n\n## [1.0.0-beta.1] - 2026-10-28\n\n### Added\n- A log file.");
    expect(out).toContain("## [0.1.0] - 2026-10-23");
    expect(changelogSection(out, "1.0.0-beta.1")).toBe("### Added\n- A log file.\n\n### Fixed\n- Resuming a session that never had a conversation.");
    expect(changelogSection(out, "0.1.0")).toBe("### Added\n- First preview.");
  });

  it("keeps Windows line ends, and gives notes without them", () => {
    const windows = CHANGELOG.replace(/\n/g, "\r\n");
    const out = releaseChangelog(windows, "1.0.0-beta.1", "2026-10-28");
    expect(out).not.toMatch(/[^\r]\n/);
    expect(changelogSection(out, "1.0.0-beta.1")).toBe("### Added\n- A log file.\n\n### Fixed\n- Resuming a session that never had a conversation.");
  });

  it("refuses an empty Unreleased, a version already released and a bad version", () => {
    const released = releaseChangelog(CHANGELOG, "1.0.0-beta.1", "2026-10-28");
    expect(() => releaseChangelog(released, "1.0.0-beta.2", "2026-10-29")).toThrow(/Unreleased/);
    expect(() => releaseChangelog(CHANGELOG, "0.1.0", "2026-10-29")).toThrow(/0\.1\.0/);
    expect(() => releaseChangelog(CHANGELOG, "v1", "2026-10-29")).toThrow(/semver/);
    expect(() => changelogSection(CHANGELOG, "9.9.9")).toThrow(/9\.9\.9/);
  });
});

describe("latest.json of a drafted release", () => {
  it("points each platform at the release's download link, not the API asset (tauri-action drafts use the API)", () => {
    const latest = {
      version: "1.0.0-beta.2",
      platforms: {
        "windows-x86_64": { signature: "s", url: "https://api.github.com/repos/Mideky-hub/openvibe/releases/assets/682035832" },
        "windows-x86_64-nsis": { signature: "s", url: "https://api.github.com/repos/Mideky-hub/openvibe/releases/assets/682035832" },
      },
    };
    const assets = [
      { name: "dummyPlane_1.0.0-beta.2_x64-setup.exe", apiUrl: "https://api.github.com/repos/Mideky-hub/openvibe/releases/assets/682035832" },
      { name: "latest.json", apiUrl: "https://api.github.com/repos/Mideky-hub/openvibe/releases/assets/682035833" },
    ];
    const fixed = directDownloadUrls(latest, assets, "Mideky-hub/openvibe", "v1.0.0-beta.2");
    const url = "https://github.com/Mideky-hub/openvibe/releases/download/v1.0.0-beta.2/dummyPlane_1.0.0-beta.2_x64-setup.exe";
    expect(Object.values(fixed.platforms).map((p) => p.url)).toEqual([url, url]);
    expect(fixed.platforms["windows-x86_64"].signature).toBe("s");
    expect(fixed.version).toBe("1.0.0-beta.2");
  });

  it("refuses a URL that matches no asset rather than publish a broken update", () => {
    const latest = { version: "1", platforms: { "windows-x86_64": { signature: "s", url: "https://api.github.com/repos/o/r/releases/assets/1" } } };
    expect(() => directDownloadUrls(latest, [], "o/r", "v1")).toThrow(/asset/);
  });
});
