import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { gameState } from './state.js';
import { rarityColor } from './data.js';
import { playerInventory } from './inventory.js';
import { recomputeStats } from './stats.js';
import { generateLoot } from './loot.js';
import { addLog } from './utils.js';
import { spawnParticles, spawnSpriteFx } from './effects.js';
import { playPickupSound, playCoinSound } from './sounds.js';

const pickups = [];
let sceneRef = null;
let inventoryChangedHook = null;
const FX_PICKUP_SPARKLE = { type: 'sheet', src: 'assets/fx/pickup_sparkle_sheet.png', cols: 4, rows: 1, fps: 12 };

export function initPickups(scene, hooks = {}) {
    sceneRef = scene;
    inventoryChangedHook = hooks.onInventoryChanged || null;
}
export function clearPickups() {
    if (!sceneRef) return;
    pickups.forEach(p => { if (p.userData.beam) sceneRef.remove(p.userData.beam); sceneRef.remove(p); });
    pickups.length = 0;
}

function makeGemTexture(colorHex) {
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, 16, 16);
    ctx.fillStyle = colorHex;
    ctx.beginPath(); ctx.moveTo(8, 1); ctx.lineTo(15, 8); ctx.lineTo(8, 15); ctx.lineTo(1, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(6, 4, 2, 4);
    const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter; return tex;
}
const itemTexCache = {};
function getPickupSprite(kind, data) {
    let color = '#ffd24d', spritePath = null;
    if (kind === 'item') {
        color = rarityColor(data.rarity || 'green');
        if (typeof data.sprite === 'string' && data.sprite.trim()) spritePath = data.sprite;
    }
    let mat;
    if (spritePath) { const tex = new THREE.TextureLoader().load(spritePath); tex.magFilter = THREE.NearestFilter; mat = new THREE.SpriteMaterial({ map: tex }); }
    else { if (!itemTexCache[color]) itemTexCache[color] = makeGemTexture(color); mat = new THREE.SpriteMaterial({ map: itemTexCache[color] }); }
    const sprite = new THREE.Sprite(mat);
    const s = kind === 'gold' ? 0.35 : 0.5; sprite.scale.set(s, s, 1);
    return sprite;
}

const BEAM_H = { green: 1.6, blue: 2.0, yellow: 2.5, purple: 3.0, mythic: 3.6 };
export function spawnPickup(x, z, kind, data = {}) {
    if (!sceneRef) return;
    const sprite = getPickupSprite(kind, data);
    const baseY = kind === 'gold' ? 0.4 : 0.55;
    sprite.position.set(x, baseY, z);
    sprite.userData = { kind, data, baseY, phase: Math.random() * Math.PI * 2, beam: null };

    // Faisceau de loot (colonne lumineuse coloree par rarete)
    if (kind === 'item') {
        const rk = data.rarity || 'green';
        const col = rarityColor(rk);
        const h = BEAM_H[rk] || 1.8;
        const beam = new THREE.Mesh(
            new THREE.CylinderGeometry(0.14, 0.14, h, 6, 1, true),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(col), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
        );
        beam.position.set(x, h / 2, z);
        sceneRef.add(beam);
        sprite.userData.beam = beam;
    }

    sceneRef.add(sprite); pickups.push(sprite);
    spawnParticles(sprite.position, kind === 'gold' ? '#ffd24d' : rarityColor(data.rarity || 'green'), 6, { spread: 1.5, life: 0.4, gravity: 1 });
    spawnSpriteFx(FX_PICKUP_SPARKLE, sprite.position, { scale: kind === 'gold' ? 0.55 : 0.7, yOffset: 0.05, life: 0.45 });
}

export function updatePickups(dt, camera) {
    for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i], u = p.userData;
        u.phase += dt * 3;
        p.position.y = u.baseY + Math.sin(u.phase) * 0.12;
        p.material.rotation += dt * 1.5;
        const dist = p.position.distanceTo(camera.position);
        if (dist < 2.2) { const d = new THREE.Vector3().subVectors(camera.position, p.position); d.y = 0; d.normalize(); p.position.add(d.multiplyScalar(dt * 6)); }
        // le faisceau suit l'objet (aimantation) + pulse
        if (u.beam) { u.beam.position.x = p.position.x; u.beam.position.z = p.position.z; u.beam.material.opacity = 0.26 + Math.sin(u.phase * 2) * 0.12; }
        if (dist < 0.8) { collect(u); if (u.beam) sceneRef.remove(u.beam); sceneRef.remove(p); pickups.splice(i, 1); }
    }
}

function collect(u) {
    if (u.kind === 'gold') {
        const amount = Math.round(u.data.amount * (1 + (gameState.stats.goldBonus || 0)) * (gameState.floorGoldMult || 1));
        gameState.gold += amount; playCoinSound();
        addLog(`+${amount} or`, 'text-yellow-400');
    } else {
        const shouldAutoEquip = gameState.autoEquipEmptySlots && playerInventory.canAutoEquip(u.data);
        if (playerInventory.addItem(u.data)) {
            let equipped = false;
            if (shouldAutoEquip) {
                const index = playerInventory.items.indexOf(u.data);
                equipped = index >= 0 && playerInventory.equipItem(index);
            }
            addLog(equipped ? `Equipé : ${u.data.name}` : `✦ ${u.data.name}`, rarityColor(u.data.rarity || 'green')); playPickupSound();
            recomputeStats();
            if (inventoryChangedHook) inventoryChangedHook();
        } else addLog('Inventaire plein !', 'text-red-400');
    }
}

// Drop unifie. opts: { goldMin, goldMax, rolls, chance, boost }
export function dropLoot(x, z, opts = {}) {
    const gMin = opts.goldMin || 0, gMax = opts.goldMax || 0;
    if (gMax > 0) {
        const amount = Math.floor(gMin + Math.random() * (gMax - gMin + 1));
        if (amount > 0) {
            const piles = Math.min(3, Math.max(1, Math.floor(amount / 20) + 1));
            for (let k = 0; k < piles; k++) spawnPickup(x + (Math.random() - 0.5) * 1.2, z + (Math.random() - 0.5) * 1.2, 'gold', { amount: Math.ceil(amount / piles) });
        }
    }
    const chance = opts.chance != null ? opts.chance : 1;
    if (Math.random() <= chance) {
        const boost = (opts.boost || 0) + Math.floor((gameState.depth - 1) / 3) + (gameState.lootBoost || 0) + (gameState.floorLootBoost || 0);
        const items = generateLoot(opts.rolls || 1, boost, { tier: opts.tier });
        items.forEach(it => spawnPickup(x + (Math.random() - 0.5) * 1.6, z + (Math.random() - 0.5) * 1.6, 'item', it));
    }
}
