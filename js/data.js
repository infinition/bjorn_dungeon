// =====================================================================
//  BJORN DUNGEON - BASE DE DONNEES DE CONTENU
// =====================================================================
// Projet de la Forge persiste sur disque (server.js reecrit ce module).
// Source de verite quand le serveur node tourne ; sinon repli localStorage.
import { ForgeProject } from './project.js';

// Slots d'equipement (ordre d'affichage)
export const SLOTS = [
    'helmet', 'cape', 'necklace',
    'chest', 'gloves', 'ring1',
    'belt', 'legs', 'ring2',
    'boots', 'mainHand', 'offHand',
    'ranged', 'magic'
];
export const SLOT_LABELS = {
    helmet: 'Casque', cape: 'Cape', necklace: 'Collier',
    chest: 'Torse', gloves: 'Gants', ring1: 'Anneau I',
    belt: 'Ceinture', legs: 'Jambes', ring2: 'Anneau II',
    boots: 'Bottes', mainHand: 'Mêlée', offHand: 'Sec.',
    ranged: 'Distance', magic: 'Magie'
};

// Attributs alloues a chaque niveau
export const ATTRIBUTES = {
    force:     { name: 'Force',     desc: '+degats arme de melee' },
    dexterite: { name: 'Dexterite', desc: '+degats a distance, +crit' },
    intel:     { name: 'Intelligence', desc: '+puissance des sorts, +mana' },
    vitalite:  { name: 'Vitalite',  desc: '+points de vie max' },
    blocage:   { name: 'Blocage',   desc: '+chance de blocage auto' },
    parade:    { name: 'Parade',    desc: '+chance de parade auto' },
    furtivite: { name: 'Furtivite', desc: 'reduit la detection ennemie' }
};

