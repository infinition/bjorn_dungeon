import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { gameState } from './state.js';
import { GameData } from './data.js';
import { computeSpellDamage, computeWeaponDamage, addBuff } from './stats.js';
import { dropLoot, spawnPickup } from './pickups.js';
import { playShootSound, playHitSound, playCritSound, playDeathSound, playBossRoar, playArrowShot, playArrowImpact, playSpellCast, playSpellImpact, playClip } from './sounds.js';
import { addLog } from './utils.js';
import { spawnDamageNumber, spawnParticles, spawnRing, spawnFlash, spawnLightBurst, spawnSpriteFx } from './effects.js';
import { makeAnimatedSprite, makeAnimatedPlaneSprite } from './sprite-anim.js';
import { checkCollision, WALL_HEIGHT } from './dungeon.js';
import { applyEntityStatus } from './status.js';

const projectiles = [];
const delayedBlasts = [];   // impacts différés télégraphiés (météore)
const zones = [];           // nappes persistantes au sol (mur de flammes...)
const allies = [];          // esprits invoqués qui combattent pour le joueur
const MAX_PROJECTILES = 48;
const SHARED_PROJECTILE_LIGHT_INTERVAL = 0.05;
const SHARED_PROJECTILE_LIGHT_DISTANCE = 5.2;
const SHARED_PROJECTILE_LIGHT_INTENSITY = 1.25;
const PROJECTILE_FLOOR_Y = 0.12;
const PROJECTILE_CEILING_Y = WALL_HEIGHT - 0.12;
let lastImpactSpriteAt = -99;
let lastExplosionLightAt = -99;
let lastBounceFxAt = -99;
let lastBlastSpriteAt = -99;
let lastBlastParticlesAt = -99;
let breakableIndexSource = null;
let breakableIndexLength = -1;
let breakableIndex = null;
let sharedProjectileLight = null;
let sharedProjectileLightTimer = 0;
const _tmpBounceDir = new THREE.Vector3();
const _tmpVisualForward = new THREE.Vector3();
const _tmpVisualNormal = new THREE.Vector3();
const _tmpVisualRight = new THREE.Vector3();
const _tmpVisualMatrix = new THREE.Matrix4();
const _tmpVisualRotation = new THREE.Quaternion();
const SHARED_GEOMETRIES = {
    arrow: new THREE.ConeGeometry(0.06, 0.4, 6),
    spell: new THREE.SphereGeometry(0.14, 6, 6),
    halo: new THREE.SphereGeometry(0.3, 6, 6)
};
Object.values(SHARED_GEOMETRIES).forEach(g => { g.userData.shared = true; });
const _projectileMaterials = {};
function projectileMaterial(color, halo = false) {
    const key = `${halo ? 'halo' : 'core'}:${color}`;
    if (!_projectileMaterials[key]) {
        const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            transparent: halo,
            opacity: halo ? 0.4 : 1,
            blending: halo ? THREE.AdditiveBlending : THREE.NormalBlending,
            depthWrite: !halo
        });
        mat.userData.shared = true;
        _projectileMaterials[key] = mat;
    }
    return _projectileMaterials[key];
}

function normalizeProjectileSprite(raw) {
    return typeof raw === 'string'
        ? { type: 'image', src: raw }
        : raw;
}

function projectileRotation(owner) {
    const r = owner && owner.projectileSpriteRotation;
    if (r && typeof r === 'object') {
        return {
            x: Number(r.x || 0),
            y: Number(r.y || 0),
            z: Number(r.z || 0)
        };
    }
    return { x: 0, y: 0, z: Number(owner && owner.projectileSpriteAngle || 0) };
}

function orientProjectilePlane(mesh, dir, layout = 'horizontal', rotation = null) {
    _tmpVisualForward.copy(dir);
    if (_tmpVisualForward.lengthSq() < 0.0001) _tmpVisualForward.set(0, 0, -1);
    _tmpVisualForward.normalize();
    const up = _tmpVisualNormal;
    up.set(0, 1, 0).addScaledVector(_tmpVisualForward, -_tmpVisualForward.y);
    if (up.lengthSq() < 0.0001) up.set(0, 0, 1).addScaledVector(_tmpVisualForward, -_tmpVisualForward.z);
    up.normalize();
    _tmpVisualRight.crossVectors(_tmpVisualForward, up).normalize();
    if (layout === 'horizontal') _tmpVisualMatrix.makeBasis(_tmpVisualRight, _tmpVisualForward, up);
    else _tmpVisualMatrix.makeBasis(_tmpVisualRight, up, _tmpVisualForward);
    mesh.quaternion.setFromRotationMatrix(_tmpVisualMatrix);
    if (rotation) {
        _tmpVisualRotation.setFromEuler(new THREE.Euler(
            THREE.MathUtils.degToRad(rotation.x || 0),
            THREE.MathUtils.degToRad(rotation.y || 0),
            THREE.MathUtils.degToRad(rotation.z || 0),
            'XYZ'
        ));
        mesh.quaternion.multiply(_tmpVisualRotation);
    }
}

function projectileVolume(owner) {
    const v = owner && owner.projectileSpriteVolume;
    return (v === 'flat' || v === 'cross' || v === 'radial') ? v : 'cross';
}

// Sprite vertical (sort) : reste droit et face caméra pour rester lisible,
// sans miroir gauche/droite. Le décalage X/Y/Z s'applique par-dessus.
function orientBillboardPlane(mesh, camera, rotation = null) {
    _tmpVisualForward.copy(camera.position).sub(mesh.position);
    _tmpVisualForward.y = 0;
    if (_tmpVisualForward.lengthSq() < 0.0001) _tmpVisualForward.set(0, 0, 1);
    _tmpVisualForward.normalize();
    const up = _tmpVisualNormal.set(0, 1, 0);
    _tmpVisualRight.crossVectors(up, _tmpVisualForward).normalize();
    _tmpVisualMatrix.makeBasis(_tmpVisualRight, up, _tmpVisualForward);
    mesh.quaternion.setFromRotationMatrix(_tmpVisualMatrix);
    if (rotation) {
        _tmpVisualRotation.setFromEuler(new THREE.Euler(
            THREE.MathUtils.degToRad(rotation.x || 0),
            THREE.MathUtils.degToRad(rotation.y || 0),
            THREE.MathUtils.degToRad(rotation.z || 0),
            'XYZ'
        ));
        mesh.quaternion.multiply(_tmpVisualRotation);
    }
}

