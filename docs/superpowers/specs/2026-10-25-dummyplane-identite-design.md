# dummyPlane — Identité propre : thèmes, verre et canvas libre (spec)

- **Date** : 2026-10-25
- **Statut** : validée en brainstorming par Mathieu (maquette v3), en attente de relecture écrite
- **Remplace** dans `docs/superpowers/specs/2026-10-24-dummyplane-habillage-et-flotte-design.md` (« spec habillage ») : §4 (identité visuelle), §5 (coquille), §7.1 à §7.3 (aspect du nœud terminal), §9 (prénoms) et les couleurs de §8 et §11. Le comportement décrit par ces sections (projets, états, groupes, commande, orchestrateur, pause) reste valable ; seul leur aspect et leur emplacement changent.
- **Amende** `docs/superpowers/specs/2026-10-25-dummyplane-fenetre-et-clavier-design.md` (« spec fenêtre ») : voir §7.
- **Référence visuelle** : `.superpowers/brainstorm/maquette-dummyplane-v3.html` (maquette interactive, thèmes clair et sombre).

## 1. Objectif

dummyPlane est une alternative open source et légale à Symvibe : mêmes usages (piloter une flotte d'agents CLI sur un canvas infini), mais une identité et des fonctionnalités propres, sans copier Symvibe et sans s'écarter des standards des outils de canvas. La spec habillage visait l'inverse (« posée à côté des captures de Symvibe, l'application s'y confond ») ; elle est remplacée sur ce point.

### Critère de succès

1. Posée à côté de Symvibe, dummyPlane ne s'y confond pas : autre palette, autre logo, autres polices, barre de titre à onglets et recherche, verre dépoli, aucune orbe ni puce à bordure dégradée.
2. Elle reste immédiatement familière à qui connaît Miro, FigJam ou tldraw : canvas libre, rail d'outils à gauche, panneaux flottants.
3. Elle suit le thème clair ou sombre de Windows, et reste lisible dans les deux.

## 2. Périmètre

### Inclus

- Identité : nom conservé, logo, deux thèmes (Ivoire clair, Argile sombre), verre dépoli, polices, formes.
- Structure de la fenêtre : barre de titre, onglets de workspace, canvas plein cadre, rails flottants, panneau Agents, barre de consigne, puce git, zoom, accueil.
- Aspect des nœuds : terminal, orchestrateur, groupes, liaisons ; thème d'Excalidraw.
- Prénoms des agents (pionniers de l'informatique), couleurs des agents et des rôles.

### Hors périmètre

- Nouvelles fonctionnalités propres à dummyPlane autres que celles déjà spécifiées (clavier et palettes : spec fenêtre, jalons J7 et J8) ; elles viendront du `BACKLOG.md`.
- Personnalisation des couleurs par l'utilisateur, thèmes supplémentaires.
- Renommage de l'application (« dummyPlane » est conservé) et changement d'identifiant (`dev.dummyplane.app`).

## 3. Décisions

| Sujet | Décision |
|---|---|
| Nom | « dummyPlane » conservé (« vibe coding » est un terme générique). |
| Palette | Inspirée des couleurs d'Anthropic (ivoire, ardoise, terre cuite), sans aucune marque ni police d'Anthropic. |
| Thèmes | Ivoire (clair) et Argile (sombre) ; choix Système (défaut), Clair ou Sombre. |
| Matière | Verre dépoli pour tout ce qui flotte ; terminaux à corps opaque. |
| Structure | Canvas libre plein cadre façon Miro ; en haut une barre de titre à recherche puis les onglets de workspace ; rails flottants à gauche (canvas) et à droite (activités) ; panneau Agents flottant ; barre de consigne flottante en bas. |
| Logo | Une onde terre cuite sur une tuile ardoise. |
| Polices | Inter (interface) et JetBrains Mono (états, raccourcis, chiffres) embarquées ; Cascadia Code pour les terminaux (inchangé). |
| Prénoms | Pionniers de l'informatique, un domaine par groupe ; les agents existants gardent leur prénom. |
| Terminaux | Toujours sombres, dans les deux thèmes (les agents sont réglés pour un fond sombre). |

## 4. Identité

### 4.1 Logo

- Tuile carrée à coins arrondis (rayon 14/64) `#1A1918`, traversée d'une onde terre cuite `#D97757` : chemin `M10 36 C 18 14, 26 14, 32 32 S 46 50, 54 26` dans un repère 64 × 64, trait de 7, extrémités rondes.
- Source : `src-tauri/icons/source/wave.svg` ; elle remplace `orb.svg` et régénère toutes les icônes (`pnpm tauri icon`), comme au jalon J6.
- Dans l'application : 18 px dans la barre de titre, à gauche ; sur l'accueil, à côté de « dummyPlane ». L'orbe (`.ov-orb`) disparaît partout.

### 4.2 Couleurs et verre

Jetons CSS sur l'élément racine, redéfinis par thème (`data-theme="light" | "dark"`) ; les variables de shadcn sont redéfinies à partir d'eux.

| Jeton | Argile (sombre) | Ivoire (clair) | Usage |
|---|---|---|---|
| `--ov-canvas` | `#232220` | `#F7F5EF` | fond du canvas et de l'accueil |
| `--ov-dot` | `rgba(255,255,255,.07)` | `rgba(41,38,27,.10)` | points de la grille (pas 20 px) |
| `--ov-surface` | `#2B2A27` | `#FFFFFF` | surface opaque (repli sans transparence) |
| `--ov-field` | `rgba(255,255,255,.05)` | `rgba(255,255,255,.60)` | champs, recherche |
| `--ov-line` | `rgba(255,255,255,.09)` | `rgba(41,38,27,.10)` | filets intérieurs |
| `--ov-hover` | `rgba(255,255,255,.07)` | `rgba(41,38,27,.06)` | survol |
| `--ov-text` | `#F5F4EF` | `#29261B` | texte principal |
| `--ov-text-2` | `#B3B0A8` | `#625F57` | texte secondaire |
| `--ov-text-3` | `#86837C` | `#8F8C83` | texte tertiaire, invites |
| `--ov-accent` | `#D97757` | `#C2603F` | sélection, focus, bouton principal, « en cours » |
| `--ov-accent-soft` | `rgba(217,119,87,.18)` | `rgba(194,96,63,.13)` | fond des éléments actifs |
| `--ov-on-accent` | `#1F1E1D` | `#FFFFFF` | texte sur l'accent |
| `--ov-wait` | `#D4A27F` | `#B07D3A` | « attend ta réponse » |
| `--ov-ok` | `#8FA876` | `#5E7A43` | actif, terminé avec succès |
| `--ov-danger` | `#E5534B` | `#C93C37` | supprimer, erreur |
| `--ov-terminal` | `#1A1918` | `#1A1918` | corps des terminaux (fond xterm) |
| `--ov-glass` | `rgba(40,39,36,.52)` | `rgba(255,255,255,.50)` | verre léger : rails, puces, barre de consigne |
| `--ov-glass-strong` | `rgba(42,41,38,.84)` | `rgba(252,251,248,.88)` | verre dense : barre de titre, onglets, panneaux, menus, palettes, dialogues, toasts |
| `--ov-glass-line` | `rgba(255,255,255,.10)` | `rgba(255,255,255,.80)` | liseré du verre |
| `--ov-glass-hi` | `inset 0 1px 0 rgba(255,255,255,.07)` | `inset 0 1px 0 rgba(255,255,255,.90)` | reflet du bord haut |
| `--ov-glass-edge` | `0 0 0 1px rgba(0,0,0,.28)` | `0 0 0 1px rgba(41,38,27,.08)` | contour extérieur |
| `--ov-tray` | `rgba(255,255,255,.028)` | `rgba(255,255,255,.38)` | fond des plateaux de groupe |
| `--ov-head` | `rgba(32,31,29,.70)` | `rgba(255,255,255,.66)` | en-tête des terminaux |
| `--ov-tab-on` | `rgba(255,255,255,.08)` | `rgba(255,255,255,.88)` | onglet actif |
| `--ov-glow-1` / `-2` / `-3` | `rgba(217,119,87,.16)` / `rgba(143,168,118,.12)` / `rgba(106,155,204,.08)` | `rgba(217,119,87,.16)` / `rgba(106,155,204,.14)` / `rgba(143,168,118,.12)` | halos du fond |
| `--ov-shadow` | `0 12px 40px rgba(0,0,0,.45)` | `0 12px 40px rgba(41,38,27,.16)` | menus, palettes, dialogues |
| `--ov-float-shadow` | `0 8px 28px rgba(0,0,0,.32)` | `0 8px 28px rgba(41,38,27,.10)` | éléments flottants, nœuds |
| `--ov-draw` | `#E8E5DD` | `#29261B` | couleur de trait par défaut des dessins |

- **Verre** : fond `--ov-glass` ou `--ov-glass-strong`, `backdrop-filter: blur(18px) saturate(150%)`, bordure 1 px `--ov-glass-line`, ombre `--ov-glass-hi, --ov-glass-edge, --ov-float-shadow`. Les surfaces chargées de texte (barre de titre, onglets, panneau Agents, orchestrateur, menus, palettes, dialogues, toasts) prennent toujours le verre dense : sur un terminal sombre, le verre léger rendrait le thème clair illisible.
- **Fond du canvas et de l'accueil** : `--ov-canvas`, la grille de points, et trois halos très doux (dégradés radiaux `--ov-glow-1` en haut à gauche, `-2` en bas à droite, `-3` en haut au centre) qui donnent au verre quelque chose à flouter. Les halos sont fixes à l'écran (ils ne suivent pas le défilement du canvas).
- **Sans transparence** : quand Windows coupe les effets de transparence (`prefers-reduced-transparency: reduce`) ou que le réglage « Effets de transparence » d'dummyPlane est sur Désactivés, chaque verre devient la surface opaque `--ov-surface` (ou `--ov-head` rendu opaque pour les en-têtes) et le flou est supprimé.
- **États** : en cours `--ov-accent`, attend `--ov-wait`, prêt `--ov-text-3`, arrêté `--ov-text-3` à 50 %, terminé `--ov-ok` (code 0) ou `--ov-danger`, erreur `--ov-danger`, actifs `--ov-ok`.

### 4.3 Typographie

- **Interface** : Inter (`@fontsource-variable/inter`), 13 px par défaut ; 12,5 px dans les listes ; titres 15 à 20 px semi-gras (600).
- **Mono** : JetBrains Mono (`@fontsource-variable/jetbrains-mono`), 10,5 à 11,5 px : états, durées, raccourcis, compteurs, branche, zoom, chemins.
- **Terminaux** : Cascadia Code, inchangée (réglages de netteté du plan A conservés).
- Les deux paquets sont ajoutés à version exacte et remplacent `@fontsource-variable/geist` et `@fontsource-variable/geist-mono`.

### 4.4 Formes

| Élément | Rayon |
|---|---|
| Nœud terminal | 12 px |
| Orchestrateur, rails, panneau Agents, puce git, zoom, toasts, palettes, cartes de projet | 14 px |
| Barre de consigne, dialogues | 16 px |
| Plateau de groupe | 18 px |
| Menus | 12 px |
| Boutons d'outil, boutons texte | 9 à 10 px |
| Onglets | 6 px en haut |

Aucune forme en pilule (sauf les badges de compteur), aucun dégradé décoratif, aucune orbe.

### 4.5 Thème

- Réglage `ui.theme` (table `settings`) : `system` (défaut), `light` ou `dark`. En `system`, l'application suit le mode clair ou sombre des applications Windows en direct (`prefers-color-scheme`, et l'événement de changement de thème de la fenêtre).
- Réglage `ui.transparency` : `on` (défaut) ou `off` (§4.2, sans transparence).
- Le thème s'applique à toute l'interface, aux toasts, à Excalidraw (`theme` du composant) et à la fenêtre (thème Tauri, pour les éléments natifs). Les terminaux restent sombres.
- Le choix se fait dans le menu Réglages (§5.5) et, avec J8, dans Ctrl+Maj+P.

## 5. Structure

### 5.1 Barre de titre (38 px, verre dense)

- **Gauche** : logo, puis le projet `mk-webapp ⌄` (menu : projets récents avec leur chemin, « Tous les projets… », « Fermer le projet »).
- **Centre** : le champ de recherche « ⌕ Rechercher dans <projet>   Ctrl+P » (440 px), qui ouvre la palette « Aller à ». Il apparaît avec le jalon J8 ; d'ici là, le centre reste vide.
- **Droite** : compteurs en mono, chacun cliquable (ouvre le panneau Agents filtré) : `● N` en cours (accent, masqué à 0), `● N` attend (ambre, masqué à 0), `● N actifs` (vert). Puis les boutons de fenêtre façon Windows, 46 × 38 px, collés au coin : Réduire, Agrandir / Restaurer, « Fermer dummyPlane » (survol rouge `#C42B1C`, icône blanche).
- L'espace vide de la barre déplace la fenêtre ; double-clic : agrandir / restaurer (même mécanique Tauri qu'au jalon J6). Elle remplace la bande de déplacement et les boutons en pastille de J6.