export const GameData = {

    // --- RARETES (4 tiers : vert/bleu/jaune/violet) ---
    // affixes = nb de stats aleatoires ; mult = ampleur ; weight = frequence de drop
    "rarities": {
        "green":  { "name": "Vert",   "color": "#3ee85e", "affixes": 1, "mult": 1.0, "weight": 60 },
        "blue":   { "name": "Bleu",   "color": "#3ea8ff", "affixes": 2, "mult": 2.0, "weight": 28 },
        "yellow": { "name": "Jaune",  "color": "#ffd24d", "affixes": 3, "mult": 3.6, "weight": 10 },
        "purple": { "name": "Violet", "color": "#c44dff", "affixes": 4, "mult": 6.0, "weight": 2 },
        "mythic": { "name": "Mythique", "color": "#ff5544", "affixes": 5, "mult": 10.0, "weight": 0.4 }
    },

    // --- ITEMS (templates de base ; les drops roulent des stats aleatoires) ---
    // type: weapon|shield|torch|helmet|chest|legs|boots|belt|gloves|cape|necklace|ring|consumable|misc
    // weaponClass (si arme): sword|axe|greatsword|staff|bow|crossbow|dagger
    // hands: 1|2 (2 = bloque la main secondaire)
    "items": [
        // Armes 1 main
        { "id": "sword", "name": "Epee", "type": "weapon", "weaponClass": "sword", "hands": 1, "attackType": "melee", "baseStats": { "damage": 8 }, "range": 2.2, "icon": "🗡️", "sprite": "assets/items/sword2.png", "viewSprite": "assets/weapons/sword.png", "rarity": "green", "value": 10, "spawnChance": 0.4 },
        { "id": "pickaxe", "name": "Pioche ancienne", "type": "misc", "baseStats": {}, "icon": "⛏️", "sprite": "", "rarity": "green", "value": 5, "spawnChance": 0, "desc": "Ancien outil de test, desactive dans la boucle principale." },
        { "id": "hammer", "name": "Marteau ancien", "type": "misc", "baseStats": {}, "icon": "🔨", "sprite": "", "rarity": "green", "value": 5, "spawnChance": 0, "desc": "Ancien outil de test, desactive dans la boucle principale." },
        { "id": "axe", "name": "Hache", "type": "weapon", "weaponClass": "axe", "hands": 1, "attackType": "melee", "baseStats": { "damage": 11, "attackSpeed": -0.1 }, "range": 2.0, "icon": "🪓", "sprite": "assets/items/axe2.png", "viewSprite": "assets/weapons/axe.png", "rarity": "green", "value": 12, "spawnChance": 0.35, "status": { "type": "bleed", "dps": 5, "duration": 4 } },
        { "id": "dagger", "name": "Dague", "type": "weapon", "weaponClass": "dagger", "hands": 1, "attackType": "melee", "baseStats": { "damage": 5, "attackSpeed": 0.2, "crit": 0.1 }, "range": 1.6, "icon": "🔪", "sprite": "assets/items/dagger.png", "viewSprite": "assets/items/dagger.png", "rarity": "green", "value": 9, "spawnChance": 0.3, "status": { "type": "poison", "dps": 4, "duration": 5 } },
        { "id": "mace", "name": "Masse", "type": "weapon", "weaponClass": "mace", "hands": 1, "attackType": "melee", "baseStats": { "damage": 13, "attackSpeed": -0.1 }, "range": 2.0, "icon": "🔨", "sprite": "assets/items/mace.png", "viewSprite": "assets/items/mace.png", "rarity": "green", "value": 16, "spawnChance": 0.28 },
        { "id": "spear", "name": "Fourche", "type": "weapon", "weaponClass": "spear", "hands": 1, "attackType": "melee", "baseStats": { "damage": 12 }, "range": 2.9, "icon": "🔱", "sprite": "assets/items/fourche.png", "viewSprite": "assets/items/fourche.png", "rarity": "green", "value": 15, "spawnChance": 0.25 },
        // Armes 2 mains
        { "id": "greatsword", "name": "Espadon", "type": "weapon", "weaponClass": "greatsword", "hands": 2, "attackType": "melee", "baseStats": { "damage": 20, "attackSpeed": -0.25 }, "range": 2.8, "icon": "⚔️", "sprite": "assets/items/greatsword.png", "viewSprite": "assets/items/greatsword.png", "rarity": "blue", "value": 40, "spawnChance": 0.15 },
        { "id": "war_hammer", "name": "Marteau de Guerre", "type": "weapon", "weaponClass": "greatsword", "hands": 2, "attackType": "melee", "baseStats": { "damage": 24, "attackSpeed": -0.3 }, "range": 2.6, "icon": "🔨", "sprite": "assets/items/hammer2.png", "viewSprite": "assets/items/hammer2.png", "rarity": "blue", "value": 50, "spawnChance": 0.12 },
        { "id": "scythe", "name": "Faux", "type": "weapon", "weaponClass": "greatsword", "hands": 2, "attackType": "melee", "baseStats": { "damage": 19, "attackSpeed": -0.15 }, "range": 2.8, "icon": "☠️", "sprite": "assets/items/faux.png", "viewSprite": "assets/items/faux.png", "rarity": "blue", "value": 48, "spawnChance": 0.12, "status": { "type": "bleed", "dps": 6, "duration": 4 } },
        { "id": "staff", "name": "Baton Runique", "type": "weapon", "weaponClass": "staff", "hands": 2, "attackType": "cast", "baseStats": { "spellPower": 12, "maxMana": 30 }, "range": 0, "icon": "🪄", "sprite": "assets/items/screptre.png", "viewSprite": "assets/items/screptre.png", "rarity": "blue", "value": 45, "spawnChance": 0.15 },
        { "id": "acid_sceptre", "name": "Sceptre Acide", "type": "weapon", "weaponClass": "staff", "hands": 2, "attackType": "cast", "baseStats": { "spellPower": 16, "maxMana": 30 }, "range": 0, "icon": "🟢", "sprite": "assets/items/acid_sceptre.png", "viewSprite": "assets/items/acid_sceptre.png", "rarity": "yellow", "value": 70, "spawnChance": 0.1 },
        // Armes a distance
        { "id": "bow", "name": "Arc", "type": "weapon", "weaponClass": "bow", "hands": 2, "attackType": "ranged", "baseStats": { "damage": 9, "attackSpeed": 0.1 }, "projSpeed": 18, "icon": "🏹", "sprite": "assets/items/arc.png", "viewSprite": "assets/items/arc.png", "rarity": "green", "value": 18, "spawnChance": 0.25 },
        { "id": "crossbow", "name": "Arbalete", "type": "weapon", "weaponClass": "crossbow", "hands": 2, "attackType": "ranged", "baseStats": { "damage": 16, "attackSpeed": -0.2, "crit": 0.05 }, "projSpeed": 24, "icon": "🎯", "sprite": "assets/items/crossbow.png", "viewSprite": "assets/items/crossbow.png", "rarity": "blue", "value": 35, "spawnChance": 0.18 },
        // Secondaire
        { "id": "shield", "name": "Bouclier", "type": "shield", "hands": 1, "baseStats": { "defense": 6, "block": 0.2 }, "icon": "🛡️", "sprite": "assets/items/shield1_front.png", "rarity": "green", "value": 15, "spawnChance": 0.3 },
        { "id": "torch", "name": "Torche", "type": "torch", "hands": 1, "baseStats": {}, "light": true, "icon": "🔥", "sprite": "assets/items/torch.png", "viewSprite": "assets/items/torch.png", "rarity": "green", "value": 5, "spawnChance": 0.25 },
        // Armures
        { "id": "helmet", "name": "Casque", "type": "helmet", "baseStats": { "defense": 3, "maxHp": 10 }, "icon": "⛑️", "sprite": "assets/items/helmet.png", "rarity": "green", "value": 10, "spawnChance": 0.3 },
        { "id": "chestplate", "name": "Plastron", "type": "chest", "baseStats": { "defense": 6, "maxHp": 25 }, "icon": "🦺", "sprite": "assets/items/chestplate.png", "rarity": "green", "value": 18, "spawnChance": 0.3 },
        { "id": "leggings", "name": "Jambieres", "type": "legs", "baseStats": { "defense": 4, "maxHp": 15 }, "icon": "👖", "sprite": "assets/items/leggings.png", "rarity": "green", "value": 14, "spawnChance": 0.3 },
        { "id": "boots", "name": "Bottes", "type": "boots", "baseStats": { "defense": 2, "speed": 0.05 }, "icon": "🥾", "sprite": "assets/items/boots.png", "rarity": "green", "value": 10, "spawnChance": 0.3 },
        { "id": "belt", "name": "Ceinture", "type": "belt", "baseStats": { "defense": 2, "maxHp": 8 }, "icon": "🩹", "sprite": "assets/items/belt.png", "rarity": "green", "value": 8, "spawnChance": 0.25 },
        { "id": "gloves", "name": "Gants", "type": "gloves", "baseStats": { "defense": 2, "attackSpeed": 0.05 }, "icon": "🧤", "sprite": "assets/items/gloves.png", "rarity": "green", "value": 9, "spawnChance": 0.25 },
        { "id": "cape", "name": "Cape", "type": "cape", "baseStats": { "stealth": 1, "speed": 0.05 }, "icon": "🧣", "sprite": "assets/items/cape.png", "rarity": "green", "value": 12, "spawnChance": 0.2 },
        // Bijoux
        { "id": "necklace", "name": "Collier", "type": "necklace", "baseStats": { "spellPower": 4 }, "icon": "📿", "sprite": "assets/items/necklace.png", "rarity": "blue", "value": 25, "spawnChance": 0.18 },
        { "id": "ring", "name": "Anneau", "type": "ring", "baseStats": { "crit": 0.04 }, "icon": "💍", "sprite": "assets/items/ring.png", "rarity": "blue", "value": 25, "spawnChance": 0.18 },
        // Consommables
        { "id": "potion_heal", "name": "Potion de Soin", "type": "consumable", "heal": 45, "icon": "🧪", "sprite": "assets/items/potion_de_vie.png", "rarity": "green", "value": 10, "spawnChance": 0.5 },
        { "id": "potion_mana", "name": "Fiole de Mana", "type": "consumable", "manaRestore": 55, "icon": "💙", "sprite": "assets/items/potion_de_mana.png", "rarity": "green", "value": 10, "spawnChance": 0.35 },
        { "id": "potion_vigor", "name": "Potion de Vigueur", "type": "consumable", "staminaRestore": 100, "icon": "🟩", "sprite": "assets/items/potion_de_vigeur.png", "rarity": "green", "value": 8, "spawnChance": 0.25 },
        { "id": "elixir_rage", "name": "Elixir de Rage", "type": "consumable", "buff": { "stat": "damage", "amount": 18, "duration": 12 }, "icon": "🔥", "sprite": "assets/items/elixir_rage.png", "rarity": "yellow", "value": 40, "spawnChance": 0.12 },
        // Armes additionnelles
        { "id": "katana", "name": "Katana", "type": "weapon", "weaponClass": "sword", "hands": 1, "attackType": "melee", "baseStats": { "damage": 10, "attackSpeed": 0.15, "crit": 0.05 }, "range": 2.3, "icon": "\ud83d\udde1", "sprite": "assets/items/sword2.png", "viewSprite": "assets/weapons/sword.png", "rarity": "blue", "value": 30, "spawnChance": 0.18 },
        { "id": "flail", "name": "Fleau", "type": "weapon", "weaponClass": "mace", "hands": 1, "attackType": "melee", "baseStats": { "damage": 14, "attackSpeed": -0.15 }, "range": 2.1, "icon": "\u26d3", "sprite": "assets/items/mace.png", "viewSprite": "assets/items/mace.png", "rarity": "blue", "value": 26, "spawnChance": 0.18, "status": { "type": "bleed", "dps": 5, "duration": 3 } },
        { "id": "rapier", "name": "Rapiere", "type": "weapon", "weaponClass": "dagger", "hands": 1, "attackType": "melee", "baseStats": { "damage": 7, "attackSpeed": 0.25, "crit": 0.08, "parry": 0.06 }, "range": 2.0, "icon": "\ud83e\udd3a", "sprite": "assets/items/dagger.png", "viewSprite": "assets/items/dagger.png", "rarity": "blue", "value": 28, "spawnChance": 0.18 },
        { "id": "battle_axe", "name": "Hache de Guerre", "type": "weapon", "weaponClass": "greatsword", "hands": 2, "attackType": "melee", "baseStats": { "damage": 22, "attackSpeed": -0.2 }, "range": 2.7, "icon": "\ud83e\ude93", "sprite": "assets/items/axe2.png", "viewSprite": "assets/weapons/axe.png", "rarity": "blue", "value": 46, "spawnChance": 0.12, "status": { "type": "bleed", "dps": 5, "duration": 4 } },
        { "id": "longbow", "name": "Arc Long", "type": "weapon", "weaponClass": "bow", "hands": 2, "attackType": "ranged", "baseStats": { "damage": 13, "attackSpeed": 0.05, "crit": 0.05 }, "projSpeed": 22, "icon": "\ud83c\udff9", "sprite": "assets/items/arc.png", "viewSprite": "assets/items/arc.png", "rarity": "blue", "value": 32, "spawnChance": 0.16 },
        { "id": "grimoire", "name": "Grimoire Occulte", "type": "weapon", "weaponClass": "staff", "hands": 2, "attackType": "cast", "baseStats": { "spellPower": 14, "manaRegen": 3 }, "range": 0, "icon": "\ud83d\udcd5", "sprite": "assets/items/closed_book.png", "viewSprite": "assets/items/opened_book.png", "rarity": "blue", "value": 50, "spawnChance": 0.12 },
        { "id": "tower_shield", "name": "Pavois", "type": "shield", "hands": 1, "baseStats": { "defense": 10, "block": 0.3, "speed": -0.05 }, "icon": "\ud83d\udee1", "sprite": "assets/items/shield3_front.png", "rarity": "blue", "value": 34, "spawnChance": 0.15 },
        // Armures additionnelles
        { "id": "arcanist_robe", "name": "Robe d'Arcaniste", "type": "chest", "baseStats": { "defense": 2, "spellPower": 8, "maxMana": 25 }, "icon": "\ud83e\udd7b", "sprite": "assets/items/cape.png", "rarity": "blue", "value": 30, "spawnChance": 0.16 },
        { "id": "heavy_plate", "name": "Armure Lourde", "type": "chest", "baseStats": { "defense": 12, "maxHp": 40, "speed": -0.08 }, "icon": "\ud83e\uddbe", "sprite": "assets/items/chestplate.png", "rarity": "blue", "value": 42, "spawnChance": 0.14 },
        { "id": "shadow_hood", "name": "Capuche d'Ombre", "type": "helmet", "baseStats": { "defense": 1, "stealth": 2, "crit": 0.03 }, "icon": "\ud83c\udfa9", "sprite": "assets/items/helmet.png", "rarity": "blue", "value": 24, "spawnChance": 0.16 },
        // Bijoux additionnels
        { "id": "amulet_vitality", "name": "Talisman de Vie", "type": "necklace", "baseStats": { "maxHp": 30 }, "icon": "\ud83e\uddff", "sprite": "assets/items/necklace.png", "rarity": "blue", "value": 28, "spawnChance": 0.14 },
        { "id": "ring_focus", "name": "Anneau de Focalisation", "type": "ring", "baseStats": { "spellPower": 5, "manaRegen": 2 }, "icon": "\ud83d\udc8d", "sprite": "assets/items/ring.png", "rarity": "blue", "value": 28, "spawnChance": 0.14 },
        // Consommables additionnels
        { "id": "bomb", "name": "Bombe Naine", "type": "consumable", "aoeDamage": 60, "aoeRadius": 4, "icon": "\ud83d\udca3", "sprite": "", "rarity": "blue", "value": 25, "spawnChance": 0.14, "desc": "Explose autour de toi. Recule d'abord... ou pas." },
        { "id": "antidote", "name": "Antidote", "type": "consumable", "cure": true, "heal": 10, "icon": "\ud83e\uddf4", "sprite": "", "rarity": "green", "value": 12, "spawnChance": 0.2, "desc": "Purge tous les statuts (poison, brulure, saignement, givre)." },
        { "id": "scroll_return", "name": "Parchemin de Rappel", "type": "consumable", "teleport": "spawn", "icon": "\ud83d\udcdc", "sprite": "", "rarity": "blue", "value": 20, "spawnChance": 0.12, "desc": "Te ramene instantanement au debut de l'etage (pres du marchand)." },
        { "id": "grilled_meat", "name": "Viande Grillee", "type": "consumable", "heal": 25, "staminaRestore": 40, "icon": "\ud83c\udf56", "sprite": "", "rarity": "green", "value": 8, "spawnChance": 0.22 },
        { "id": "elixir_focus", "name": "Elixir d'Arcane", "type": "consumable", "buff": { "stat": "spellPower", "amount": 20, "duration": 12 }, "icon": "\ud83d\udd2e", "sprite": "", "rarity": "yellow", "value": 40, "spawnChance": 0.1 },
        // Objets de quête / monde
        { "id": "vault_key", "name": "Clé du Caveau", "type": "misc", "baseStats": {}, "icon": "🗝️", "sprite": "", "rarity": "yellow", "value": 0, "spawnChance": 0, "desc": "Ouvre le caveau scellé de l'étage (interagis avec la porte dorée)." }
    ],

    // --- OBJETS UNIQUES (ultra-rares, effets speciaux) ---
    // special : multishot (nb projectiles), spread (cone), extraBounce (+rebonds)
    "uniques": [
        { "id": "tri_prism", "name": "Prisme Tri-Runique", "type": "offhand", "unique": true, "baseStats": { "spellPower": 16, "maxMana": 40 }, "special": { "multishot": 3, "spread": 0.22 }, "icon": "🔱", "sprite": "assets/items/tri_prism.png", "value": 500, "desc": "Chaque sort se scinde en 3 projectiles en eventail." },
        { "id": "cyclone_crown", "name": "Couronne du Cyclone", "type": "helmet", "unique": true, "baseStats": { "defense": 10, "maxHp": 50 }, "special": { "multishot": 2, "spread": 0.35 }, "icon": "👑", "sprite": "assets/items/cyclone_crown.png", "value": 480, "desc": "Double les projectiles de sort, large eventail." },
        { "id": "ricochet_ring", "name": "Anneau du Ricochet", "type": "ring", "unique": true, "baseStats": { "crit": 0.1 }, "special": { "extraBounce": 3 }, "icon": "💍", "sprite": "assets/items/ricochet_ring.png", "value": 420, "desc": "Les sorts rebondissent 3 fois de plus avant de se desintegrer." },
        { "id": "storm_volley", "name": "Volée Tempête", "type": "weapon", "weaponClass": "bow", "hands": 2, "attackType": "ranged", "unique": true, "baseStats": { "damage": 20, "attackSpeed": 0.15 }, "projSpeed": 22, "special": { "multishot": 3, "spread": 0.16 }, "icon": "🏹", "sprite": "assets/items/storm_volley.png", "viewSprite": "assets/items/storm_volley.png", "value": 520, "desc": "Décoche une volée de 3 traits." },
        { "id": "aegis_eternal", "name": "Egide Eternelle", "type": "shield", "hands": 1, "unique": true, "baseStats": { "defense": 14, "block": 0.3, "maxHp": 30 }, "special": { "thorns": 8 }, "icon": "\ud83d\udee1", "sprite": "assets/items/shield2_front.png", "value": 520, "desc": "Renvoie 8 degats a chaque attaquant en melee." },
        { "id": "reaper_scythe", "name": "Faux du Moissonneur", "type": "weapon", "weaponClass": "greatsword", "hands": 2, "attackType": "melee", "unique": true, "baseStats": { "damage": 26, "lifesteal": 0.05 }, "range": 2.9, "special": { "onKillHeal": 12 }, "status": { "type": "bleed", "dps": 8, "duration": 4 }, "icon": "\u2620", "sprite": "assets/items/faux.png", "viewSprite": "assets/items/faux.png", "value": 560, "desc": "Chaque ame fauchee te rend 12 PV." },
        { "id": "frostbrand", "name": "Lame de Givre Eternel", "type": "weapon", "weaponClass": "sword", "hands": 1, "attackType": "melee", "unique": true, "baseStats": { "damage": 18, "attackSpeed": 0.05 }, "range": 2.3, "special": { "frostAura": 3.2 }, "status": { "type": "freeze", "dps": 3, "duration": 2.5 }, "icon": "\u2744", "sprite": "assets/items/sword2.png", "viewSprite": "assets/weapons/sword.png", "value": 540, "desc": "Une aura glaciale ralentit les ennemis proches." },
        { "id": "midas_gauntlets", "name": "Gantelets de Midas", "type": "gloves", "unique": true, "baseStats": { "defense": 4, "attackSpeed": 0.06 }, "special": { "goldFind": 0.5 }, "icon": "\ud83e\udde4", "sprite": "assets/items/gloves.png", "value": 480, "desc": "+50% d'or trouve." },
        { "id": "executioner_axe", "name": "Hache du Bourreau", "type": "weapon", "weaponClass": "greatsword", "hands": 2, "attackType": "melee", "unique": true, "baseStats": { "damage": 24, "crit": 0.08 }, "range": 2.7, "special": { "execute": 0.35 }, "icon": "\ud83e\ude93", "sprite": "assets/items/axe2.png", "viewSprite": "assets/weapons/axe.png", "value": 550, "desc": "+35% de degats contre les ennemis sous 30% de PV." },
        { "id": "phoenix_plume", "name": "Plume de Phenix", "type": "cape", "unique": true, "baseStats": { "speed": 0.08, "maxHp": 20 }, "special": { "cheatDeath": true }, "icon": "\ud83e\udd85", "sprite": "assets/items/cape.png", "value": 600, "desc": "Evite la mort une fois par etage (retour a 50% PV)." }
    ],

    // --- MONSTRES ---
    "monsters": [
        { "id": "skeleton", "name": "Squelette", "hp": 30, "damage": 7, "xp": 12, "color": "#dddddd", "scale": 1.1, "speed": 1.5, "attackRange": 1.5, "attackRate": 0.02, "detect": 12, "behavior": "chaser", "sprite": "assets/mobs/skeleton.png", "sound": "bones", "gold": [2, 9], "lootChance": 0.4, "spawnChance": 0.6 },
        { "id": "fighter_skeleton", "name": "Squelette Guerrier", "hp": 50, "damage": 11, "xp": 22, "color": "#cfd0d4", "scale": 1.15, "speed": 1.4, "attackRange": 1.6, "attackRate": 0.025, "detect": 13, "behavior": "chaser", "sprite": "assets/mobs/fighter_skeleton.png", "sound": "bones", "gold": [6, 16], "lootChance": 0.5, "statusOnHit": { "type": "bleed", "dps": 3, "duration": 3 }, "spawnChance": 0.35 },
        { "id": "goblin", "coward": true, "name": "Gobelin", "hp": 20, "damage": 5, "xp": 9, "color": "#9acd32", "scale": 0.9, "speed": 2.4, "attackRange": 1.4, "attackRate": 0.025, "detect": 13, "behavior": "chaser", "sprite": "assets/mobs/gobelin.png", "sound": "screech", "gold": [3, 12], "lootChance": 0.45, "spawnChance": 0.55 },
        { "id": "slime", "name": "Slime", "hp": 26, "damage": 4, "xp": 7, "color": "#3ee85e", "scale": 0.85, "speed": 1.0, "attackRange": 1.2, "attackRate": 0.02, "detect": 9, "behavior": "chaser", "gait": "hop", "sprite": "assets/mobs/slime1.png", "sound": "squish", "gold": [1, 5], "lootChance": 0.3, "spawnChance": 0.4 },
        { "id": "giant_slime", "name": "Slime Géant", "hp": 95, "damage": 10, "xp": 28, "color": "#33cc55", "scale": 1.7, "speed": 0.8, "attackRange": 1.8, "attackRate": 0.02, "detect": 10, "behavior": "chaser", "gait": "hop", "sprite": "assets/mobs/slime2.png", "sound": "squish", "gold": [10, 24], "lootChance": 0.5, "spawnChance": 0.18 },
        { "id": "hell_slime", "name": "Slime Infernal", "hp": 40, "damage": 7, "xp": 18, "color": "#ff5a33", "scale": 0.95, "speed": 1.2, "attackRange": 1.3, "attackRate": 0.025, "detect": 11, "behavior": "chaser", "gait": "hop", "sprite": "assets/mobs/hell_slime.png", "sound": "squish", "gold": [6, 15], "lootChance": 0.45, "statusOnHit": { "type": "burn", "dps": 5, "duration": 3 }, "spawnChance": 0.28 },
        { "id": "zombie", "name": "Zombie", "hp": 58, "damage": 8, "xp": 17, "color": "#7a9a5a", "scale": 1.1, "speed": 0.85, "attackRange": 1.5, "attackRate": 0.02, "detect": 11, "behavior": "chaser", "sprite": "assets/mobs/zombie.png", "sound": "wail", "gold": [4, 13], "lootChance": 0.45, "statusOnHit": { "type": "poison", "dps": 3, "duration": 4 }, "spawnChance": 0.4 },
        { "id": "mummy", "name": "Momie", "hp": 64, "damage": 9, "xp": 22, "color": "#d8c89a", "scale": 1.15, "speed": 0.9, "attackRange": 1.6, "attackRate": 0.022, "detect": 11, "behavior": "chaser", "sprite": "assets/mobs/mummy.png", "sound": "wail", "gold": [8, 18], "lootChance": 0.5, "statusOnHit": { "type": "poison", "dps": 4, "duration": 5 }, "spawnChance": 0.3 },
        { "id": "spider", "name": "Araignée", "hp": 24, "damage": 6, "xp": 12, "color": "#a060d0", "scale": 0.9, "speed": 2.6, "attackRange": 1.3, "attackRate": 0.03, "detect": 14, "behavior": "chaser", "sprite": "assets/mobs/spider.png", "sound": "screech", "gold": [3, 10], "lootChance": 0.4, "statusOnHit": { "type": "poison", "dps": 4, "duration": 4 }, "spawnChance": 0.45 },
        { "id": "werewolf", "charger": true, "name": "Loup-garou", "hp": 70, "damage": 16, "xp": 34, "color": "#8a99b0", "scale": 1.3, "speed": 2.8, "attackRange": 1.7, "attackRate": 0.03, "detect": 16, "behavior": "chaser", "sprite": "assets/mobs/werewolf.png", "sound": "roar", "gold": [14, 30], "lootChance": 0.6, "statusOnHit": { "type": "bleed", "dps": 6, "duration": 4 }, "spawnChance": 0.25 },
        { "id": "gargoyle", "name": "Gargouille", "hp": 80, "damage": 13, "xp": 32, "color": "#9aa0a8", "scale": 1.35, "speed": 1.1, "attackRange": 1.8, "attackRate": 0.025, "detect": 13, "behavior": "chaser", "sprite": "assets/mobs/gargouille.png", "sound": "roar", "gold": [16, 34], "lootChance": 0.6, "spawnChance": 0.22 },
        { "id": "ghost", "name": "Spectre", "hp": 20, "damage": 9, "xp": 16, "color": "#aaccff", "scale": 1.15, "speed": 1.9, "attackRange": 1.6, "attackRate": 0.03, "detect": 14, "behavior": "phaser", "sprite": "assets/mobs/ghost.png", "sound": "wail", "gold": [5, 16], "lootChance": 0.5, "statusOnHit": { "type": "bleed", "dps": 3, "duration": 3 }, "spawnChance": 0.3 },
        { "id": "spectrum", "name": "Spectre Glacial", "hp": 28, "damage": 11, "xp": 22, "color": "#aaf0ff", "scale": 1.2, "speed": 2.1, "attackRange": 1.7, "attackRate": 0.03, "detect": 15, "behavior": "phaser", "sprite": "assets/mobs/spectrum.png", "sound": "wail", "gold": [8, 20], "lootChance": 0.55, "statusOnHit": { "type": "freeze", "dps": 2, "duration": 2 }, "spawnChance": 0.25 },
        { "id": "eye", "name": "Œil Flottant", "hp": 32, "damage": 11, "xp": 24, "color": "#ffd24d", "scale": 1.1, "speed": 1.4, "attackRange": 2.2, "attackRate": 0.03, "detect": 18, "behavior": "caster", "gait": "float", "sprite": "assets/mobs/eye.png", "sound": "wail", "gold": [10, 22], "lootChance": 0.55, "spawnChance": 0.3 },
        { "id": "thunder_elemental", "name": "Élémentaire de Foudre", "hp": 52, "damage": 14, "xp": 34, "color": "#7fdfff", "scale": 1.25, "speed": 1.7, "attackRange": 2.4, "attackRate": 0.03, "detect": 17, "behavior": "caster", "gait": "float", "sprite": "assets/mobs/thunder_elemental.png", "sound": "zap", "gold": [16, 36], "lootChance": 0.6, "spawnChance": 0.2 },
        { "id": "acid_skull", "name": "Crâne Acide", "hp": 28, "damage": 9, "xp": 16, "color": "#9aff66", "scale": 1.0, "speed": 1.8, "attackRange": 2.0, "attackRate": 0.03, "detect": 15, "behavior": "caster", "gait": "float", "sprite": "assets/mobs/acid_skull.png", "sound": "wail", "gold": [6, 16], "lootChance": 0.5, "statusOnHit": { "type": "poison", "dps": 5, "duration": 4 }, "spawnChance": 0.3 },
        { "id": "ancient_golem", "name": "Golem Ancien", "hp": 130, "damage": 17, "xp": 42, "color": "#9a8a6a", "scale": 1.5, "speed": 0.8, "attackRange": 2.0, "attackRate": 0.022, "detect": 12, "behavior": "chaser", "sprite": "assets/mobs/ancient_golem.png", "sound": "roar", "gold": [22, 44], "lootChance": 0.7, "spawnChance": 0.15 },
        { "id": "ancient_spectrum", "name": "Spectre Ancien", "hp": 34, "damage": 13, "xp": 26, "color": "#bfeaff", "scale": 1.2, "speed": 2.0, "attackRange": 1.7, "attackRate": 0.03, "detect": 16, "behavior": "phaser", "sprite": "assets/mobs/ancient_spectrum.png", "sound": "wail", "gold": [10, 24], "lootChance": 0.55, "statusOnHit": { "type": "freeze", "dps": 3, "duration": 2 }, "spawnChance": 0.22 },
        { "id": "archery_skeleton", "name": "Archer Squelette", "hp": 40, "damage": 13, "xp": 26, "color": "#d8d4b0", "scale": 1.1, "speed": 1.5, "attackRange": 2.6, "attackRate": 0.03, "detect": 18, "behavior": "caster", "sprite": "assets/mobs/archery_master_skeleton.png", "sound": "bones", "gold": [10, 24], "lootChance": 0.55, "spawnChance": 0.28 },
        { "id": "crystal_golem", "name": "Golem de Cristal", "hp": 105, "damage": 14, "xp": 38, "color": "#9fe0ff", "scale": 1.4, "speed": 0.9, "attackRange": 1.9, "attackRate": 0.022, "detect": 12, "behavior": "chaser", "sprite": "assets/mobs/crystal_golem.png", "sound": "roar", "gold": [20, 42], "lootChance": 0.7, "statusOnHit": { "type": "freeze", "dps": 2, "duration": 2 }, "spawnChance": 0.16 },
        { "id": "death_worm", "name": "Ver de la Mort", "hp": 50, "damage": 14, "xp": 28, "color": "#c08a6a", "scale": 1.1, "speed": 2.5, "attackRange": 1.6, "attackRate": 0.03, "detect": 14, "behavior": "chaser", "sprite": "assets/mobs/death_worm.png", "sound": "screech", "gold": [12, 26], "lootChance": 0.55, "statusOnHit": { "type": "poison", "dps": 4, "duration": 4 }, "spawnChance": 0.25 },
        { "id": "draugr", "name": "Draugr", "hp": 60, "damage": 12, "xp": 24, "color": "#8aa0a0", "scale": 1.15, "speed": 1.4, "attackRange": 1.7, "attackRate": 0.025, "detect": 13, "behavior": "chaser", "sprite": "assets/mobs/draugr.png", "sound": "bones", "gold": [10, 22], "lootChance": 0.55, "statusOnHit": { "type": "bleed", "dps": 4, "duration": 4 }, "spawnChance": 0.3 },
        { "id": "forest_golem", "name": "Golem Sylvestre", "hp": 100, "damage": 12, "xp": 36, "color": "#6aaa55", "scale": 1.4, "speed": 1.0, "attackRange": 1.9, "attackRate": 0.022, "detect": 12, "behavior": "chaser", "sprite": "assets/mobs/forest_golem.png", "sound": "roar", "gold": [18, 38], "lootChance": 0.65, "statusOnHit": { "type": "poison", "dps": 3, "duration": 4 }, "spawnChance": 0.18 },
        { "id": "fury", "charger": true, "name": "Furie", "hp": 54, "damage": 18, "xp": 32, "color": "#ff5577", "scale": 1.2, "speed": 2.9, "attackRange": 1.7, "attackRate": 0.032, "detect": 16, "behavior": "chaser", "gait": "float", "sprite": "assets/mobs/fury.png", "sound": "roar", "gold": [16, 34], "lootChance": 0.6, "statusOnHit": { "type": "bleed", "dps": 6, "duration": 4 }, "spawnChance": 0.22 },
        { "id": "lava_monster", "name": "Monstre de Lave", "hp": 64, "damage": 14, "xp": 30, "color": "#ff6622", "scale": 1.25, "speed": 1.2, "attackRange": 1.7, "attackRate": 0.026, "detect": 13, "behavior": "chaser", "sprite": "assets/mobs/lava_monster.png", "sound": "burn", "gold": [14, 32], "lootChance": 0.6, "statusOnHit": { "type": "burn", "dps": 6, "duration": 3 }, "spawnChance": 0.24 },
        { "id": "leech_fish", "coward": true, "name": "Sangsue", "hp": 26, "damage": 7, "xp": 12, "color": "#cc5577", "scale": 0.9, "speed": 2.7, "attackRange": 1.3, "attackRate": 0.03, "detect": 13, "behavior": "chaser", "sprite": "assets/mobs/leech_fish.png", "sound": "squish", "gold": [3, 10], "lootChance": 0.4, "statusOnHit": { "type": "bleed", "dps": 4, "duration": 3 }, "spawnChance": 0.3 },
        { "id": "mush", "name": "Champimort", "hp": 38, "damage": 6, "xp": 14, "color": "#cc88aa", "scale": 1.0, "speed": 0.9, "attackRange": 1.4, "attackRate": 0.022, "detect": 10, "behavior": "chaser", "sprite": "assets/mobs/mush.png", "sound": "squish", "gold": [4, 12], "lootChance": 0.4, "statusOnHit": { "type": "poison", "dps": 5, "duration": 5 }, "spawnChance": 0.35 },
        { "id": "plague_doctor", "name": "Médecin de Peste", "hp": 48, "damage": 12, "xp": 28, "color": "#6a8a6a", "scale": 1.2, "speed": 1.5, "attackRange": 2.3, "attackRate": 0.03, "detect": 16, "behavior": "caster", "sprite": "assets/mobs/plague_doctor.png", "sound": "wail", "gold": [12, 28], "lootChance": 0.6, "statusOnHit": { "type": "poison", "dps": 5, "duration": 5 }, "spawnChance": 0.24 },
        { "id": "poltergeist", "name": "Poltergeist", "hp": 28, "damage": 11, "xp": 20, "color": "#c0a0ff", "scale": 1.15, "speed": 2.2, "attackRange": 1.6, "attackRate": 0.03, "detect": 15, "behavior": "phaser", "sprite": "assets/mobs/poltergeist.png", "sound": "wail", "gold": [8, 20], "lootChance": 0.55, "spawnChance": 0.26 },
        { "id": "spikeye", "name": "Œil à Pics", "hp": 34, "damage": 12, "xp": 24, "color": "#ff8855", "scale": 1.1, "speed": 1.4, "attackRange": 2.2, "attackRate": 0.03, "detect": 18, "behavior": "caster", "gait": "float", "sprite": "assets/mobs/spikeye.png", "sound": "wail", "gold": [10, 24], "lootChance": 0.55, "statusOnHit": { "type": "bleed", "dps": 4, "duration": 3 }, "spawnChance": 0.26 },
        { "id": "spiking_bug", "name": "Insecte à Pics", "hp": 24, "damage": 8, "xp": 12, "color": "#88aa44", "scale": 0.85, "speed": 2.7, "attackRange": 1.3, "attackRate": 0.03, "detect": 14, "behavior": "chaser", "sprite": "assets/mobs/spiking_bug.png", "sound": "screech", "gold": [3, 10], "lootChance": 0.4, "statusOnHit": { "type": "bleed", "dps": 3, "duration": 3 }, "spawnChance": 0.32 },
        { "id": "thief_rat", "coward": true, "name": "Rat Voleur", "hp": 18, "damage": 5, "xp": 9, "color": "#a08866", "scale": 0.8, "speed": 3.2, "attackRange": 1.2, "attackRate": 0.035, "detect": 14, "behavior": "chaser", "sprite": "assets/mobs/thief_rat.png", "sound": "screech", "gold": [6, 18], "lootChance": 0.35, "spawnChance": 0.4 },
        { "id": "void_elemental", "name": "Élémentaire du Vide", "hp": 52, "damage": 15, "xp": 34, "color": "#c44dff", "scale": 1.25, "speed": 1.7, "attackRange": 2.4, "attackRate": 0.03, "detect": 17, "behavior": "caster", "gait": "float", "sprite": "assets/mobs/void_elemental.png", "sound": "woosh", "gold": [16, 36], "lootChance": 0.6, "spawnChance": 0.2 },
        { "id": "water_elemental", "name": "Élémentaire d'Eau", "hp": 48, "damage": 12, "xp": 30, "color": "#5fc8ff", "scale": 1.2, "speed": 1.6, "attackRange": 2.3, "attackRate": 0.03, "detect": 16, "behavior": "caster", "gait": "float", "sprite": "assets/mobs/water_elemental.png", "sound": "woosh", "gold": [14, 32], "lootChance": 0.6, "statusOnHit": { "type": "freeze", "dps": 2, "duration": 2.5 }, "spawnChance": 0.22 },
        { "id": "rune_warden", "name": "Sentinelle Runique", "hp": 76, "damage": 14, "xp": 34, "color": "#4deeea", "scale": 1.25, "speed": 1.2, "attackRange": 1.9, "attackRate": 0.026, "detect": 14, "behavior": "chaser", "sprite": "assets/mobs/rune_warden.png", "sound": "bones", "gold": [14, 34], "lootChance": 0.62, "statusOnHit": { "type": "freeze", "dps": 2, "duration": 2 }, "spawnChance": 0.24 },
        { "id": "bone_archer", "name": "Archer d'Os", "hp": 38, "damage": 12, "xp": 24, "color": "#e2dabc", "scale": 1.05, "speed": 1.25, "attackRange": 2.8, "attackRate": 0.032, "detect": 19, "behavior": "caster", "ranged": true, "projColor": "#e8d18a", "projSpeed": 13, "projChance": 0.95, "sprite": "assets/mobs/bone_archer.png", "sound": "bones", "gold": [8, 22], "lootChance": 0.52, "spawnChance": 0.28 },
        { "id": "ember_imp", "name": "Diablotin de Braise", "hp": 30, "damage": 9, "xp": 18, "color": "#ff6622", "scale": 0.95, "speed": 2.6, "attackRange": 1.35, "attackRate": 0.034, "detect": 15, "behavior": "chaser", "gait": "hop", "sprite": "assets/mobs/ember_imp.png", "sound": "burn", "gold": [6, 18], "lootChance": 0.45, "statusOnHit": { "type": "burn", "dps": 5, "duration": 3 }, "spawnChance": 0.34 },
        { "id": "void_acolyte", "name": "Acolyte du Vide", "hp": 44, "damage": 13, "xp": 30, "color": "#c44dff", "scale": 1.1, "speed": 1.35, "attackRange": 2.5, "attackRate": 0.03, "detect": 18, "behavior": "caster", "ranged": true, "gait": "float", "projColor": "#c44dff", "projSpeed": 10, "projChance": 1, "sprite": "assets/mobs/void_acolyte.png", "sound": "woosh", "gold": [12, 30], "lootChance": 0.58, "statusOnHit": { "type": "bleed", "dps": 3, "duration": 3 }, "spawnChance": 0.24 },
        { "id": "blood_knight", "charger": true, "name": "Chevalier Sanglant", "hp": 92, "damage": 18, "xp": 42, "color": "#d9223e", "scale": 1.25, "speed": 1.55, "attackRange": 1.8, "attackRate": 0.028, "detect": 15, "behavior": "chaser", "sprite": "assets/mobs/blood_knight.png", "sound": "roar", "gold": [18, 40], "lootChance": 0.72, "statusOnHit": { "type": "bleed", "dps": 7, "duration": 4 }, "spawnChance": 0.18 }
    ],

    // --- BOSS (plusieurs ; choisis selon le biome / la profondeur) ---
    "bosses": [
        {
            "id": "guardian", "name": "Gardien Asgardien", "hp": 320, "damage": 18, "xp": 200,
            "color": "#ffffff", "scale": 1.8, "speed": 1.3, "attackRange": 2.6, "attackRate": 0.03, "detect": 30,
            "sprite": "assets/mobs/guardian.png", "sound": "roar", "gold": [120, 220],
            "lootChance": 1, "lootRolls": 3, "enrageAt": 0.35,
            "abilities": [
                { "id": "slam", "name": "Choc Sismique", "cooldown": 6, "damage": 25, "range": 4 },
                { "id": "summon", "name": "Invocation", "cooldown": 12, "count": 2 }
            ]
        },
        {
            "id": "frost_queen", "name": "Reine de Givre", "hp": 380, "damage": 16, "xp": 240,
            "color": "#aaddff", "scale": 1.7, "speed": 1.5, "attackRange": 2.4, "attackRate": 0.03, "detect": 30,
            "sprite": "assets/mobs/frost_queen.png", "sound": "shatter", "gold": [140, 240],
            "lootChance": 1, "lootRolls": 3, "enrageAt": 0.35,
            "abilities": [
                { "id": "slam", "name": "Explosion de Givre", "cooldown": 5, "damage": 22, "range": 4.5 },
                { "id": "summon", "name": "Eclats Vivants", "cooldown": 11, "count": 3 }
            ]
        },
        {
            "id": "infernal_smith", "name": "Forgeron Infernal", "hp": 440, "damage": 22, "xp": 300,
            "color": "#ff7744", "scale": 2.0, "speed": 1.2, "attackRange": 2.8, "attackRate": 0.035, "detect": 30,
            "sprite": "assets/mobs/infernal_smith.png", "sound": "roar", "gold": [180, 300],
            "lootChance": 1, "lootRolls": 4, "enrageAt": 0.4,
            "abilities": [
                { "id": "slam", "name": "Marteau Sismique", "cooldown": 5, "damage": 30, "range": 4 },
                { "id": "summon", "name": "Braises", "cooldown": 10, "count": 2 }
            ]
        },
        {
            "id": "diablo", "name": "Diablo", "hp": 520, "damage": 26, "xp": 360,
            "color": "#ff5544", "scale": 2.1, "speed": 1.4, "attackRange": 2.8, "attackRate": 0.035, "detect": 32,
            "sprite": "assets/mobs/diablo.png", "sound": "roar", "gold": [220, 360],
            "lootChance": 1, "lootRolls": 4, "enrageAt": 0.4,
            "abilities": [
                { "id": "slam", "name": "Faille Infernale", "cooldown": 4.5, "damage": 34, "range": 4.5 },
                { "id": "summon", "name": "Légion", "cooldown": 9, "count": 3 }
            ]
        },
        {
            "id": "void_diablo", "name": "Diablo du Vide", "hp": 640, "damage": 30, "xp": 440,
            "color": "#c44dff", "scale": 2.2, "speed": 1.5, "attackRange": 2.9, "attackRate": 0.035, "detect": 34,
            "sprite": "assets/mobs/void_diablo.png", "sound": "roar", "gold": [280, 460],
            "lootChance": 1, "lootRolls": 5, "enrageAt": 0.4,
            "abilities": [
                { "id": "slam", "name": "Effondrement du Vide", "cooldown": 4, "damage": 38, "range": 5 },
                { "id": "summon", "name": "Horde du Néant", "cooldown": 8, "count": 4 }
            ]
        }
    ],

    // --- SORTS / SKILLS ---
    "spells": [
        { "id": "rune", "unlockLevel": 1, "name": "Rune", "type": "bolt", "damage": 12, "manaCost": 6, "color": "#4deeea", "cooldown": 0.35, "speed": 14, "lifetime": 2.0, "radius": 1.0, "icon": "ᚱ", "sound": "zap", "sprite": "assets/items/spell_rune.png", "fx": { "type": "sheet", "src": "assets/fx/rune_spell_sheet.png", "cols": 4, "rows": 1, "fps": 14 }, "fxScale": 0.75, "desc": "Eclat runique rapide." },
        { "id": "void", "unlockLevel": 2, "name": "Vide", "type": "pierce", "damage": 18, "manaCost": 14, "color": "#aa00ff", "cooldown": 0.8, "speed": 11, "lifetime": 2.2, "radius": 1.1, "icon": "◇", "sound": "woosh", "sprite": "assets/items/spell_void.png", "fx": { "type": "sheet", "src": "assets/fx/void_spell_sheet.png", "cols": 4, "rows": 1, "fps": 12 }, "fxScale": 0.85, "desc": "Transperce les ennemis alignes." },
        { "id": "fire", "unlockLevel": 3, "name": "Foudre-Feu", "type": "aoe", "damage": 22, "manaCost": 22, "color": "#ffaa00", "cooldown": 1.4, "speed": 9, "lifetime": 2.5, "radius": 2.6, "icon": "⚡", "sound": "burn", "sprite": "assets/items/spell_fire.png", "fx": { "type": "sheet", "src": "assets/fx/fire_spell_sheet.png", "cols": 4, "rows": 1, "fps": 13 }, "fxScale": 0.95, "fxImpactScale": 1.45, "status": { "type": "burn", "dps": 6, "duration": 3 }, "desc": "Explose et enflamme." },
        { "id": "frost_nova", "unlockLevel": 4, "name": "Nova de Givre", "type": "nova", "damage": 16, "manaCost": 30, "color": "#7fdfff", "cooldown": 3.0, "speed": 0, "lifetime": 0.4, "radius": 4.5, "icon": "❄", "sound": "shatter", "sprite": "assets/items/spell_frost.png", "fx": { "type": "sheet", "src": "assets/fx/frost_nova_sheet.png", "cols": 4, "rows": 1, "fps": 12 }, "fxScale": 1.8, "status": { "type": "freeze", "dps": 2, "duration": 2.5 }, "desc": "Vague de givre, gèle." },
        { "id": "heal", "unlockLevel": 1, "name": "Soin", "type": "heal", "heal": 45, "manaCost": 25, "color": "#3ee85e", "cooldown": 2.5, "icon": "✚", "sound": "heal", "desc": "Restaure des PV.", "sprite": "assets/items/spell_holy.png", "fx": { "type": "sheet", "src": "assets/fx/heal_spell_sheet.png", "cols": 4, "rows": 1, "fps": 12 }, "fxScale": 1.25 },
        { "id": "chain_lightning", "unlockLevel": 6, "name": "Chaîne d'Éclairs", "type": "chain", "damage": 20, "manaCost": 28, "color": "#78ebff", "cooldown": 2.2, "radius": 7, "jumps": 5, "icon": "ϟ", "sound": "zap", "sprite": "assets/items/spell_chain.png", "fx": { "type": "sheet", "src": "assets/fx/chain_spell_sheet.png", "cols": 4, "rows": 1, "fps": 16 }, "fxScale": 0.8, "desc": "Bondit entre plusieurs ennemis proches." },
        { "id": "blood_pact", "unlockLevel": 7, "name": "Pacte Sanglant", "type": "bolt", "damage": 34, "manaCost": 16, "color": "#d9223e", "cooldown": 1.1, "speed": 12, "lifetime": 2.2, "radius": 1.0, "icon": "♦", "sound": "wail", "status": { "type": "bleed", "dps": 8, "duration": 4 }, "sprite": "assets/items/spell_blood.png", "fx": { "type": "sheet", "src": "assets/fx/blood_spell_sheet.png", "cols": 4, "rows": 1, "fps": 12 }, "fxScale": 0.9, "desc": "Projectile brutal qui fait saigner." },
        { "id": "stone_skin", "unlockLevel": 5, "name": "Peau de Pierre", "type": "buff", "manaCost": 24, "color": "#a0aaa0", "cooldown": 8, "radius": 1.8, "icon": "◆", "sound": "shatter", "sprite": "assets/items/spell_stone.png", "fx": { "type": "sheet", "src": "assets/fx/stone_skin_sheet.png", "cols": 4, "rows": 1, "fps": 10 }, "fxScale": 1.35, "buff": { "stat": "defense", "amount": 16, "duration": 18 }, "log": "Ta peau devient pierre.", "desc": "Augmente fortement l'armure pendant 18 s." },
        { "id": "poison_cloud", "unlockLevel": 8, "name": "Nuage Toxique", "type": "aoe", "damage": 14, "manaCost": 30, "color": "#64e646", "cooldown": 2.4, "speed": 7, "lifetime": 2.8, "radius": 3.2, "icon": "☣", "sound": "woosh", "sprite": "assets/items/spell_poison.png", "fx": { "type": "sheet", "src": "assets/fx/poison_spell_sheet.png", "cols": 4, "rows": 1, "fps": 10 }, "fxScale": 1.0, "fxImpactScale": 1.55, "status": { "type": "poison", "dps": 8, "duration": 5 }, "desc": "Explose en nappe de poison." },
        { "id": "shadow_veil", "unlockLevel": 9, "name": "Voile d'Ombre", "type": "buff", "manaCost": 22, "color": "#9842ff", "cooldown": 7, "radius": 2.0, "icon": "◈", "sound": "woosh", "sprite": "assets/items/spell_shadow.png", "fx": { "type": "sheet", "src": "assets/fx/shadow_veil_sheet.png", "cols": 4, "rows": 1, "fps": 12 }, "fxScale": 1.45, "buff": { "stat": "speed", "amount": 0.35, "duration": 8 }, "log": "Le voile d'ombre accélère tes pas.", "desc": "Accélère fortement les déplacements pendant 8 s." },
        { "id": "arcane_ray", "unlockLevel": 10, "name": "Rayon Arcanique", "type": "beam", "damage": 26, "manaCost": 26, "color": "#4deeea", "cooldown": 1.6, "range": 15, "icon": "≡", "sound": "zap", "fx": { "type": "sheet", "src": "assets/fx/rune_spell_sheet.png", "cols": 4, "rows": 1, "fps": 14 }, "fxScale": 0.8, "desc": "Rayon instantane qui perce tout sur la ligne de visee." },
        { "id": "fire_wall", "unlockLevel": 11, "name": "Mur de Flammes", "type": "zone", "damage": 18, "manaCost": 34, "color": "#ff7722", "cooldown": 6, "range": 7, "radius": 2.4, "duration": 7, "icon": "☲", "sound": "burn", "fx": { "type": "sheet", "src": "assets/fx/fire_spell_sheet.png", "cols": 4, "rows": 1, "fps": 12 }, "fxScale": 1.2, "status": { "type": "burn", "dps": 7, "duration": 3 }, "desc": "Nappe de feu persistante qui brule quiconque la traverse." },
        { "id": "holy_ward", "unlockLevel": 12, "name": "Egide Sacree", "type": "ward", "ward": 55, "duration": 14, "manaCost": 38, "color": "#ffd24d", "cooldown": 12, "icon": "◈", "sound": "heal", "fx": { "type": "sheet", "src": "assets/fx/holy_spell_sheet.png", "cols": 4, "rows": 1, "fps": 12 }, "fxScale": 1.4, "desc": "Bouclier sacre qui absorbe les degats a ta place." },
        { "id": "meteor", "unlockLevel": 13, "name": "Meteore", "type": "meteor", "damage": 46, "manaCost": 44, "color": "#ff8830", "cooldown": 5, "range": 11, "radius": 3.2, "delay": 0.85, "icon": "☄", "sound": "burn", "fx": { "type": "sheet", "src": "assets/fx/fire_spell_sheet.png", "cols": 4, "rows": 1, "fps": 13 }, "fxImpactScale": 1.7, "status": { "type": "burn", "dps": 8, "duration": 3 }, "desc": "Frappe celeste differee sur la zone visee." },
        { "id": "spirit_guardian", "unlockLevel": 14, "name": "Esprit Gardien", "type": "summon", "damage": 12, "manaCost": 46, "color": "#8fd8ff", "cooldown": 14, "duration": 16, "fireRate": 1.0, "maxAllies": 2, "icon": "♟", "sound": "heal", "fx": { "type": "sheet", "src": "assets/fx/holy_spell_sheet.png", "cols": 4, "rows": 1, "fps": 12 }, "fxScale": 1.1, "log": "Un esprit gardien repond a ton appel.", "desc": "Invoque un esprit qui orbite et mitraille tes ennemis." },
        { "id": "soul_drain", "unlockLevel": 15, "name": "Drain d'Ame", "type": "beam", "damage": 22, "drain": 0.5, "manaCost": 30, "color": "#d9223e", "cooldown": 2.4, "range": 12, "icon": "☠", "sound": "wail", "fx": { "type": "sheet", "src": "assets/fx/blood_spell_sheet.png", "cols": 4, "rows": 1, "fps": 12 }, "fxScale": 0.85, "status": { "type": "bleed", "dps": 6, "duration": 3 }, "desc": "Rayon qui draine la vie des ennemis vers toi." }
    ],

    "environment": {
        "floor": "assets/textures/floor.png",
        "wall": "assets/textures/wall.png",
        "skyColor": "#050505",
        "fogColor": "#0c0c14",
        "fov": 50,
        "pixelation": 88,
        "weaponY": 0,
        "normalStrength": 0.1,
        "bloomStrength": 0.85,
        "bloomRadius": 0.5,
        "bloomThreshold": 0.65
    },

    // --- BONUS DE CLASSE (un par nom de perso, déterministe) ---
    "bonuses": [
        { "id": "berserk", "name": "Berserker", "desc": "+7 dégâts", "stats": { "damage": 7 } },
        { "id": "archimage", "name": "Archimage", "desc": "+9 magie, +25 mana", "stats": { "spellPower": 9, "bonusMaxMana": 25 } },
        { "id": "colosse", "name": "Colosse", "desc": "+55 PV, +5 armure", "stats": { "bonusMaxHp": 55, "defense": 5 } },
        { "id": "assassin", "name": "Assassin", "desc": "+12% crit, +2 furtivité", "stats": { "crit": 0.12, "stealth": 2 } },
        { "id": "funambule", "name": "Funambule", "desc": "+15% vitesse, +parade", "stats": { "speed": 0.15, "parry": 0.08 } },
        { "id": "vampire", "name": "Vampire", "desc": "+9% vol de vie", "stats": { "lifesteal": 0.09 } },
        { "id": "chanceux", "name": "Chanceux", "desc": "meilleur butin, +10% XP", "stats": { "xpBonus": 0.1 }, "lootBoost": 1 },
        { "id": "elementaliste", "name": "Élémentaliste", "desc": "+5 magie, +regen mana", "stats": { "spellPower": 5, "manaRegen": 5 } },
        { "id": "gladiateur", "name": "Gladiateur", "desc": "+5 dégâts, +12% blocage", "stats": { "damage": 5, "block": 0.12 } },
        { "id": "sniper", "name": "Tireur d'élite", "desc": "+5 dégâts, +10% crit", "stats": { "damage": 5, "crit": 0.1 } }
    ],

    // --- EFFETS DE STATUT (DoT / ralentissement) ---
    "statusDefs": [
        { "type": "burn", "color": "#ff7722", "tick": 0.5, "icon": "🔥", "label": "Brûlure" },
        { "type": "poison", "color": "#66dd33", "tick": 0.7, "icon": "☠", "label": "Poison" },
        { "type": "bleed", "color": "#dd2222", "tick": 0.4, "icon": "🩸", "label": "Saignement" },
        { "type": "freeze", "color": "#88ddff", "tick": 1.0, "icon": "❄", "label": "Givre", "slow": true }
    ],

    // --- BIOMES (selectionnes selon la profondeur ; teintent murs/sol/brouillard/lumiere) ---
    "biomes": [
        { "id": "crypt",  "name": "Crypte",  "wallTint": "#8a8a8a", "floorTint": "#9a9a9a", "fogColor": "#0c0c16", "ambient": "#282840", "ambientI": 0.5,  "light": "#ffaa44", "rune": "#4deeea", "wallTex": "assets/textures/crypt_wall.png", "floorTex": "assets/textures/crypt_floor.png", "boss": "guardian",       "monsters": ["skeleton", "draugr", "zombie", "archery_skeleton", "ghost"] },
        { "id": "ice",    "name": "Glacier", "wallTint": "#9ab4d4", "floorTint": "#a6c0d8", "fogColor": "#0a1622", "ambient": "#2a3a58", "ambientI": 0.6,  "light": "#bfe6ff", "rune": "#7fdfff", "wallTex": "assets/textures/ice_wall.png", "floorTex": "assets/textures/ice_floor.png", "boss": "frost_queen",    "monsters": ["ancient_spectrum", "crystal_golem", "water_elemental", "mummy", "spectrum"] },
        { "id": "forge",  "name": "Forge",   "wallTint": "#b87a52", "floorTint": "#8a5a3a", "fogColor": "#180a06", "ambient": "#48241a", "ambientI": 0.55, "light": "#ff8844", "rune": "#ffaa33", "floorTex": "assets/textures/forge_floor.png", "boss": "diablo",         "monsters": ["lava_monster", "hell_slime", "fury", "werewolf", "thunder_elemental"] },
        { "id": "void",   "name": "Néant",   "wallTint": "#9a7ab0", "floorTint": "#6a5a82", "fogColor": "#0a0816", "ambient": "#2c1846", "ambientI": 0.55, "light": "#c060ff", "rune": "#c44dff", "boss": "void_diablo",    "monsters": ["poltergeist", "void_elemental", "acid_skull", "spikeye", "ancient_spectrum"] },
        { "id": "toxic",  "name": "Marais",  "wallTint": "#84a06a", "floorTint": "#6a8a52", "fogColor": "#0a1408", "ambient": "#2c4424", "ambientI": 0.5,  "light": "#9aff66", "rune": "#88ff88", "wallTex": "assets/textures/toxic_wall.png", "floorTex": "assets/textures/toxic_floor.png", "boss": "infernal_smith", "monsters": ["mush", "plague_doctor", "spider", "leech_fish", "giant_slime"] },
        { "id": "ossuary", "name": "Ossuaire", "wallTint": "#7f8f8f", "floorTint": "#c2b896", "fogColor": "#100e12", "ambient": "#2d2732", "ambientI": 0.52, "light": "#d8d2bf", "rune": "#4deeea", "wallTex": "assets/textures/rune_wall.png", "floorTex": "assets/textures/ossuary_floor.png", "boss": "guardian", "monsters": ["bone_archer", "blood_knight", "rune_warden", "skeleton", "fighter_skeleton"] },
        { "id": "ember", "name": "Fournaise", "wallTint": "#bf6a48", "floorTint": "#7c3c2e", "fogColor": "#160706", "ambient": "#4a1f16", "ambientI": 0.55, "light": "#ff7733", "rune": "#ffaa33", "wallTex": "assets/textures/ember_wall.png", "boss": "infernal_smith", "monsters": ["ember_imp", "lava_monster", "hell_slime", "fury", "thunder_elemental"] },
        { "id": "deep_void", "name": "Abîme", "wallTint": "#70559a", "floorTint": "#40305d", "fogColor": "#05040f", "ambient": "#21123d", "ambientI": 0.5, "light": "#a050ff", "rune": "#c44dff", "wallTex": "assets/textures/deep_void_wall.png", "floorTex": "assets/textures/void_floor.png", "boss": "void_diablo", "monsters": ["void_acolyte", "void_elemental", "poltergeist", "spikeye", "ancient_spectrum"] }
    ],

    // --- OBJETS DU MONDE ---
    "objects": [
        { "id": "chest_common", "name": "Coffre", "type": "chest", "sprite": "assets/sprites/chest_closed.png", "spriteOpen": "assets/sprites/chest_opened.png", "scale": 0.8, "lootRolls": 2, "goldMin": 10, "goldMax": 40 },
        { "id": "chest_rare", "name": "Coffre Runique", "type": "chest", "sprite": "assets/sprites/chest_closed.png", "spriteOpen": "assets/sprites/chest_opened.png", "scale": 0.95, "lootRolls": 3, "goldMin": 40, "goldMax": 100, "rarityBoost": 1 },
        { "id": "chest_cursed", "name": "Coffre Maudit", "type": "chest", "sprite": "assets/mobs/cursed_chest.png", "spriteOpen": "assets/sprites/chest_opened.png", "scale": 1.0, "lootRolls": 3, "goldMin": 60, "goldMax": 140, "rarityBoost": 2 },
        { "id": "barrel", "name": "Tonneau", "type": "breakable", "sprite": "assets/objects/barrel_sprite.png", "scale": 0.7, "lootRolls": 1, "goldMin": 2, "goldMax": 15 },
        { "id": "cursed_lantern", "name": "Lanterne Maudite", "type": "breakable", "sprite": "assets/mobs/cursed_lantern.png", "scale": 0.9, "lootRolls": 1, "goldMin": 5, "goldMax": 25, "rarityBoost": 1 },
        { "id": "shrine", "name": "Sanctuaire", "type": "breakable", "sprite": "assets/mobs/shrine.png", "scale": 1.1, "lootRolls": 2, "goldMin": 20, "goldMax": 60, "rarityBoost": 1 },
        { "id": "totem", "name": "Totem", "type": "breakable", "sprite": "assets/mobs/totem.png", "scale": 1.0, "lootRolls": 1, "goldMin": 8, "goldMax": 30 }
    ],

    // --- DONJON ---
    "dungeon": {
        "size": 44,            // taille de la grille (cellules)
        "roomsMin": 7,
        "roomsMax": 11,
        "roomMin": 5,
        "roomMax": 11,
        "mobsPerFloorBase": 7, // + depth
        "chestsPerFloor": 3,
        "trapProps": ["bones", "rock"],
        "trapPropChance": 0.18
    },

    // --- MODELES 3D des props (glTF/GLB par chemin ; certains props restent procéduraux) ---
    "propModels": {
        "barrel": "assets/props/barrel.glb", "crate": "assets/props/crate.glb",
        "table": "assets/props/table.glb", "chair": "assets/props/chair.glb",
        "wardrobe": "assets/props/wardrobe.glb", "cage": "assets/props/cage.glb",
        "skull": "assets/props/skull.glb", "bones": "assets/props/bones.glb",
        "rock": "assets/props/rock.glb"
    },
    "propTextures": {},
    // Taille cible (dimension max, en unités monde) à laquelle le modèle est mis à l'échelle
    "propScales": {
        "barrel": 0.7, "crate": 0.7, "table": 1.25, "chair": 0.95,
        "wardrobe": 1.85, "cage": 1.35, "skull": 0.32, "bones": 0.6, "rock": 0.5
    },
    // Rotation Y de base (degrés) par prop - pour orienter les modèles (ex: porte d'armoire)
    "propRotations": {},

    // --- AUDIO par défaut (musique + sons par catégorie / par sort) ---
    "audio": {
        "music": "assets/audio/ambience.mp3",
        "sfx": {
            "weapon": "assets/audio/metal_slash.mp3",
            "weapon.sword": "assets/audio/sword.wav",
            "block": "assets/audio/shield_block.mp3",
            "spell_impact": "assets/audio/spell_impact.mp3",
            "spell.heal.cast": "assets/audio/heal_cast.mp3",
            "step.player": "assets/audio/step.mp3",
            "step.heavy": "assets/audio/step_heavy.mp3",
            "container": "assets/audio/door.mp3",
            "bat": "assets/audio/bat.mp3"
        }
    }
};