function makeProjectileSprite(raw, owner, color, dir, defaultLayout = 'vertical') {
    const spec = normalizeProjectileSprite(raw);
    if (!spec || typeof spec !== 'object' || !(spec.src || '').trim()) return null;
    const layout = owner.projectileSpriteLayout || defaultLayout;
    const rotation = projectileRotation(owner);
    const scale = owner.projectileScale || owner.projectileSpriteScale || owner.fxScale || 0.9;
    const anim = makeAnimatedPlaneSprite(spec, { scale, color, mirrorMode: projectileVolume(owner) });
    return { anim, mesh: anim.sprite, layout, rotation, billboard: layout !== 'horizontal' };
}

export function currentSpell() { return GameData.spells[gameState.currentSpellIndex] || GameData.spells[0]; }
export function spellCooldownLeft(id) { return Math.max(0, (gameState.spellCooldowns[id] || 0) - gameState.time); }

// =====================================================================
//  LANCER DE SORT (clavier dedie)
// =====================================================================
export function castSpell(camera, scene, mobs, boss, spell, world = null) {
    if (gameState.isDead || gameState.won) return;
    if (!spell) spell = currentSpell();
    if (spellCooldownLeft(spell.id) > 0) return;
    if (gameState.mana < spell.manaCost) { addLog('Mana insuffisant !', 'text-blue-400'); return; }

    gameState.mana -= spell.manaCost;
    const cd = (spell.cooldown || 0.5) * (1 - Math.min(0.6, gameState.stats.attackSpeed));
    gameState.spellCooldowns[spell.id] = gameState.time + cd;
    playSpellCast(spell);

    // Soin
    if (spell.type === 'heal') {
        const heal = spell.heal || 25;
        gameState.hp = Math.min(gameState.maxHp, gameState.hp + heal);
        spawnDamageNumber(camera.position, heal, { color: '#3ee85e', prefix: '+' });
        spawnSpriteFx(spell.fx, camera.position, { scale: spell.fxScale || 1.2, yOffset: 0.3, life: 0.5, depthTest: false });
        spawnRing(camera.position, '#3ee85e', { radius: 1.6, life: 0.5, y: 0.2 });
        spawnParticles(camera.position, '#3ee85e', 18, { spread: 3, life: 0.7 });
        spawnLightBurst(camera.position, '#3ee85e', { intensity: 5, distance: 8, life: 0.45 });
        addLog(`Soin +${heal}`, 'text-green-400');
        return;
    }

    if (spell.type === 'buff') {
        const buff = spell.buff || { stat: 'defense', amount: 8, duration: 12 };
        addBuff(buff.stat, buff.amount, buff.duration || 12, {
            id: spell.id || buff.stat,
            name: spell.name,
            icon: spell.icon,
            color: spell.color,
            sprite: spell.sprite
        });
        if (spell.hpCost) gameState.hp = Math.max(1, gameState.hp - spell.hpCost);
        const color = spell.color || '#ffd24d';
        spawnDamageNumber(camera.position, spell.name, { color });
        spawnSpriteFx(spell.fx, camera.position, { scale: spell.fxScale || 1.35, yOffset: 0.25, life: 0.55, depthTest: false });
        spawnRing(camera.position, color, { radius: spell.radius || 1.8, life: 0.55, y: 0.2 });
        spawnParticles(camera.position, color, 22, { spread: 3, life: 0.7 });
        spawnLightBurst(camera.position, color, { intensity: 5, distance: 8, life: 0.35 });
        addLog(spell.log || `${spell.name} !`, 'text-purple-300');
        return;
    }

    if (spell.type === 'chain') {
        const color = spell.color || '#7fdfff';
        const jumps = spell.jumps || 4;
        const radius = spell.radius || 7;
        const targets = [...mobs]; if (!gameState.bossDead && boss) targets.push(boss);
        let origin = camera.position.clone();
        let dmgMul = 1;
        const hit = new Set();
        for (let j = 0; j < jumps; j++) {
            let best = null, bd = radius;
            for (const t of targets) {
                if (t.userData.dead || hit.has(t)) continue;
                const d = t.position.distanceTo(origin);
                if (d < bd) { bd = d; best = t; }
            }
            if (!best) break;
            hit.add(best);
            const { amount, crit } = computeSpellDamage(spell);
            applyDamage(best, Math.max(1, Math.round(amount * dmgMul)), crit, scene, mobs, boss, spell.status);
            breakBreakablesNear(best.position, world, 1.1, false);
            spawnChainArc(origin, best.position, color, scene);
            spawnSpriteFx(spell.fx, best.position, { scale: spell.fxScale || 0.85, yOffset: 0.65, life: 0.25 });
            spawnFlash(best.position, color, { size: 0.45, life: 0.2 });
            spawnLightBurst(best.position, color, { intensity: 5, distance: 6, life: 0.25 });
            origin = best.position.clone();
            dmgMul *= 0.72;
        }
        if (!hit.size) addLog('Aucune cible pour la chaine.', 'text-blue-400');
        return;
    }

    // Égide : bouclier absorbant (les dégâts entament l'égide avant les PV)
    if (spell.type === 'ward') {
        const amount = Math.round((spell.ward || 40) + gameState.stats.spellPower * 1.2);
        gameState.ward = { amount, max: amount, until: gameState.time + (spell.duration || 12) };
        const color = spell.color || '#ffd24d';
        spawnSpriteFx(spell.fx, camera.position, { scale: spell.fxScale || 1.4, yOffset: 0.25, life: 0.55, depthTest: false });
        spawnRing(camera.position, color, { radius: 1.8, life: 0.55, y: 0.2 });
        spawnLightBurst(camera.position, color, { intensity: 5, distance: 8, life: 0.4 });
        addLog(`${spell.name} : ${amount} dégâts absorbés`, 'text-yellow-300');
        return;
    }

    // Rayon instantané : perce tout sur la ligne de visée (avec drain de vie optionnel)
    if (spell.type === 'beam') {
        const range = spell.range || 14;
        const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
        let end = range;
        for (let d = 0.5; d < range; d += 0.25) {
            if (checkCollision({ x: camera.position.x + fwd.x * d, z: camera.position.z + fwd.z * d })) { end = d; break; }
        }
        const targets = [...mobs]; if (!gameState.bossDead && boss) targets.push(boss);
        let hits = 0;
        for (const tgt of targets) {
            if (tgt.userData.dead) continue;
            const rx = tgt.position.x - camera.position.x, rz = tgt.position.z - camera.position.z;
            const along = rx * fwd.x + rz * fwd.z;
            if (along < 0 || along > end) continue;
            const perp = Math.abs(rx * fwd.z - rz * fwd.x);
            if (perp > 0.55 + 0.45 * (tgt.userData.scale || 1)) continue;
            const { amount, crit } = computeSpellDamage(spell);
            applyDamage(tgt, amount, crit, scene, mobs, boss, spell.status);
            if (spell.drain) gameState.hp = Math.min(gameState.maxHp, gameState.hp + amount * spell.drain);
            spawnFlash(tgt.position, spell.color, { size: 0.4, life: 0.2 });
            spawnSpriteFx(spell.fx, tgt.position, { scale: spell.fxScale || 0.8, yOffset: 0.5, life: 0.22 });
            hits++;
        }
        spawnBeamFx(camera, fwd, end, spell.color || '#4deeea', scene);
        spawnLightBurst(camera.position, spell.color, { intensity: 4, distance: 7, life: 0.25 });
        if (spell.drain && hits) addLog('Le rayon draine leur essence.', 'text-red-300');
        return;
    }

    // Météore : impact différé télégraphié au point visé
    if (spell.type === 'meteor') {
        const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
        const range = spell.range || 10;
        let end = range;
        for (let d = 0.6; d < range; d += 0.3) {
            if (checkCollision({ x: camera.position.x + fwd.x * d, z: camera.position.z + fwd.z * d })) { end = Math.max(0.6, d - 0.4); break; }
        }
        const x = camera.position.x + fwd.x * end, z = camera.position.z + fwd.z * end;
        const delay = spell.delay || 0.85;
        spawnRing({ x, y: 0.14, z }, spell.color || '#ff8830', { radius: spell.radius || 3, life: delay, y: 0.14 });
        delayedBlasts.push({ at: gameState.time + delay, x, z, spell });
        return;
    }

    // Nappe persistante au sol (mur de flammes, marécage...)
    if (spell.type === 'zone') {
        const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
        const range = spell.range || 7;
        let end = range;
        for (let d = 0.6; d < range; d += 0.3) {
            if (checkCollision({ x: camera.position.x + fwd.x * d, z: camera.position.z + fwd.z * d })) { end = Math.max(0.6, d - 0.4); break; }
        }
        const x = camera.position.x + fwd.x * end, z = camera.position.z + fwd.z * end;
        const radius = spell.radius || 2.2;
        const mesh = makeZoneMesh(spell.color || '#ff7722', radius);
        mesh.position.set(x, 0, z);
        scene.add(mesh);
        zones.push({ mesh, x, z, radius, until: gameState.time + (spell.duration || 6), nextTick: 0, spell });
        spawnSpriteFx(spell.fx, { x, y: 0, z }, { scale: spell.fxScale || 1.3, yOffset: 0.4, life: 0.4 });
        return;
    }

    // Invocation : esprit gardien qui orbite autour du joueur et mitraille les ennemis
    if (spell.type === 'summon') {
        const maxAllies = spell.maxAllies || 2;
        while (allies.length >= maxAllies) { const a = allies.shift(); disposeAlly(a, scene); }
        const mesh = makeAllyMesh(spell.color || '#8fd8ff');
        mesh.position.set(camera.position.x, 1.4, camera.position.z);
        scene.add(mesh);
        allies.push({ mesh, until: gameState.time + (spell.duration || 15), nextShot: gameState.time + 0.4, phase: Math.random() * 6.28, spell });
        spawnRing(camera.position, spell.color, { radius: 1.6, life: 0.5, y: 0.2 });
        spawnParticles(mesh.position, spell.color, 16, { spread: 2.5, life: 0.6 });
        addLog(spell.log || `${spell.name} répond à ton appel !`, 'text-cyan');
        return;
    }

    // Nova instantanee (robuste : champs custom optionnels)
    if (spell.type === 'nova') {
        const radius = spell.radius || 4;
        const color = spell.color || '#88ddff';
        const center = camera.position.clone(); center.y = 0.6;
        spawnSpriteFx(spell.fx, camera.position, { scale: spell.fxScale || 1.7, yOffset: 0.1, life: 0.5, depthTest: false });
        spawnRing(center, color, { radius, life: 0.5, y: 0.3 });
        spawnParticles(center, color, 30, { spread: Math.min(8, radius + 1), life: 0.7, gravity: 2 });
        spawnLightBurst(center, color, { intensity: 7, distance: radius + 5, life: 0.5 });
        breakBreakablesNear(center, world, radius, false);
        const targets = [...mobs]; if (!gameState.bossDead && boss) targets.push(boss);
        targets.forEach(t => {
            if (t.userData.dead) return;
            if (t.position.distanceTo(camera.position) <= radius) {
                const { amount, crit } = computeSpellDamage(spell);
                applyDamage(t, amount, crit, scene, mobs, boss, spell.status);
                t.userData.slowUntil = gameState.time + 2.5;
            }
        });
        return;
    }

    // Multishot : objets ultra-rares -> plusieurs projectiles en cone
    const sp = gameState.specials || {};
    const n = Math.max(1, sp.multishot || 1);
    const spread = sp.spread || 0.22;
    for (let k = 0; k < n; k++) {
        const off = n > 1 ? (k - (n - 1) / 2) * spread : 0;
        spawnProjectile(camera, scene, { kind: 'spell', spell, color: spell.color || '#c44dff', speed: spell.speed || 12, life: spell.lifetime || 2, angleOffset: off });
    }
}