### 5.2 Onglets de workspace (34 px, verre dense)

- Sous la barre de titre, façon navigateur : onglets à coins arrondis en haut ; l'actif sur `--ov-tab-on`, bordé de `--ov-glass-line`, avec un filet d'accent de 2 px en haut ; badge du nombre d'agents vivants (accent sur l'onglet actif) ; × au survol (suppression avec la confirmation existante) ; `+` à la fin.
- Double-clic pour renommer et menu contextuel : inchangés (spec habillage §5.2).
- L'espace vide à droite des onglets déplace aussi la fenêtre.

### 5.3 Canvas

- Plein cadre : il s'étend sous la barre de titre et les onglets, que l'on voit floutés au-dessus. La première vue d'un nouveau workspace place son contenu sous les barres.
- Tout le reste flotte dessus, à 12 à 14 px des bords.

### 5.4 Rail gauche : le canvas

Verre léger, centré verticalement, boutons de 36 × 34 px, outil actif sur `--ov-accent-soft` en accent :

| Bouton | Action |
|---|---|
| Sélection | outil `selection` (V) |
| Main | outil `hand` (H) |
| Formes ⌄ | menu Rectangle (R), Ellipse (O), Losange (D), Ligne (L), Flèche (A), Cadre (F) ; garde la dernière forme |
| Texte | outil `text` (T) |
| Stylo ⌄ | outil `freedraw` (P) ; menu couleurs (dont `--ov-draw`) et épaisseurs |
| Gomme | outil `eraser` (E) |
| Image | outil `image` |
| ＋ (accent) | menu « Lancer un agent » : le catalogue (spec habillage §10.1, agents non détectés grisés), puis Nouvelle console, Lancer 4 agents, Orchestrateur |
| Ajuster | `scrollToContent` sur toute la scène |

