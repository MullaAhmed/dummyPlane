# Releasing dummyPlane

Versions follow [Semantic Versioning](https://semver.org/). Betas of the first version are `1.0.0-beta.N`; `1.0.0` comes out once no tester has lost work or had to build anything.

## Publish a version

1. On `main`, with a clean tree, make sure `CHANGELOG.md` lists the changes under `## [Unreleased]`, in words a user understands.
2. Run `node scripts/release.mjs <version>`, for example `node scripts/release.mjs 1.0.0-beta.2`. It updates `package.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`, dates the changelog section, commits `chore(release): v<version>` and tags `v<version>`. It pushes nothing, and changes nothing when it refuses (dirty tree, not on `main`, empty Unreleased, tag already there).
3. Push: `git push origin main v<version>`.
4. The **Release** workflow builds the installer and drafts the release `dummyPlane <version>` with:
   - `dummyPlane_<version>_x64-setup.exe` and its `.sig`,
   - `latest.json`, which installed copies read to find updates; the workflow points it at the release's download links (tauri-action writes a draft's with API URLs),
   - the changelog section and install instructions as notes.
5. Open the draft on GitHub, check the files are there, and **publish** it. Installed copies see it within 6 hours (or at once with « Rechercher les mises à jour »).

Keep betas as normal releases, not pre-releases, until `1.0.0`: the updater reads `releases/latest/download/latest.json`, and GitHub's latest release is never a pre-release.

Running the **Release** workflow by hand (Actions → Release → Run workflow) only builds the installer and keeps it as an artifact. Like a tagged build, it needs the update key's secrets (below): without them the bundler refuses to build the signed updater files.

## The update key

Installed copies only accept updates signed with dummyPlane's update key; its public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.

- The key pair lives in `%USERPROFILE%\.tauri\dummyplane.key` (private), `dummyplane.key.pub` and `dummyplane.key.password`.
- **Keep a copy of the private key and its password off this machine** (a password manager). Without them, no installed copy can ever be updated again: every user would have to reinstall by hand.
- The workflow reads them from two repository secrets, `TAURI_SIGNING_PRIVATE_KEY` (the content of `dummyplane.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`:

  ```powershell
  Get-Content $HOME\.tauri\dummyplane.key -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY --repo Mideky-hub/openvibe
  Get-Content $HOME\.tauri\dummyplane.key.password -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo Mideky-hub/openvibe
  ```

## Code signing

Betas are not code-signed, so Windows SmartScreen warns on first launch. Once a first release is published, apply to the [SignPath Foundation](https://signpath.org/), which signs open-source projects for free:

- the project is under an OSI licence (MIT) and its installer is built entirely by GitHub Actions from this repository;
- the README links a code signing policy page;
- after approval, a signing step goes into `release.yml` between the build and the upload, and the release notes stop mentioning SmartScreen.

Azure Artifact Signing is not open to individual developers in France.
