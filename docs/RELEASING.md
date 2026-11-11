# Releasing dummyPlane

Versions follow [Semantic Versioning](https://semver.org/). dummyPlane's first release is **`0.1.0`**; `1.0.0` comes out once no tester has lost work or had to build anything.

dummyPlane's home is [`MullaAhmed/dummyPlane`](https://github.com/MullaAhmed/dummyPlane): that is `origin`, and the only remote a release is pushed to. `upstream` is [OpenVibe](https://github.com/Mideky-hub/openvibe), the project dummyPlane was forked from; never push there. The local `v1.x` tags are OpenVibe's, not dummyPlane's releases; [CHANGELOG.md](../CHANGELOG.md) starts at the fork and links OpenVibe's own changelog for what came before.

## Before the first release

Two things to settle before `0.1.0`:

- **The update key's secrets.** dummyPlane has its own update key pair, and `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` is its public half. The Release workflow signs with the private half, which it reads from two repository secrets: until they are set (see [The update key](#the-update-key)), it cannot build the signed updater files. The key that signs a build must match the `pubkey` inside it, or installed copies reject the update.
- **The inherited version number.** `package.json` still carries a `1.x` beta number from OpenVibe. `node scripts/release.mjs 0.1.0` sets `0.1.0` in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`; it does not compare it with the current one, so going down is fine. The updater only offers a version higher than the one installed, so a copy built before the release, still numbered `1.x`, is never offered `0.1.0`: it is reinstalled by hand.

## Publish a version

1. On `main`, with a clean tree, make sure `CHANGELOG.md` lists the changes under `## [Unreleased]`, in words a user understands.
2. Run `node scripts/release.mjs <version>`, for example `node scripts/release.mjs 0.1.0`. It updates `package.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`, dates the changelog section, commits `chore(release): v<version>` and tags `v<version>`. It pushes nothing, and changes nothing when it refuses (not a semver version, not on `main`, tracked files with changes, empty Unreleased, tag already there). It does not refuse a version lower than the current one, so check the number yourself. (`scripts/release.mjs`, `scripts/release-lib.mjs`.)
3. Push to `origin`: `git push origin main v<version>`.
4. The **Release** workflow builds the installer and drafts the release `dummyPlane <version>` with:
   - `dummyPlane_<version>_x64-setup.exe` and its `.sig`,
   - `latest.json`, which installed copies read to find updates; the workflow points it at the release's download links (tauri-action writes a draft's with API URLs),
   - the changelog section and install instructions as notes.
5. Open the draft on GitHub, check the files are there, and **publish** it. Installed copies see it within 6 hours (or at once with **Check for updates** in the command palette, Ctrl+Shift+P).

Publish every release as a normal release, not a pre-release (the workflow already drafts it that way), including a beta such as `0.2.0-beta.1`: the updater reads `releases/latest/download/latest.json`, and GitHub's latest release is never a pre-release.

Running the **Release** workflow by hand (Actions → Release → Run workflow) only builds the installer and keeps it as an artifact. Like a tagged build, it needs the update key's secrets (below): without them the bundler refuses to build the signed updater files.

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