Les menus s'ouvrent à droite du rail, en verre dense.

### 5.5 Rail droit : les activités

| Bouton | Action |
|---|---|
| Agents | ouvre ou ferme le panneau Agents (§5.6) ; pastille ambre du nombre d'agents qui attendent |
| Fonctions | ouvre Ctrl+Maj+P ; apparaît avec J8 |
| Réglages | menu : Thème (Système, Clair (Ivoire), Sombre (Argile)), Effets de transparence (Activés / Désactivés), Exporter la scène…, Importer une scène…, Exporter en PNG…, À propos d'dummyPlane |

Les menus s'ouvrent à gauche du rail.

### 5.6 Panneau Agents (flottant, verre dense)

- À gauche du rail droit, sous les onglets, 318 px de large, hauteur au plus jusqu'à la barre de consigne, défilable. Ouvert ou fermé selon le dernier choix (réglage `ui.agentsPanel`).
- **En-tête** « AGENTS » et ses actions : Lancer un agent (menu du ＋), Nouvelle console, Composer un groupe (ouvre « Composer un groupe », spec habillage §11.2, ancré au bouton), Tout mettre en pause, Tout reprendre, ⋯ (Lancer 4 agents, Tout replier, Tout déplier), ✕.
- **Filtres** sur une ligne : Tous, En cours, Attend, Prêts, Arrêtés, avec leurs compteurs.
- **Arbre** : par groupe (chevron repliable, carré de la couleur du rôle, NOM, compteurs ; au survol ⋯ = menu du groupe), puis « Hors groupe », puis « Orchestrateurs ». Lignes d'agent : carré de la teinte de l'agent, prénom, agent, état et durée en mono ; au survol Centrer, Mettre en pause ou Reprendre, Fermer. Clic : comportement de la spec habillage §5.5.
- Il remplace le panneau Flotte et le rail droit actuels.

