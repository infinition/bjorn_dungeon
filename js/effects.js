import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { makeAnimatedSprite } from './sprite-anim.js';

// =====================================================================
//  EFFETS VISUELS
//  Particules, nombres de degats flottants, ondes de choc.
//  Tout est gere dans un tableau interne mis a jour chaque frame.
// =====================================================================

const effects = [];          // { mesh, update(dt)->bool(alive), dispose() }
const MAX_EFFECTS = 90;
let sceneRef = null;
const _ringGeometries = {};
const _sphereGeometries = {};

function sharedRingGeometry(segments) {
    const key = segments || 32;
    if (!_ringGeometries[key]) {
        _ringGeometries[key] = new THREE.RingGeometry(0.1, 0.25, key);
        _ringGeometries[key].userData.shared = true;
    }
    return _ringGeometries[key];
}

function sharedSphereGeometry(size, segments) {
    const key = `${size || 0.4}:${segments || 8}`;
    if (!_sphereGeometries[key]) {
        _sphereGeometries[key] = new THREE.SphereGeometry(size || 0.4, segments || 8, segments || 8);
        _sphereGeometries[key].userData.shared = true;
    }
    return _sphereGeometries[key];
}

export function initEffects(scene) {
    sceneRef = scene;
}

function add(effect) {
    if (!sceneRef) return;
    while (effects.length >= MAX_EFFECTS) {
        const old = effects.shift();
        if (old.mesh) sceneRef.remove(old.mesh);
        if (old.dispose) old.dispose();
    }
    sceneRef.add(effect.mesh);
    effects.push(effect);
}

export function updateEffects(dt, camera) {
    for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i];
        const alive = e.update(dt, camera);
        if (!alive) {
            sceneRef.remove(e.mesh);
            if (e.dispose) e.dispose();
            effects.splice(i, 1);
        }
    }
}

// --- Nombre de degats flottant (billboard texture) ---
const numberCanvasCache = {};
function makeNumberTexture(text, color) {
    const key = text + color;
    if (numberCanvasCache[key]) return numberCanvasCache[key];
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 44px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, 64, 32);
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    numberCanvasCache[key] = tex;
    return tex;
}

export function spawnDamageNumber(pos, amount, opts = {}) {
    const color = opts.color || '#ffffff';
    const text = (opts.prefix || '') + amount;
    const tex = makeNumberTexture(text, color);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    const baseScale = opts.crit ? 1.1 : 0.7;
    sprite.scale.set(baseScale, baseScale * 0.5, 1);
    sprite.position.copy(pos);
    sprite.position.y += 0.8;
    // Petite derive laterale aleatoire
    const drift = (Math.random() - 0.5) * 1.2;
    let life = 0;
    const dur = 0.9;
    add({
        mesh: sprite,
        update(dt) {
            life += dt;
            const t = life / dur;
            sprite.position.y += dt * 1.6;
            sprite.position.x += drift * dt;
            mat.opacity = 1 - t;
            const pop = opts.crit ? 1 + Math.sin(Math.min(t * 6, Math.PI)) * 0.4 : 1;
            sprite.scale.set(baseScale * pop, baseScale * 0.5 * pop, 1);
            return life < dur;
        },
        dispose() { mat.dispose(); }
    });
}

// --- Eclat de particules ---
export function spawnParticles(pos, colorHex, count = 14, opts = {}) {
    count = Math.min(count, opts.maxCount || 12);
    const color = new THREE.Color(colorHex);
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const spread = opts.spread || 4;
    for (let i = 0; i < count; i++) {
        positions[i * 3] = pos.x;
        positions[i * 3 + 1] = pos.y;
        positions[i * 3 + 2] = pos.z;
        velocities[i * 3] = (Math.random() - 0.5) * spread;
        velocities[i * 3 + 1] = Math.random() * spread * 0.8;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * spread;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
        color, size: opts.size || 0.18, transparent: true, opacity: 1,
        depthWrite: false, blending: THREE.AdditiveBlending
    });
    const points = new THREE.Points(geo, mat);
    let life = 0;
    const dur = opts.life || 0.6;
    const grav = opts.gravity !== undefined ? opts.gravity : 6;
    add({
        mesh: points,
        update(dt) {
            life += dt;
            const arr = geo.attributes.position.array;
            for (let i = 0; i < count; i++) {
                velocities[i * 3 + 1] -= grav * dt;
                arr[i * 3] += velocities[i * 3] * dt;
                arr[i * 3 + 1] += velocities[i * 3 + 1] * dt;
                arr[i * 3 + 2] += velocities[i * 3 + 2] * dt;
            }
            geo.attributes.position.needsUpdate = true;
            mat.opacity = 1 - life / dur;
            return life < dur;
        },
        dispose() { geo.dispose(); mat.dispose(); }
    });
}

