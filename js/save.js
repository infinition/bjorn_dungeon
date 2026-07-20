import { gameState } from './state.js';
import { playerInventory } from './inventory.js';
import { ATTRIBUTES, GameData } from './data.js';

// =====================================================================
//  SAUVEGARDE + RÉGLAGES + CRÉATION DE PERSONNAGE
//  Persistance : localStorage (toujours) + serveur (si backend dispo).
// =====================================================================
const SAVE_KEY = 'bjorn_save';
const SETTINGS_KEY = 'bjorn_settings';

// ---- Réglages (FOV, pixelisation, volume, bloom, normal) ----
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { } }
export function loadSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || null; } catch (e) { return null; } }

// ---- Hash déterministe (FNV-1a) ----
function hashStr(str) {
    let h = 2166136261 >>> 0;
    const s = (str || '').toLowerCase().trim();
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
}

// ---- Bonus de personnage (un par nom, déterministe) - éditables dans la Forge (GameData.bonuses) ----
const _FALLBACK_BONUSES = [
    { id: 'berserk', name: 'Berserker', desc: '+7 dégâts', stats: { damage: 7 } },
    { id: 'archimage', name: 'Archimage', desc: '+9 magie, +25 mana', stats: { spellPower: 9, bonusMaxMana: 25 } },
    { id: 'colosse', name: 'Colosse', desc: '+55 PV, +5 armure', stats: { bonusMaxHp: 55, defense: 5 } },
    { id: 'assassin', name: 'Assassin', desc: '+12% crit, +2 furtivité', stats: { crit: 0.12, stealth: 2 } },
    { id: 'funambule', name: 'Funambule', desc: '+15% vitesse, +parade', stats: { speed: 0.15, parry: 0.08 } },
    { id: 'vampire', name: 'Vampire', desc: '+9% vol de vie', stats: { lifesteal: 0.09 } },
    { id: 'chanceux', name: 'Chanceux', desc: 'meilleur butin, +10% XP', stats: { xpBonus: 0.1 }, lootBoost: 1 },
    { id: 'elementaliste', name: 'Élémentaliste', desc: '+5 magie, +regen mana', stats: { spellPower: 5, manaRegen: 5 } },
    { id: 'gladiateur', name: 'Gladiateur', desc: '+5 dégâts, +12% blocage', stats: { damage: 5, block: 0.12 } },
    { id: 'sniper', name: 'Tireur d\'élite', desc: '+5 dégâts, +10% crit', stats: { damage: 5, crit: 0.1 } }
];
export const BONUSES = (GameData.bonuses && GameData.bonuses.length) ? GameData.bonuses : _FALLBACK_BONUSES;
export function bonusById(id) { return BONUSES.find(b => b.id === id) || BONUSES[0]; }

// ---- Dérive un personnage à partir d'un nom ----
export function deriveCharacter(name) {
    const h = hashStr(name);
    const bonus = BONUSES[h % BONUSES.length];
    const keys = Object.keys(ATTRIBUTES);
    const attributes = {}; keys.forEach(k => attributes[k] = 0);
    // 5 points répartis selon le hash (profil de départ unique)
    let hh = h;
    for (let i = 0; i < 5; i++) { attributes[keys[hh % keys.length]]++; hh = (Math.floor(hh / 5) + 2654435761) >>> 0; }
    return { name: (name || 'Bjorn').slice(0, 16), bonusId: bonus.id, attributes };
}

// Applique le personnage à l'état (au démarrage d'une partie)
export function applyCharacter(char) {
    gameState.charName = char.name;
    gameState.charBonusId = char.bonusId;
    const b = bonusById(char.bonusId);
    gameState.charStats = b.stats || {};
    gameState.lootBoost = b.lootBoost || 0;
    gameState.attributes = { ...char.attributes };
}

// ---- Sauvegarde de partie ----
export function buildSave() {
    return {
        v: 1,
        name: gameState.charName, bonusId: gameState.charBonusId, mode: gameState.mode,
        attributes: gameState.attributes, attrPoints: gameState.attrPoints,
        skills: gameState.skills, skillPoints: gameState.skillPoints,
        level: gameState.level, xp: gameState.xp, maxXp: gameState.maxXp,
        gold: gameState.gold, honor: gameState.honor, kills: gameState.kills,
        depth: gameState.depth, currentSpellIndex: gameState.currentSpellIndex,
        hp: gameState.hp, mana: gameState.mana, stamina: gameState.stamina,
        inventory: playerInventory.items, equipment: playerInventory.equipment,
        ts: gameState.time
    };
}
export function saveGame() {
    const data = buildSave();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { }
    syncServer(data);
    return data;
}
export function loadGame() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; } }
export function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
export function deleteSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } }

// Restaure un save dans l'état + l'inventaire (le donjon est régénéré par le jeu)
export function applySave(s) {
    applyCharacter({ name: s.name, bonusId: s.bonusId, attributes: s.attributes });
    gameState.mode = s.mode || 'delve';
    gameState.attrPoints = s.attrPoints || 0;
    gameState.level = s.level || 1; gameState.xp = s.xp || 0; gameState.maxXp = s.maxXp || 100;
    // Compétences (rétro-compat : anciennes saves -> points rattrapés selon le niveau)
    gameState.skills = s.skills || {};
    gameState.skillPoints = s.skillPoints != null ? s.skillPoints : Math.max(0, (s.level || 1) - 1);
    gameState.gold = s.gold || 0; gameState.honor = s.honor || 0; gameState.kills = s.kills || 0;
    gameState.depth = s.depth || 1; gameState.currentSpellIndex = s.currentSpellIndex || 0;
    // Vitals restaurés (clampés après recomputeStats côté jeu) ; null = "remettre au max"
    gameState.savedHp = s.hp != null ? s.hp : null;
    gameState.savedMana = s.mana != null ? s.mana : null;
    gameState.savedStamina = s.stamina != null ? s.stamina : null;
    const disabledTool = it => it && it.attackType === 'tool';
    playerInventory.items = Array.isArray(s.inventory) ? s.inventory.filter(it => !disabledTool(it)) : [];
    if (s.equipment) {
        for (const k of Object.keys(playerInventory.equipment)) {
            const it = s.equipment[k] || null;
            playerInventory.equipment[k] = disabledTool(it) ? null : it;
        }
    }
    const hasMelee = playerInventory.equipment.mainHand ||
        playerInventory.items.some(it => it && it.type === 'weapon' && it.attackType === 'melee');
    if (!hasMelee) {
        const sword = GameData.items.find(i => i.id === 'sword');
        if (sword) playerInventory.equipment.mainHand = JSON.parse(JSON.stringify(sword));
    }
}

// ---- Synchronisation serveur (backend optionnel : node server.js) ----
let serverOk = true;
async function syncServer(data) {
    if (!serverOk) return;
    try {
        const r = await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (!r.ok) serverOk = false;
    } catch (e) { serverOk = false; }   // pas de backend (ex: python http.server) -> localStorage seul
}
export async function loadFromServer(name) {
    try {
        const r = await fetch('/api/load?name=' + encodeURIComponent(name));
        if (r.ok) return await r.json();
    } catch (e) { }
    return null;
}