### 5.7 Panneau de propriétés

Pour un dessin sélectionné (spec habillage §5.4, contenu inchangé) : flottant en verre dense, à droite du rail gauche, aligné sur son haut.

### 5.8 Bas de l'écran

- **Gauche** : puce git flottante (verre léger, 32 px) : icône de branche, nom de la branche, nombre de fichiers modifiés en accent (masqué à 0). Info-bulle : chemin du dépôt. Masquée hors dépôt.
- **Centre** : la barre de consigne flottante (verre léger, 680 px, 46 px de haut, rayon 16) : invite `›` en accent, cibles en badges, champ « Consigne aux agents · @ pour cibler · ↑ historique », bouton « Envoyer » (accent, rayon 10 ; grisé sans cible). L'indice ponctuel (spec habillage §12) s'affiche juste au-dessus. Le comportement de la spec habillage §12 est inchangé.
- **Droite** : zoom flottant `− 100 % +` (clic sur le pourcentage : 100 %).
- **Toasts** : en bas à droite, au-dessus du zoom, en verre dense ; l'offre « Reprendre toutes les conversations ? » s'y affiche aussi.

### 5.9 Accueil

- Même barre de titre (logo, « dummyPlane », recherche « Rechercher un projet » avec J8, boutons de fenêtre).
- Sur le fond aux halos, sans grille : « Projets » et « Ajouter un projet » (bouton accent), puis les cartes de projet en verre (contenu et menu de la spec habillage §5.1).

