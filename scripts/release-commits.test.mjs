import { describe, expect, it } from "vitest";
import {
  FIRST_RELEASE,
  commitType,
  decideBump,
  describe as describeSubject,
  effectiveSubjects,
  installNotes,
  nextBetaVersion,
  nextVersion,
  releaseNotes,
  renderNotes,
  squashedSubjects,
} from "./release-commits.mjs";
import { releaseChangelog, unreleasedNotes } from "./release-lib.mjs";

describe("commitType", () => {
  it("reads a conventional header, with or without a scope or a bang", () => {
    expect(commitType("feat: a")).toEqual({ type: "feat", breaking: false });
    expect(commitType("fix(shell): a")).toEqual({ type: "fix", breaking: false });
    expect(commitType("feat(api)!: a")).toEqual({ type: "feat", breaking: true });
  });

  it("returns no type for anything else", () => {
    expect(commitType("Feat/curated scan (#10)").type).toBeNull();
    expect(commitType("Merge branch main").type).toBeNull();
    expect(commitType("").type).toBeNull();
  });
});

describe("squash merges", () => {
  const body = "* feat(scan): curated scan\n* fix: a typo\n* wip stuff\n- not a commit: prose\nplain text";

  it("keeps the conventional bullets only, and asterisk bullets only", () => {
    expect(squashedSubjects(body)).toEqual(["feat(scan): curated scan", "fix: a typo"]);
  });

  it("opens a squash titled after its branch, and takes a conventional title as it is", () => {
    const commits = [
      { subject: "Feat/curated scan (#10)", body },
      { subject: "fix(shell): written title", body: "* fix(shell): the same thing" },
    ];
    expect(effectiveSubjects(commits)).toEqual([
      "Feat/curated scan (#10)",
      "feat(scan): curated scan",
      "fix: a typo",
      "fix(shell): written title",
    ]);
  });
});

describe("decideBump", () => {
  it("is no release for commits that change nothing a user sees", () => {
    expect(decideBump(["docs: a", "chore: b", "ci: c", "test: d", "refactor: e", "perf: f"], [])).toBeNull();
    expect(decideBump([], [])).toBeNull();
  });

  it("is a patch for a fix and a minor for a feature", () => {
    expect(decideBump(["chore: a", "fix: b"], [])).toBe("patch");
    expect(decideBump(["fix: a", "feat: b"], [])).toBe("minor");
  });

  it("keeps a breaking change at minor before 1.0, by its bang or its body", () => {
    expect(decideBump(["fix!: a"], [])).toBe("minor");
    expect(decideBump(["fix: a"], ["BREAKING CHANGE: the format"])).toBe("minor");
  });

  it("makes a commit that names a release a minor, as a whole word only", () => {
    expect(decideBump(["chore(release): v1"], [])).toBe("minor");
    expect(decideBump(["Release 0.2.0"], [])).toBe("minor");
    expect(decideBump(["docs: the prerelease and the released one"], [])).toBeNull();
  });
});

describe("versions", () => {
  it("bumps the minor or the patch, and ignores a pre-release suffix", () => {
    expect(nextVersion("0.3.4", "minor")).toBe("0.4.0");
    expect(nextVersion("0.3.4", "patch")).toBe("0.3.5");
    expect(nextVersion("1.2.0-beta.1", "patch")).toBe("1.2.1");
    expect(() => nextVersion("nope", "minor")).toThrow(/version/);
    expect(() => nextVersion("1.0.0", "major")).toThrow(/bump/);
  });

  it("starts at 0.1.0", () => {
    expect(FIRST_RELEASE).toBe("0.1.0");
  });

  it("numbers a beta one past the last of its target, and none once the target is out", () => {
    expect(nextBetaVersion("0.2.0", [])).toBe("0.2.0-beta.1");
    expect(nextBetaVersion("0.2.0", ["v0.1.0", "v0.2.0-beta.1", "v0.2.0-beta.2", "v0.3.0-beta.9"])).toBe("0.2.0-beta.3");
    expect(nextBetaVersion("0.2.0", ["v0.2.0", "v0.2.0-beta.1"])).toBeNull();
  });

  it("does not take 0.2.0's dots for wildcards", () => {
    expect(nextBetaVersion("0.2.0", ["v0x2x0-beta.5"])).toBe("0.2.0-beta.1");
  });
});

describe("notes", () => {
  it("writes a changelog line with the scope as a bold lead", () => {
    expect(describeSubject("feat(review): send all remarks")).toBe("**review:** send all remarks");
    expect(describeSubject("fix: a typo")).toBe("a typo");
    expect(describeSubject("Plain title ")).toBe("Plain title");
  });

  it("groups the commits in the order Added, Fixed, Performance, Changed, Documentation", () => {
    const notes = renderNotes(["docs: d", "fix(x): f", "feat: a", "chore: hidden", "refactor: r", "perf: p"]);
    expect(notes).toBe(
      ["### Added", "", "- a", "", "### Fixed", "", "- **x:** f", "", "### Performance", "", "- p", "", "### Changed", "", "- r", "", "### Documentation", "", "- d"].join("\n"),
    );
  });

  it("falls back to a maintenance release when nothing is shown", () => {
    expect(renderNotes(["chore: a", "ci: b"])).toBe("Maintenance release.");
  });

  it("tells how to install on both platforms, and says a pre-release is not offered to installed copies", () => {
    const stable = installNotes("0.2.0", false);
    expect(stable).toContain("dummyPlane_0.2.0_x64-setup.exe");
    expect(stable).toContain("dummyPlane_0.2.0_aarch64.dmg");
    expect(stable).toContain("Installed copies update themselves.");
    const beta = releaseNotes("### Added\n\n- a", "0.2.0-beta.1", true);
    expect(beta.startsWith("Pre-release")).toBe(true);
    expect(beta).toContain("not offered it");
    expect(beta).toContain("- a");
  });
});

describe("the changelog of an automatic release", () => {
  const changelog = "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-01-01\n\n- old\n";

  it("reads what is written under Unreleased, and nothing when it is empty", () => {
    expect(unreleasedNotes("# C\n\n## [Unreleased]\n\n### Added\n- a\n\n## [0.1.0] - d\n- x\n")).toBe("### Added\n- a");
    expect(unreleasedNotes(changelog)).toBe("");
    expect(unreleasedNotes("# no sections")).toBe("");
  });

  it("gives an empty Unreleased the notes written from the commits", () => {
    const text = releaseChangelog(changelog, "0.2.0", "2026-02-02", "### Fixed\n\n- a typo");
    expect(text).toBe("# Changelog\n\n## [Unreleased]\n\n## [0.2.0] - 2026-02-02\n\n### Fixed\n\n- a typo\n\n## [0.1.0] - 2026-01-01\n\n- old\n");
  });

  it("still refuses an empty Unreleased when it has no notes to put there", () => {
    expect(() => releaseChangelog(changelog, "0.2.0", "2026-02-02")).toThrow(/empty/);
  });

  it("moves a written Unreleased as before, and ignores the notes from the commits", () => {
    const written = "# Changelog\n\n## [Unreleased]\n\n- by hand\n";
    expect(releaseChangelog(written, "0.2.0", "2026-02-02", "### Fixed\n\n- ignored")).toBe(
      "# Changelog\n\n## [Unreleased]\n\n## [0.2.0] - 2026-02-02\n\n- by hand\n",
    );
  });
});