// =====================================================================
//  TIR DE FLECHE (arme a distance)
// =====================================================================
export function fireArrow(camera, scene, weapon) {
    playArrowShot(weapon);
    const sp = gameState.specials || {};
    const n = Math.max(1, sp.multishot || 1);
    const spread = sp.spread || 0.22;
    for (let k = 0; k < n; k++) {
        const off = n > 1 ? (k - (n - 1) / 2) * spread : 0;
        spawnProjectile(camera, scene, { kind: 'arrow', weapon, color: '#e8d18a', speed: weapon.projSpeed || 18, life: 2.5, angleOffset: off });
    }
}

function spawnProjectile(camera, scene, opt) {
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    // Decalage angulaire (multishot en cone)
    if (opt.angleOffset) fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), opt.angleOffset);
    // Origine = BOUT DE L'ARME (bas-droite du viewmodel), pas le centre de l'écran.
    // On vise ensuite le réticule (point lointain au centre) -> le trait converge depuis l'arme.
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const muzzle = camera.position.clone()
        .add(right.clone().multiplyScalar(0.24))
        .add(new THREE.Vector3(0, -0.2, 0))
        .add(fwd.clone().multiplyScalar(0.6));
    const aim = camera.position.clone().add(fwd.clone().multiplyScalar(40));
    const dir = aim.sub(muzzle).normalize();
    let mesh, fxAnim = null;

    const spriteOwner = opt.kind === 'spell' ? opt.spell : opt.weapon;
    const customSprite = spriteOwner && spriteOwner.projectileSprite;
    const customSpriteEnabled = opt.kind === 'arrow' || (opt.kind === 'spell' && opt.spell.projectileFx === true);
    const projectileVisual = customSpriteEnabled ? makeProjectileSprite(customSprite, spriteOwner || {}, opt.color, dir, opt.kind === 'arrow' ? 'horizontal' : 'vertical') : null;

    if (projectileVisual) {
        // Visuel sprite optionnel. La position du sprite reste le projectile physique.
        fxAnim = projectileVisual.anim;
        mesh = projectileVisual.mesh;
    } else {
        const geom = opt.kind === 'arrow' ? SHARED_GEOMETRIES.arrow : SHARED_GEOMETRIES.spell;
        const mat = projectileMaterial(opt.color);
        mesh = new THREE.Mesh(geom, mat);
        if (opt.kind === 'arrow') mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone());
        else {
            const halo = new THREE.Mesh(SHARED_GEOMETRIES.halo, projectileMaterial(opt.color, true));
            mesh.add(halo);
        }
    }

    mesh.position.copy(muzzle);
    if (projectileVisual) {
        if (projectileVisual.billboard) orientBillboardPlane(mesh, camera, projectileVisual.rotation);
        else orientProjectilePlane(mesh, dir, projectileVisual.layout, projectileVisual.rotation);
    }

    // L'eclairage des sorts est gere par une lumiere partagee dans updateSpells.

    scene.add(mesh);
    const extra = (gameState.specials && gameState.specials.extraBounce) || 0;
    while (projectiles.length >= MAX_PROJECTILES) {
        const old = projectiles.shift();
        if (old) { disposeProjectile(old); scene.remove(old.mesh); }
    }
    projectiles.push({ mesh, fxAnim, visualLayout: projectileVisual && projectileVisual.layout, visualBillboard: projectileVisual && projectileVisual.billboard, visualRotation: projectileVisual && projectileVisual.rotation, velocity: dir.clone().multiplyScalar(opt.speed), life: opt.life, kind: opt.kind, spell: opt.spell, weapon: opt.weapon, hitSet: new Set(), bounces: 0, maxBounces: 6 + extra });
}