### 5.10 Menus, dialogues, palettes

Menus Radix, dialogues (fermer un agent, fermer un groupe, options d'un terminal), palettes de J8 : verre dense, rayons de §4.4, ombre `--ov-shadow`. Voile des dialogues : `rgba(0,0,0,.25)` et flou de 3 px.

### 5.11 Ce qui disparaît

Les pastilles flottantes du haut et la bande de déplacement de J6 ; le rail gauche et le rail droit en pilule ; le panneau Flotte ; les puces du bas (leurs actions vont au ＋ du rail gauche et au panneau Agents) ; l'ancienne barre de commande et son orbe ; l'orbe de l'accueil ; les classes `ov-chip` et `ov-orb`.

## 6. Nœuds et canvas

### 6.1 Terminal

- Rayon 12, bordure 1 px `--ov-glass-line`, ombre `--ov-float-shadow`, fond transparent hors du corps.
- **En-tête** (28 px, `--ov-head` flouté) : carré de 8 px de la teinte de l'agent, prénom (600), nom de l'agent en `--ov-text-2`, et à droite l'état en mono « ● en cours · 12 min » à la couleur de l'état. Au survol : Relancer ▾, Dupliquer, Fermer. On le saisit pour déplacer le terminal (inchangé).
- **Corps** : `--ov-terminal` opaque ; xterm sur ce fond.
- **Bordure selon l'état** : terminal qui a le clavier ou sélectionné → `--ov-accent` ; qui attend → `--ov-wait` (remplace la lueur ambre intérieure) ; l'accent l'emporte si les deux.
- **Arrêté** : l'encart « Relancer <prénom> ? / Cliquer pour relancer · taper démarre à neuf » (comportement de la spec habillage §7.3), en carte sombre arrondie dans le corps.

### 6.2 Orchestrateur

Panneau en verre dense, rayon 14 : en-tête (icône réseau en accent, nom, progression « 1/3 au travail », ✕), « Relié à <cibles> · N agents » et « ＋ Relier », lignes des agents reliés (teinte, prénom, agent, état), champ de consigne et bouton d'envoi accent. Comportement : spec habillage §13.

### 6.3 Groupes

- Le cadre de groupe devient un plateau : rayon 18, fond `--ov-tray`, bordure `--ov-glass-line`, reflet `--ov-glass-hi`.
- Étiquette au-dessus à gauche, sur fond transparent : carré de la couleur du rôle, NOM, compteurs en mono, ⋯ (menu du groupe).
- Les cadres créés à la main restent des cadres Excalidraw ordinaires.

### 6.4 Liaisons et dessins

- Liaison d'orchestrateur : courbe `--ov-accent` de 1,5 px, terminée par un point de 3 px.
- Dessins : style à main levée d'Excalidraw, inchangé ; le thème d'Excalidraw suit celui de l'application (en sombre, Excalidraw inverse les couleurs des dessins : comportement standard).

### 6.5 Couleurs des agents et des rôles

| Agent | Teinte |
|---|---|
| Claude | `#D97757` |
| Codex | `#8B95D6` |
| Gemini | `#6A9BCC` |
| Qwen Code | `#B49BD6` |
| OpenCode | `#7FB5B5` |
| Aider | `#8FA876` |
| Ollama | `#E8E5DD` |
| Cursor, Shell, Personnalisé | `#A8A6A0` |

| Rôle de groupe | Couleur |
|---|---|
| Frontend | `#C9A06E` |
| Backend | `#B49BD6` |
| Testeurs | `#8FA876` |
| Relecteurs | `#6A9BCC` |
| Design | `#D58BA0` |
| Docs | `#7FB5B5` |
| Sécurité | `#D4836B` |
| Général | `#A8A6A0` |

### 6.6 Prénoms : pionniers de l'informatique

Chaque groupe tire ses prénoms d'un domaine (au lieu d'un panthéon) ; les agents hors groupe d'un workspace, de celui du workspace. Les règles d'attribution de la spec habillage §9.2 (pas de doublon dans un workspace, domaine suivant non utilisé, retour au premier au-delà du huitième, numérotation quand un domaine est épuisé) s'appliquent telles quelles.

