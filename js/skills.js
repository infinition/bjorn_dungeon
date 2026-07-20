import { gameState } from './state.js';

// =====================================================================
//  COMPÉTENCES PASSIVES - 1 point par niveau, rangs cumulables.
//  Appliquées dans recomputeStats (stats.js) via applySkills.
// =====================================================================
export const SKILL_DEFS = [
    { id: 'martial', name: 'Maîtrise martiale', icon: '⚔', max: 5, desc: '+6% dégâts d\'arme par rang', color: '#ff8855' },
    { id: 'arcana', name: 'Arcanes', icon: '✦', max: 5, desc: '+6% puissance des sorts par rang', color: '#c44dff' },
    { id: 'vigor', name: 'Vigueur', icon: '❤', max: 5, desc: '+20 PV max par rang', color: '#ff5566' },
    { id: 'wisdom', name: 'Sagesse', icon: '◈', max: 5, desc: '+15 mana max et +1 régén mana par rang', color: '#4da6ff' },
    { id: 'precision', name: 'Précision', icon: '◎', max: 5, desc: '+2% chance de critique par rang', color: '#ffd24d' },
    { id: 'celerity', name: 'Célérité', icon: 'ϟ', max: 5, desc: '+3% vitesse d\'attaque par rang', color: '#9be08a' },
    { id: 'iron_skin', name: 'Peau de fer', icon: '▣', max: 5, desc: '+3 défense par rang', color: '#9aa8c0' },
    { id: 'vampirism', name: 'Vampirisme', icon: '♦', max: 5, desc: '+1.5% vol de vie par rang', color: '#d9223e' },
    { id: 'reflexes', name: 'Réflexes', icon: '✋', max: 5, desc: '+2% blocage et parade par rang', color: '#7fdfff' },
    { id: 'swiftness', name: 'Course', icon: '➤', max: 5, desc: '+3% vitesse de déplacement par rang', color: '#8fd8a0' },
    { id: 'fortune', name: 'Fortune', icon: '⬡', max: 5, desc: '+4% XP et or trouvés par rang', color: '#ffcf4d' },
    { id: 'shadow', name: 'Ombre', icon: '☾', max: 5, desc: '+1 furtivité par rang', color: '#8a7ab0' }
];

export function skillRank(id) { return (gameState.skills && gameState.skills[id]) || 0; }
export function spentSkillPoints() { return Object.values(gameState.skills || {}).reduce((s, v) => s + (v || 0), 0); }

export function canLearnSkill(id) {
    const def = SKILL_DEFS.find(d => d.id === id);
    return !!def && (gameState.skillPoints || 0) > 0 && skillRank(id) < def.max;
}

export function learnSkill(id) {
    if (!canLearnSkill(id)) return false;
    if (!gameState.skills) gameState.skills = {};
    gameState.skills[id] = (gameState.skills[id] || 0) + 1;
    gameState.skillPoints--;
    return true;
}

// Injecte les rangs de compétence dans les stats dérivées
export function applySkills(s) {
    const r = skillRank;
    s.damageMult = 1 + r('martial') * 0.06;
    s.spellMult = 1 + r('arcana') * 0.06;
    s.bonusMaxHp += r('vigor') * 20;
    s.bonusMaxMana += r('wisdom') * 15;
    s.manaRegen += r('wisdom');
    s.crit += r('precision') * 0.02;
    s.attackSpeed += r('celerity') * 0.03;
    s.defense += r('iron_skin') * 3;
    s.lifesteal += r('vampirism') * 0.015;
    s.block += r('reflexes') * 0.02;
    s.parry += r('reflexes') * 0.02;
    s.speed += r('swiftness') * 0.03;
    s.xpBonus += r('fortune') * 0.04;
    s.goldBonus = (s.goldBonus || 0) + r('fortune') * 0.04;
    s.stealth += r('shadow');
}
