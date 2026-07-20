import { GameData } from './data.js';

// =====================================================================
//  ETAT GLOBAL
// =====================================================================
export const gameState = {
    hp: 100, maxHp: 100,
    mana: 100, maxMana: 100, manaRegen: 8,

    xp: 0, maxXp: 100, level: 1,
    gold: 0, honor: 0, kills: 0,
    depth: 1, worldTier: 1,   // etage du donjon + tier de progression

    // Personnage & partie
    charName: 'Bjorn', charBonusId: 'berserk', charStats: {}, lootBoost: 0,
    mode: 'delve',            // 'delve' (descente) | 'labyrinth' (labyrinthe)
    checkpointDepth: 1,       // étage du dernier checkpoint (retour à la mort)

    bossHp: GameData.boss.hp, bossMaxHp: GameData.boss.hp,
    bossDead: false, bossEnraged: false,

    isFiring: false, isBlocking: false,
    isDead: false, won: false,
    menuOpen: false,           // un menu (inventaire / fin) est ouvert -> souris libre + pause
    autoEquipEmptySlots: true,
    currentSpellIndex: 0,
    spells: GameData.spells.map(s => s.name),
    spellCooldowns: {},
    attackReady: 0,           // cooldown de l'attaque d'arme

    // Attributs alloues par le joueur
    attributes: { force: 0, dexterite: 0, intel: 0, vitalite: 0, blocage: 0, parade: 0, furtivite: 0 },
    attrPoints: 0,

    // Compétences passives : { id: rang } + points à dépenser (1/niveau)
    skills: {},
    skillPoints: 0,

    // Bouclier absorbant actif (sort Égide) : { amount, max, until }
    ward: null,

    // Stats derivees (equipement + attributs + buffs)
    stats: {
        damage: 0, spellPower: 0, defense: 0, crit: 0.05, attackSpeed: 0, speed: 0,
        block: 0, parry: 0, stealth: 0, lifesteal: 0, xpBonus: 0, manaRegen: 0,
        bonusMaxHp: 0, bonusMaxMana: 0
    },

    // Effets uniques agreges depuis l'equipement (objets ultra-rares)
    specials: { multishot: 1, extraBounce: 0, spread: 0.22 },

    // Statuts subis par le joueur (poison, brulure...) : { type: {dmgPerTick, until, next} }
    playerStatus: {},

    // Esquive
    stamina: 100, maxStamina: 100,
    dashUntil: 0, dashCdUntil: 0, invulnUntil: 0,
    dashDir: { x: 0, z: 0 },

    // Saut
    jumpY: 0, jumpVel: 0,

    buffs: [],
    time: 0,
    logs: []
};

export function resetState() {
    Object.assign(gameState, {
        hp: gameState.maxHp, mana: gameState.maxMana,
        xp: 0, maxXp: 100, level: 1, gold: 0, honor: 0, kills: 0, depth: 1, worldTier: 1,
        bossHp: GameData.boss.hp, bossMaxHp: GameData.boss.hp,
        bossDead: false, bossEnraged: false,
        isDead: false, won: false, currentSpellIndex: 0,
        spellCooldowns: {}, attackReady: 0, attrPoints: 0,
        skills: {}, skillPoints: 0, ward: null,
        attributes: { force: 0, dexterite: 0, intel: 0, vitalite: 0, blocage: 0, parade: 0, furtivite: 0 },
        buffs: [], time: 0
    });
}
