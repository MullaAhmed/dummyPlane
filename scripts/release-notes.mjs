// The release notes of a tag (release.yml): its CHANGELOG section, then how to install.
//
//   node scripts/release-notes.mjs v1.0.0-beta.1
import { readFileSync } from "node:fs";
import { changelogSection } from "./release-lib.mjs";

const version = (process.argv[2] ?? "").replace(/^v/, "");
const install = `---

**Install:** download \`dummyPlane_${version}_x64-setup.exe\` below and run it (Windows 10/11, no admin rights needed). Installed versions update themselves.

Betas are not code-signed yet: if Windows SmartScreen stops the installer, choose **More info**, then **Run anyway**.`;

process.stdout.write(`${changelogSection(readFileSync("CHANGELOG.md", "utf8"), version)}\n\n${install}\n`);
