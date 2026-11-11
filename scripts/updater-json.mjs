// Rewrites a drafted release's latest.json with download links (release.yml).
//
//   node scripts/updater-json.mjs latest.json assets.json MullaAhmed/dummyPlane v1.0.0-beta.2
import { readFileSync, writeFileSync } from "node:fs";
import { directDownloadUrls } from "./release-lib.mjs";

const [file, assetsFile, repo, tag] = process.argv.slice(2);
const latest = JSON.parse(readFileSync(file, "utf8"));
const { assets } = JSON.parse(readFileSync(assetsFile, "utf8"));
writeFileSync(file, `${JSON.stringify(directDownloadUrls(latest, assets, repo, tag), null, 2)}\n`);
