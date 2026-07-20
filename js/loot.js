import { GameData, rollRarity, rarityName } from './data.js';
import { gameState } from './state.js';
import { itemPowerMultiplier, lootLevel, lootTier } from './scaling.js';

// =====================================================================
//  LOOT - generation d'items a stats aleatoires selon la rarete.
//  Plus c'est rare, plus il y a d'affixes et plus ils sont puissants.
// =====================================================================

// Pool d'affixes : base = valeur de reference (a x mult de rarete) ; pct = pourcentage
const AFFIXES = [
    { key: 'damage',      label: 'Degats',      base: 4,    for: ['weapon'] },
    { key: 'defense',     label: 'Armure',      base: 3,    for: ['armor', 'shield'] },
    { key: 'maxHp',       label: 'PV',          base: 14,   for: ['armor', 'shield', 'jewel'] },
    { key: 'maxMana',     label: 'Mana',        base: 12,   for: ['weapon', 'jewel'] },
    { key: 'spellPower',  label: 'Magie',       base: 5,    for: ['weapon', 'jewel'] },
    { key: 'crit',        label: 'Crit',        base: 0.03, pct: true, for: ['weapon', 'jewel', 'gloves'] },
    { key: 'attackSpeed', label: 'Vit.Att',     base: 0.05, pct: true, for: ['weapon', 'gloves'] },
    { key: 'speed',       label: 'Vitesse',     base: 0.04, pct: true, for: ['armor', 'jewel', 'boots'] },
    { key: 'block',       label: 'Blocage',     base: 0.04, pct: true, for: ['shield', 'armor'] },
    { key: 'parry',       label: 'Parade',      base: 0.04, pct: true, for: ['weapon', 'jewel'] },
    { key: 'stealth',     label: 'Furtivite',   base: 1,    for: ['armor', 'cape', 'jewel'] },
    { key: 'lifesteal',   label: 'Vol de vie',  base: 0.03, pct: true, for: ['weapon', 'jewel'] },
    { key: 'manaRegen',   label: 'Regen Mana',  base: 2,    for: ['jewel', 'weapon'] },
    { key: 'xpBonus',     label: 'Gain XP',     base: 0.05, pct: true, for: ['jewel', 'cape'] }
];

const ARMOR_TYPES = ['helmet', 'chest', 'legs', 'boots', 'belt', 'gloves', 'cape'];

// Préfixes (adjectif) : tier 1=bas, 3=haut. Donnent stats (+ parfois effet/special).
const PREFIXES = [
    { name: 'Simple', tier: 1, stats: {} },
    { name: 'en Bois', tier: 1, stats: {} },
    { name: 'Rouillée', tier: 1, stats: { damage: 1 } },
    { name: 'Usée', tier: 1, stats: { maxHp: 5 } },
    { name: 'Solide', tier: 1, stats: { defense: 1, maxHp: 8 } },
    { name: 'Acérée', tier: 2, stats: { damage: 3, attackSpeed: 0.04 } },
    { name: 'Runique', tier: 2, stats: { spellPower: 4, maxMana: 10 } },
    { name: 'Robuste', tier: 2, stats: { maxHp: 18, defense: 3 } },
    { name: 'Véloce', tier: 2, stats: { speed: 0.05, attackSpeed: 0.05 } },
    { name: 'Chatoyante', tier: 2, stats: { spellPower: 3, xpBonus: 0.06 } },
    { name: 'Sanglante', tier: 2, stats: { damage: 2 }, status: { type: 'bleed', dps: 5, duration: 4 } },
    { name: 'Glaciale', tier: 2, stats: { spellPower: 3 }, status: { type: 'freeze', dps: 2, duration: 2 } },
    { name: 'Ardente', tier: 2, stats: { damage: 3 }, status: { type: 'burn', dps: 6, duration: 3 } },
    { name: 'Redoutable', tier: 3, stats: { damage: 6, crit: 0.06 } },
    { name: 'Puissante', tier: 3, stats: { damage: 5, crit: 0.05 }, special: { explode: true } },
    { name: 'Légendaire', tier: 3, stats: { damage: 4, spellPower: 4, maxHp: 20 } },
    { name: 'Sombre', tier: 3, stats: { crit: 0.05 }, status: { type: 'poison', dps: 6, duration: 5 } }
];
// Suffixes ("du/de X") : flavor + souvent un effet marquant.
const SUFFIXES = [
    { name: 'du Pêcheur', tier: 1, stats: {} },
    { name: 'du Dragon', tier: 2, stats: { damage: 4 }, status: { type: 'burn', dps: 8, duration: 4 } },
    { name: 'de l\'Oracle', tier: 2, stats: { spellPower: 6, xpBonus: 0.08 } },
    { name: 'du Seigneur Vampire', tier: 2, stats: { lifesteal: 0.06 }, status: { type: 'bleed', dps: 6, duration: 4 } },
    { name: 'de la Tempête', tier: 2, stats: { attackSpeed: 0.08, crit: 0.05 } },
    { name: 'des Abysses', tier: 3, stats: { spellPower: 5 }, status: { type: 'poison', dps: 6, duration: 5 } },
    { name: 'du Colosse', tier: 2, stats: { maxHp: 30, defense: 5 } },
    { name: 'de l\'Assassin', tier: 3, stats: { crit: 0.1 }, status: { type: 'poison', dps: 5, duration: 4 } },
    { name: 'du Berserker', tier: 3, stats: { damage: 6, attackSpeed: 0.06 } },
    { name: 'de la Lune', tier: 2, stats: { speed: 0.08, parry: 0.06 } }
];
const RARITY_TIER = { green: 1, blue: 2, yellow: 2, purple: 3, mythic: 3, red: 3 };
const PCT_SET = new Set(['crit', 'attackSpeed', 'speed', 'block', 'parry', 'lifesteal', 'xpBonus']);