| Domaine | Prénoms (dans l'ordre d'attribution) |
|---|---|
| Langages | Ada, Grace, Guido, Bjarne, Brendan, Niklaus, Barbara, Kristen, Yukihiro, Anders, Rob, James, Larry, Rasmus, Chris, Kathleen |
| Systèmes | Linus, Ken, Dennis, Margaret, Fernando, Butler, Leslie, Andrew, Frances, Maurice, Jim, Per, Fred, Gene, Theo, Seymour |
| Réseaux et web | Tim, Vint, Radia, Bob, Jon, Elizabeth, Paul, Leonard, Steve, Håkon, Brewster, Ray, Judith, Van, Sally, Robert |
| Algorithmes | Alan, Donald, Edsger, Tony, Juris, Stephen, Leonid, Richard, Manuel, Michael, Dana, Robin, John, Jeff, Avi, Christos |
| Intelligence artificielle | Marvin, Geoffrey, Judea, Fei-Fei, Yann, Yoshua, Herbert, Allen, Joseph, Arthur, Daphne, Cynthia, Rodney, Demis, Ilya, Terry |
| Interfaces | Douglas, Ivan, Adele, Susan, Jef, Ted, Ben, Don, Bill, Andries, Brenda, Bret, Lucy, Jakob, Bruce, Mark |
| Sécurité et cryptographie | Whitfield, Martin, Ron, Adi, Shafi, Silvio, Ralph, Dorothy, Phil, Taher, Neal, Victor, Daniel, Moxie, Ross, Eugene |
| Données | Edgar, Raymond, Patricia, Charles, Peter, Jennifer, Hector, David, Rakesh, Surajit, Mike, Joe, Mohan, Anastasia, Laura, Doug |