// =====================================================================
//  MISE A JOUR PROJECTILES
// =====================================================================
function breakBreakablesNear(pos, world, radius, firstOnly = true) {
    const list = world && world.breakables;
    const destroy = world && world.destroyBreakableAt;
    if (!list || !destroy || !list.length) return false;
    const candidates = breakableCandidatesNear(list, pos, radius);
    const radiusSq = radius * radius;
    let hit = false;
    for (let ci = candidates.length - 1; ci >= 0; ci--) {
        const candidate = candidates[ci];
        let i = candidate.index;
        const b = candidate.item;
        if (!b || !b.mesh || b.mesh.visible === false) continue;
        const bx = Number.isFinite(b.x) ? b.x : b.mesh.position.x;
        const bz = Number.isFinite(b.z) ? b.z : b.mesh.position.z;
        const dx = bx - pos.x;
        const dz = bz - pos.z;
        if (dx * dx + dz * dz > radiusSq) continue;
        if (list[i] !== b) i = list.indexOf(b);
        if (i < 0) continue;
        if (destroy(i)) hit = true;
        if (firstOnly && hit) return true;
    }
    return hit;
}

function breakableCandidatesNear(list, pos, radius) {
    if (breakableIndexSource !== list || breakableIndexLength !== list.length) {
        breakableIndexSource = list;
        breakableIndexLength = list.length;
        breakableIndex = new Map();
        for (let i = 0; i < list.length; i++) {
            const b = list[i];
            if (!b) continue;
            const x = Number.isFinite(b.x) ? b.x : b.mesh && b.mesh.position.x;
            const z = Number.isFinite(b.z) ? b.z : b.mesh && b.mesh.position.z;
            if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
            const key = `${Math.floor(x)},${Math.floor(z)}`;
            let cell = breakableIndex.get(key);
            if (!cell) { cell = []; breakableIndex.set(key, cell); }
            cell.push({ index: i, item: b });
        }
    }
    const out = [];
    const minX = Math.floor(pos.x - radius);
    const maxX = Math.floor(pos.x + radius);
    const minZ = Math.floor(pos.z - radius);
    const maxZ = Math.floor(pos.z + radius);
    for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
            const cell = breakableIndex.get(`${x},${z}`);
            if (cell) out.push(...cell);
        }
    }
    return out;
}

