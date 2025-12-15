import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

const textureLoader = new THREE.TextureLoader();

export function loadSprite(path) {
    const tex = textureLoader.load(path);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
}

export function createBillboard(texture, size = 1) {
    const mat = new THREE.SpriteMaterial({ map: texture, color: 0xffffff });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(size, size, 1);
    return sprite;
}

// Procedural Boss Texture (Fallback)
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

export function createBoss(scene, x, z) {
    // Try to load custom sprite, fallback to procedural
    // For now, using procedural constant
    const boss = createBillboard(bossTexture, 1.5);
    boss.position.set(x, 1, z);
    scene.add(boss);
    return boss;
}

export function createMob(scene, x, z, mobData) {
    let tex;
    if (mobData.sprite && mobData.sprite.trim() !== '') {
        tex = loadSprite(mobData.sprite);
    } else {
        // Fallback procedural generation
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = mobData.color || '#ddd';
        ctx.fillRect(8, 8, 16, 24);
        tex = new THREE.CanvasTexture(canvas);
        tex.magFilter = THREE.NearestFilter;
    }

    const mob = createBillboard(tex, mobData.scale || 1);
    mob.position.set(x, 0.5 * (mobData.scale || 1), z);
    // Store stats on the mesh for gameplay logic
    mob.userData = { hp: mobData.hp, damage: mobData.damage, name: mobData.name, sound: mobData.sound };

    scene.add(mob);
    return mob;
}