- Aucun prénom n'apparaît dans deux domaines. « Claude » (Shannon) est exclu : il se confondrait avec l'agent.
- **Données existantes** : les agents gardent leur prénom actuel. Le champ enregistré (`pantheon` du cadre de groupe et du workspace) garde son nom ; ses anciennes valeurs sont lues comme un domaine : égyptien → Langages, grec → Systèmes, nordique → Réseaux et web, japonais → Algorithmes, celte → Intelligence artificielle, hindou → Interfaces, aztèque → Sécurité et cryptographie, mésopotamien → Données, slave → Langages, chinois → Systèmes, romain → Réseaux et web, yoruba → Algorithmes. Les nouveaux membres d'un ancien groupe reçoivent donc des pionniers.

## 7. Effets sur la spec fenêtre

- **§4.2 à §4.4** (bande de déplacement, boutons en pastille, accueil) : remplacés par la barre de titre et les onglets (§5.1, §5.2, §5.9). `TOP_ROW_HEIGHT` devient la hauteur de la barre de titre et des onglets (72 px).
- **§4.6** (icône) : remplacée par le logo onde (§4.1).
- **§6.4 point 1** (zone utile pour l'arrivée sur un terminal) : la surface du canvas moins les 72 px du haut et moins la bande de la barre de consigne (60 px en bas).
- **§7.1** (palette) : la palette s'ouvre sous la barre de titre, centrée, à l'aplomb du champ de recherche ; un clic sur ce champ l'ouvre aussi. Elle prend le verre dense.
- **§10** : J7 et J8 viennent après R3.

## 8. Architecture front

| Fichier | Rôle |
|---|---|
| `src/index.css` | jetons des deux thèmes et du verre (§4.2), polices, utilitaire `ov-glass` / `ov-glass-strong`, repli sans transparence |
| `src/app/theme.ts` (nouveau) | `resolveTheme(choice, systemDark)` (pur), magasin du thème et de la transparence, application à la racine, à la fenêtre et à Excalidraw |
| `src/shell/TitleBar.tsx` (nouveau) | barre de titre (logo, projet, recherche J8, compteurs, boutons de fenêtre, déplacement) ; reprend `WindowControls` |
| `src/shell/WorkspaceTabs.tsx` | onglets façon navigateur |
| `src/shell/ToolRail.tsx`, `src/shell/ActivityRail.tsx` (nouveaux) | rails gauche et droit ; remplacent `LeftRail` et `RightRail` |
| `src/fleet/AgentsPanel.tsx` (nouveau) | panneau Agents ; reprend le contenu de `FleetPanel` |
| `src/shell/CommandBar.tsx`, `GitChip.tsx`, `ZoomControl.tsx` | flottants restylés |
| `src/home/HomeScreen.tsx`, `ProjectCard.tsx` | accueil en verre |
| `src/nodes/terminal/TerminalHeader.tsx`, `frame.ts`, `ResumeCard.tsx`, `src/nodes/orchestrator/OrchestratorNode.tsx`, `src/canvas/overlay/GroupBackdrops.tsx`, `GroupLabels.tsx` | nœuds et plateaux |
| `src/fleet/names.ts` | domaines de pionniers, lecture des anciens panthéons |
| `src/fleet/catalog.ts`, `src/fleet/roles.ts` | teintes des agents et couleurs des rôles |
| supprimés | `TopBar.tsx`, `DragStrip.tsx`, `LeftRail.tsx`, `RightRail.tsx`, `ActionChips.tsx`, `LiveCount.tsx`, `FleetPanel.tsx`, `ui.tsx` (`PillButton`, `ChipButton`, `RoundButton` remplacés par des boutons de verre), `src-tauri/icons/source/orb.svg` |

## 9. Gestion des erreurs

- Thème ou transparence illisibles dans `settings` : valeurs par défaut (`system`, `on`), sans message.
- Échec d'enregistrement d'un réglage : toast « Réglage non enregistré : <raison> » ; le choix s'applique quand même pour la session.
- Les erreurs des actions déplacées (puces → panneau, ＋) restent celles d'aujourd'hui.

## 10. Jalons

| Jalon | Contenu | Vérification de Mathieu |
|---|---|---|
| R1 Fondations | §4 entière (jetons, verre, halos, repli sans transparence, polices, formes des éléments existants, thème et réglages, Excalidraw et toasts selon le thème, logo et icône) ; l'orbe disparaît | Windows en clair puis en sombre : l'application suit ; Réglages › Thème force l'un ou l'autre ; transparence coupée dans Windows : surfaces opaques ; icône onde |
| R2 Structure | §5 (barre de titre, onglets, rails, panneau Agents, panneau de propriétés, puce git, barre de consigne, zoom, toasts, accueil) et §5.11 | toutes les actions des anciennes puces et du panneau Flotte se retrouvent ; déplacer la fenêtre par la barre de titre et les onglets |
| R3 Nœuds et canvas | §6 | terminaux dans les deux thèmes, attente ambre, arrêté ; orchestrateur et liaisons ; plateaux de groupe ; nouveaux agents nommés en pionniers, anciens inchangés |

Chaque jalon a son plan et se livre par un installateur. J7 et J8 suivent R3.

## 11. Tests

### Automatisés

- `resolveTheme` : `system` suit le mode de Windows (clair, sombre, changement en direct) ; `light` et `dark` forcent ; valeur enregistrée illisible → `system`.
- Jetons : chaque jeton de §4.2 est défini dans les deux thèmes (analyse de `index.css`).
- Transparence : `off` ou `prefers-reduced-transparency` → surfaces opaques (classe ou attribut appliqué à la racine).
- Barre de titre : compteurs masqués à 0, clic → panneau Agents filtré ; boutons de fenêtre (repris des tests J6).
- Rails : chaque bouton déclenche son outil ou son menu ; le ＋ contient le catalogue, Nouvelle console, Lancer 4 agents, Orchestrateur.
- Panneau Agents : ouvert ou fermé selon le réglage ; filtres ; actions de la barre d'outils.
- Prénoms : domaine par groupe, domaine suivant non utilisé, pas de doublon dans un workspace, numérotation à l'épuisement, conversion de chaque ancien panthéon, aucun prénom commun à deux domaines, « Claude » absent.

### Vérifications manuelles (Mathieu)

Celles des jalons (§10), plus : lisibilité du panneau Agents posé au-dessus d'un terminal, dans les deux thèmes ; fluidité du défilement et du zoom du canvas avec une dizaine de terminaux et le panneau ouvert.

## 12. Risques

1. **Coût du flou** : `backdrop-filter` sollicite le GPU pendant le défilement du canvas. Limité aux éléments flottants (une dizaine) ; repli opaque automatique quand Windows coupe la transparence, et réglage « Effets de transparence » pour le couper à la main.
2. **Thème sombre d'Excalidraw** : il inverse les couleurs des dessins ; un dessin fait en clair change d'aspect en sombre (comportement d'Excalidraw, accepté).
3. **Proximité avec Anthropic** : palette inspirée, aucune marque, aucun logo, aucune police d'Anthropic ; le logo onde est original.
4. **Proximité avec Symvibe** : les rails et panneaux flottants sont un standard des outils de canvas (Miro, FigJam, tldraw, Excalidraw) ; la différence porte sur la barre de titre à onglets et recherche, le verre, la palette, les polices, le logo, les prénoms et l'absence d'orbe et de puces.

## 13. Conventions

- Interface en français ; code et commentaires en anglais.
- Commits en anglais au format conventionnel, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Dépendances ajoutées à version exacte : `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`.