// --- Onde de choc (anneau qui s'agrandit) ---
export function spawnRing(pos, colorHex, opts = {}) {
    const maxR = opts.radius || 2.5;
    const geo = sharedRingGeometry(opts.segments || 32);
    const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colorHex), transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos);
    ring.position.y = opts.y !== undefined ? opts.y : 0.15;
    let life = 0;
    const dur = opts.life || 0.5;
    add({
        mesh: ring,
        update(dt) {
            life += dt;
            const t = life / dur;
            const r = 0.1 + t * maxR;
            ring.scale.set(r, r, r);
            mat.opacity = 0.9 * (1 - t);
            return life < dur;
        },
        dispose() { mat.dispose(); }
    });
}

// --- Slash d'arme : arc orienté DANS le plan de vue (suit la visée haut/bas/côté) ---
export function spawnSlash(pos, quat, opts = {}) {
    const r = opts.radius || 0.9, arc = opts.arc || Math.PI * 0.85, roll = opts.roll || 0;
    const geo = new THREE.TorusGeometry(r, opts.thick || 0.05, 6, 24, arc);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(opts.color || '#eeeeee'), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    if (quat) m.quaternion.copy(quat);     // aligné au regard -> dans le plan écran
    m.rotateZ(roll - arc / 2);             // angle du coup + centrage de l'arc
    let life = 0; const dur = opts.life || 0.16;
    add({
        mesh: m,
        update(dt) { life += dt; const t = life / dur; m.scale.setScalar(0.7 + t * 0.6); mat.opacity = 0.9 * (1 - t); return life < dur; },
        dispose() { geo.dispose(); mat.dispose(); }
    });
}

// --- Bouffee de lumiere ponctuelle (impact/explosion de sort) ---
export function spawnLightBurst(pos, colorHex, opts = {}) {
    const peak = opts.intensity || 4;
    const light = new THREE.PointLight(new THREE.Color(colorHex), peak, opts.distance || 8);
    light.position.copy(pos);
    let life = 0;
    const dur = opts.life || 0.35;
    add({
        mesh: light,
        update(dt) { life += dt; light.intensity = peak * (1 - life / dur); return life < dur; },
        dispose() { }
    });
}

// --- Flash lumineux ponctuel (impact de sort) ---
export function spawnFlash(pos, colorHex, opts = {}) {
    const seg = opts.segments || 8;
    const geo = sharedSphereGeometry(opts.size || 0.4, seg);
    const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colorHex), transparent: true, opacity: 1,
        depthWrite: false, blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    let life = 0;
    const dur = opts.life || 0.25;
    add({
        mesh,
        update(dt) {
            life += dt;
            const t = life / dur;
            const s = 1 + t * 2.5;
            mesh.scale.set(s, s, s);
            mat.opacity = 1 - t;
            return life < dur;
        },
        dispose() { mat.dispose(); }
    });
}

// --- Sprite FX anime (spritesheet pixel-art billboard) ---
export function spawnSpriteFx(spec, pos, opts = {}) {
    if (!spec) return;
    const anim = makeAnimatedSprite(spec, { scale: opts.scale || spec.scale || 1, color: opts.color || spec.color });
    const sprite = anim.sprite;
    sprite.position.copy(pos);
    sprite.position.y += opts.yOffset != null ? opts.yOffset : 0.6;
    if (opts.depthTest === false) sprite.material.depthTest = false;
    let life = 0;
    const dur = opts.life || spec.life || 0.45;
    add({
        mesh: sprite,
        update(dt, camera) {
            life += dt;
            anim.update(dt);
            if (opts.float) sprite.position.y += dt * opts.float;
            if (camera) sprite.lookAt(camera.position);
            sprite.material.opacity = Math.max(0, 1 - Math.max(0, life - dur * 0.65) / (dur * 0.35));
            return life < dur;
        },
        dispose() {
            if (sprite.material.map) sprite.material.map.dispose();
            sprite.material.dispose();
        }
    });
}
