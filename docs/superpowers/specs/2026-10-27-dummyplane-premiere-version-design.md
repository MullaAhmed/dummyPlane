# dummyPlane — La première version à partager (spec)

- **Date** : 2026-10-27
- **Statut** : décisions de Mathieu du 2026-10-27 : dépôt public à la première bêta ; bêtas non signées, puis SignPath Foundation ; anglais et français, langue de Windows par défaut ; jalons enchaînés sans relecture, chacun fusionné et poussé sur `main`. Les choix qu'il n'a pas tranchés sont marqués **(choix par défaut)**.
- **Source** : la liste de Mathieu (« Pouvoir l'installer », « Ne rien perdre », « Tenir les promesses de sécurité », « Une mission qui va au bout », « Être compris ») et les points correspondants de `BACKLOG.md`.

## 1. Objectif

Avoir une première version d'dummyPlane qu'on peut donner à des testeurs : un installeur téléchargeable, qui se met à jour seul, qui ne perd pas leur travail, qui tient les promesses du README et qu'on comprend sans parler français.

### Critère de sortie

La version **1.0.0** sort quand plus aucun testeur n'a perdu de travail ni dû compiler quoi que ce soit. Avant elle, les testeurs reçoivent des bêtas `1.0.0-beta.N` **(choix par défaut)**. À partir de la première bêta : un `CHANGELOG.md` et le versionnage sémantique.

## 2. Jalons

Chaque jalon a son plan (`docs/superpowers/plans/2026-10-27-dummyplane-plan-rN-….md`), sa branche, ses tests écrits d'abord, une relecture finale par un agent, puis la fusion et le push sur `main`.

| Jalon | Contenu | Pourquoi dans cet ordre |
|---|---|---|
| **R1** Ne rien perdre | reprise sans conversation, sauvegardeur, sauvegarde avant migration, limites d'erreur, paniques et verrous, journaux | Le critère de sortie ; les journaux servent à tout le reste. |
| **R2** Tenir les promesses de sécurité | orchestrateur sans réglages, CSP, jeton hors des lignes de commande, marqueurs de session | Avant que le dépôt soit public. |
| **R3** Une mission qui va au bout | dépôt sans commit, `MERGE_HEAD`, temps après « terminer », × d'un orchestrateur au travail | Petits correctifs déjà analysés. |
| **R4** Pouvoir l'installer | CI, versions, CHANGELOG, installeur, mises à jour automatiques | Les textes ajoutés par R1–R3 existent déjà quand R5 les traduit. |
| **R5** Être compris | anglais et français, premier lancement guidé, dépannage | Plus gros chantier : il passe sur tous les textes. |

Après R5 : audit des secrets de l'historique, passage du dépôt en public (confirmé par Mathieu au moment de le faire), publication de `v1.0.0-beta.1`.

## 3. R1 — Ne rien perdre

### 3.1 Reprendre une session Claude sans conversation

Constat : « Relancer », « Reprendre la session », « Reprendre toutes les conversations » et la carte de reprise lancent `claude --resume <id>`. Si l'agent n'a jamais reçu de message, Claude n'a rien enregistré sous cet identifiant : « No conversation found with session ID », et le terminal retombe sur le shell nu. « Plus récente du dossier » (`--continue`) échoue de même dans un dossier sans conversation.

Règle, côté Rust, juste avant de construire la commande (`claude_command`, `pty/shell.rs`), par une fonction injectée comme `Locate` pour rester testable :

- **Resume** : si aucun fichier `<id>.jsonl` n'existe dans un sous-dossier de `<config>/projects/` (où `<config>` est `CLAUDE_CONFIG_DIR` ou `~/.claude`, comme `user_settings_file`), lancer `--session-id <id>` au lieu de `--resume <id>` : une nouvelle conversation sous le même identifiant, sûre puisque rien n'existe sous ce nom.
- **Continue** : si le dossier de projet de Claude pour ce `cwd` ne contient aucun `.jsonl`, lancer une nouvelle session `--session-id <id>`. Le nom du dossier suit la règle de Claude Code (tout caractère hors `[A-Za-z0-9]`, compté en unités UTF-16, devient `-`), comparé sans casse ; au-delà de 200 caractères (nom haché), on ne vérifie pas et on garde `--continue`.
- Côté TypeScript : un terminal Claude sans `claudeSessionId` reçoit un identifiant **enregistré dans son nœud** avant le lancement (aujourd'hui `buildSpawnSpec` en tire un au hasard sans le garder, et une reprise suivante en tire un autre).

La bascule est silencieuse : l'utilisateur voit Claude démarrer une conversation neuve.

### 3.2 Le sauvegardeur périodique n'écrase plus l'historique final

Constat : le sauvegardeur Rust (toutes les 10 s) prend un instantané de chaque terminal, puis les enregistre l'un après l'autre. Si un terminal se termine entre l'instantané et l'écriture, la sauvegarde finale (à la sortie du processus) est écrasée par l'instantané plus ancien.

Correctif : l'instantané porte l'heure de sa capture (prise sous le verrou de la sortie) ; `scrollback::save` écrit cette heure dans `updated_at` et ne remplace une ligne que si elle est au moins aussi récente (`ON CONFLICT … DO UPDATE … WHERE excluded.updated_at >= terminal_scrollback.updated_at`). La colonne existe déjà : pas de migration.

### 3.3 Sauvegarde de la base avant chaque migration

- Avant d'appliquer la première migration manquante d'une base existante (`0 < user_version < MIGRATIONS.len()`), `VACUUM INTO '<dossier>/dummyplane.v<N>-backup.db'`. Si ce fichier existe déjà, on le garde (c'est la copie d'avant la première tentative). Si la copie échoue, la migration n'a pas lieu et dummyPlane affiche l'erreur au démarrage (le dialogue bloquant existant).
- Une base d'une version plus récente (`user_version > MIGRATIONS.len()`, cas d'un testeur qui revient à une bêta antérieure) n'est pas ouverte : « Cette base vient d'une version plus récente d'dummyPlane. Installe la dernière version. » Aujourd'hui elle est ouverte sans rien dire.

### 3.4 Limites d'erreur React

- **Racine** (autour du contenu d'`App`) : un écran « L'interface a rencontré une erreur », le message, « Recharger l'interface » et « Ouvrir le dossier des journaux ». Recharger ne coupe pas les agents : leurs processus vivent dans Rust et les terminaux se rattachent au démarrage.
- **Chaque nœud** (`NodeHost`) : une carte d'erreur dans le cadre du nœud, avec « Réessayer ». Le processus du terminal continue.
- **Le canvas** (clé : l'espace) et **les panneaux** (Agents, revue, usage, palette, dialogues) : une erreur locale avec « Réessayer », le reste de l'interface reste en place.
- `boot()` rejeté passe à un écran d'erreur au lieu de rester sur « Chargement… ».
- Toute erreur attrapée, `window.onerror` et `unhandledrejection` vont dans le journal (§3.6).

### 3.5 Paniques et verrous

Constat : la build release a `panic = "abort"` : une panique dans n'importe quel fil (serveur local, lecteur d'un terminal) tue dummyPlane et tous ses agents, sans la sauvegarde finale. En dev, une panique sous verrou empoisonne le verrou, et les 33 `lock().unwrap()` paniquent ensuite à leur tour (la base, le suivi d'activité qui fige les terminaux).

Correctif :

- `panic = "unwind"` en release : une panique ne tue que son fil.
- Un helper `lock(&Mutex<T>)` qui récupère un verrou empoisonné (`unwrap_or_else(PoisonError::into_inner)`) remplace les 33 `lock().unwrap()` de production.
- Un `panic hook` écrit la panique (message, fichier, ligne, fil) dans le journal.

### 3.6 Journaux

- `tauri-plugin-log` : un fichier `dummyplane.log` dans `%LOCALAPPDATA%\dev.dummyplane.app\logs`, rotation à 5 Mo en gardant les fichiers précédents (le plan fixe le nombre), heure locale ; niveau `info` en release, `debug` en dev ; sortie console en dev.
- Les 6 `eprintln!` deviennent des `log::warn!`/`log::error!`. Lignes ajoutées : démarrage (version, Windows), base (ouverture, migrations, sauvegarde), serveur local (port), lancement et fin de chaque terminal (nœud, agent, code de sortie), erreurs de mission et de mise à jour.
- **Jamais dans le journal** : jetons, texte des terminaux, consignes, contenu des fichiers. Le journal est fait pour être envoyé.
- Le frontend écrit ses `console.warn`/`console.error`, les erreurs des limites (§3.4) et les rejets non gérés par `@tauri-apps/plugin-log`.
- « Ouvrir le dossier des journaux » : une commande Rust (`app_log_dir` + l'ouvreur), dans la palette (section Aide, disponible partout) et dans le menu des réglages.
- Le modèle de rapport de bug (`.github/ISSUE_TEMPLATE/bug_report.yml`) demande le fichier de journal et dit où le trouver.

## 4. R2 — Tenir les promesses de sécurité

### 4.1 Un orchestrateur ne démarre jamais sans ses réglages

Constat : sans serveur local, ou si l'écriture de ses réglages échoue, l'orchestrateur démarre comme un Claude ordinaire, sans `deny`, sans outils ni consigne de rôle, dans le dossier de l'utilisateur. Et `Bash` n'est jamais interdit : il peut faire `git checkout` ou écrire un fichier.

- `pty_spawn` refuse de lancer un orchestrateur dont `--settings`, `--mcp-config` ou `--append-system-prompt-file` manque : il nettoie ce qui a été écrit et renvoie une erreur de type `toolsUnavailable`.
- Le nœud affiche alors, à la place du terminal, « Outils dummyPlane indisponibles » avec la cause, « Réessayer » et « Ouvrir le dossier des journaux » (spec orchestrateur §9). Ni « arrêté » ni offre de reprise.
- Les réglages de l'orchestrateur interdisent aussi `Bash` **(choix par défaut)** : il lit le dépôt avec Read, Grep et Glob, et fait vérifier les tests par un agent (c'est déjà sa consigne). Il est lancé avec `--strict-mcp-config` : seuls les outils d'dummyPlane, pas les serveurs MCP de l'utilisateur dont les outils d'écriture échapperaient au `deny` **(choix par défaut)**.
- La consigne de rôle dit qu'il ne peut ni modifier de fichier ni lancer de commande.

### 4.2 Une CSP stricte

`csp: null` devient (production) :

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ipc: http://ipc.localhost data: blob:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'
```

- `'wasm-unsafe-eval'` : le découpage des polices d'Excalidraw (export SVG) et le redimensionnement des images. `'unsafe-inline'` en style : xterm, Excalidraw, sonner et React posent des styles en ligne.
- Le script en ligne d'`index.html` (`window.EXCALIDRAW_ASSET_PATH = "/"`) passe dans un module importé en premier par `main.tsx`.
- Les polices de secours d'Excalidraw sur `esm.sh` sont bloquées : dummyPlane n'appelle aucun réseau pour dessiner.
- Une `devCsp` équivalente qui autorise en plus le serveur Vite (`ws://localhost:1420`, scripts en ligne de react-refresh).
- Vérification dans l'app de sonde : aucune violation (`securitypolicyviolation`) en dessinant, en insérant une icône et une image, en exportant en PNG, en copiant en SVG et avec des terminaux ouverts.

### 4.3 Le jeton du serveur local sort des lignes de commande

Constat : la ligne d'état (`bash statusline.sh '<url>?t=<jeton>'` puis `curl … "$1"`) et Codex (`codex -c "notify=['curl.exe',…,'…?t=<jeton>','-d']"`) mettent le jeton dans la ligne de commande de processus visibles par tous, et la commande de Codex est tapée dans le shell, donc dans son historique.

- Le serveur accepte le jeton dans un en-tête `X-dummyPlane-Token` en plus du paramètre `?t=`.
- dummyPlane écrit au démarrage un fichier de configuration curl `hooks/curl.cfg` (`header = "X-dummyPlane-Token: <jeton>"`), dans le même dossier protégé que les réglages qui contiennent déjà le jeton.
- La ligne d'état appelle `curl -K '<cfg>' … '<url sans jeton>'` ; Codex reçoit `notify=['curl.exe','-s','-K','<cfg>','-X','POST','<url sans jeton>','-d']`.
- Les hooks HTTP de Claude gardent leur URL avec jeton : elle n'est que dans un fichier.
- Test : aucune commande construite ne contient le jeton.

### 4.4 Marqueurs de session hérités

Les 8 marqueurs de la spec habillage (§8.2) sont déjà retirés de l'environnement des terminaux ; `BACKLOG.md` est en retard. Restent, quand dummyPlane lui-même tourne dans une session Claude Code (`CLAUDECODE` présent) : `CLAUDE_CODE_SSE_PORT`, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_PID`, `CLAUDE_EFFORT`, `AI_AGENT`, `GIT_EDITOR` et `NoDefaultCurrentDirectoryInExePath` : ils sont retirés aussi dans ce cas seulement (hors Claude Code, `GIT_EDITOR` est un réglage de l'utilisateur). Pas de retrait par préfixe `CLAUDE_CODE_*`, qui enlèverait des réglages comme `CLAUDE_CODE_USE_BEDROCK`. Le test vérifie la liste entière.

## 5. R3 — Une mission qui va au bout

### 5.1 Dépôt sans commit

`mission::prepare` vérifie `git rev-parse --verify --quiet HEAD` avant de créer le worktree : « Le dépôt n'a pas encore de commit : fais un premier commit, puis relance la mission. » au lieu de « fatal: invalid reference: HEAD ».

### 5.2 Une fusion ratée ne bloque plus les suivantes

`merge_agent` annule la fusion (`git merge --abort`) dès que `MERGE_HEAD` existe après un échec, avec ou sans fichier en conflit (un hook qui refuse le commit laisse `MERGE_HEAD` sans conflit). L'erreur rendue dit que la fusion a été annulée, avec la sortie de git.

### 5.3 Les temps s'arrêtent à « terminer »

`Mission` gagne `endedAt`, posé par `endMission` et relu par `readMission`. Le temps d'un agent court jusqu'à son compte rendu, sinon jusqu'à `endedAt`, sinon jusqu'à maintenant. Une mission terminée avant ce correctif (sans `endedAt`) n'affiche pas le temps des agents qui n'ont pas rendu compte.

### 5.4 Le × d'un orchestrateur au travail demande confirmation

- Le × du nœud et la commande « Fermer l'orchestrateur » passent par la même confirmation que les terminaux quand l'orchestrateur tourne ; avec une mission en cours, le dialogue le dit : « <nom> mène une mission en cours. Le fermer arrête sa session ; ses agents continuent, mais personne ne lira leurs comptes rendus. »
- Un orchestrateur supprimé n'a plus de mission active : `memberOf`, l'horloge des budgets et les évènements de mission l'ignorent (plus de toasts de dépassement pour lui).
- `rendre_compte` vers un orchestrateur arrêté ou supprimé enregistre le compte rendu dans le panneau et répond qu'il n'est pas transmis : « Compte rendu enregistré, mais l'orchestrateur est fermé : personne ne le lira pour l'instant. »

## 6. R4 — Pouvoir l'installer

### 6.1 Versions et CHANGELOG

- La version vit dans `package.json` ; `tauri.conf.json` la lit (`"version": "../package.json"`) ; `Cargo.toml` la recopie. Un test vérifie que les deux concordent.
- `CHANGELOG.md` en anglais, au format Keep a Changelog : `## [Unreleased]` puis une section par version.
- `scripts/release.mjs <version>` : vérifie la version (semver), un arbre propre sur `main` et une section `Unreleased` non vide ; met à jour `package.json`, `Cargo.toml` et `Cargo.lock` ; déplace `Unreleased` dans `## [<version>] - <date>` ; commite `chore(release): v<version>` et pose le tag annoté `v<version>`. Il ne pousse rien. Ses fonctions pures sont testées.
- Première bêta : `1.0.0-beta.1`. Le plan vérifie d'abord qu'une version avec suffixe passe dans l'installeur NSIS ; sinon il le dit et propose un autre schéma.

### 6.2 Intégration continue

- `.github/workflows/ci.yml`, sur push vers `main` et sur pull request, sous `windows-latest` : `pnpm install --frozen-lockfile`, tests TS, `tsc`, `pnpm build`, `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`. Caches pnpm et Rust.
- `.github/workflows/release.yml`, sur tag `v*` : les mêmes vérifications, puis `tauri-apps/tauri-action@v1` avec les secrets de signature des mises à jour ; release **en brouillon** nommée `dummyPlane <version>`, son texte tiré de la section du CHANGELOG ; l'installeur, sa signature `.sig` et `latest.json` en pièces jointes.
- Les bêtas sont publiées comme releases normales (pas « pre-release ») tant qu'aucune 1.0.0 n'existe : l'adresse `releases/latest/download/latest.json` ne voit pas les pre-releases. Après 1.0.0, les bêtas seront des pre-releases installées à la main **(choix par défaut)**.
- Les actions sont épinglées à leur version majeure.

### 6.3 Installeur

- NSIS, par utilisateur, sans droits d'administrateur (comme aujourd'hui).
- Langues `English` et `French`, choisies d'après Windows, sans sélecteur.

### 6.4 Mises à jour automatiques

- `tauri-plugin-updater` et `tauri-plugin-process` ; `bundle.createUpdaterArtifacts: true` ; `plugins.updater.pubkey` ; point d'accès `https://github.com/Mideky-hub/openvibe/releases/latest/download/latest.json` ; installation `passive` (barre de progression seule).
- La paire de clés est générée une fois (`tauri signer generate`, avec mot de passe) dans `%USERPROFILE%\.tauri\dummyplane.key` ; la clé privée et son mot de passe vont dans les secrets du dépôt (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Mathieu en garde une copie hors de la machine : sans elle, plus aucune mise à jour possible pour les installations existantes.
- Vérification 10 s après le démarrage puis toutes les 6 h, si le réglage « Rechercher les mises à jour automatiquement » est actif (par défaut). Commande « Rechercher les mises à jour » dans la palette (Aide) et dans le menu des réglages.
- Une mise à jour trouvée : une puce discrète dans la barre du haut, « Version <x> disponible ». Elle ouvre un dialogue : version, notes, et la liste des agents en cours (« Ces agents seront arrêtés ; leurs conversations Claude pourront être reprises au redémarrage »). « Installer et redémarrer » télécharge (progression), enregistre tout (scène, nœuds, historiques des terminaux), puis installe ; Windows ferme dummyPlane et le relance. Au redémarrage, l'offre « Reprendre toutes les conversations » existante s'applique.
- Une erreur de vérification automatique est seulement journalisée ; une vérification demandée à la main affiche un toast.
- README et `SECURITY.md` disent que la seule requête réseau d'dummyPlane est cette vérification auprès de GitHub, et comment la couper.

### 6.5 Signature du code

- Les bêtas ne sont pas signées. Le README et le guide de dépannage disent quoi faire devant SmartScreen (« Informations complémentaires », « Exécuter quand même »).
- `docs/RELEASING.md` décrit : publier une version, les secrets, la sauvegarde de la clé, et la demande à SignPath Foundation une fois le dépôt public et une première release publiée (conditions : licence OSI, build entièrement en CI, page de politique de signature). La signature s'ajoutera à `release.yml` après acceptation.

### 6.6 Passage en public (après R5)

1. Audit de tout l'historique à la recherche de secrets (motifs de clés et jetons, fichiers `.env`, `.key`).
2. Mathieu confirme, puis le dépôt passe en public.
3. Activer le signalement privé des vulnérabilités ; Mathieu téléverse `docs/assets/brand/social-preview.png` comme aperçu social (pas d'API).
4. Tag `v1.0.0-beta.1`, vérification du brouillon (installeur, `.sig`, `latest.json`), publication.

## 7. R5 — Être compris

### 7.1 Deux langues

- **Langue** : réglage `ui.language` = `system` (par défaut), `fr` ou `en`. `system` donne `fr` si `navigator.language` commence par `fr`, sinon `en`. Choix dans le menu des réglages et par la palette (« Langue »), sur l'accueil comme dans un projet.
- **Dictionnaires typés, sans bibliothèque** **(choix par défaut)** : `src/i18n/fr.ts` est la source ; `src/i18n/en.ts` a le même type, donc une clé manquante ne compile pas. Une valeur est un texte ou une fonction pour les paramètres et les pluriels (`closeTitle: (name: string) => …`), chaque langue appliquant sa règle (en français, 0 et 1 au singulier). `useT()` dans les composants, `t()` ailleurs ; un changement de langue re-rend l'interface sans redémarrage.
- **Ce qui suit la langue** : tous les textes visibles (JSX, `aria-label`, `title`, placeholders, toasts, palette avec ses mots-clés, dialogues natifs), Excalidraw (`langCode`), `<html lang>`, les dates et nombres (`Intl`, fini les `toLocale…("fr-FR")` et les virgules à la main), les noms de touches (« Maj », « Échap », « Suppr » / « Shift », « Esc », « Del »).
- **Côté Rust** : la langue résolue est transmise au démarrage et à chaque changement (`set_language`) ; les messages montrés à l'utilisateur passent par un helper `tr(fr, en)`. Le dialogue d'échec de la base, avant l'interface, suit la langue de Windows.
- **Ce qui est envoyé aux agents** suit aussi la langue : consignes de rôle, descriptions et réponses des outils MCP, lignes `[dummyPlane]` tapées dans les terminaux, message des remarques de revue.
- **Les noms des outils MCP passent en anglais pour tous** (`declare_steps`, `step`, `report`, `propose_plan`, `team`, `read_output`, `write`, `extend`, `interrupt`, `reassign`, `merge`, `finish`, et leurs arguments) **(choix par défaut)** : ils s'affichent dans les terminaux, et un seul protocole évite de le traduire.
- **Ce qui ne change pas** : les identifiants enregistrés (états de mission `en_cours`…, niveaux `faible`…), les noms déjà donnés (« Groupe 2 », « Orchestrateur », « Workspace 1 » ; les nouveaux prennent la langue courante), les prénoms des panthéons (seuls leurs libellés sont traduits). `@tous` et `@all` marchent dans les deux langues.
- **Tests** : la langue des tests est le français, les tests existants ne changent pas ; des tests en anglais couvrent l'accueil, la palette, un dialogue et un outil MCP.
- README (plus de « its interface is in French »), `README.fr.md` et `CONTRIBUTING.md` (« les textes vont dans les deux dictionnaires ») sont mis à jour.

### 7.2 Premier lancement guidé

- L'accueil charge la liste des agents. Tant qu'aucun projet n'existe ou qu'aucun agent de code n'est installé, un encart « Bien démarrer » montre trois étapes et leur état : installer un agent, ajouter un projet (un dossier de dépôt git), lancer un agent (clic droit sur le canvas ou `Ctrl+K`).
- Sans aucun agent : « Aucun agent de code trouvé ». Claude Code en tête (il est requis pour l'orchestrateur, les missions et l'usage), avec sa commande d'installation officielle à copier ; les autres agents avec un lien vers leur page d'installation officielle. Les commandes et liens sont vérifiés au moment du plan.
- « Vérifier à nouveau » relit le `PATH` de Windows (utilisateur et machine, dans le registre) avant de chercher les agents : un agent installé après le démarrage d'dummyPlane est trouvé sans le relancer, et les nouveaux terminaux le voient aussi.
- Lancer un orchestrateur sans Claude Code installé est refusé avec un message clair.

### 7.3 Dépannage

- Un dialogue « Dépannage » (palette, section Aide ; menu des réglages ; lien sur l'accueil) : version d'dummyPlane ; agents trouvés et leur chemin ; Git et Git Bash ; serveur local (en marche ou non) ; boutons « Ouvrir le dossier des journaux », « Ouvrir le dossier des données », « Copier le diagnostic » (texte sans jeton ni chemin de projet), « Guide de dépannage » et « Signaler un problème » (nouvelle issue GitHub avec la version préremplie).
- `docs/troubleshooting.md` et `docs/troubleshooting.fr.md` : SmartScreen, agent introuvable, compteur d'usage vide (Git Bash), « Outils dummyPlane indisponibles », mission dans un dépôt sans commit, où sont les journaux et les données, signaler un bug, repartir de zéro, désinstaller.

## 8. Après la première bêta

Les testeurs installent la bêta depuis la page des releases, les suivantes leur arrivent par la mise à jour automatique. Chaque bêta passe par `scripts/release.mjs`. Quand plus aucun testeur n'a perdu de travail ni dû compiler, `1.0.0`.

## 9. Hors périmètre

- La signature effective (après acceptation par SignPath).
- macOS et Linux.
- Un canal de bêta séparé après 1.0.0.
- La sauvegarde de l'historique d'un terminal relancé (sa première sauvegarde remplace celle de la session précédente) : au BACKLOG.
- Les autres points du BACKLOG.

## 10. Vérification

- Chaque correctif commence par un test qui échoue (Rust ou TS).
- Les jalons qui touchent l'interface sont vérifiés dans l'app de sonde (`dev.dummyplane.probe`), jamais sur la base réelle de Mathieu.
- R4 : une release en brouillon construite par la CI tant que le dépôt est privé ; la mise à jour testée de bout en bout en local avec un `latest.json` servi en local (configuration de sonde).
- `BACKLOG.md` : les points réglés sont retirés à la fin de chaque jalon.