function pctPowerMultiplier(tier) {
    const t = Math.max(0, (tier || 1) - 1);
    return 1 + Math.log2((tier || 1) + 1) * 0.18 + t * 0.006;
}

function scaleStatValue(key, value, flatMult, pctMult) {
    const mult = PCT_SET.has(key) ? pctMult : flatMult;
    const v = value * mult;
    return PCT_SET.has(key) ? Math.round(v * 1000) / 1000 : Math.max(1, Math.round(v));
}

// Applique un préfixe/suffixe : stats mises à l'échelle de la rareté + effet/special.
function applyAffixPart(inst, stats, part, mult, pctMult = mult) {
    if (!part) return;
    for (const k in (part.stats || {})) {
        let v = part.stats[k] * (PCT_SET.has(k) ? pctMult : mult) * (0.85 + Math.random() * 0.3);
        v = PCT_SET.has(k) ? Math.round(v * 1000) / 1000 : Math.round(v);
        if (v) stats[k] = (stats[k] || 0) + v;
    }
    if (part.status) {   // garde le statut le plus fort
        const s = { type: part.status.type, dps: Math.round(part.status.dps * mult), duration: part.status.duration };
        if (!inst.status || (s.dps > (inst.status.dps || 0))) inst.status = s;
    }
    if (part.special) inst.special = { ...(inst.special || {}), ...part.special };
}
function pickAffix(pool, maxTier) {
    const cand = pool.filter(p => p.tier <= maxTier);
    return cand.length ? cand[Math.floor(Math.random() * cand.length)] : pool[0];
}

function groupTags(item) {
    const t = item.type;
    if (t === 'weapon') return ['weapon'];
    if (t === 'shield') return ['shield', 'armor'];
    if (t === 'necklace' || t === 'ring') return ['jewel'];
    if (t === 'gloves') return ['armor', 'gloves'];
    if (t === 'cape') return ['armor', 'cape'];
    if (t === 'boots') return ['armor', 'boots'];
    if (ARMOR_TYPES.includes(t)) return ['armor'];
    return [];
}

export function isEquippable(item) {
    return groupTags(item).length > 0;
}

const rand = (a, b) => a + Math.random() * (b - a);

