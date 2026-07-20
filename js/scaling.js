import { gameState } from './state.js';

function clampMin(n, min = 1) {
    return Math.max(min, Math.floor(Number.isFinite(n) ? n : min));
}

const TIER_SIZE = 20;

export function worldLevel(depth = gameState.depth || 1, level = gameState.level || 1, mode = gameState.mode || 'delve') {
    const d = clampMin(depth);
    const l = clampMin(level);
    return mode === 'labyrinth'
        ? Math.max(l, Math.floor(d * 0.75))
        : Math.max(l, d);
}

export function tierFromLevel(level = 1) {
    return 1 + Math.floor((clampMin(level) - 1) / TIER_SIZE);
}

export function worldTier(depth = gameState.depth || 1, level = gameState.level || 1, mode = gameState.mode || 'delve') {
    return tierFromLevel(worldLevel(depth, level, mode));
}

export function monsterScale(depth = gameState.depth || 1, opts = {}) {
    const scaleLevel = opts.scaleLevel || worldLevel(depth);
    const tier = opts.tier || tierFromLevel(scaleLevel);
    const t = Math.max(0, scaleLevel - 1);
    const rank = opts.boss ? 1.18 : opts.elite ? 1.08 : 1;
    return {
        tier,
        level: scaleLevel,
        hp: rank * (1 + t * 0.11 + Math.pow(t, 1.12) * 0.03),
        damage: rank * (1 + t * 0.055 + Math.pow(t, 1.06) * 0.014),
        xp: 1 + t * 0.075,
        gold: 1 + t * 0.055
    };
}

export function lootLevel(depth = gameState.depth || 1, boost = 0) {
    return Math.max(1, worldLevel(depth) + Math.max(0, Math.floor(boost || 0)) * 5);
}

export function lootTier(depth = gameState.depth || 1, boost = 0) {
    return tierFromLevel(lootLevel(depth, boost));
}

export function itemPowerMultiplier(level = 1) {
    const t = Math.max(0, clampMin(level) - 1);
    return 1 + t * 0.055 + Math.pow(t, 1.06) * 0.01;
}

export function floorPopulation(depth = gameState.depth || 1, mode = gameState.mode || 'delve') {
    const level = worldLevel(depth, gameState.level || 1, mode);
    const tier = tierFromLevel(level);
    const t = Math.max(0, level - 1);
    return {
        tier,
        roomBonus: Math.min(mode === 'labyrinth' ? 12 : 8, Math.floor(t / 14)),
        mobBonus: Math.min(mode === 'labyrinth' ? 30 : 22, Math.floor(t / 3.5)),
        roomSizeBonus: Math.min(mode === 'labyrinth' ? 3 : 5, Math.floor(t / 18))
    };
}

export function applyMonsterScale(entity, depth = gameState.depth || 1, opts = {}) {
    if (!entity || !entity.userData) return null;
    const u = entity.userData;
    const s = monsterScale(depth, opts);
    u.tier = s.tier;
    u.level = s.level;
    u.hp = u.maxHp = Math.max(1, Math.round(u.maxHp * s.hp));
    u.damage = Math.max(1, Math.round(u.damage * s.damage));
    u.xp = Math.max(1, Math.round((u.xp || 10) * s.xp));
    if (Array.isArray(u.gold)) u.gold = u.gold.map(v => Math.max(0, Math.round(v * s.gold)));
    return s;
}