export function updateSpells(dt, scene, mobs, boss, camera, world = null) {
    ensureSharedProjectileLight(scene);
    // Impacts différés (météore) : explosent quand le télégraphe expire
    for (let i = delayedBlasts.length - 1; i >= 0; i--) {
        const b = delayedBlasts[i];
        if (gameState.time < b.at) continue;
        delayedBlasts.splice(i, 1);
        blastAt(new THREE.Vector3(b.x, 0.25, b.z), b.spell, scene, mobs, boss, world);
    }
    updateZones(dt, scene, mobs, boss);
    updateAllies(dt, scene, mobs, boss, camera);
    updateDissolving(dt);

    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        let remove = false;

        // --- Deplacement avec collision murale (rebond axe par axe) ---
        const vx = p.velocity.x * dt, vy = p.velocity.y * dt, vz = p.velocity.z * dt;
        const prevX = p.mesh.position.x, prevY = p.mesh.position.y, prevZ = p.mesh.position.z;
        let hitWall = false;
        if (checkCollision({ x: p.mesh.position.x + vx, z: p.mesh.position.z })) { p.velocity.x = -p.velocity.x; hitWall = true; } else p.mesh.position.x += vx;
        if (checkCollision({ x: p.mesh.position.x, z: p.mesh.position.z + vz })) { p.velocity.z = -p.velocity.z; hitWall = true; } else p.mesh.position.z += vz;
        const nextY = p.mesh.position.y + vy;
        if (nextY <= PROJECTILE_FLOOR_Y) {
            p.mesh.position.y = PROJECTILE_FLOOR_Y;
            p.velocity.y = Math.abs(p.velocity.y);
            hitWall = true;
        } else if (nextY >= PROJECTILE_CEILING_Y) {
            p.mesh.position.y = PROJECTILE_CEILING_Y;
            p.velocity.y = -Math.abs(p.velocity.y);
            hitWall = true;
        } else {
            p.mesh.position.y = nextY;
        }

        p.life -= dt;
        if (p.fxAnim) p.fxAnim.update(dt);
        if (p.visualBillboard) orientBillboardPlane(p.mesh, camera, p.visualRotation);
        else if (p.visualLayout) orientProjectilePlane(p.mesh, p.velocity, p.visualLayout, p.visualRotation);
        else if (p.kind === 'spell' && p.mesh.children[0] && p.mesh.children[0].isMesh) { const s = 1 + Math.sin(gameState.time * 20) * 0.2; p.mesh.children[0].scale.set(s, s, s); }

        let brokeProp = false;
        if (p.kind === 'spell') {
            brokeProp = hitWall
                ? breakBreakablesNear(p.mesh.position, world, 1.05, true)
                : breakBreakablesNear(p.mesh.position, world, 0.62, true);
            if (brokeProp) {
                if (p.spell && p.spell.type === 'aoe') { explode(p, scene, mobs, boss, world); remove = true; }
                else if (!(p.spell && p.spell.type === 'pierce')) remove = true;
            }
        }

        if (hitWall && !brokeProp) {
            const col = p.spell ? p.spell.color : '#e8d18a';
            const canBounceFx = gameState.time - lastBounceFxAt > 0.08;
            if (canBounceFx) {
                lastBounceFxAt = gameState.time;
                spawnParticles(p.mesh.position, col, 4, { spread: 1.4, life: 0.22, maxCount: 4 });
            }
            if (p.kind === 'arrow') { playArrowImpact(p.weapon); remove = true; }  // fleche : se brise
            else if (p.spell.type === 'aoe') { explode(p, scene, mobs, boss, world); remove = true; }  // aoe : explose
            else if (p.bounces >= p.maxBounces) {
                if (canBounceFx) spawnFlash(p.mesh.position, col, { size: 0.32, life: 0.12 });
                playSpellImpact(p.spell);
                remove = true;
            }
            else {
                p.bounces++;
                p.mesh.position.set(prevX, prevY, prevZ);
                p.mesh.position.add(_tmpBounceDir.copy(p.velocity).normalize().multiplyScalar(0.12));
                if (canBounceFx) spawnFlash(p.mesh.position, col, { size: 0.2, life: 0.1 });
            }
        }

        const targetCount = remove ? 0 : mobs.length + (!gameState.bossDead && boss ? 1 : 0);
        for (let ti = 0; ti < targetCount; ti++) {
            const t = ti < mobs.length ? mobs[ti] : boss;
            if (t.userData.dead || p.hitSet.has(t)) continue;
            const hitR = (t.userData.scale || 1) * 0.6 + 0.4;
            const dx = p.mesh.position.x - t.position.x, dy = p.mesh.position.y - t.position.y, dz = p.mesh.position.z - t.position.z;
            if (dx * dx + dy * dy + dz * dz < hitR * hitR) {
                if (p.kind === 'spell' && p.spell.type === 'aoe') { explode(p, scene, mobs, boss, world); remove = true; break; }
                const { amount, crit } = p.kind === 'arrow' ? computeWeaponDamage() : computeSpellDamage(p.spell);
                const coating = gameState.weaponCoating && gameState.weaponCoating.until > gameState.time ? gameState.weaponCoating.status : null;
                const st = p.kind === 'arrow' ? (coating || (p.weapon && p.weapon.status)) : (p.spell && p.spell.status);
                applyDamage(t, amount, crit, scene, mobs, boss, st);
                spawnFlash(p.mesh.position, p.kind === 'arrow' ? '#e8d18a' : p.spell.color, { size: 0.3, life: 0.2 });
                if (p.kind === 'spell' && gameState.time - lastImpactSpriteAt > 0.06) {
                    lastImpactSpriteAt = gameState.time;
                    spawnSpriteFx(p.spell && p.spell.fx, p.mesh.position, { scale: p.spell.fxScale || 0.75, yOffset: 0.2, life: 0.18 });
                }
                if (p.kind === 'spell') playSpellImpact(p.spell);
                else if (p.kind === 'arrow') playArrowImpact(p.weapon);
                if (p.kind === 'spell' && p.spell.type === 'pierce') p.hitSet.add(t);
                else { remove = true; break; }
            }
        }
        if (!remove && p.life <= 0) { if (p.kind === 'spell' && p.spell.type === 'aoe') explode(p, scene, mobs, boss, world); remove = true; }
        if (remove) { disposeProjectile(p); scene.remove(p.mesh); projectiles.splice(i, 1); }
    }
    updateSharedProjectileLight(dt, camera);
}

