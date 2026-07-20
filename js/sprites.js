import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { GameData } from './data.js';
import { makeAnimatedSprite } from './sprite-anim.js';

// Texture procedurale du boss (fallback runique, conserve le look d'origine)
function createBossTexture() {
    const bossCanvas = document.createElement('canvas');
    bossCanvas.width = 64; bossCanvas.height = 64;
    const bCtx = bossCanvas.getContext('2d');
    bCtx.fillStyle = 'rgba(0,0,0,0)'; bCtx.fillRect(0, 0, 64, 64);
    bCtx.fillStyle = '#2a2015'; bCtx.fillRect(20, 20, 24, 40);
    bCtx.fillStyle = '#444'; bCtx.fillRect(24, 10, 16, 14);
    bCtx.fillStyle = '#0ff'; bCtx.fillRect(28, 14, 2, 2); bCtx.fillRect(34, 14, 2, 2);
    bCtx.strokeStyle = '#4deeea'; bCtx.lineWidth = 2;
    bCtx.beginPath();
    bCtx.moveTo(24, 12); bCtx.lineTo(16, 4); bCtx.lineTo(20, 0);
    bCtx.moveTo(40, 12); bCtx.lineTo(48, 4); bCtx.lineTo(44, 0);
    bCtx.stroke();
    bCtx.fillStyle = '#666'; bCtx.fillRect(10, 30, 4, 34);
    bCtx.fillStyle = '#4deeea'; bCtx.fillRect(6, 30, 12, 8);
    bCtx.fillStyle = '#0ff'; bCtx.font = '10px monospace'; bCtx.fillText('ᚱ', 28, 40);
    const tex = new THREE.CanvasTexture(bossCanvas);
    tex.magFilter = THREE.NearestFilter;
    return tex;
}
export const bossTexture = createBossTexture();

export function createBoss(scene, x, z, d = GameData.boss) {
    const scale = d.scale || 1.5;
    const baseY = scale * 0.6;

    let mesh, anim = null;
    // Sprite image (chemin) ou authore (objet) -> sprite anime ; sinon -> procedural runique
    const hasSprite = (typeof d.sprite === 'string' && d.sprite.trim()) ||
        (d.sprite && typeof d.sprite === 'object' && (d.sprite.src || '').trim());
    if (hasSprite) {
        anim = makeAnimatedSprite(d.sprite, { scale, color: d.color });
        mesh = anim.sprite;
    } else {
        const mat = new THREE.SpriteMaterial({ map: bossTexture, color: 0xffffff });
        mesh = new THREE.Sprite(mat);
        mesh.scale.set(scale, scale, 1);
    }
    mesh.position.set(x, baseY, z);
    mesh.userData = {
        isBoss: true, name: d.name,
        hp: d.hp, maxHp: d.hp, damage: d.damage, xp: d.xp,
        speed: d.speed || 1.3, attackRange: d.attackRange || 2.5, attackRate: d.attackRate || 0.03,
        color: d.color || '#ffffff', baseY, phase: 0, hitFlash: 0,
        attackSound: d.attackSound, deathSound: d.deathSound, walkSound: d.walkSound,
        abilityTimers: {}, abilities: d.abilities || [], gold: d.gold, loot: d.loot,
        lootChance: d.lootChance, lootRolls: d.lootRolls, enrageAt: d.enrageAt || 0.35,
        anim, moving: false
    };
    scene.add(mesh);
    return mesh;
}

export function createMob(scene, x, z, mobData) {
    const scale = mobData.scale || 1;
    const baseY = 0.5 * scale;
    const anim = makeAnimatedSprite(mobData.sprite, { scale, color: mobData.color });
    const mob = anim.sprite;
    mob.position.set(x, baseY, z);

    mob.userData = {
        id: mobData.id, name: mobData.name,
        hp: mobData.hp, maxHp: mobData.hp, damage: mobData.damage, xp: mobData.xp || 10,
        speed: mobData.speed || 1.0, attackRange: mobData.attackRange || 1.5, attackRate: mobData.attackRate || 0.02,
        detect: mobData.detect || 13,
        behavior: mobData.behavior || 'chaser', color: mobData.color || '#dddddd', sound: mobData.sound,
        coward: !!mobData.coward, charger: !!mobData.charger,
        walkSound: mobData.walkSound, attackSound: mobData.attackSound, deathSound: mobData.deathSound,
        ranged: !!mobData.ranged || mobData.behavior === 'caster', projColor: mobData.projColor, projSpeed: mobData.projSpeed, projChance: mobData.projChance,
        gold: mobData.gold, loot: mobData.loot, statusOnHit: mobData.statusOnHit, lootChance: mobData.lootChance,
        status: null, tint: null,
        baseY, scale, phase: Math.random() * Math.PI * 2,
        hitFlash: 0, slowUntil: 0, dead: false, deathDone: false,
        aggro: false, wanderTimer: Math.random() * 2, wanderDir: null,
        gait: mobData.gait || (mobData.behavior === 'phaser' ? 'float' : 'walk'),
        facing: 1, flipT: 0,
        anim, moving: false
    };
    scene.add(mob);
    return mob;
}