// Boss "actif" par defaut (compat : etat initial). Le jeu choisit le boss par etage.
GameData.boss = GameData.bosses[0];

// Copie figee du contenu par defaut (avant toute surcharge Forge)
export const DEFAULT_GAME_DATA = JSON.parse(JSON.stringify(GameData));

// --- Chargement d'un projet cree dans la Forge (forge.html) ---
export const FORGE_KEY = 'bjorn_forge_project';

// Applique un projet Forge (deja parse) par-dessus GameData.
function applyForgeProject(proj) {
    ['rarities', 'items', 'monsters', 'spells', 'bosses', 'environment', 'objects', 'dungeon', 'biomes', 'uniques', 'bonuses', 'statusDefs'].forEach(k => {
        if (proj[k] !== undefined) GameData[k] = proj[k];
    });
    // Assets lourds : FUSION par clé (le projet surcharge, mais une valeur
    // VIDE ne supprime pas le défaut - évite qu'un champ effacé masque l'asset fourni).
    const mergeAssets = (base, over) => {
        const o = { ...(base || {}) };
        for (const k in (over || {})) {
            const v = over[k];
            if (typeof v === 'string' && !v.trim()) continue;
            if (Array.isArray(v) && !v.length) continue;
            o[k] = v;
        }
        return o;
    };
    if (proj.propModels) GameData.propModels = mergeAssets(GameData.propModels, proj.propModels);
    if (proj.propTextures) GameData.propTextures = mergeAssets(GameData.propTextures, proj.propTextures);
    if (proj.propScales) GameData.propScales = mergeAssets(GameData.propScales, proj.propScales);
    if (proj.propRotations) GameData.propRotations = mergeAssets(GameData.propRotations, proj.propRotations);
    if (proj.audio) {
        const baseAudio = GameData.audio || {};
        const pm = proj.audio.music;
        const hasMusic = Array.isArray(pm) ? pm.length > 0 : (pm && pm.trim());
        GameData.audio = {
            ...baseAudio, ...proj.audio,
            music: hasMusic ? pm : (baseAudio.music || ''),
            sfx: mergeAssets(baseAudio.sfx, proj.audio.sfx)
        };
    }
    // Garde-fous pour les projets d'un ANCIEN schema (sinon crash a l'init)
    if (!Array.isArray(GameData.bosses) || !GameData.bosses.length) GameData.bosses = proj.boss ? [proj.boss] : DEFAULT_GAME_DATA.bosses;
    if (!Array.isArray(GameData.biomes) || !GameData.biomes.length) GameData.biomes = DEFAULT_GAME_DATA.biomes;
    GameData.biomes.forEach(b => { if (Array.isArray(b.props)) b.props = b.props.filter(x => x !== 'gem'); });
    if (!Array.isArray(GameData.monsters) || !GameData.monsters.length) GameData.monsters = DEFAULT_GAME_DATA.monsters;
    if (!GameData.rarities || !Object.keys(GameData.rarities).length) GameData.rarities = DEFAULT_GAME_DATA.rarities;
}

