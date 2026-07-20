import { gameState } from './state.js';
import { playerInventory } from './inventory.js';
import { applySkills } from './skills.js';

// =====================================================================
//  STATS - equipement + attributs + buffs
// =====================================================================
const BASE = () => ({
    damage: 0, spellPower: 0, defense: 0, crit: 0.05, attackSpeed: 0, speed: 0,
    block: 0, parry: 0, stealth: 0, lifesteal: 0, xpBonus: 0, manaRegen: 0,
    bonusMaxHp: 0, bonusMaxMana: 0
});

const STAT_MAP = {
    damage: 'damage', spellPower: 'spellPower', defense: 'defense', crit: 'crit',
    attackSpeed: 'attackSpeed', speed: 'speed', block: 'block', parry: 'parry',
    stealth: 'stealth', lifesteal: 'lifesteal', xpBonus: 'xpBonus', manaRegen: 'manaRegen',
    maxHp: 'bonusMaxHp', maxMana: 'bonusMaxMana'
};

export function itemStats(item) {
    return item ? (item.stats || item.baseStats || {}) : {};
}

export function recomputeStats() {
    const s = BASE();

    // Equipement (tous slots)
    Object.values(playerInventory.equipment).forEach(item => {
        const st = itemStats(item);
        for (const [k, v] of Object.entries(st)) { const t = STAT_MAP[k]; if (t) s[t] += v; }
    });

    // Attributs
    const a = gameState.attributes;
    s.damage += a.force * 1.5 + a.dexterite * 0.8;
    s.crit += a.dexterite * 0.004;
    s.spellPower += a.intel * 1.2;
    s.bonusMaxMana += a.intel * 4;
    s.bonusMaxHp += a.vitalite * 12;
    s.block += a.blocage * 0.03;
    s.parry += a.parade * 0.03;
    s.stealth += a.furtivite;

    // Bonus de personnage (création par nom)
    if (gameState.charStats) for (const [k, v] of Object.entries(gameState.charStats)) { if (k in s) s[k] += v; }

    // Buffs temporaires
    gameState.buffs = gameState.buffs.filter(b => b.until > gameState.time);
    gameState.buffs.forEach(b => { const t = STAT_MAP[b.stat] || b.stat; if (t in s) s[t] += b.amount; });

    // Compétences passives (rangs achetés au niveau)
    applySkills(s);

    // Caps
    s.block = Math.min(0.8, s.block);
    s.parry = Math.min(0.6, s.parry);
    s.crit = Math.min(0.8, s.crit);

    gameState.stats = s;

    // Effets uniques (objets ultra-rares)
    const sp = { multishot: 1, extraBounce: 0, spread: 0.22, thorns: 0, onKillHeal: 0, frostAura: 0, execute: 0, cheatDeath: false };
    Object.values(playerInventory.equipment).forEach(item => {
        const sx = item && item.special;
        if (!sx) return;
        if (sx.multishot) sp.multishot = Math.max(sp.multishot, sx.multishot);
        if (sx.extraBounce) sp.extraBounce += sx.extraBounce;
        if (sx.spread != null) sp.spread = sx.spread;
        if (sx.thorns) sp.thorns += sx.thorns;
        if (sx.onKillHeal) sp.onKillHeal += sx.onKillHeal;
        if (sx.frostAura) sp.frostAura = Math.max(sp.frostAura, sx.frostAura);
        if (sx.execute) sp.execute = Math.max(sp.execute, sx.execute);
        if (sx.cheatDeath) sp.cheatDeath = true;
        if (sx.goldFind) s.goldBonus = (s.goldBonus || 0) + sx.goldFind;
    });
    gameState.specials = sp;

    gameState.maxHp = 100 + (gameState.level - 1) * 15 + s.bonusMaxHp;
    gameState.maxMana = 100 + s.bonusMaxMana;
    gameState.manaRegen = 8 + s.manaRegen;
    if (gameState.hp > gameState.maxHp) gameState.hp = gameState.maxHp;
    if (gameState.mana > gameState.maxMana) gameState.mana = gameState.maxMana;
}

// L'arme principale equipee
export function mainWeapon() { return playerInventory.equipment.mainHand; }
export function hasShield() {
    const off = playerInventory.equipment.offHand;
    return off && off.type === 'shield';
}
export function hasTorch() {
    const off = playerInventory.equipment.offHand;
    return off && off.type === 'torch';
}

// Degats d'une attaque d'arme (melee/distance)
export function computeWeaponDamage() {
    const s = gameState.stats;
    let dmg = (4 + s.damage) * (s.damageMult || 1);   // 4 = poing nu
    const crit = Math.random() < s.crit;
    if (crit) dmg *= 2;
    return { amount: Math.max(1, Math.round(dmg)), crit };
}

export function computeSpellDamage(spellData) {
    const s = gameState.stats;
    let dmg = ((spellData.damage || 0) + s.spellPower + s.damage * 0.3) * (s.spellMult || 1);
    const crit = Math.random() < s.crit;
    if (crit) dmg *= 2;
    return { amount: Math.round(dmg), crit };
}

// Degats subis : parade (annule) -> blocage (reduit) -> armure
export function mitigate(raw) {
    const s = gameState.stats;
    const weapon = mainWeapon();
    const isMelee = weapon && weapon.attackType === 'melee';

    // Parade auto
    const parryChance = s.parry + (isMelee ? 0.05 : 0);
    if (Math.random() < parryChance) return { amount: 0, parried: true, blocked: false };

    // Blocage
    let factor = 1, blocked = false;
    if (gameState.isBlocking && hasShield()) {
        // Bouclier en garde : absorbe 90% des dégâts, MAIS coûte de la vigueur (10/coup)
        if (gameState.stamina >= 10) { gameState.stamina -= 10; factor = 0.1; blocked = true; }
        else { factor = 0.5; blocked = true; }               // plus assez de vigueur -> blocage partiel
    } else if (gameState.isBlocking && isMelee) {
        factor = 0.45; blocked = true;                       // parade à l'arme (sans bouclier)
    } else if (Math.random() < s.block) {
        factor = 0.5; blocked = true;                        // blocage auto (passif)
    }

    let amount = raw * factor - s.defense * 0.6;
    return { amount: Math.max(1, Math.round(amount)), blocked, parried: false };
}

// Portee de detection ennemie reduite par la furtivite
export function detectRange(base) {
    const reduc = Math.min(0.7, gameState.stats.stealth * 0.06);
    return base * (1 - reduc);
}

export function addBuff(stat, amount, duration, meta = {}) {
    const key = meta.id || stat;
    const until = gameState.time + duration;
    const existing = gameState.buffs.find(b => (b.id || b.stat) === key);
    if (existing) {
        existing.stat = stat;
        existing.amount = amount;
        existing.until = Math.max(existing.until, until);
        existing.name = meta.name || existing.name;
        existing.icon = meta.icon || existing.icon;
        existing.color = meta.color || existing.color;
        existing.sprite = meta.sprite || existing.sprite;
        existing.id = key;
    } else {
        gameState.buffs.push({ id: key, stat, amount, until, name: meta.name, icon: meta.icon, color: meta.color, sprite: meta.sprite });
    }
    recomputeStats();
}

export function activeBuffs() {
    return gameState.buffs
        .filter(b => b.until > gameState.time)
        .map(b => ({ ...b, left: Math.max(0, b.until - gameState.time) }));
}
