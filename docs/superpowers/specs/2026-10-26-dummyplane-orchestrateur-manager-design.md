# dummyPlane — L'orchestrateur manager d'équipe (spec)

- **Date** : 2026-10-26
- **Statut** : décisions de fond validées en brainstorming par Mathieu (cas d'usage, cerveau, isolement, temps, équipe, sous-agents, frise, approche MCP, cycle d'une mission, serveur MCP). Mathieu a ensuite demandé d'aller jusqu'aux fonctions sans relecture visuelle : la présentation (§6) est fonctionnelle, son design sera repris avec lui. Les choix que Mathieu n'a pas tranchés sont marqués **(choix par défaut)**.
- **Étend** : `docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md` (« spec habillage » : orchestrateur §13, activité des agents §10, `pty_send_text` §15.3). Tout ce que cette spec ne modifie pas reste régi par elle et par les specs fenêtre, identité et menu radial.

## 1. Objectif

Faire de l'orchestrateur un **manager d'équipe**, presque un agent à part entière : on lui donne une tâche générale, il la découpe, la distribue à une équipe d'agents, suit leur avancement et gère le temps alloué à chacun ; chaque agent délègue ses propres sous-tâches à ses sous-agents. Aujourd'hui, l'orchestrateur ne fait que taper la même consigne dans les agents reliés (spec habillage §13).

### Critères de succès

1. Mathieu écrit dans l'orchestrateur « Ajoute l'authentification » avec un budget d'une heure : l'orchestrateur lit le dépôt et propose un plan (sous-tâches, agent, budget de chacune) qui attend son feu vert.
2. Au feu vert, l'équipe se forme sur le canvas : agents reliés et agents nouveaux, chacun dans son worktree, chacun reçoit sa sous-tâche.
3. Sous chaque agent, une frise montre ses étapes (Plan, Recherche, Implémentation, Vérification…) et leur état ; elle s'allume au fil de son travail.
4. Un agent qui dépasse son budget réveille l'orchestrateur, qui le relance, le prolonge ou réattribue sa sous-tâche.
5. À la fin, l'orchestrateur fusionne les branches dans la branche de la mission, fait passer les tests et rend compte ; Mathieu fusionne lui-même dans sa branche.

## 2. Périmètre

### Inclus

- Un serveur MCP local dans dummyPlane, donné à chaque session Claude qu'dummyPlane lance (§4).
- La frise des étapes sous chaque agent Claude, alimentée par l'agent lui-même et par les hooks de ses sous-agents (§5).
- L'orchestrateur IA : une session Claude dans le nœud orchestrateur, ses outils, la mission (plan, feu vert, équipe, worktrees, attribution, fin, fusion) (§3, §7).
- Le temps : budget global, budgets par sous-tâche, dépassements, interventions (§8).

### Hors périmètre

- Agents autres que Claude (Codex, Gemini… acceptent MCP : étape suivante). Sans outils dummyPlane, un agent n'a pas de frise et ne peut pas faire partie d'une mission.
- Sous-agents sur le canvas (des terminaux ouverts par un agent pour ses sous-tâches) : au BACKLOG.
- Fusion dans la branche de Mathieu : jamais faite par dummyPlane.
- Le design visuel final du nœud orchestrateur et de la frise (repris avec Mathieu).
- L'injection de messages autrement qu'en tapant dans le terminal (les « channels » de Claude Code sont en aperçu et trop restrictifs).

## 3. Décisions

| Sujet | Décision |
|---|---|
| Cas d'usage premier | Une fonctionnalité découpée entre plusieurs agents d'un même dépôt. |
| Cerveau de l'orchestrateur | Une session Claude Code lancée par dummyPlane dans le nœud, avec les outils dummyPlane (abonnement de Mathieu, pas de clé d'API). |
| Pont | Un serveur MCP dans dummyPlane, à côté du serveur de hooks (127.0.0.1, port au hasard, jeton par nœud). |
| Isolement | Un worktree git par agent, sur sa branche ; la branche de la mission reçoit les fusions. |
| Équipe | Les agents reliés à l'orchestrateur, plus des agents nouveaux si le plan en demande, jusqu'à un maximum. |
| Feu vert | Le plan attend la validation de Mathieu avant de lancer l'équipe. |
| Temps | Budget global facultatif, découpé en budgets par sous-tâche ; un dépassement réveille l'orchestrateur, qui décide. |
| Sous-agents | Les sous-agents natifs de chaque agent ; la frise sous l'agent montre ses étapes. |
| Frise | Étapes déclarées par l'agent ; couleur = état (fait, en cours, à venir, échec). |
| Fin | L'orchestrateur fusionne dans la branche de la mission ; Mathieu fusionne le reste. |