function ensureSharedProjectileLight(scene) {
    if (!sharedProjectileLight) {
        sharedProjectileLight = new THREE.PointLight(0x4deeea, 0, SHARED_PROJECTILE_LIGHT_DISTANCE);
        sharedProjectileLight.visible = false;
    }
    if (sharedProjectileLight.parent !== scene) scene.add(sharedProjectileLight);
}

function updateSharedProjectileLight(dt, camera) {
    if (!sharedProjectileLight) return;

    let target = null;
    let bestDist = Infinity;
    for (const p of projectiles) {
        if (p.kind !== 'spell') continue;
        const d = camera ? p.mesh.position.distanceToSquared(camera.position) : 0;
        if (d < bestDist) { bestDist = d; target = p; }
    }

    if (!target) {
        sharedProjectileLight.visible = false;
        sharedProjectileLight.intensity = 0;
        sharedProjectileLightTimer = 0;
        return;
    }

    sharedProjectileLightTimer -= dt;
    if (sharedProjectileLightTimer > 0 && sharedProjectileLight.visible) return;
    sharedProjectileLightTimer = SHARED_PROJECTILE_LIGHT_INTERVAL;

    sharedProjectileLight.visible = true;
    sharedProjectileLight.position.copy(target.mesh.position);
    sharedProjectileLight.color.set(target.spell && target.spell.color ? target.spell.color : '#4deeea');
    sharedProjectileLight.intensity = SHARED_PROJECTILE_LIGHT_INTENSITY + Math.sin(gameState.time * 18) * 0.2;
}

export function clearProjectiles(scene) {
    projectiles.forEach(p => { disposeProjectile(p); scene.remove(p.mesh); });
    projectiles.length = 0;
    if (sharedProjectileLight) {
        sharedProjectileLight.visible = false;
        sharedProjectileLight.intensity = 0;
        sharedProjectileLightTimer = 0;
    }
    delayedBlasts.length = 0;
    zones.forEach(z => { scene.remove(z.mesh); z.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); });
    zones.length = 0;
    allies.forEach(a => scene.remove(a.mesh));
    allies.length = 0;
    dissolving.length = 0;
    gameState.ward = null;
}

function disposeProjectile(p) {
    p.mesh.traverse(obj => {
        if (obj.geometry && obj.geometry.dispose && !obj.geometry.userData.shared) obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach(mat => {
            if (!mat) return;
            ['map', 'alphaMap', 'emissiveMap'].forEach(key => {
                if (mat[key] && mat[key].dispose) mat[key].dispose();
            });
            if (mat.dispose && !mat.userData.shared) mat.dispose();
        });
    });
}

function spawnChainArc(from, to, color, scene) {
    const pts = [];
    const a = from.clone(); a.y = 1.05;
    const b = to.clone(); b.y = 1.05;
    const dir = new THREE.Vector3().subVectors(b, a);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const p = a.clone().lerp(b, t);
        p.add(side.clone().multiplyScalar((Math.random() - 0.5) * 0.35));
        p.y += Math.sin(t * Math.PI) * 0.25;
        pts.push(p);
    }
    const mesh = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.95 })
    );
    scene.add(mesh);
    setTimeout(() => { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }, 130);
}

function explode(p, scene, mobs, boss, world = null) {
    blastAt(p.mesh.position.clone(), p.spell, scene, mobs, boss, world);
}

// Explosion de sort en un point (projectile aoe, météore différé)
function blastAt(pos, spell, scene, mobs, boss, world = null) {
    playSpellImpact(spell);
    const radius = spell.radius || 3;
    spawnRing(pos, spell.color, { radius, life: 0.35, y: pos.y || 0.2, segments: 24 });
    if (gameState.time - lastBlastParticlesAt > 0.04) {
        lastBlastParticlesAt = gameState.time;
        spawnParticles(pos, spell.color, 10, { spread: Math.min(4, radius + 1), life: 0.34, maxCount: 10 });
    }
    spawnFlash(pos, spell.color, { size: 0.55, life: 0.18, segments: 8 });
    if (gameState.time - lastBlastSpriteAt > 0.08) {
        lastBlastSpriteAt = gameState.time;
        spawnSpriteFx(spell.fx, pos, { scale: spell.fxImpactScale || spell.fxScale || 1.1, yOffset: 0.35, life: 0.3 });
    }
    if (gameState.time - lastExplosionLightAt > 0.16) {
        lastExplosionLightAt = gameState.time;
        spawnLightBurst(pos, spell.color, { intensity: 3.5, distance: radius + 4, life: 0.22 });
    }
    if (spell.type === 'meteor' && window.triggerShake) window.triggerShake(0.035, 0.3);
    breakBreakablesNear(pos, world, radius, false);
    const radiusSq = radius * radius;
    const targetCount = mobs.length + (!gameState.bossDead && boss ? 1 : 0);
    for (let ti = 0; ti < targetCount; ti++) {
        const t = ti < mobs.length ? mobs[ti] : boss;
        if (t.userData.dead) continue;
        const dx = t.position.x - pos.x, dz = t.position.z - pos.z;
        if (dx * dx + dz * dz <= radiusSq) {
            const { amount, crit } = computeSpellDamage(spell);
            applyDamage(t, amount, crit, scene, mobs, boss, spell.status);
        }
    }
}