// Cree une instance jouable d'un item de base (avec affixes aleatoires)
export function rollItemInstance(base, opts = {}) {
    const inst = JSON.parse(JSON.stringify(base));
    inst.rolled = true;
    const itemLevel = Math.max(1, opts.itemLevel || lootLevel(gameState.depth || 1, opts.boost || 0));
    const tier = Math.max(1, opts.tier || lootTier(gameState.depth || 1, opts.boost || 0));
    const powerMult = itemPowerMultiplier(itemLevel);
    const pctMult = pctPowerMultiplier(itemLevel);
    inst.tier = tier;
    inst.itemLevel = itemLevel;

    // Consommables / misc : pas d'affixes
    if (!isEquippable(base)) {
        inst.stats = inst.stats || {};
        return inst;
    }

    const rarityKey = opts.rarity || rollRarity(opts.boost || 0);
    const rDef = GameData.rarities[rarityKey] || GameData.rarities.green;
    inst.rarity = rarityKey;

    const stats = {};
    Object.entries(base.baseStats || {}).forEach(([k, v]) => {
        stats[k] = scaleStatValue(k, v, powerMult, pctMult);
    });
    const tags = groupTags(base);
    const candidates = AFFIXES.filter(a => a.for.some(t => tags.includes(t)));

    const affixes = [];
    const used = new Set();
    const count = Math.min(rDef.affixes || 1, candidates.length);
    for (let i = 0; i < count; i++) {
        let pick, guard = 0;
        do { pick = candidates[Math.floor(Math.random() * candidates.length)]; guard++; }
        while (used.has(pick.key) && guard < 20);
        used.add(pick.key);

        let mag = pick.base * (rDef.mult || 1) * (pick.pct ? pctMult : powerMult) * rand(0.75, 1.3);
        mag = pick.pct ? Math.round(mag * 1000) / 1000 : Math.round(mag);
        if (mag <= 0) mag = pick.pct ? 0.01 : 1;

        stats[pick.key] = (stats[pick.key] || 0) + mag;
        affixes.push({ key: pick.key, label: pick.label, value: mag, pct: !!pick.pct });
    }

    // Préfixe (toujours) + suffixe (rareté ≥ tier 2) thématiques : stats + effets.
    const maxTier = RARITY_TIER[rarityKey] || 1;
    const mult = (rDef.mult || 1) * powerMult;
    const prefix = pickAffix(PREFIXES, maxTier);
    applyAffixPart(inst, stats, prefix, mult, (rDef.mult || 1) * pctMult);
    let suffix = null;
    if (maxTier >= 2 && Math.random() < 0.85) { suffix = pickAffix(SUFFIXES, maxTier); applyAffixPart(inst, stats, suffix, mult, (rDef.mult || 1) * pctMult); }

    inst.stats = stats;
    inst.affixes = affixes;
    inst.power = Math.round(Object.values(stats).reduce((s, v) => s + (Math.abs(v) < 1 ? v * 100 : v), 0));
    inst.value = Math.round((base.value || 5) * (rDef.mult || 1) * Math.max(1, tier * 0.75) * (suffix ? 1.5 : 1));
    // Nom RPG : "Hache Runique du Dragon" (la rareté reste indiquée par la couleur)
    inst.name = `${base.name} ${prefix.name}${suffix ? ' ' + suffix.name : ''}`.trim();
    return inst;
}

// Choisit un item de base equipable au hasard (pondere par spawnChance)
export function randomEquipBase() {
    const pool = GameData.items.filter(isEquippable);
    const total = pool.reduce((s, it) => s + (it.spawnChance || 0.1), 0);
    let r = Math.random() * total;
    for (const it of pool) { r -= (it.spawnChance || 0.1); if (r <= 0) return it; }
    return pool[0];
}

function randomConsumable() {
    const pool = GameData.items.filter(it => it.type === 'consumable');
    return pool[Math.floor(Math.random() * pool.length)];
}

// Genere une liste d'items pour un drop (coffre/monstre)
// rolls = nombre de tirages ; boost = decalage de rarete (coffres rares, profondeur)
// Tire un objet UNIQUE (ultra-rare), roule en rarete mythique (garde son special)
export function rollUnique(opts = {}) {
    const pool = GameData.uniques || [];
    if (!pool.length) return null;
    const base = pool[Math.floor(Math.random() * pool.length)];
    return rollItemInstance(base, { rarity: 'mythic', tier: opts.tier || lootTier(gameState.depth || 1, 2), itemLevel: opts.itemLevel || lootLevel(gameState.depth || 1, 2) });
}

export function generateLoot(rolls = 1, boost = 0, opts = {}) {
    const out = [];
    const uniqueChance = 0.03 + (boost || 0) * 0.015;   // monte avec la profondeur / les coffres rares
    const itemLevel = Math.max(1, opts.itemLevel || lootLevel(gameState.depth || 1, boost));
    const tier = Math.max(1, opts.tier || lootTier(gameState.depth || 1, boost));
    for (let i = 0; i < rolls; i++) {
        if (Math.random() < uniqueChance) {
            const u = rollUnique({ tier, itemLevel });
            if (u) { out.push(u); continue; }
        }
        if (Math.random() < 0.3) {
            const c = randomConsumable();
            if (c) out.push(JSON.parse(JSON.stringify(c)));
        } else {
            out.push(rollItemInstance(randomEquipBase(), { boost, tier, itemLevel }));
        }
    }
    return out;
}
