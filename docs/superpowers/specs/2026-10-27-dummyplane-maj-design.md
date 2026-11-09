# dummyPlane — mise à jour du 27 octobre 2026

Les six idées de « prochaine mise à jour » du `BACKLOG.md`, faites la nuit du 26 au 27 octobre, chacune sur sa branche `feat/…` fusionnée dans `maj/2026-10-27`. Mathieu dormait : les décisions prises pour lui sont notées dans chaque section, sous « Décisions ». Le design (couleurs, tailles, disposition fine) reste à reprendre avec lui.

## 1. Commandes groupées (`feat/commandes-groupees`)

**Demande** : « Pouvoir via la consigne aux agents exécuter une commande pour plusieurs agents en même temps, type `@athena/zeus/héra /effort ultracode`. »

**Comportement**

- `@a/b/c` cible les trois agents (ou groupes) d'un coup, dans la barre de consigne comme dans le champ d'un orchestrateur. Chaque nom suit les règles de `@` : casse et accents ignorés. Si l'un des noms est inconnu ou ambigu, la mention reste telle quelle dans le texte, comme une mention simple.
- La liste `@` complète le dernier nom tapé : `@thot/ze` propose `@zeus`, et Tab fait des puces de Thot et de Zeus.
- Un texte qui commence par `/` est une commande du CLI de l'agent : il est tapé tel quel, suivi d'Entrée (vérifié dans l'app avec Claude Code 2.1.304 : `/effort`, `/context`, `/remote-control` s'exécutent).
- Après les cibles, `/` ouvre la liste des commandes utiles de Claude Code (`/effort`, `/model`, `/remote-control`, `/compact`, `/clear`, `/context`, `/usage`, `/fast`, `/status`), avec une ligne d'aide. Tab ou Entrée complète, Échap ferme.

**Décisions**

- Une commande `/…` ne part pas aux terminaux sans agent (shell nu, commande personnalisée) : un shell la lancerait comme un programme. Ils sont nommés dans un toast. Les autres agents (Codex, Gemini…) la reçoivent : ils ont leurs propres commandes `/`.
- Un agent qui attend une réponse reste ignoré, comme pour une consigne : l'Entrée validerait le choix de son dialogue.
- Constat : `/effort <niveau>` enregistre aussi ce niveau comme effort par défaut de Claude pour ce modèle (`modelSettings` de `~/.claude/settings.json`). La ligne d'aide le dit. Pendant l'essai, l'effort par défaut d'Opus 5.5 est passé de `xhigh` à `high`, puis il a été remis à `xhigh`.

## 2. Remote Control sur plusieurs terminaux (`feat/remote-control`)

**Demande** : « Permettre d'activer le remote-control sur plusieurs terminaux, à l'unité ou au travers de l'orchestrateur, pour gérer et avoir accès aux workflows à distance. »

**Comportement**

- Chaque session Claude (agent ou orchestrateur) a un téléphone dans son en-tête. Le menu propose « Activer Remote Control » ou « Couper Remote Control », puis « Copier le lien » et « Ouvrir dans le navigateur » quand le lien est connu. L'icône est orange quand c'est actif, clignote pendant la connexion, devient rouge en cas d'échec ; le panneau Agents montre aussi un téléphone à côté des agents suivis.
- Le choix est retenu dans le terminal : une session qui a Remote Control démarre avec `claude … --remote-control "<prénom>"` (à la fin de la ligne, le nom étant facultatif). dummyPlane lit alors le lien sur l'écran.
- Sur une session en cours, dummyPlane tape `/remote-control` et lit la réponse : « /remote-control is active » et le lien. Pour couper, il tape `/remote-control`, ce qui ouvre le menu de Claude (« Disconnect this session », « Show QR code », « Continue »), remonte jusqu'à « Disconnect this session » en vérifiant la ligne surlignée, puis valide. Il attend « Remote Control disconnected. ». Vérifié dans l'app avec Claude Code 2.1.304 : démarrage avec le drapeau, coupure, réactivation, nouvelle coupure.
- Le menu d'un groupe a « Activer / Couper Remote Control » pour ses agents. Le menu de l'orchestrateur a « Remote Control pour l'équipe » et « Couper Remote Control » (lui et ses agents reliés).
- L'orchestrateur a un outil `remote_control` (`actif`, `agents` : prénoms, « tous », « moi »). Il rend les liens, pour que l'utilisateur pilote l'équipe depuis son téléphone à travers l'orchestrateur.

