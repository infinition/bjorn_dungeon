import { GameData } from './data.js';

export const gameState = {
    hp: 100,
    maxHp: 100,
    bossHp: GameData.boss.hp,
    bossMaxHp: GameData.boss.hp,
    lastShot: 0,
    isFiring: false,
    isDead: false,
    bossDead: false,
    logs: [],
    currentSpellIndex: 0,
    spells: GameData.spells.map(s => s.name),
    xp: 0,
    maxXp: 100,
    level: 1
};