// --- Visuels et entités des nouveaux types de sorts ---
function spawnBeamFx(camera, fwd, length, color, scene) {
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const start = camera.position.clone().add(right.multiplyScalar(0.22)).add(new THREE.Vector3(0, -0.18, 0)).add(fwd.clone().multiplyScalar(0.4));
    const end = camera.position.clone().add(fwd.clone().multiplyScalar(length));
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = Math.max(0.5, dir.length());
    const geo = new THREE.CylinderGeometry(0.045, 0.1, len, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(start).add(dir.clone().multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    scene.add(mesh);
    setTimeout(() => { scene.remove(mesh); geo.dispose(); mat.dispose(); }, 150);
}

function makeZoneMesh(color, radius) {
    const col = new THREE.Color(color);
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 24),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.06;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.92, 0.05, 6, 28),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.1;
    g.add(disc, ring);
    return g;
}

function makeAllyMesh(color) {
    const col = new THREE.Color(color);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color: col }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.add(halo);
    const light = new THREE.PointLight(col, 1.1, 5);
    core.add(light);
    return core;
}

function disposeAlly(a, scene) {
    spawnParticles(a.mesh.position, a.spell.color, 10, { spread: 2, life: 0.4 });
    scene.remove(a.mesh);
    a.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
}

function fireAllyBolt(a, target, scene) {
    const sp = a.spell;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(sp.color) }));
    mesh.position.copy(a.mesh.position);
    const dir = new THREE.Vector3().subVectors(target.position, a.mesh.position).normalize();
    scene.add(mesh);
    projectiles.push({ mesh, fxAnim: null, light: null, velocity: dir.multiplyScalar(sp.projSpeed || 13), life: 1.6, kind: 'spell', spell: { ...sp, type: 'bolt' }, hitSet: new Set(), bounces: 0, maxBounces: 0 });
}

function updateAllies(dt, scene, mobs, boss, camera) {
    for (let i = allies.length - 1; i >= 0; i--) {
        const a = allies[i];
        if (gameState.time >= a.until || gameState.isDead) { disposeAlly(a, scene); allies.splice(i, 1); continue; }
        a.phase += dt * 2.2;
        // orbite autour du joueur
        const tx = camera.position.x + Math.cos(a.phase) * 1.15;
        const tz = camera.position.z + Math.sin(a.phase) * 1.15;
        const ty = 1.35 + Math.sin(a.phase * 2.4) * 0.12;
        a.mesh.position.x += (tx - a.mesh.position.x) * Math.min(1, dt * 4);
        a.mesh.position.y += (ty - a.mesh.position.y) * Math.min(1, dt * 4);
        a.mesh.position.z += (tz - a.mesh.position.z) * Math.min(1, dt * 4);
        a.mesh.rotation.y += dt * 3;
        // tir sur la cible vivante la plus proche
        if (gameState.time >= a.nextShot) {
            a.nextShot = gameState.time + (a.spell.fireRate || 1.1);
            let best = null, bd = a.spell.aggroRange || 13;
            const targets = [...mobs]; if (!gameState.bossDead && boss) targets.push(boss);
            for (const t of targets) {
                if (t.userData.dead) continue;
                const d = t.position.distanceTo(a.mesh.position);
                if (d < bd) { bd = d; best = t; }
            }
            if (best) { fireAllyBolt(a, best, scene); spawnFlash(a.mesh.position, a.spell.color, { size: 0.2, life: 0.15 }); }
        }
    }
}

function updateZones(dt, scene, mobs, boss) {
    for (let i = zones.length - 1; i >= 0; i--) {
        const z = zones[i];
        if (gameState.time >= z.until) {
            scene.remove(z.mesh);
            z.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
            zones.splice(i, 1); continue;
        }
        z.mesh.children[1].rotation.z += dt * 1.4;
        const pulse = 0.9 + Math.sin(gameState.time * 5) * 0.1;
        z.mesh.children[0].material.opacity = 0.16 + pulse * 0.1;
        if (gameState.time >= z.nextTick) {
            z.nextTick = gameState.time + 0.5;
            const targets = [...mobs]; if (!gameState.bossDead && boss) targets.push(boss);
            const r2 = z.radius * z.radius;
            for (const t of targets) {
                if (t.userData.dead) continue;
                const dx = t.position.x - z.x, dz = t.position.z - z.z;
                if (dx * dx + dz * dz > r2) continue;
                const { amount } = computeSpellDamage(z.spell);
                applyDamage(t, Math.max(1, Math.round(amount * 0.4)), false, scene, mobs, boss, z.spell.status);
            }
            spawnParticles({ x: z.x + (Math.random() - 0.5) * z.radius, y: 0.3, z: z.z + (Math.random() - 0.5) * z.radius, distanceTo: () => 0 }, z.spell.color, 3, { spread: 1, life: 0.4, gravity: -0.6, maxCount: 3 });
        }
    }
}

// Degats directs (ticks de statut) : pas de crit ni vol de vie, mort geree.
export function dealDirectDamage(entity, amount, color, scene, mobs, boss) {
    const u = entity.userData;
    if (u.dead) return;
    amount = Math.max(1, Math.round(amount));
    u.hp -= amount; u.hitFlash = 0.06;
    spawnDamageNumber(entity.position, amount, { color });
    if (u.isBoss) gameState.bossHp = Math.max(0, u.hp);
    if (u.hp <= 0) killEntity(entity, scene, mobs, boss);
}