**Décisions**

- dummyPlane ne suit que ce qu'il a fait lui-même : un `/remote-control` tapé à la main (ou envoyé par `@tous /remote-control`) n'allume pas le téléphone.
- Si l'écran ne dit pas que la session est connectée, « Couper » tape quand même `/remote-control` ; si cela l'allume, il le retape pour ouvrir le menu et la couper. Mieux vaut deux commandes qu'une session restée ouverte.
- Le premier usage de Remote Control sur un compte affiche un dialogue de consentement (« Enable Remote Control ») : dummyPlane ne l'accepte jamais à la place de l'utilisateur, il le reconnaît, ne tape rien dedans et dit à l'utilisateur d'y répondre.
- Relecture : dummyPlane ne tape jamais dans une session au travail ou qui attend une réponse (l'Entrée après la commande répondrait à sa place à un dialogue d'autorisation). La demande est retenue et appliquée dès que la session redevient inactive, avec le dernier souhait exprimé ; l'icône clignote en attendant. Pour l'orchestrateur qui se l'applique (« moi »), c'est donc à la fin de son tour.
- Relecture : une seule opération à la fois par session, et l'écran n'est lu que pour la session en cours (pas ce qu'un lancement précédent a laissé) ; un menu n'est reconnu qu'en bas de l'écran, une réponse que juste après le dernier `/remote-control` tapé ou dans la bannière d'un démarrage. Les mêmes mots affichés ailleurs (un fichier, un diff) ne comptent pas.

## 3. Routeur de modèles de l'orchestrateur (`feat/routeur-modeles`)

**Demande** : « Avoir une option Routeur dans l'orchestrateur, qui attribue pour chaque agent un modèle faible pour les tâches faibles Haiku 5.5, moyen Sonnet 5.5, élevé Opus, extrême Fable 5.1. »

**Comportement**

- Les réglages de la mission (sous le terminal de l'orchestrateur) ont une case « Routeur de modèles », à côté du budget global et du nombre d'agents.
- Chaque sous-tâche du plan peut porter un `niveau` (`faible`, `moyen`, `eleve`, `extreme`, accents et casse acceptés). Avec le routeur, le niveau devient obligatoire et choisit le modèle :

  | niveau | modèle | `--model` |
  |---|---|---|
  | faible | Haiku 5.5 | `claude-haiku-5-5` |
  | moyen | Sonnet 5.5 | `claude-sonnet-5-5` |
  | élevé | Opus 5.5 | `claude-opus-5-5` |
  | extrême | Fable 5.1 | `claude-fable-5-1` |

- Les nouveaux agents démarrent avec `claude --model '<id>' …`. Les agents reliés repartent déjà dans une nouvelle conversation dans leur worktree : ils y prennent leur modèle, puis retrouvent le modèle par défaut de Claude quand la mission se termine et qu'ils reviennent dans le dossier du projet. Un agent « nouveau » créé par `reattribuer` prend le modèle du niveau de la sous-tâche.
- Le plan affiche « faible · Haiku 5.5 » à côté de chaque sous-tâche (le niveau seul sans le routeur) ; l'équipe affiche le modèle de chaque agent. `mission()` rend `routeur`, et le `niveau` et le `modele` de chaque sous-tâche ; `equipe` rend le `modele` de chaque agent.
- Le prompt de l'orchestrateur explique les niveaux et lui demande de réserver `extreme` aux sous-tâches qui le valent.

**Décisions**

- Les identifiants complets plutôt que les alias (`haiku`, `sonnet`…) : c'est ce que Mathieu a demandé (« Sonnet 5.5 »), et un alias changerait de modèle tout seul à la prochaine version. Vérifié dans l'app : Claude Code 2.1.304 affiche « Haiku 5.5 », « Sonnet 5.5 », « Fable 5.1 » dans sa bannière.
- Sans le routeur, le niveau est gardé et affiché mais ne change rien.
- Un agent qui reprend une sous-tâche avec `reattribuer` garde le modèle avec lequel il a démarré : le changer voudrait dire le relancer et perdre sa conversation.
- Le modèle passe en argument de ligne de commande, entre guillemets, et seuls les caractères d'un nom de modèle sont acceptés (lettres, chiffres, `-._[]`).
- Relecture : « Lancer la mission » refuse un plan sans niveau quand le routeur a été coché après coup, et le dit à l'orchestrateur pour qu'il repropose le plan.
- Relecture : le modèle d'un agent s'affiche dans son en-tête (« Haiku 5.5 »), avec « Modèle par défaut au prochain démarrage » ; une copie d'agent (Ctrl+D) ne reprend ni son modèle ni son Remote Control.

## 4. Icônes Excalidraw intégrées (`feat/icones-excalidraw`)

**Demande** : « Pouvoir importer/embarquer nativement les icônes de system design, AWS, Azure et GCP d'Excalidraw dans l'application. »

**Comportement**

- La barre d'outils de gauche a un bouton « Icônes », sous « Image ». Il ouvre un panneau qui contient :
  - un champ de recherche ;
  - quatre onglets : Conception système, AWS, Azure, GCP ;
  - une grille de vignettes dessinées par Excalidraw dans le thème du canvas.
- Un clic pose une copie de l'icône au centre de la vue, sélectionnée, en une seule étape d'annulation. L'icône reçoit de nouveaux identifiants ; ses groupes, ses textes dans leurs formes et ses flèches liées sont conservés. Elle est regroupée pour se déplacer d'un bloc.
- La recherche parcourt les quatre catégories à la fois, sur le nom de l'icône et celui de sa bibliothèque, sans tenir compte des accents ni de la casse.
- Bibliothèques embarquées : `public/libraries`, 12 fichiers, environ 6 Mo minifiés. Elles viennent de https://github.com/excalidraw/excalidraw-libraries, sous licence MIT ; les crédits sont dans `public/libraries/CREDITS.md`.

  | catégorie | bibliothèques | icônes |
  |---|---|---|
  | Conception système | System Design Components, Software Architecture, System Design Icons | 34 |
  | AWS | AWS Architecture Icons (Anna Pastushko), AWS Serverless Icons v2 | 273 |
  | Azure | Azure cloud services icons, Azure General, Compute, Network, Storage | 97 |
  | GCP | GCP Icons (Clément Bosc), Google Icons (Marcus Guidoti) | 222 |

- `scripts/fetch-icon-libraries.mjs` retélécharge les fichiers listés dans `src/canvas/icons/catalog.json`. L'application ne va jamais les chercher sur Internet.

**Décisions**

- Un panneau d'dummyPlane plutôt que la bibliothèque d'Excalidraw : l'interface d'Excalidraw est masquée dans dummyPlane, et y verser 600 icônes encombrerait la bibliothèque personnelle de l'utilisateur.
- Les icônes sans nom dans leur bibliothèque prennent le texte qu'elles contiennent, sinon « <bibliothèque> <n> ».
- Une recherche affiche 120 icônes au plus. Les vignettes ne sont dessinées qu'à leur apparition dans la grille, une fois par thème.
- Les logos AWS, Azure et Google Cloud restent des marques de leurs propriétaires. Les crédits le rappellent, et ces logos servent à dessiner des architectures.
- Relecture : `CREDITS.md` contient le texte complet de la licence MIT (le script l'écrit). Après la pose, le clavier revient au canvas sur l'icône sélectionnée, et aucun terminal ne reste actif.

## 5. Revue des changements des agents (`feat/revue-diffs`)

**Demande** : « Pouvoir visualiser les diffs réalisés par les agents et faciliter le code review de la sortie des agents (un peu IDE embarqué avec visualisation de fichiers du workspace). »

**Comportement**

- Un panneau « Revue · <agent> » s'ouvre à droite du canvas. On y accède par :
  - le bouton de l'en-tête d'un terminal ;
  - une ligne du panneau Agents ;
  - « diff » dans l'équipe d'une mission ;
  - la palette (« Revue des changements »).

  Échap ou × le ferme.
- **Onglet Changements** : les fichiers changés dans le dossier de l'agent, chacun avec sa lettre (A, N pour un fichier non suivi, M, D, R), ses lignes `+n −m` et son diff unifié, numéroté des deux côtés et coloré.
- **Base de comparaison** : « Non commité » compare avec HEAD. « Depuis <base> » compare avec le commit où la branche a divergé de la base, committé ou non, fichiers non suivis compris. La base est la branche de la mission pour un agent de mission, sinon la branche par défaut du dépôt (`origin/HEAD`, sinon `main` ou `master`).
- **Onglet Fichiers** : les fichiers du dépôt (suivis ou non, pas ceux ignorés), filtrables, et leur contenu en lecture seule avec numéros de ligne.
- **Remarques** : un clic sur une ligne du diff ouvre un champ « Remarque ». Les remarques s'accumulent en bas du panneau, puis « Envoyer à <agent> » les tape en un seul message :

  ```
  Revue de code de tes changements :
  - src/a.ts:12 — …
  - src/a.ts (ligne 11 supprimée) — …
  Corrige ce qui doit l'être, puis dis-moi ce que tu as changé.
  ```

  Comme une consigne, rien n'est envoyé à un agent arrêté ou qui attend une réponse ; un toast le dit.

**Décisions**

- Un panneau plutôt qu'un nœud sur le canvas : la revue a besoin de place, et elle ne doit pas s'enregistrer dans l'espace de travail.
- Lecture seule : l'agent corrige, l'utilisateur relit. Un fichier ne peut pas être lu hors de la racine du dépôt (chemins absolus et `..` refusés, chemin canonique vérifié). Une base qui commence par `-` est refusée : elle serait lue comme une option de git.
- Un diff ou un fichier de plus de 1 Mo est coupé ; l'affichage s'arrête à 4 000 lignes. L'onglet Fichiers liste 400 fichiers au plus, le filtre trouve les autres.
- git est lancé avec `--no-optional-locks` (les agents commitent dans ces dépôts) et `core.quotePath=false` (accents dans les chemins).
- Relecture : le chemin d'un fichier non suivi est vérifié comme les autres (rien hors du dépôt) ; les fichiers non suivis et l'onglet Fichiers se lisent depuis la racine, même quand l'agent travaille dans un sous-dossier ; les fichiers et les diffs ne sont jamais lus au-delà de 1 Mo, et les lignes d'un fichier non suivi ne sont comptées que sous 1 Mo ; `--no-ext-diff` ignore un outil de diff externe (difftastic…) ; Échap ne ferme pas le panneau quand un menu ou un champ l'a déjà utilisée ; les remarques non envoyées attendent la réouverture de la revue du même agent.

## 6. L'usage dans la barre du haut (`feat/barre-usage`)

**Demande** : « Mettre dans la barre du haut les % d'usage (Current Session, Current week (all models), Current week (Fable)) ; quand tu cliques dessus, tu as le détail (Total cost, Total duration (API), Total duration (Wall), code changes, usage by model, prompt cache, warm, CO₂ consumption, etc.). »

**D'où viennent les chiffres**

- Claude Code donne à sa ligne d'état (`statusLine`) un JSON par session. Il contient :
  - les limites de l'abonnement (`rate_limits.five_hour`, `rate_limits.seven_day`), avec leur pourcentage et leur heure de remise à zéro ;
  - le coût et les durées API et réelle (`cost`) ;
  - les lignes ajoutées et retirées ;
  - les jetons (`context_window`) ;
  - le cache de prompt (`prompt_cache` : `warm`, `hit_ratio`, `expires_at`, `ttl`) ;
  - le modèle.

  Les limites n'y apparaissent qu'après la première réponse de l'API. Le tout a été vérifié dans l'app avec Claude Code 2.1.304, sur une vraie session Haiku.
- dummyPlane donne à ses sessions Claude, par leur `--settings`, une ligne d'état `bash '<hooks>/statusline.sh' '<url>' '<ta commande>'`. Le script envoie le JSON au serveur local d'dummyPlane (`POST /status/<nœud>?t=<jeton>`), puis lance ta propre ligne d'état avec le même JSON. Ta ligne claude-carbon s'affiche donc toujours dans les terminaux, et son suivi du CO₂ continue. Sa commande, son `padding` et son `refreshInterval` sont lus dans `~/.claude/settings.json` (ou `$CLAUDE_CONFIG_DIR`).

**Comportement**

- Barre du haut, à gauche des compteurs d'agents : « Session 29 % » et « Semaine 53 % », chacun avec une petite barre (orange dès 70 %, rouge dès 90 %). Avant la première réponse d'un agent, on y lit « Usage ».
- Au clic, le détail affiche :
  - **les limites** : chacune avec sa barre et son heure de remise à zéro (« repart à 03:50 », « repart à jeu. 23:00 ») ;
  - **les sessions d'dummyPlane depuis son ouverture** : coût total, durée API, durée réelle, lignes de code `+n −m`, et le CO₂ estimé ;
  - **le détail par modèle** : coût, jetons d'entrée et de sortie ;
  - **le cache de prompt de chaque session** : « chaud · 48 % · jusqu'à 01:27 », ou « froid ».
- Le CO₂ reprend la méthode de claude-carbon (MIT) : des facteurs en gCO₂e par million de jetons d'entrée et de sortie, par famille de modèle (Fable 156/3304, Opus 78/1652, Sonnet 39/826, Haiku 10/207 ; Jegham et al. 2025). C'est un ordre de grandeur, présenté comme une estimation.

**Décisions**

- **« Semaine (Fable) »** : Claude Code 2.1.304 ne la transmet pas aux lignes d'état, seul `/usage` l'affiche. Le détail l'indique comme « non transmise ». Toute limite `seven_day_<modèle>` que Claude Code enverrait un jour s'affichera d'elle-même, dans la barre comme dans le détail.
- **Pas de point d'accès non documenté** : Anthropic expose aussi l'usage à une adresse non documentée. Il faudrait y présenter le jeton OAuth de ton abonnement, lu dans `~/.claude/.credentials.json` ; dummyPlane ne s'en sert pas.
- **Mémoire de l'app** : les sessions sont gardées en mémoire, depuis l'ouverture d'dummyPlane, et rien n'est enregistré. Les limites viennent de la dernière ligne d'état reçue, toutes sessions confondues.
- **Sessions sans `--settings`** : une session Claude lancée hors d'dummyPlane, ou sans serveur local, ne compte pas.
- Relecture :
  - **limites** : chaque fenêtre (5 h, semaine, modèle) garde la lecture la plus récente, c'est-à-dire la remise à zéro la plus tardive puis l'usage le plus haut. La ligne d'état d'une ancienne session ne fait donc plus redescendre le compteur, et une fenêtre passée sa remise à zéro s'affiche à 0 % ;
  - **ligne d'état reprise** : c'est celle que Claude aurait montrée, dans cet ordre : `.claude/settings.local.json` du dossier, puis `.claude/settings.json`, puis les réglages de l'utilisateur (un fichier enregistré avec BOM est lu aussi) ;
  - **script** : si `statusline.sh` ne peut pas être écrit, la session démarre sans la ligne d'état, mais avec ses hooks et ses outils.
