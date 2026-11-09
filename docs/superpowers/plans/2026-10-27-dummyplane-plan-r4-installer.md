# R4 « Pouvoir l'installer » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un testeur télécharge un installeur depuis les releases GitHub, sans rien compiler, et reçoit les versions suivantes par la mise à jour automatique ; chaque version a son numéro semver et sa section de CHANGELOG.

**Architecture:** Une seule version (`package.json`, lue par `tauri.conf.json`, recopiée dans `Cargo.toml`), un script de publication testé, deux workflows GitHub Actions (vérifications à chaque push, build et release en brouillon à chaque tag), `tauri-plugin-updater` avec une clé de signature des mises à jour, et une interface de mise à jour qui enregistre tout avant d'installer.

**Tech Stack:** Tauri 2.12 (`tauri-plugin-updater`, `tauri-plugin-process`), GitHub Actions (`tauri-apps/tauri-action@v1`), Node 22 / pnpm 10, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-dummyplane-premiere-version-design.md` (§6). Constat du 2026-10-27 : le dépôt est déjà public depuis le 23 octobre ; l'étape « passage en public » (§6.6) se réduit à l'audit des secrets (fait, propre) et aux réglages du dépôt.

## Global Constraints

- Première bêta : `1.0.0-beta.1` (posée par le script au moment de publier, pas dans ce jalon).
- Point d'accès des mises à jour : `https://github.com/Mideky-hub/openvibe/releases/latest/download/latest.json`.
- Clé : `%USERPROFILE%\.tauri\dummyplane.key` (+ `.pub`), mot de passe dans `%USERPROFILE%\.tauri\dummyplane.key.password` ; secrets `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Installation `passive`, NSIS par utilisateur, langues `English` et `French`.
- Vérification 10 s après le démarrage puis toutes les 6 h, si `updates.auto` (vrai par défaut).
- La seule requête réseau d'dummyPlane est cette vérification ; elle se coupe dans les réglages.
- CHANGELOG en anglais, format Keep a Changelog.
- Textes de l'interface en français (R5 traduira).
- Ne jamais lancer l'exe de release ni l'installeur sur ce poste ; vérifications dans l'app de sonde.

## Review Focus

1. Une mise à jour lancée pendant qu'un agent écrit : son historique et la scène doivent être enregistrés avant que l'installeur ferme dummyPlane.
2. Pas de réseau, GitHub injoignable ou `latest.json` absent (aucune release publiée) : la vérification automatique ne dit rien à l'utilisateur et l'écrit au journal.
3. `scripts/release.mjs` lancé deux fois, ou avec une section `Unreleased` vide, ou sur une autre branche que `main` : il refuse sans rien modifier.
4. Une version avec suffixe (`1.0.0-beta.1`) dans l'installeur NSIS et dans la comparaison de l'updater (`beta.2` > `beta.1`, `1.0.0` > `beta.9`).
5. Le réglage « Rechercher les mises à jour automatiquement » coupé : aucune requête, même au démarrage.

---

### Task 1: Une seule version, un CHANGELOG, un script de publication

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`"version": "../package.json"`)
- Create: `CHANGELOG.md`, `scripts/release.mjs`, `scripts/release-lib.mjs`, `scripts/release.test.mjs`, `src/app/version.test.ts`

**Interfaces:**
- Produces (`scripts/release-lib.mjs`): `isSemver(v): boolean`, `bumpPackageJson(text, v): string`, `bumpCargoToml(text, v): string`, `bumpCargoLock(text, v): string` (the `dummyplane` package only), `releaseChangelog(text, v, date): string` (moves `## [Unreleased]` into `## [v] - date`, leaves an empty `## [Unreleased]`; throws when Unreleased is empty or `v` already has a section), `changelogSection(text, v): string` (the body of a version, for the release notes).

- [ ] **Step 1: Failing tests** (`scripts/release.test.mjs`): each function above with real text fixtures — semver with prerelease; `Cargo.lock` with two packages where only `name = "dummyplane"` changes; the CHANGELOG move; the refusals (empty Unreleased, existing version, not semver). `src/app/version.test.ts`: `package.json` and `src-tauri/Cargo.toml` versions are equal, and `tauri.conf.json` reads `../package.json`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the lib; `scripts/release.mjs <version>` checks a clean tree on `main`, applies the bumps (`package.json`, `Cargo.toml`, `Cargo.lock`), the CHANGELOG, then `git commit -m "chore(release): v<version>"` and `git tag -a v<version> -m "dummyPlane <version>"`; prints the push command, pushes nothing. `CHANGELOG.md`: header, `## [Unreleased]` listing R1–R4 (and R5 later) in user words, in English.
- [ ] **Step 4: Run** → PASS; `pnpm tauri build --debug --no-bundle` still reads the version (About shows 0.1.0).
- [ ] **Step 5: Commit** — `build(release): one version, a changelog and a release script`

### Task 2: Intégration continue et workflow de release

**Files:** Create `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/release-notes.mjs`.