## 4. Le serveur MCP (le pont)

### 4.1 Transport

- Une route `/mcp` sur le serveur HTTP local des hooks (spec habillage §10.3), au format MCP « streamable HTTP » réduit à requête et réponse JSON (pas de flux SSE, pas de notifications du serveur). Méthodes : `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
- L'appelant s'identifie par l'en-tête `Authorization: Bearer <jeton du nœud>` : un jeton tiré au lancement de chaque session et propre au nœud. Sans jeton valable : 401 ; méthode inconnue : erreur JSON-RPC `-32601`.
- Rust ne porte que le transport et l'identité : `tools/list` et `tools/call` sont transmis à l'interface (évènement `mcp-call` avec le nœud appelant, réponse par la commande `mcp_reply`), qui connaît le canvas, les nœuds et les missions. Sans réponse en 30 s : erreur « dummyPlane ne répond pas ».
- Corps limité à 256 Kio.

### 4.2 Lancement d'une session Claude

Chaque session Claude lancée par dummyPlane reçoit, en plus de `--settings` (hooks) :

- `--mcp-config <appdata>/mcp/<nodeId>.json` : `{"mcpServers": {"dummyplane": {"type": "http", "url": "http://127.0.0.1:<port>/mcp", "headers": {"Authorization": "Bearer <jeton>"}}}}` ;
- `--append-system-prompt-file <appdata>/mcp/<nodeId>.md` : sa consigne de rôle (agent ou orchestrateur, §4.4, §7.2) ;
- dans son fichier de réglages : `permissions.allow` = `mcp__dummyplane` (les outils dummyPlane sans demande d'autorisation) ; pour un orchestrateur, `permissions.deny` = `Edit`, `Write`, `NotebookEdit` (un manager ne code pas lui-même) ;
- les hooks `SubagentStart` et `SubagentStop` en plus de ceux d'aujourd'hui (§5.2).

Les fichiers sont réécrits à chaque lancement et effacés à la fin du processus, comme ceux des hooks.

### 4.3 Portée

Un nœud n'agit que sur son périmètre : un agent sur lui-même ; un orchestrateur sur les agents de sa mission. Un outil d'orchestrateur appelé par un agent répond « outil réservé à l'orchestrateur ».

### 4.4 Outils d'un agent (toute session Claude)

| Outil | Effet |
|---|---|
| `declarer_etapes(etapes: string[])` | Ses étapes, dans l'ordre (1 à 12, 40 caractères chacune) ; remplace les précédentes. |
| `etape(titre, etat)` | `etat` : `en_cours`, `fait`, `echec`. Une étape inconnue est ajoutée à la fin. |
| `rendre_compte(resume, statut)` | `statut` : `termine`, `bloque`, `echec`. Hors mission : « pas d'orchestrateur » ; en mission : transmis à l'orchestrateur (§7.5). |

Consigne de rôle d'un agent : il travaille dans dummyPlane ; quand sa tâche demande plusieurs étapes (ou les phases d'un workflow), il les déclare avant de commencer et marque chacune ; il délègue ses sous-tâches à ses sous-agents ; en mission, il travaille sur sa branche, commit son travail et rend compte à la fin.

Pendant qu'un workflow ou des sous-agents travaillent, la session attend et ne peut rien marquer (constaté par Mathieu après H1 : la frise ne s'allumait qu'à la fin). La consigne lui demande donc de donner à chaque agent délégué le titre exact de son étape et de la lui faire marquer lui-même (`mcp__dummyplane__etape`) ; des agents en parallèle ont chacun leur étape. Les agents d'un workflow ont les outils dummyPlane et le même jeton : leurs marques arrivent sous le terminal de la session.

## 5. La frise des étapes

### 5.1 Ce qu'elle montre

- Sous chaque terminal Claude qui a déclaré des étapes : une ligne de la largeur du terminal, un point par étape à intervalles réguliers, son titre dessous (tronqué ; pas de survol, la frise ne prend pas la souris — décision H1).
- Couleur = état : fait (vert `--ov-ok`), en cours (couleur « au travail » de l'identité, `--ov-working`, pulse), à venir (gris), échec (rouge). Sans étape déclarée : rien. (Le bleu du croquis de Mathieu n'existe pas dans la palette de l'identité : à revoir avec le design.)
- Pendant une mission, la barre du budget de l'agent se place au-dessus de la frise (§8.3).

### 5.2 Les sous-agents

- Les hooks `SubagentStart` / `SubagentStop` de la session tiennent le compte des sous-agents en cours ; la frise l'affiche à côté de l'étape en cours (« ×3 »).
- Les phases d'un workflow ne sont pas visibles par les hooks (non documenté) : seule la déclaration de l'agent les montre, et ce sont les agents du workflow qui marquent leur étape (§4.4).

### 5.3 Données

- Les étapes vivent dans l'interface (magasin par nœud) et sont enregistrées dans le payload du terminal (`steps`) pour survivre à un redémarrage ; le compte des sous-agents vient de Rust (évènement `agent-subagents`) et ne s'enregistre pas.

## 6. Présentation (fonctionnelle, à reprendre avec Mathieu)

- La frise : un calque sous les nœuds, comme les fonds de groupe, placé sous chaque terminal, sans capter la souris.
- Le nœud orchestrateur **(choix par défaut)** : en-tête (nom, état de la mission, temps passé / budget global), puis le terminal de sa session Claude (on lui parle comme à tout terminal), puis le panneau de la mission : réglages (budget global, maximum d'agents), le plan proposé avec « Lancer la mission » tant qu'il attend le feu vert, puis l'équipe (agent, sous-tâche, budget, état, compte rendu), puis le bilan avec « Nettoyer la mission ». Taille par défaut 640 × 760.
- « Écrire » et « Coller » vers un orchestrateur (barre de commande, menu radial) passent par son terminal, comme pour un agent.
- Un orchestrateur existant (payload `{ name }`) devient un orchestrateur IA : sa session démarre à son affichage comme un agent. La diffusion sans IA reste dans la barre de commande (spec habillage §12).

## 7. La mission

### 7.1 Démarrage

- Mathieu écrit sa tâche dans le terminal de l'orchestrateur. Le budget global (facultatif) et le nombre maximal d'agents (défaut 4) se règlent dans le panneau de la mission **(choix par défaut)** et sont donnés à l'orchestrateur avec `mission()`.
- L'orchestrateur lit le dépôt (sa session tourne dans le dossier du projet, sans pouvoir y écrire) et appelle `proposer_plan`.

### 7.2 Outils de l'orchestrateur

| Outil | Effet |
|---|---|
| `mission()` | La mission : tâche, budget global et reste, maximum d'agents, état, branche ; les agents reliés disponibles. |
| `proposer_plan(sous_taches[])` | Chaque sous-tâche : `titre`, `consigne`, `agent` (prénom d'un agent relié, ou `nouveau`), `budget_min`. Remplace le plan en attente ; refusé si la somme dépasse le budget global ou le nombre d'agents le maximum. Le plan s'affiche et attend le feu vert. |
| `equipe()` | Chaque agent : prénom, sous-tâche, état (travaille, attend, inactif, arrêté), étapes, temps passé / budget, compte rendu éventuel. |
| `lire_sortie(agent, lignes)` | La fin de son terminal en texte simple (sans séquences ANSI), 200 lignes au plus. |
| `ecrire(agent, texte)` | Tape le texte dans son terminal (relance, précision). Refusé si l'agent attend une réponse (le dialogue est pour Mathieu). |
| `prolonger(agent, minutes)` | (H3) Ajoute des minutes, prises sur le reste du budget global. |
| `interrompre(agent)` | (H3) Arrête son tour (Échap), comme « Pause ». |
| `reattribuer(sous_tache, agent)` | (H3) Donne la sous-tâche à un autre agent de la mission (ou `nouveau`) : il la reçoit avec le compte rendu et la branche du précédent. |
| `fusionner()` | Fusionne les branches des agents qui ont rendu compte dans la branche de la mission (§7.6) ; dit ce qui est fusionné et les conflits. |
| `terminer(bilan)` | Clôt la mission : bilan affiché dans le panneau, équipe libérée (§7.7). |

Consigne de rôle de l'orchestrateur : il est le manager ; il ne code pas ; il découpe en sous-tâches indépendantes autant que possible, chacune avec un résultat vérifiable ; il propose son plan et attend le feu vert ; il suit son équipe par les évènements, intervient sur les dépassements, ne répond jamais aux dialogues d'autorisation des agents (il les signale à Mathieu) ; il fusionne, fait vérifier (tests) par un agent, puis termine avec un bilan.

### 7.3 Feu vert et équipe

- « Lancer la mission » (panneau) : dummyPlane — pas l'IA — forme l'équipe : crée la branche de la mission, puis pour chaque sous-tâche son worktree et sa branche, lance l'agent dedans et lui tape sa sous-tâche quand il est prêt.
- Agent relié : son processus est arrêté et relancé dans son worktree, en nouvelle session (une session Claude ne se reprend pas depuis un autre dossier). Agent nouveau : un Claude créé à côté de l'orchestrateur, avec un prénom, dans un groupe « Mission <nom> » relié à l'orchestrateur.
- Un agent est « prêt » quand son processus tourne et qu'il est inactif depuis 2 s ; au bout de 60 s, la sous-tâche est tapée quand même. (Relecture H2, vérifié dans l'application : « inactif » se lit à l'écran de la nouvelle session — sa boîte de saisie `❯` sous un trait, sans invite de confiance — après la relance ; un agent relié est jugé seulement une fois relancé.)
- Les évènements d'un orchestrateur qui démarre ou reprend attendent sa boîte de saisie ; une ligne qui n'a pas pu être tapée est gardée pour son prochain démarrage.
- Un lancement qui échoue retire les worktrees et branches qu'il a créés (jamais de force) ; les agents reliés ne bougent qu'une fois toute l'équipe formée. L'espace de l'orchestrateur doit être affiché pendant le lancement.
- Dans un worktree qu'dummyPlane vient de créer, Claude demande s'il peut faire confiance au dossier : dummyPlane accepte cette invite (texte de l'écran contenant « trust » et « folder » : flèche bas puis Entrée), et seulement dans ces worktrees.
- La sous-tâche tapée : « [dummyPlane · mission <nom>] <titre> — <consigne> Budget : <n> min. Branche : <branche>. Déclare tes étapes, délègue à tes sous-agents, commit sur ta branche, puis rends compte avec rendre_compte. »

### 7.4 Worktrees et branches (choix par défaut)

- Branche de la mission : `dummyplane/<mission>` (nom de la mission en minuscules, tirets), créée depuis la branche courante du dossier du projet.
- Branche d'un agent : `dummyplane/<mission>-<prénom>`, créée depuis la branche de la mission.
- Dossier d'un worktree : `<parent du projet>/<nom du dossier>.worktrees/<mission>-<prénom>` ; celui de la mission : `…/<mission>` (où se font les fusions). Hors du dépôt : rien n'apparaît dans `git status` du projet.
- Les dépendances (node_modules…) ne sont pas copiées : la consigne de l'agent le lui dit.

### 7.5 Évènements vers l'orchestrateur

dummyPlane tape dans le terminal de l'orchestrateur une ligne préfixée `[dummyPlane]` (Claude la met en file s'il travaille) :

- feu vert donné (avec l'équipe formée) ;
- un agent a rendu compte (prénom, statut, résumé) ;
- un agent attend une réponse de Mathieu (un dialogue est ouvert) ;
- un budget est écoulé (§8.2) ; le budget global est écoulé ;
- un agent s'est arrêté (processus terminé).

Si l'orchestrateur attend lui-même une réponse de Mathieu, les évènements attendent et partent dans l'ordre dès qu'il est libre.

### 7.6 Fusion

- Dans le worktree de la mission, chaque branche d'agent qui a rendu compte « termine » est fusionnée (`git merge --no-ff`) dans la branche de la mission.
- Un conflit : la fusion est annulée (`git merge --abort`), les fichiers en conflit sont rendus à l'orchestrateur, qui peut demander à l'agent de fusionner la branche de la mission dans la sienne et de résoudre, puis rappeler `fusionner()`.
- Jamais de fusion dans la branche de Mathieu ; jamais de `push`.

### 7.7 Fin

- `terminer(bilan)` : la mission passe « terminée », le bilan reste lisible dans le panneau ; les agents nouveaux sont fermés ; les agents reliés sont relancés dans le dossier du projet.
- Les worktrees restent jusqu'à « Nettoyer la mission » (panneau), qui retire ceux dont la branche est fusionnée dans celle de la mission ; les branches restent.

## 8. Le temps

### 8.1 Budgets

- Budget global facultatif (minutes) ; le plan donne un budget à chaque sous-tâche (somme ≤ budget global).
- Le temps d'une sous-tâche court depuis l'envoi de sa consigne jusqu'à son compte rendu (temps réel, pas seulement l'activité).

### 8.2 Dépassement

- À 100 % du budget d'une sous-tâche : évènement « budget écoulé » à l'orchestrateur, une fois. Il décide : `ecrire` (relance), `prolonger`, `interrompre`, `reattribuer`.
- À 200 % sans compte rendu : dummyPlane prévient Mathieu (toast, barre rouge) ; il n'arrête jamais un agent de lui-même.
- Budget global écoulé : évènement à l'orchestrateur (« termine avec ce qui est fait ») et toast à Mathieu.

### 8.3 Affichage

- Au-dessus de la frise de chaque agent de la mission : une barre temps passé / budget (vert, orange au-delà de 80 %, rouge au-delà de 100 %).
- Dans l'en-tête de l'orchestrateur : temps passé / budget global.

## 9. Gestion des erreurs

- Serveur MCP indisponible (serveur de hooks non démarré) : les sessions Claude démarrent sans outils dummyPlane ; toast au démarrage comme aujourd'hui ; l'orchestrateur affiche « Outils dummyPlane indisponibles ».
- Outil appelé avec des arguments invalides : erreur MCP lisible (`isError`, texte en français) ; rien n'est modifié.
- Création d'un worktree impossible (branche existante, dossier occupé, pas un dépôt git) : la mission ne démarre pas, l'erreur s'affiche dans le panneau et part à l'orchestrateur.
- Un agent de la mission fermé par Mathieu : évènement « arrêté » ; sa sous-tâche reste à réattribuer.
- Redémarrage d'dummyPlane pendant une mission : la mission (payload de l'orchestrateur) et les étapes (payload des terminaux) sont rechargées ; les agents sont « arrêtés » comme tout agent au démarrage ; l'orchestrateur reçoit au redémarrage de sa session l'état de la mission par `mission()`.

## 10. Jalons

- **H1 — le pont** : serveur MCP, lancement des sessions Claude avec leurs outils, outils d'agent, hooks des sous-agents, frise. Utile seul : tout agent Claude montre ses étapes.
- **H2 — la mission** : orchestrateur IA, plan et feu vert, worktrees et branches, équipe, attribution, évènements, comptes rendus, fusion, fin. Outils : `mission`, `proposer_plan`, `equipe`, `lire_sortie`, `ecrire`, `fusionner`, `terminer`. Les budgets du plan sont enregistrés et affichés, sans minuterie.
- **H3 — le temps** : minuterie des budgets, dépassements (100 %, 200 %, budget global), `prolonger`, `interrompre`, `reattribuer`, barres de budget et temps dans l'en-tête.

Chaque jalon a son plan et sa build de test (`dummyPlane-H1.exe`…).

## 11. Tests

### Automatisés

- Rust : transport MCP (jeton, méthodes, transmission et délai), fichiers de lancement (config MCP, consigne, réglages), commandes git des worktrees et de la fusion (dépôt temporaire), sortie en texte simple.
- Interface : routeur des outils (portée, validation, effets), magasin des étapes, frise (positions, couleurs), mission (plan, feu vert, équipe, évènements, budgets, dépassements) avec horloge simulée.

### Dans l'application réelle (profil de sonde)

- Un client MCP scripté (Node) appelle chaque outil avec le jeton d'un nœud et vérifie ses effets.
- Une session Claude réelle, courte (consomme l'abonnement de Mathieu, à garder minimale) : elle déclare ses étapes, la frise s'allume.

### Vérifications de Mathieu

- Les critères de §1.
