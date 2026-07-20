# Bjorn Dungeon - Suivi du développement

> État du projet, fonctionnalités faites, et idées pour la suite.
> Dernière mise à jour : voir l'historique git (`git log --oneline`).

---

## ⚙️ Comment lancer (important : cache)

- **Le plus simple : double‑clic sur `lancer.bat`** (lance `node server.js` sur le port 8100 et ouvre le navigateur ; port passable en argument : `lancer.bat 8200`).
- **Recommandé : `node server.js`** → sert le jeu avec des en‑têtes **no‑cache** (tu as toujours la dernière version).
  Le port est passable en argument : `node server.js 8100`.
- Sinon `python -m http.server` fonctionne aussi (localStorage seul), mais **fais un Ctrl+Shift+R** après chaque mise à jour (sinon le navigateur garde d'anciens modules JS en cache → bugs fantômes / écran noir).
- Sauvegardes : `localStorage` (toujours) + copie serveur dans `saves/` si tu lances `node server.js`.

## 🗂️ Structure

- `index.html` - le jeu (FPS dungeon crawler, Three.js r0.128, ESM, sans build).
- `forge.html` + `js/forge.js` - **Bjorn Forge**, l'éditeur de contenu (studio).
- `js/` - modules : `game.js` (orchestrateur), `dungeon.js` (génération + décor 3D), `sprites.js`, `viewmodel.js`, `spells.js`, `items.js`, `inventory.js`, `loot.js`, `effects.js`, `sounds.js`, `status.js`, `save.js`, `data.js` (données), `utils.js`, `assets-db.js` (IndexedDB), `state.js`.
- `assets/` - sprites (mobs, npc, items, weapons), textures, **props/** (modèles GLB), **audio/**, `manifest.json` (liste des assets, régénérée par `tools/gen-manifest.cjs`).
- `divers/` - assets bruts fournis (originaux, non versionnés).

---

## ✅ Ce qui est fait

### Refonte RPG (juillet 2026)
- **IA des monstres** : flow field partagé (BFS depuis le joueur, recalcul ~3x/s, module `js/ai.js`) → les mobs contournent les murs ; **ligne de vue** (aggro à vue, plus de tirs dans les murs) ; **attaques mêlée télégraphées** (flash rouge 0,38 s, esquivables) ; **charge** des brutes (loup‑garou, chevalier sanglant, furie, élites Vifs) ; **kite + strafe** des casters ; **fuite** des couards blessés (gobelin, rat, sangsue) ; **aggro de meute** (un mob alerté/frappé alerte les siens à 7 m) ; **séparation** (les meutes encerclent au lieu de s'empiler).
- **Performance** : LOD d'IA (mobs lointains passifs mis à jour 4x moins souvent), zéro allocation de vecteurs dans les boucles chaudes, ligne de vue en cache court.
- **6 nouveaux sorts / 5 nouveaux types** : Rayon Arcanique (beam), Mur de Flammes (zone persistante), Égide Sacrée (bouclier absorbant, affiché au HUD), Météore (impact différé télégraphié), Esprit Gardien (invocation qui orbite et mitraille), Drain d'Âme (rayon qui vole la vie). **Sorts débloqués par niveau** (1 → 15), annoncés au level‑up.
- **Compétences passives** (`js/skills.js`) : 12 compétences à 5 rangs (maîtrise martiale, arcanes, vigueur, fortune…), 1 point par niveau, panneau dans l'inventaire, sauvegardées (rétro‑compat : points rattrapés sur les vieilles saves).
- **Ressenti** : screen shake (coups, choc sismique, météore, bombe), punch de FOV au dash, dissolution des morts (fondu + affaissement), vignette rouge pulsée sous 25% PV.
- **Donjon mieux agencé** : salles **thématiques** (trésorerie, tanière mono‑monstre, réserve, cimetière, sanctuaire, salle de garde avec champion) ; **caveau scellé** (porte dorée runique visible sur la carte, clé portée par un champion « Porte‑clé », 2 coffres rares/maudits à l'intérieur).
- **Biomes vivants** : **flaques de danger** par biome (lave qui brûle, vase qui empoisonne, glace qui ralentit) ; **mutations d'étage** (Horde, Opulent, Enragé, Voilé, Ancien) affichées au HUD, dès l'étage 2 (45%).
- **17 nouveaux objets** (katana, fléau, rapière, hache de guerre, arc long, grimoire, pavois, robe d'arcaniste, armure lourde, capuche d'ombre, talisman, anneau de focalisation, bombe naine, antidote, parchemin de rappel, viande grillée, élixir d'arcane) + **6 nouveaux uniques** (Égide Éternelle/épines, Faux du Moissonneur/soin au kill, Lame de Givre/aura de gel, Gantelets de Midas/+or, Hache du Bourreau/exécution, Plume de Phénix/évite la mort 1x par étage).

### Donjon & génération
- Génération par **salles + couloirs**, portes, **passages secrets** (avec **levier 3D** repère), **portail** vers l'étage suivant (profondeur infinie), fosses (trous).
- **Biomes** par étage (crypte/glace/forge/void/marais…) : teintent murs/sol/brouillard/lumière, biaisent le pool de monstres et le boss. **Textures de sol/mur/plafond par biome** (importables).
- **Décor 3D bas‑poly placé logiquement** : torches (halo 3D), tonneaux, caisses, table/chaise, armoire, os, crânes, rochers, cages, cercueils, gemmes lumineuses, **tapis** (decal sol), **tableaux/tapisseries** (decals muraux), **colonnes** encastrées dans les coins, toiles d'araignée dans les coins.
- **Runes murales en decals 3D** (ne s'enfoncent plus). **Halo de torche 3D** (ne billboarde plus par‑dessus le joueur).
- **Collision du gros mobilier** ; orientation auto « dos au mur ».

### Interactions & objets du monde
- **Coffres** (commun/rare/maudit) - ouvrables, avec **support modèle GLB fermé/ouvert**.
- **Cercueils interactifs** (E) : butin **ou** embuscade de monstre.
- **Contenants fouillables** (tonneau/caisse/armoire) via E → butin (le tonneau/la caisse se brisent).
- **Décor cassable en mêlée** (rochers, vases, os, table…) → drop. **Toiles** → chance d'araignée.
- **Marchand** (PNJ) avec boutique + **bascule Delve/Labyrinthe**. **PNJ d'ambiance** (barde, garde, mage…) avec répliques.

### Vie du donjon
- **Événements de salle** : autels runiques, fontaines éthériques et caches scellées à activer avec **E**.
- **Pièges lisibles au sol** : glyphes de pointes, feu et givre, avec dégâts/statuts et cooldown de déclenchement.
- L'ancienne boucle **pioche/marteau** type Minecraft est **désactivée** pour recentrer l'expérience sur le dungeon crawler fantasy.

### Combat, sorts, loot
- **Armes** : épée, hache, dague, masse, lance, espadon (2M), arc, arbalète, bâton/sceptre - chaque type = attaque différente (mêlée / tir / sort). **Slash orienté vers la visée** (haut/bas).
- **Slots d'équipement dédiés** : Mêlée (main + secondaire dual‑wield), **Distance**, **Magie**, + armure/anneaux/etc. **Barre d'action unifiée** (armes + sorts, molette/1‑N).
- **Sorts** : bolt / pierce / aoe / nova / heal, mana, cooldowns, VFX, rebonds, projectiles multishot. **Monstres tireurs** (projectiles vers le joueur).
- **Loot 4 raretés** (vert/bleu/jaune/violet) avec **affixes aléatoires** scalant fort avec la rareté ; **noms procéduraux** (préfixe + base + suffixe). **Logs colorés par rareté.**
- **Sons par entité** (marche/attaque/mort) + **audio importable** (musique en boucle, SFX par catégorie **et par sort**, valeurs **multiples jouées au hasard**).
- **Statuts** : brûlure / poison / saignement / givre (DoT + ralentissement).

### Progression & sauvegarde
- **Sauvegarde permanente** : objets, PV, or, niveau, progression conservés ; **reprise automatique au rechargement** (seule la position repart au début de l'étage). Bouton **Nouvelle partie** (efface la save).
- **Bonus de classe** déterministe selon le nom du perso ; XP / niveaux / attributs (+3 pts/niveau).
- **Barre de vie ennemie** en haut‑centre, nom au‑dessus.
- **Bouton Éditeur** dans le menu pause (rejoint la Forge sans perdre la partie).

### Rendu / réglages
- Rendu basse‑def upscalé (look pixel‑art), **bloom** (WebGL), fog/ambient/vignette.
- Réglages (menu pause) : **FOV (défaut 50), Pixelisation (défaut 88)**, **Hauteur des armes** (aperçu temps réel), Bloom, Volume.

### Bjorn Forge (éditeur de contenu)
- Édite : items, uniques, monstres, sorts, boss, objets, biomes, raretés, environnement.
- **Cards façon RPG** (avatar + stats en **sliders + valeur manuelle** + badges) pour monstres/boss/items/uniques/objets/**sorts**.
- **Zéro JSON** : éditeurs cliquables pour statut/effet, spécial, buff, **capacités de boss**, et objets génériques (clé→valeur).
- **Cases à cocher** biome↔monstres / objets / décor 3D (bidirectionnel).
- **Bibliothèque d'assets** partout (texture / son / modèle 3D) : parcourir l'existant + importer ; **les imports rejoignent la bibliothèque** ; **éditeur d'image** (recadrage/chroma) sur les textures.
- **Import de vrais modèles 3D** (glTF/GLB) pour remplacer les props procéduraux (+ taille + **rotation** par prop).
- **Onglet Décor 3D**, **onglet Audio** (musique + SFX par catégorie/par sort), **onglet Bonus**, **onglet Effets** - tout **data‑driven** et éditable.
- **Gros assets en IndexedDB** (GLB/audio) → plus de `QuotaExceededError` ; migration auto des anciens base64.
- **Mode preview de biome** : « ▶ Tester ce biome » → on marche dedans **sans monstre** (pioche/marteau dispo, la partie n'est pas écrasée).

### Sécurité / infra
- Dépôt **git** avec commits‑checkpoints réguliers + **backup dossier** (`_bjorn_backup_<date>`).
- `tools/gen-manifest.cjs` régénère `assets/manifest.json` (au boot de `node server.js`).

---

## 💡 Idées / reste à faire

### Polish demandé
- **Variantes de sprite aléatoires** par monstre (plusieurs visuels tirés au hasard, comme l'audio multi‑valeurs).
- **Sprites importés en IndexedDB** (aujourd'hui en base64 dans le projet → risque de quota si beaucoup d'imports).
- **Câbler `plant` / `money_bag`** (assets GLB fournis non utilisés) en props décoratifs.
- **Équilibrage** : les stats des hautes raretés sont énormes ; surveiller les monstres tireurs et la difficulté globale.

### Confort / UX
- **Sauvegardes multiples / slots de perso** (aujourd'hui une seule save globale).
- Preview du **viewmodel dans la Forge** (voir l'arme/le sort en 3D pendant l'édition).
- **Orientation manuelle** dans le jeu (marteau) au‑delà de la touche R (angle libre, snap 15°).
- **Aperçu live** en jeu des sons assignés ; **presets audio** par défaut.
- Rendre l'**inventaire drag‑and‑drop**.

### Contenu / gameplay
- Plus de **types de sorts / effets** (chaîne, invocation joueur, bouclier, dash‑attack…).
- **Pièges** (dards, dalles, flammes) et **énigmes** (leviers multiples, plaques de pression).
- Élargir les **événements de salle** : arène qui se scelle, vagues, mini‑boss d'élite.
- **PNJ hub** / village au début, quêtes simples.
- **Chauve‑souris** : sprite dédié (actuellement généré par canvas).
- **Halo de torche projeté sur le joueur** - nécessiterait un corps de joueur (mains/ombre) en vue FPS.

### Technique / robustesse
- **Éliminer complètement le problème de cache** : versionner les imports de modules (ex. `?v=BUILD`) ou passer par un petit build, pour ne plus dépendre du hard‑refresh.
- Nettoyer les assets obsolètes (`maps.js`, anciens `assets/sprites/*` dupliqués).
- **Nettoyer `plague_doctor`** (fond gris résiduel signalé).
- Tests légers automatisés sur les fonctions pures (loot, stats, statuts).
- Optionnel : petit **build/minify** pour la prod.

---

*Bjorn Cyberviking - dungeon crawler navigateur, vanilla JS, sans framework.*