- [ ] **Step 1:** `ci.yml` — on `push` to `main` and `pull_request`: `windows-latest`; `actions/checkout@v4`; `pnpm/action-setup@v4`; `actions/setup-node@v4` (node 22, pnpm cache); `dtolnay/rust-toolchain@stable` with `clippy, rustfmt`; `swatinem/rust-cache@v2` (`workspaces: src-tauri`); `pnpm install --frozen-lockfile`; `pnpm exec tsc --noEmit`; `pnpm test`; `pnpm build`; `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` in `src-tauri`.
- [ ] **Step 2:** `release.yml` — on `push` tags `v*` and `workflow_dispatch` (dry run): same setup; `node scripts/release-notes.mjs "$GITHUB_REF_NAME" > notes.md`; `tauri-apps/tauri-action@v1` with `GITHUB_TOKEN`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; `tagName: ${{ github.ref_name }}`, `releaseName: dummyPlane __VERSION__`, `releaseBodyPath: notes.md` (or `releaseBody` from a step output), `releaseDraft: true`, `prerelease: false`, `updaterJsonPreferNsis: true`; on `workflow_dispatch`, no release: `actions/upload-artifact@v4` of `src-tauri/target/release/bundle/nsis/*`. `permissions: contents: write`.
- [ ] **Step 3:** `scripts/release-notes.mjs` uses `changelogSection` (tested in Task 1).
- [ ] **Step 4:** Push the branch; run `gh workflow run release.yml --ref <branch>` (dry run) after Task 3 sets the secrets, and `ci.yml` runs on the push; watch both with `gh run watch`; fix until green.
- [ ] **Step 5: Commit** — `ci: check every push and build releases from tags`

### Task 3: Mises à jour automatiques

**Files:**
- Modify: `src-tauri/Cargo.toml`, `package.json` (`tauri-plugin-updater`, `tauri-plugin-process`, `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`), `src-tauri/src/lib.rs` (plugins; command `prepare_for_update`), `src-tauri/tauri.conf.json` (`bundle.createUpdaterArtifacts`, `plugins.updater`, NSIS languages), `src-tauri/capabilities/default.json` (`updater:default`, `process:allow-restart`)
- Create: `src/app/updates.ts`, `src/app/updates.test.ts`, `src/shell/UpdateChip.tsx`, `src/shell/UpdateDialog.tsx`, `src/shell/UpdateDialog.test.tsx`
- Modify: `src/app/boot.ts` (start the checks), `src/shell/TitleBar.tsx` or `ProjectView`/`HomeScreen` (chip), `src/shell/SettingsMenu.tsx` (toggle + « Rechercher les mises à jour »), `src/commands/catalog/app.ts` (command)

**Interfaces:**
- Produces: `updatesStore` (`{ available: { version, notes } | null, auto: boolean, checking: boolean, progress?: number }`); `checkForUpdate({ manual }): Promise<void>`; `installUpdate(): Promise<void>` (download with progress → `flushAll()` → `invoke("prepare_for_update")` (Rust: final scrollback flush) → `update.install()`); `startUpdateChecks(): () => void` (10 s, then every 6 h, only when `auto`).

- [ ] **Step 1: Failing tests** (`updates.test.ts`, the updater and process plugins mocked): no check when `auto` is off; an automatic check that throws only logs (`console.warn`), a manual one shows `toast.error`; an available update sets `available`; `installUpdate` calls, in order, download, `flushAll`, `prepare_for_update`, install. (`UpdateDialog.test.tsx`): lists the running agents by name and warns they will be stopped; « Installer et redémarrer » calls `installUpdate`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; key pair with `pnpm tauri signer generate -w %USERPROFILE%\.tauri\dummyplane.key -p <random>` (password saved next to it), public key into `plugins.updater.pubkey`, secrets with `gh secret set`. Rust `prepare_for_update`: `flush_scrollbacks(app, true)` then returns (the installer closes the app; `RunEvent::Exit` still kills the agents).
- [ ] **Step 4: Run** → PASS; full suites.
- [ ] **Step 5: Probe check** — a probe build with `plugins.updater.endpoints` pointed at a local static server (`dangerousInsecureTransportProtocol` for http) serving a `latest.json` of a higher version signed with the new key: the chip appears, the dialog lists agents, the download verifies the signature (stop before `install`: the installer would install). Then a `latest.json` with a bad signature: an error, nothing installed.
- [ ] **Step 6: Commit** — `feat(updates): find, download and install new versions`

### Task 4: Documentation et fin du jalon

- [ ] `README.md` / `README.fr.md`: install from the Releases page (installer, SmartScreen « More info » → « Run anyway » for unsigned betas), updates, the one network request and how to turn it off; « Build from source » stays below.
- [ ] `SECURITY.md`: « No telemetry » mentions the update check; signature of updates.
- [ ] `docs/RELEASING.md`: publish a version (CHANGELOG, `node scripts/release.mjs`, push tag, check the draft, publish), the secrets, back up the key, SignPath application (OSI licence, CI build, signing policy page) once a first release is published.
- [ ] `BACKLOG.md`; all checks; final review; fixes; merge into `main`, push, delete the branch. CI must be green on `main`.
