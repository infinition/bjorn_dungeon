import { gameState } from './state.js';
import { spawnParticles } from './effects.js';
import { GameData } from './data.js';

// =====================================================================
//  EFFETS DE STATUT (DoT / ralentissement) - éditables dans la Forge (GameData.statusDefs)
// =====================================================================
const _FALLBACK_STATUS = {
    burn:   { color: '#ff7722', tick: 0.5, icon: '🔥', label: 'Brûlure' },
    poison: { color: '#66dd33', tick: 0.7, icon: '☠',  label: 'Poison' },
    bleed:  { color: '#dd2222', tick: 0.4, icon: '🩸', label: 'Saignement' },
    freeze: { color: '#88ddff', tick: 1.0, icon: '❄',  label: 'Givre', slow: true }
};
export const STATUS_DEF = (GameData.statusDefs && GameData.statusDefs.length)
    ? GameData.statusDefs.reduce((m, s) => { m[s.type] = s; return m; }, {})
    : _FALLBACK_STATUS;

// --- Entites (mobs / boss : stocke sur userData.status) ---
export function applyEntityStatus(u, type, dps, duration) {
    const def = STATUS_DEF[type]; if (!def) return;
    if (!u.status) u.status = {};
    u.status[type] = { dmgPerTick: dps * def.tick, until: gameState.time + duration, next: gameState.time + def.tick };
    if (def.slow) u.slowUntil = Math.max(u.slowUntil || 0, gameState.time + duration);
}

// dealFn(amount, color) inflige les degats (mort geree par l'appelant)
export function tickEntityStatus(u, pos, dealFn) {
    if (!u.status) return;
    for (const [type, st] of Object.entries(u.status)) {
        const def = STATUS_DEF[type];
        if (gameState.time >= st.next) {
            st.next += def.tick;
            dealFn(st.dmgPerTick, def.color);
            spawnParticles(pos, def.color, 4, { spread: 1.4, life: 0.3, gravity: 1 });
        }
        if (gameState.time > st.until) delete u.status[type];
    }
}

// --- Joueur ---
export function applyPlayerStatus(type, dps, duration) {
    const def = STATUS_DEF[type]; if (!def) return;
    gameState.playerStatus[type] = { dmgPerTick: dps * def.tick, until: gameState.time + duration, next: gameState.time + def.tick };
}

export function tickPlayerStatus(damageFn, camPos) {
    const ps = gameState.playerStatus;
    for (const [type, st] of Object.entries(ps)) {
        const def = STATUS_DEF[type];
        if (gameState.time >= st.next) { st.next += def.tick; damageFn(st.dmgPerTick, def.color); if (camPos) spawnParticles(camPos, def.color, 3, { spread: 1, life: 0.3 }); }
        if (gameState.time > st.until) delete ps[type];
    }
}

export function activePlayerStatuses() {
    return Object.keys(gameState.playerStatus).map(t => ({ type: t, ...STATUS_DEF[t] }));
}