// =====================================================================
//  DEGATS (mobs ET boss)
// =====================================================================
export function applyDamage(entity, amount, crit, scene, mobs, boss, status) {
    const u = entity.userData;
    if (u.dead) return;
    // Exécution (Hache du Bourreau) : bonus contre les cibles affaiblies
    const exec = gameState.specials && gameState.specials.execute;
    if (exec && u.hp / u.maxHp < 0.3) amount = Math.round(amount * (1 + exec));
    u.hp -= amount; u.hitFlash = 0.12;
    if (!u.isBoss && !u.aggro) { u.aggro = true; u.packAlert = true; }   // un mob frappé riposte et alerte les siens
    if (status && u.hp > 0) applyEntityStatus(u, status.type, status.dps, status.duration);

    spawnDamageNumber(entity.position, amount, { color: crit ? '#ffd24d' : '#ffffff', crit });
    spawnParticles(entity.position, crit ? '#ffd24d' : '#ff6666', crit ? 12 : 6, { spread: 2.5, life: 0.4 });
    if (crit) { playCritSound(); } else playHitSound();

    // Vol de vie
    const ls = gameState.stats.lifesteal;
    if (ls > 0) { gameState.hp = Math.min(gameState.maxHp, gameState.hp + amount * ls); }

    if (u.isBoss) { gameState.bossHp = Math.max(0, u.hp); updateTargetBar('☠ ' + u.name, u.hp, u.maxHp, true); checkBossEnrage(u); }
    else updateTargetBar(u.name, u.hp, u.maxHp, false);

    if (u.hp <= 0) killEntity(entity, scene, mobs, boss);
}

function killEntity(entity, scene, mobs, boss) {
    const u = entity.userData;
    u.dead = true; u.hp = 0;
    spawnParticles(entity.position, u.color || '#ffffff', 22, { spread: 4, life: 0.7 });
    spawnRing(entity.position, u.color || '#ffffff', { radius: 1.5, life: 0.4 });
    if (!playClip(u.deathSound)) playDeathSound();

    // Porteur de la clé du caveau : la clé tombe toujours
    if (u.vaultKeyHolder) {
        const key = (GameData.items || []).find(i => i.id === 'vault_key');
        if (key) {
            spawnPickup(entity.position.x, entity.position.z, 'item', JSON.parse(JSON.stringify(key)));
            addLog('★ La clé du caveau tombe au sol !', 'text-yellow-300');
        }
    }

    // Loot
    dropLoot(entity.position.x, entity.position.z, {
        goldMin: u.gold ? u.gold[0] : 0, goldMax: u.gold ? u.gold[1] : 0,
        rolls: u.lootRolls || (u.isBoss ? 3 : 1),
        chance: u.lootChance != null ? u.lootChance : 0.4,
        boost: u.isBoss ? 1 : (u.eliteBoost || 0),
        tier: u.tier
    });

    if (window.gainXp) window.gainXp(u.xp || 10);
    gameState.kills++; gameState.honor += u.isBoss ? 50 : 2;

    // Faux du Moissonneur : chaque kill rend des PV
    const okh = gameState.specials && gameState.specials.onKillHeal;
    if (okh > 0 && !gameState.isDead) {
        gameState.hp = Math.min(gameState.maxHp, gameState.hp + okh);
        spawnDamageNumber(entity.position, okh, { color: '#3ee85e', prefix: '+' });
    }

    if (u.anim && u.anim.hasState('death')) u.anim.setState('death');
    else startDissolve(entity);   // fondu + affaissement (au lieu de disparaître sec)

    const bar = document.getElementById('target-bar-container'); if (bar) bar.classList.add('hidden');

    if (u.isBoss) {
        gameState.bossDead = true;
        addLog('★ BOSS VAINCU ! Le portail s\'ouvre ★', 'text-orange');
        playBossRoar();
        if (window.onBossDefeated) window.onBossDefeated();
    } else addLog(`${u.name} elimine !`, 'text-green-400');
}

// --- Dissolution de mort : le sprite s'efface et s'affaisse (0.55 s) ---
const dissolving = [];
function startDissolve(entity) {
    const u = entity.userData;
    u.deathDone = true;   // updateMobs n'y touche plus, la dissolution prend le relais
    if (entity.material) entity.material.transparent = true;
    dissolving.push({ entity, t: 0, dur: 0.55, y0: entity.position.y, sx: entity.scale.x, sy: entity.scale.y });
}
function updateDissolving(dt) {
    for (let i = dissolving.length - 1; i >= 0; i--) {
        const d = dissolving[i];
        d.t += dt;
        const k = Math.min(1, d.t / d.dur);
        const e = d.entity;
        if (e.material) e.material.opacity = 1 - k;
        e.position.y = d.y0 - k * 0.35;
        const s = 1 - k * 0.4;
        e.scale.set(d.sx * s, d.sy * s, 1);
        if (k >= 1) { e.visible = false; if (e.material) e.material.opacity = 1; dissolving.splice(i, 1); }
    }
}

function checkBossEnrage(u) {
    if (!gameState.bossEnraged && u.hp / u.maxHp <= (u.enrageAt || 0.35)) {
        gameState.bossEnraged = true; u.damage = Math.round(u.damage * 1.6); u.speed *= 1.4;
        addLog('Le Boss entre en RAGE !', 'text-red-500'); playBossRoar();
    }
}

function updateTargetBar(label, hp, maxHp, isBoss) {
    const hpBar = document.getElementById('boss-hp-bar'), hpLabel = document.getElementById('boss-hp-label'), bar = document.getElementById('target-bar-container');
    if (!hpBar || !hpLabel || !bar) return;
    bar.classList.remove('hidden'); hpLabel.classList.remove('hidden'); hpLabel.innerText = label;
    hpBar.style.width = `${Math.max(0, (hp / maxHp) * 100)}%`;
    hpBar.className = `bar-fill ${isBoss ? 'bg-red-700' : 'bg-orange-600'}`;
    if (window.targetBarTimeout) clearTimeout(window.targetBarTimeout);
    window.targetBarTimeout = setTimeout(() => bar.classList.add('hidden'), isBoss ? 6000 : 3000);
}
