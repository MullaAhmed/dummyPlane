# Releasing dummyPlane

Versions follow [Semantic Versioning](https://semver.org/). dummyPlane's first release is **`0.1.0`**; `1.0.0` comes out once no tester has lost work or had to build anything.

dummyPlane's home is [`MullaAhmed/dummyPlane`](https://github.com/MullaAhmed/dummyPlane): that is `origin`, and the only remote a release is pushed to. `upstream` is [OpenVibe](https://github.com/Mideky-hub/openvibe), the project dummyPlane was forked from; never push there. The local `v1.x` tags are OpenVibe's, not dummyPlane's releases; [CHANGELOG.md](../CHANGELOG.md) starts at the fork and links OpenVibe's own changelog for what came before.

## How a release happens

Nobody tags by hand. Releases follow [dummyIndex](https://github.com/MullaAhmed/dummyIndex)'s approach and are driven by the commit messages.

Every push to `main` runs the **Release** workflow (`.github/workflows/release.yml`, with `scripts/release-decide.mjs`). It reads the commits since the last `vX.Y.Z` tag and decides the version from their [Conventional Commits](https://www.conventionalcommits.org/) types:

| Commits since the last release | Version |
|---|---|
| a `feat`, a breaking change (`!`, or a `BREAKING CHANGE:` line), or a commit or pull request titled with the word *release* | minor (`0.1.0` to `0.2.0`) |
| a `fix` | patch (`0.2.0` to `0.2.1`) |
| only `docs`, `chore`, `ci`, `test`, `perf` or `refactor` | no release |

Before 1.0 a breaking change stays a minor bump. A squash merge titled after its branch is read through its `* ` bullet list, so the `feat` and `fix` inside it count.

When a release is due, the workflow:

1. runs the checks (types, interface tests, `cargo fmt`, clippy, `cargo test`);
2. bumps `package.json`, `src-tauri/Cargo.toml` and `Cargo.lock`, dates `CHANGELOG.md`, and pushes `chore(release): vX.Y.Z [skip ci]` and the tag `vX.Y.Z` to `main` together;
3. drafts the release `dummyPlane X.Y.Z` with its notes;
4. builds the Windows installer and the macOS disk image, one after the other, into that draft: `dummyPlane_X.Y.Z_x64-setup.exe`, `dummyPlane_X.Y.Z_aarch64.dmg`, their updater files and signatures, and `latest.json`;
5. points `latest.json` at the release's download links (tauri-action writes a draft's with API URLs) and **publishes** the release.

Installed copies see it within 6 hours, or at once with **Check for updates** in the command palette (Ctrl+Shift+P). The build needs the update key's secrets (see [The update key](#the-update-key)): without them the bundler refuses to build the signed updater files.

**The notes** are what `CHANGELOG.md` says under `## [Unreleased]`, written for users: the version's section takes them, and Unreleased starts empty again. When Unreleased is empty, the notes are written from the commit messages instead (Added, Fixed, Performance, Changed, Documentation).

**The first release** is `0.1.0`, whatever number the code carried before: `package.json` still says `1.x` from OpenVibe, and the release sets it to `0.1.0`. The updater only offers a version higher than the one installed, so a copy built before the release, still numbered `1.x`, is never offered `0.1.0`: it is reinstalled by hand. `1.0.0` comes out once no tester has lost work or had to build anything; the script only bumps the minor and the patch, so reaching it will take a small change to `scripts/release-commits.mjs`.

## Betas

A push to the `development` branch cuts a **beta**, `X.Y.Z-beta.N`, the same way (same checks, same builds):

- its version bump is pushed as a tag only, never to the branch, so `development` keeps the stable number and no bot commit reaches `main`; no changelog entry is written;
- the release is a **pre-release**: GitHub's "latest" and the updater ignore it, and testers download it by hand from the Releases page;
- a beta of a version that is already released is refused: merge `main` into `development` first.

Try changes to the release pipeline itself on `development` first: a push there cannot move `main` or reach users.

## Trying it without a release

Running the **Release** workflow by hand (Actions, Release, Run workflow) only runs the checks and builds both installers, as artifacts: nothing is tagged, committed or published. To see what a push would release without pushing, run `node scripts/release-decide.mjs --dry-run` in a clone: it prints the decision and the notes and writes nothing.

## If a release fails

- **A check fails:** nothing is tagged. Fix it and push: the next run decides again.
- **A build fails after the tag:** the tag, the bump commit and the draft stay. Open the failed run and use **Re-run failed jobs**: the build uploads into the same draft again (the job that tags does not run twice). To start over instead, delete the release and its tag (`gh release delete vX.Y.Z --cleanup-tag`) and revert the bump commit if it is on `main`.
- **Never publish a draft by hand** unless its `latest.json` points at `releases/download/` links, not `api.github.com` ones.

## Where installed copies look for updates

`plugins.updater.endpoints` in `src-tauri/tauri.conf.json` lists the one URL installed copies read:

```
https://github.com/MullaAhmed/dummyPlane/releases/latest/download/latest.json
```

It is the `latest.json` of the latest published release of `MullaAhmed/dummyPlane`. It must point there, not at OpenVibe's repository: an installed copy asks that URL, and nothing else, whether a newer version exists.

## The update key

Installed copies only accept updates signed with dummyPlane's update key; its public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.

> **The key is dummyPlane's own, not OpenVibe's.** Copies installed from OpenVibe's releases trust OpenVibe's key, so they do not update to dummyPlane: they are reinstalled by hand. Once a version is published with this key, every installed copy trusts it for good.

- The key pair lives in `%USERPROFILE%\.tauri\dummyplane.key` (private), `dummyplane.key.pub` and `dummyplane.key.password`.
- **Keep a copy of the private key and its password off this machine** (a password manager). Without them, no installed copy can ever be updated again: every user would have to reinstall by hand.
- To make the pair, run `pnpm tauri signer generate -w $HOME\.tauri\dummyplane.key`, store the password it asks for in `dummyplane.key.password`, then put the content of `dummyplane.key.pub` in `plugins.updater.pubkey`.
- The workflow reads the private key from two repository secrets, `TAURI_SIGNING_PRIVATE_KEY` (the content of `dummyplane.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`:

  ```powershell
  Get-Content $HOME\.tauri\dummyplane.key -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY --repo MullaAhmed/dummyPlane
  Get-Content $HOME\.tauri\dummyplane.key.password -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo MullaAhmed/dummyPlane
  ```

## Code signing

Releases are not code-signed, so Windows SmartScreen warns on first launch. Once a first release is published, apply to the [SignPath Foundation](https://signpath.org/), which signs open-source projects for free:

- the project is under an OSI licence (MIT) and its installer is built entirely by GitHub Actions from this repository;
- the README links a code signing policy page;
- after approval, a signing step goes into `release.yml` between the build and the upload, and the release notes stop mentioning SmartScreen.

Azure Artifact Signing may not be open to individual developers in your country; check before relying on it.

## macOS (experimental)

The Release workflow builds an Apple Silicon `.dmg` (on `macos-latest`) after the Windows installer, into the same draft release. The platforms build one after the other, and a last job rewrites `latest.json` once both have added their files.

- **Unsigned.** `src-tauri/tauri.macos.conf.json` signs ad hoc (`signingIdentity` set to `-`): the app runs, but Gatekeeper blocks the first launch, and the README says how to open it. There is no Apple Developer ID yet. Signing and notarizing later means adding Apple secrets (a certificate, its password, the signing identity, an Apple ID with an app-specific password, and the team ID, as in Tauri's macOS signing guide) to the macOS build step.
- **Update files.** The updater reads the `.app.tar.gz` and its `.sig`, signed with the same update key as Windows. Updates on macOS are untested: before telling anyone they work, install one version, publish the next, and use *Check for updates*.
- **Apple Silicon only.** Intel Macs need a second matrix entry (`--target x86_64-apple-darwin`) or a universal build.
- **CI.** The macOS job of `ci.yml` is marked `experimental`: its failures show but do not fail the run. Remove `continue-on-error` once it has been green for a while.
- **Before publishing a draft that has a macOS file,** install the `.dmg` on a real Mac and check that terminals start, that your agents are found, and that the title bar's buttons work.