try {
    // 1) Disque (serveur node) : source de verite, projet embarque dans project.js
    if (ForgeProject && typeof ForgeProject === 'object') {
        applyForgeProject(ForgeProject);
        console.info('[Bjorn] Projet Forge charge depuis le disque (project.js).');
    } else if (typeof localStorage !== 'undefined') {
        // 2) Repli : navigateur seul (ex: python http.server, pas de backend)
        const saved = localStorage.getItem(FORGE_KEY);
        if (saved) {
            applyForgeProject(JSON.parse(saved));
            console.info('[Bjorn] Projet Forge charge depuis localStorage (repli hors serveur).');
        }
    }
} catch (e) {
    console.warn('[Bjorn] Echec chargement projet Forge :', e);
}

// Garantit toujours un boss "actif" valide (utilise par l'etat initial)
if (!Array.isArray(GameData.bosses) || !GameData.bosses.length) GameData.bosses = DEFAULT_GAME_DATA.bosses;
GameData.boss = GameData.bosses[0];

// --- Helpers raretes ---
export function rollRarity(boost = 0) {
    const entries = Object.entries(GameData.rarities);
    // boost : decale la probabilite vers les raretes superieures
    const total = entries.reduce((s, [, r]) => s + (r.weight || 1), 0);
    let roll = Math.random() * total;
    for (let i = 0; i < entries.length; i++) {
        const [key, r] = entries[i];
        roll -= (r.weight || 1);
        if (roll <= 0) {
            const idx = Math.min(entries.length - 1, i + boost);
            return entries[idx][0];
        }
    }
    return entries[0][0];
}

export function rarityColor(key) {
    return (GameData.rarities[key] || Object.values(GameData.rarities)[0]).color;
}
export function rarityName(key) {
    return (GameData.rarities[key] || Object.values(GameData.rarities)[0]).name;
}
