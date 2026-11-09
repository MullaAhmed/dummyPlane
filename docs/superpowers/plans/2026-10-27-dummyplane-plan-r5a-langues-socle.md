# R5a « Être compris » — le socle des langues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dummyPlane sait parler anglais ou français : la langue suit Windows (anglais si ce n'est pas du français), se change dans les réglages sans redémarrer, et l'accueil, la barre du haut, les réglages, les écrans d'erreur et la mise à jour sont traduits. Les autres domaines suivent en R5b, les textes des agents en R5c.

**Architecture:** Des dictionnaires typés par domaine, sans bibliothèque : `defineMessages(fr, en)` impose à `en` le type de `fr` (une clé manquante ne compile pas) ; une valeur est un texte ou une fonction (paramètres, pluriels selon la langue). `useMessages(dict)` dans les composants, `messages(dict)` ailleurs, lisent `langStore`. Rust reçoit la langue résolue (`set_language`) pour ses propres messages (R5c).

**Tech Stack:** React 19, zustand, TypeScript 6 (`NoInfer`), Vitest, Rust (`AtomicU8`).

**Spec:** `docs/superpowers/specs/2026-10-27-dummyplane-premiere-version-design.md` (§7.1)

## Global Constraints

- Réglage `ui.language` : `"system"` (défaut), `"fr"`, `"en"`. `system` → `fr` si `navigator.language` commence par `fr`, sinon `en`.
- Les tests tournent en français (fichier de mise en place Vitest) : les tests existants ne changent pas.
- Anglais de l'interface : phrases courtes, casse de phrase (« Open the logs folder », pas « Open The Logs Folder »), « you » implicite, vocabulaire de l'app : agent, terminal, canvas, workspace, project, orchestrator, mission, group.
- Noms de touches affichés : FR « Maj », « Échap », « Suppr » ; EN « Shift », « Esc », « Del ». Les identifiants internes (`Shortcut`) ne changent pas.
- Les identifiants enregistrés et les noms donnés par l'utilisateur ne sont pas traduits.

## Review Focus

1. Un changement de langue pendant qu'un dialogue est ouvert : le dialogue se re-rend dans la nouvelle langue, sans perdre son état.
2. Un `navigator.language` absent ou bizarre (`""`, `"fr"`, `"fr-CA"`, `"en-GB"`, `"de-DE"`) : `fr`/`fr`/`fr`/`en`/`en`.
3. Un réglage enregistré illisible (`"de"`, `42`) : retour à `system`.
4. Une date d'usage en anglais : « Tue 09:00 », pas « mar. 09:00 ».
5. Excalidraw suit la langue (`langCode`) sans perdre la scène.

---

### Task 1: Le socle

**Files:** Create `src/i18n/index.ts`, `src/i18n/index.test.ts`, `src/test/setup.ts`; Modify `vite.config.ts` (`test.setupFiles`), `src/app/boot.ts` (load), `src/main.tsx` (start from the system language before the first render), `index.html` (`lang` set at start), `src-tauri/src/i18n.rs` (+ command `set_language`), `src-tauri/src/lib.rs`.

**Interfaces:**
- `type Lang = "fr" | "en"`; `type LanguageChoice = "system" | Lang`.
- `langStore` (`{ choice: LanguageChoice; lang: Lang }`), `useLang()`, `resolveLang(choice, navigatorLanguage): Lang`, `readLanguageChoice(raw): LanguageChoice`.
- `loadLanguage(): Promise<void>` (boot), `setLanguage(choice): Promise<void>` (saves, applies, tells Rust).
- `defineMessages<M>(fr: M, en: NoInfer<M>): { fr: M; en: M }`, `useMessages(dict)`, `messages(dict)`.
- `plural(lang, count, one, many)`: FR singular for 0 and 1, EN for 1 only.
- Rust: `i18n::set(lang)`, `i18n::is_english()`, macro `tr!(fr_fmt, en_fmt, args…)`.

- [ ] **Step 1: Failing tests** — `resolveLang` (the Review Focus cases), `readLanguageChoice`, `defineMessages` + `messages` switching with `langStore`, `plural` (FR 0 → singular, EN 0 → plural), `setLanguage` saving `ui.language` and invoking `set_language` with the resolved language; a component using `useMessages` re-renders on change. Rust: `tr!` picks the language set.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** `src/test/setup.ts` sets `langStore` to French. `main.tsx` sets the language from `navigator.language` before rendering; `boot` reads the saved choice; `document.documentElement.lang` follows.
- [ ] **Step 4: Run** → PASS; full suites. **Step 5: Commit** — `feat(i18n): an English and French interface, chosen from Windows`

### Task 2: Formats et touches

**Files:** Modify `src/lib/format.ts` (`formatAgo`, `plural`, `formatDuration` take the language), `src/shell/UsageMeter.tsx` (dates via `Intl` in the language, decimal separator), `src/usage/usage.ts` (cost text), `src/commands/shortcuts.ts` (display names per language), the places that show shortcuts.

- [ ] **Step 1: Failing tests** — `formatAgo` EN « just now », « 5 min ago », « 2 h ago », « 3 d ago »; FR unchanged; `formatDuration` EN « 1 h 05 » stays; usage reset time EN « Tue 09:00 »; cost « 1.5 $ » in EN, « 1,5 $ » in FR; shortcut label EN « Ctrl+Shift+P ».
- [ ] **Step 2–4** RED → GREEN; full suites. **Step 5: Commit** — `feat(i18n): dates, numbers and key names in the interface's language`

### Task 3: Accueil, barre du haut, réglages, erreurs, mise à jour

**Files:** Create `src/shell/messages.ts`, `src/home/messages.ts`, `src/app/messages.ts`; Modify every component of `src/shell/` (TitleBar, SearchField, ProjectPicker, WorkspaceTabs, SettingsMenu, ActivityRail, ToolRail, ZoomControl, GitChip, CommandBar, UsageMeter, AgentCounts, CloseAgentDialog, CloseGroupDialog, CrashNotice, UpdateDialog, StatusScreen, ProjectDialogs, PenMenu, ShapesMenu, IconsMenu, WindowControls, sceneActions, workspaceActions), `src/home/*`, `src/App.tsx`, `src/app/about.ts`, `src/app/logs.ts`, `src/app/updates.ts`, `src/canvas/Canvas.tsx` (`langCode`); the settings menu gets « Langue » (Système / Français / English).

- [ ] **Step 1: Failing tests** — English renderings: the home screen's empty state, the settings menu's language items, the close dialog (« Close Isis? », « Close the agent »), the crash notice, the update chip (« Version 1.0.0-beta.2 available »). Existing French tests stay as they are.
- [ ] **Step 2–4** RED → GREEN; full suites; tsc.
- [ ] **Step 5: Probe check** — switch to English in the settings menu: the title bar, home, settings and Excalidraw's own menus change at once; the scene stays; back to French.
- [ ] **Step 6: Commit** — `feat(i18n): the home screen, title bar, settings and dialogs in English`

### Task 4: Fin du jalon

- [ ] CONTRIBUTING (« texts go into both dictionaries of their domain »), CHANGELOG (Unreleased: English interface, language setting), BACKLOG; all checks; final review; merge into `main`, push.
