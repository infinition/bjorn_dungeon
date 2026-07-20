import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { EffectComposer } from 'https://unpkg.com/three@0.128.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.128.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.128.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RENDER_WIDTH, RENDER_HEIGHT, MOVE_SPEED, ROT_SPEED } from './constants.js';
import { GameData, DEFAULT_GAME_DATA, SLOTS, SLOT_LABELS, ATTRIBUTES, rarityColor, rarityName } from './data.js';
import { gameState } from './state.js';
import { addLog } from './utils.js';
import {
    generateFloor, buildFloorMesh, disposeFloor, checkCollision, tryRevealSecret,
    isAtPortal, drawMinimap, drawBigMap, updatePortal, WALL_HEIGHT, getLayout, cellAt, isPit, makeProp, getBreakables, freePropCell, blockPropCell, rayTarget, digWall, placeBlock, placeAsset, removeAsset, hasAsset, setForcedBiome, vaultDoorNear, tryUnlockVault
} from './dungeon.js';
import { createBoss, createMob } from './sprites.js';
import { createViewmodel } from './viewmodel.js';
import { createObject, swapObjectModel } from './items.js';
import { idbGet } from './assets-db.js';
import { castSpell, fireArrow, updateSpells, applyDamage, dealDirectDamage, spellCooldownLeft, clearProjectiles } from './spells.js';
import { makeAnimatedSprite } from './sprite-anim.js';
import { tickEntityStatus, applyPlayerStatus, tickPlayerStatus, activePlayerStatuses } from './status.js';
import { input, initInputs, updateInputs } from './inputs.js';
import { playerInventory } from './inventory.js';
import { recomputeStats, addBuff, activeBuffs, mainWeapon, hasShield, hasTorch, computeWeaponDamage, detectRange, itemStats, mitigate } from './stats.js';
import { initEffects, updateEffects, spawnParticles, spawnRing, spawnDamageNumber, spawnSlash, spawnSpriteFx, spawnFlash } from './effects.js';
import { initPickups, updatePickups, dropLoot, clearPickups } from './pickups.js';
import { rollItemInstance, generateLoot, isEquippable } from './loot.js';
import { applyMonsterScale, lootTier, worldLevel, worldTier } from './scaling.js';
import { playHurtSound, playLevelUpSound, playChestSound, playGameOver, playVictory, toggleMute, setVolume, getVolume, playCoinSound, startAmbient, stopAmbient, playFootstep, playSwingSound, playBlockSound, playBossRoar, playWeaponSwing, playBlockHit, registerSamples, preloadRegisteredSamples, startMusicTrack, playSample, playClip } from './sounds.js';
import { saveSettings, loadSettings, deriveCharacter, applyCharacter, bonusById, saveGame, loadGame, hasSave, applySave, deleteSave } from './save.js';
import { updateFlowField, flowDirection, hasLineOfSight, resetFlowField } from './ai.js';
import { SKILL_DEFS, skillRank, canLearnSkill, learnSkill } from './skills.js';

export const IS_AZERTY = true;

// --- THREE.JS SETUP ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
const fogColor = new THREE.Color(GameData.environment.fogColor || '#0c0c14');
scene.background = fogColor;
scene.fog = new THREE.Fog(fogColor.getHex(), 2, 20);

const camera = new THREE.PerspectiveCamera(GameData.environment.fov || 75, RENDER_WIDTH / RENDER_HEIGHT, 0.02, 100);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.domElement.id = 'game-canvas';
if (container) container.appendChild(renderer.domElement);

// Réglages persistés (FOV, pixelisation, hauteur d'arme, bloom, volume).
// FOV/pixelisation/hauteur d'arme sont des préférences JOUEUR : réglage perso
// sinon DÉFAUT DU JEU (pas la valeur figée d'un vieux projet Forge).
const _savedSettings = loadSettings() || {};
const _RENDER_DEFAULTS = ['fov', 'pixelation', 'weaponY'];
['fov', 'pixelation', 'weaponY', 'normalStrength', 'bloomStrength', 'bloomRadius', 'bloomThreshold'].forEach(k => {
    if (_savedSettings[k] != null) GameData.environment[k] = _savedSettings[k];
    else if (_RENDER_DEFAULTS.includes(k) && DEFAULT_GAME_DATA.environment[k] != null) GameData.environment[k] = DEFAULT_GAME_DATA.environment[k];
});
if (_savedSettings.volume != null) setVolume(_savedSettings.volume);
if (_savedSettings.autoEquipEmptySlots != null) gameState.autoEquipEmptySlots = _savedSettings.autoEquipEmptySlots !== false;

// --- POST-PROCESSING : Bloom (lueur sur emissif : torches, runes, portail, sorts) ---
let composer = null, bloomPass = null, useBloom = false;
try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const env = GameData.environment;
    bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1),
        env.bloomStrength != null ? env.bloomStrength : 0.8,
        env.bloomRadius != null ? env.bloomRadius : 0.5,
        env.bloomThreshold != null ? env.bloomThreshold : 0.7);
    composer.addPass(bloomPass);
    useBloom = true;
} catch (e) { console.warn('[Bjorn] Bloom indisponible :', e); useBloom = false; }

// Rendu interne en BASSE RESOLUTION, upscalé en CSS (look pixel-art 16/8-bit).
// pixelation 0 = net (haute def), 100 = tres pixelisé (8-bit).
function setRenderSize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pix = Math.max(0, Math.min(100, GameData.environment.pixelation != null ? GameData.environment.pixelation : 60));
    const targetH = Math.max(120, Math.round(720 - (pix / 100) * 600)); // 0->720px, 100->120px
    const scale = Math.min(1, targetH / h);
    const rw = Math.round(w * scale), rh = Math.round(h * scale);
    renderer.setSize(rw, rh, false); // false: garde le CSS 100%
    if (composer) composer.setSize(rw, rh);
    camera.aspect = w / h;
    camera.fov = GameData.environment.fov || 75;
    camera.updateProjectionMatrix();
}
setRenderSize();

initEffects(scene);
initPickups(scene, {
    onInventoryChanged: () => {
        buildActionBar();
        updateHUD();
        if (invModal && !invModal.classList.contains('hidden')) renderInventory();
    }
});

const chestOpenTexture = new THREE.TextureLoader().load('assets/sprites/chest_opened.png');
chestOpenTexture.magFilter = THREE.NearestFilter;

const ambientLight = new THREE.AmbientLight(0x282840, 0.5);
scene.add(ambientLight);
const torchLight = new THREE.PointLight(0xffaa00, 2.2, 22);
scene.add(torchLight);

// Caméra dans la scène (pour que le viewmodel, enfant de la caméra, soit rendu)
scene.add(camera);
const vm3d = createViewmodel(camera);
if (vm3d.setWeaponY) vm3d.setWeaponY(GameData.environment.weaponY || 0);   // hauteur d'arme persistée

// Dernière position sûre (hors trou) pour la chute
const lastSafePos = new THREE.Vector3(0.5, 0, 0.5);

// --- ENTITES (reconstruites a chaque etage) ---
let boss = null;
const mobs = [];
const objects = [];
const dungeonEvents = [];
const traps = [];
const hazards = [];   // flaques de biome (lave/poison/glace)
const FX_TRAP_FLARE = { type: 'sheet', src: 'assets/fx/trap_flare_sheet.png', cols: 4, rows: 1, fps: 14 };
const FX_GUARD_SHIMMER = { type: 'sheet', src: 'assets/fx/guard_shimmer_sheet.png', cols: 4, rows: 1, fps: 12 };

let currentBiome = null;
function pickMonster() {
    let list = GameData.monsters;
    // Biais de biome : favorise les monstres du biome (2x)
    if (currentBiome && currentBiome.monsters && currentBiome.monsters.length) {
        const weighted = [];
        list.forEach(m => { weighted.push(m); if (currentBiome.monsters.includes(m.id)) weighted.push(m, m); });
        list = weighted;
    }
    const total = list.reduce((s, m) => s + (m.spawnChance || 0.1), 0);
    let r = Math.random() * total;
    for (const m of list) { r -= (m.spawnChance || 0.1); if (r <= 0) return m; }
    return list[0];
}

function applyBiome(biome) {
    currentBiome = biome || null;
    if (!biome) return;
    const fog = new THREE.Color(biome.fogColor || '#0c0c14');
    scene.background = fog;
    if (scene.fog) scene.fog.color = fog;
    ambientLight.color = new THREE.Color(biome.ambient || '#282840');
    ambientLight.intensity = biome.ambientI != null ? biome.ambientI : 0.5;
}

function pickBoss(depth, biome) {
    const bosses = GameData.bosses || [GameData.boss];
    if (biome && biome.boss) { const b = bosses.find(x => x.id === biome.boss); if (b) return b; }
    return bosses[(depth - 1) % bosses.length] || GameData.boss;
}

// Transforme un mob en champion (élite) : plus fort, doré, loot garanti, affixe
const ELITE_AFFIXES = {
    fast: { label: 'Vif', color: 0xffdd55, css: '#ffdd55', apply: u => { u.speed *= 1.65; u.charger = true; } },
    tanky: { label: 'Colosse', color: 0xd7b56d, css: '#d7b56d', apply: u => { u.maxHp = u.hp = Math.round(u.maxHp * 1.45); } },
    explosive: { label: 'Instable', color: 0xff6a22, css: '#ff7a22' },
    vampiric: { label: 'Vampire', color: 0xd9223e, css: '#ff5668', apply: u => { u.damage = Math.round(u.damage * 1.12); } },
    frost: { label: 'Givre', color: 0x7fdfff, css: '#7fdfff', apply: u => { u.statusOnHit = { type: 'freeze', dps: 2, duration: 2.2 }; } },
    venom: { label: 'Venimeux', color: 0x72e05a, css: '#72e05a', apply: u => { u.statusOnHit = { type: 'poison', dps: 6, duration: 5 }; } },
    runic: { label: 'Runique', color: 0x4deeea, css: '#4deeea', apply: u => { u.ranged = true; u.projColor = '#4deeea'; u.projSpeed = Math.max(u.projSpeed || 0, 12); u.projChance = 0.55; } }
};

function makeElite(m) {
    const u = m.userData;
    u.elite = true;
    const keys = Object.keys(ELITE_AFFIXES);
    u.affix = keys[Math.floor(Math.random() * keys.length)];
    const def = ELITE_AFFIXES[u.affix] || ELITE_AFFIXES.fast;
    u.affixLabel = def.label;
    u.affixColor = def.css;
    u.name = `Elite ${def.label} ${u.name}`;
    u.maxHp = u.hp = Math.round(u.maxHp * 2.4);
    u.damage = Math.round(u.damage * 1.5);
    u.xp = Math.round((u.xp || 10) * 3);
    u.gold = u.gold ? [u.gold[0] * 3, u.gold[1] * 3] : [10, 30];
    u.lootChance = 1; u.lootRolls = 2; u.eliteBoost = 1;
    u.tint = def.color;
    u.scale *= 1.25; m.scale.multiplyScalar(1.25); u.baseY *= 1.25;
    if (def.apply) def.apply(u);
}

// Intervalle entre deux attaques d'un mob/boss (cadence "à l'ancienne", pas de spam)
function attackInterval(u) { return Math.max(0.85, Math.min(2.2, 0.04 / (u.attackRate || 0.025))); }

// Cherche une case LIBRE (ni mur ni trou) près de (x,z) pour faire apparaître un mob
function spawnPointNear(x, z) {
    for (let r = 0; r < 16; r++) {
        const a = Math.random() * Math.PI * 2, rad = 0.8 + r * 0.4;
        const nx = x + Math.cos(a) * rad, nz = z + Math.sin(a) * rad;
        if (!checkCollision({ x: nx, z: nz }) && !isPit(nx, nz)) return { x: nx, z: nz };
    }
    return { x, z };
}

function clearEntities() {
    mobs.forEach(m => scene.remove(m)); mobs.length = 0;
    objects.forEach(o => scene.remove(o)); objects.length = 0;
    dungeonEvents.forEach(o => scene.remove(o)); dungeonEvents.length = 0;
    traps.forEach(o => scene.remove(o)); traps.length = 0;
    hazards.forEach(o => scene.remove(o)); hazards.length = 0;
    if (boss) { scene.remove(boss); boss = null; }
    if (merchant) { scene.remove(merchant); merchant = null; }
    npcs.forEach(n => scene.remove(n)); npcs.length = 0;
    clearEnemyProjectiles();
    clearPickups(); clearProjectiles(scene);
}

// Mutations d'étage : un modificateur global tiré au sort qui rend l'étage singulier
const FLOOR_MUTATIONS = [
    { id: 'horde', name: 'Horde', desc: 'Les monstres pullulent', color: 'text-red-400' },
    { id: 'riche', name: 'Opulent', desc: 'Or trouvé doublé', color: 'text-yellow-400' },
    { id: 'enrage', name: 'Enragé', desc: 'Monstres féroces, butin amélioré', color: 'text-red-400' },
    { id: 'voile', name: 'Voilé', desc: 'Brouillard épais, butin amélioré', color: 'text-purple-300' },
    { id: 'ancien', name: 'Ancien', desc: 'Les champions abondent', color: 'text-cyan' }
];

function loadFloor(depth) {
    clearEntities();
    disposeFloor(scene);
    const L = generateFloor(depth, gameState.mode);
    applyBiome(L.biome);
    buildFloorMesh(scene);
    breakables = getBreakables();   // decor cassable rempli par le build du decor
    resetFlowField();
    gameState.depth = depth;
    gameState.worldTier = worldTier(depth);
    gameState.checkpointDepth = depth;     // chaque étage = checkpoint

    // Mutation d'étage (jamais à l'étage 1 ni en preview)
    gameState.floorGoldMult = 1; gameState.floorLootBoost = 0;
    gameState.cheatDeathUsed = false;   // la Plume de Phénix se recharge à chaque étage
    let mutation = null;
    if (!gameState.preview && depth >= 2 && Math.random() < 0.45) {
        mutation = FLOOR_MUTATIONS[Math.floor(Math.random() * FLOOR_MUTATIONS.length)];
        if (mutation.id === 'riche') gameState.floorGoldMult = 2;
        if (mutation.id === 'enrage' || mutation.id === 'voile') gameState.floorLootBoost = 1;
    }
    if (scene.fog) scene.fog.far = (mutation && mutation.id === 'voile') ? 11 : 20;

    camera.position.set(L.spawn.x, 1.2, L.spawn.z);

    // Mode preview de biome (depuis la Forge) : décor seul, aucun ennemi
    if (!gameState.preview) {
        boss = createBoss(scene, L.bossSpawn.x, L.bossSpawn.z, pickBoss(depth, L.biome));
        const tier = gameState.worldTier;
        applyMonsterScale(boss, depth, { boss: true, tier });
        gameState.bossHp = boss.userData.maxHp; gameState.bossMaxHp = boss.userData.maxHp;
        gameState.bossEnraged = false;
        const eliteMul = mutation && mutation.id === 'ancien' ? 2.2 : 1;
        const applyMutation = (m) => {
            if (mutation && mutation.id === 'enrage') {
                const u = m.userData;
                u.damage = Math.round(u.damage * 1.15); u.speed *= 1.1;
                u.lootChance = Math.min(1, (u.lootChance != null ? u.lootChance : 0.4) + 0.15);
            }
        };
        L.mobSpawns.forEach(sp => {
            // Tanières : le spawn impose son monstre ; salles de garde : élite garanti
            const def = sp.monsterId ? (GameData.monsters.find(mm => mm.id === sp.monsterId) || pickMonster()) : pickMonster();
            const m = createMob(scene, sp.x, sp.z, def);
            applyMonsterScale(m, depth, { tier });
            if (sp.elite || Math.random() < Math.min(0.6, (0.10 + worldLevel(depth) * 0.004) * eliteMul)) makeElite(m);   // champions
            applyMutation(m);
            mobs.push(m);
        });
        // Horde : renforts supplémentaires dispersés
        if (mutation && mutation.id === 'horde' && L.mobSpawns.length) {
            const extra = Math.ceil(L.mobSpawns.length * 0.4);
            for (let i = 0; i < extra; i++) {
                const sp = L.mobSpawns[Math.floor(Math.random() * L.mobSpawns.length)];
                const p = spawnPointNear(sp.x, sp.z);
                const m = createMob(scene, p.x, p.z, pickMonster());
                applyMonsterScale(m, depth, { tier });
                applyMutation(m);
                mobs.push(m);
            }
        }
        // Caveau scellé : la clé est confiée à un champion de l'étage
        if (L.vaultDoors && L.vaultDoors.length) {
            let holder = mobs.find(m => m.userData.elite);
            if (!holder && mobs.length) { holder = mobs[Math.floor(Math.random() * mobs.length)]; makeElite(holder); }
            if (holder) {
                holder.userData.vaultKeyHolder = true;
                holder.userData.name = `${holder.userData.name} · Porte-clé`;
                addLog('Un caveau scellé dort quelque part... un champion garde sa clé.', 'text-yellow-300');
            }
        }
    }
    gameState.bossDead = true;   // (preview : portail libre ; partie normale : redéfini ci-dessus)
    if (!gameState.preview) gameState.bossDead = false;
    L.chestSpawns.forEach(sp => {
        const data = GameData.objects.find(o => o.id === sp.type) || GameData.objects[0];
        const obj = createObject(scene, sp.x, sp.z, data);
        obj.userData = { ...data, isOpen: false, secret: sp.secret };
        objects.push(obj);
        breakables.push({ mesh: obj, x: obj.position.x, z: obj.position.z, kind: data.type || 'chest', container: obj });
    });

    (L.coffinSpawns || []).forEach(sp => {
        const g = makeProp('coffin'); if (!g) return;
        g.position.set(sp.x, 0, sp.z); g.rotation.y = Math.random() < 0.5 ? 0 : Math.PI / 2;
        g.userData = { type: 'coffin', isOpen: false };
        scene.add(g); objects.push(g);
        breakables.push({ mesh: g, x: g.position.x, z: g.position.z, kind: 'coffin', container: g });
    });
    // Contenants fouillables (tonneau/caisse/armoire) -> butin via E
    (L.containerSpawns || []).forEach(sp => {
        const g = makeProp(sp.name); if (!g) return;
        g.position.set(sp.x, 0, sp.z); g.rotation.y = sp.rotY || 0;
        if (sp.againstWall && sp.off) { g.position.x += sp.off[0] * 0.32; g.position.z += sp.off[1] * 0.32; }
        g.userData = { type: 'container', name: sp.name, isOpen: false };
        breakables.push({ mesh: g, x: g.position.x, z: g.position.z, kind: sp.name || 'container', container: g });
        blockPropCell(g.position.x, g.position.z);   // solide tant qu'il n'est pas fouillé
        scene.add(g); objects.push(g);
    });
    spawnDungeonEvents(L);
    spawnTraps(L);
    spawnHazards(L);
    spawnMerchant(L);
    if (!gameState.preview) { spawnNPCs(L); spawnBats(L, depth); }

    const bn = L.biome ? L.biome.name : '';
    const dd = document.getElementById('depth-display');
    const modeTag = gameState.mode === 'labyrinth' ? 'Labyrinthe' : 'Delve';
    if (dd) dd.innerText = `${modeTag} ${depth} · T${gameState.worldTier}${bn ? ' · ' + bn : ''}${mutation ? ' · ⚠ ' + mutation.name : ''}`;
    addLog(`Etage ${depth} · Tier ${gameState.worldTier}${bn ? ' : ' + bn : ''}`, 'text-orange');
    if (mutation) addLog(`⚠ Étage ${mutation.name} : ${mutation.desc}`, mutation.color);
    if (playing && !gameState.preview) saveGame();     // autosave à chaque étage (pas en preview)
}

function mat(color, opt = {}) {
    return new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: opt.roughness != null ? opt.roughness : 0.75,
        metalness: opt.metalness || 0,
        emissive: new THREE.Color(opt.emissive || '#000000'),
        emissiveIntensity: opt.emissiveIntensity || 0,
        transparent: !!opt.transparent,
        opacity: opt.opacity != null ? opt.opacity : 1
    });
}

function makeEventMesh(type) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.18, 12), mat('#30283a', { metalness: 0.15 }));
    base.position.y = 0.09; g.add(base);
    const color = type === 'fountain' ? '#58d8ff' : type === 'rune_cache' ? '#ffd24d' : '#c44dff';
    if (type === 'fountain') {
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.32, 0.16, 16), mat('#243b50', { metalness: 0.1 }));
        bowl.position.y = 0.28; g.add(bowl);
        const water = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.025, 16), mat(color, { emissive: color, emissiveIntensity: 0.9, transparent: true, opacity: 0.75 }));
        water.position.y = 0.38; g.add(water);
    } else {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.55, 8), mat('#4a4050', { metalness: 0.2 }));
        pillar.position.y = 0.44; g.add(pillar);
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(type === 'rune_cache' ? 0.22 : 0.18, 0), mat(color, { emissive: color, emissiveIntensity: 1.2, transparent: true, opacity: 0.95 }));
        crystal.position.y = 0.83; g.add(crystal);
        const light = new THREE.PointLight(new THREE.Color(color), 1.1, 4);
        light.position.y = 0.9; g.add(light);
    }
    return g;
}

function spawnDungeonEvents(L) {
    (L.eventSpawns || []).forEach(sp => {
        const g = makeEventMesh(sp.type);
        g.position.set(sp.x, 0, sp.z);
        const names = { shrine: 'Autel runique', fountain: 'Fontaine etherique', rune_cache: 'Cache scellee' };
        g.userData = { type: 'event', eventType: sp.type, name: names[sp.type] || 'Relique', used: false };
        scene.add(g);
        dungeonEvents.push(g);
    });
}

function makeTrapMesh(type) {
    const color = type === 'flame' ? '#ff6622' : type === 'frost' ? '#7fdfff' : '#d8d2bf';
    const g = new THREE.Group();
    const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.018, 20),
        mat(color, { emissive: color, emissiveIntensity: 0.45, transparent: true, opacity: 0.42 })
    );
    disc.position.y = 0.025; g.add(disc);
    const rune = new THREE.Mesh(
        new THREE.TorusGeometry(0.25, 0.018, 6, 18),
        mat(color, { emissive: color, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 })
    );
    rune.rotation.x = Math.PI / 2; rune.position.y = 0.045; g.add(rune);
    return g;
}

function spawnTraps(L) {
    (L.trapSpawns || []).forEach(sp => {
        const g = sp.hidden ? new THREE.Group() : makeTrapMesh(sp.type);
        g.position.set(sp.x, 0, sp.z);
        g.userData = { type: 'trap', trapType: sp.type, hidden: !!sp.hidden, propKind: sp.propKind || '', nextTrigger: 0, phase: Math.random() * 6.28 };
        scene.add(g);
        traps.push(g);
    });
}

// --- Flaques de biome : lave (brûle), poison (empoisonne), glace (ralentit) ---
const HAZARD_DEFS = {
    lava: { color: '#ff5a22', name: 'Lave' },
    poison: { color: '#7ade4a', name: 'Vase toxique' },
    ice: { color: '#9adfff', name: 'Glace vive' }
};
function makeHazardMesh(type, r) {
    const def = HAZARD_DEFS[type] || HAZARD_DEFS.lava;
    const col = new THREE.Color(def.color);
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 20),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.035;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.9, 0.035, 6, 24),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.05;
    g.add(disc, rim);
    return g;
}
function spawnHazards(L) {
    (L.hazardSpawns || []).forEach(sp => {
        const g = makeHazardMesh(sp.type, sp.r);
        g.position.set(sp.x, 0, sp.z);
        g.userData = { type: 'hazard', hazardType: sp.type, r: sp.r, nextTick: 0, phase: Math.random() * 6.28 };
        scene.add(g);
        hazards.push(g);
    });
}
function updateHazards(dt) {
    for (const hz of hazards) {
        const u = hz.userData;
        u.phase += dt * 2.4;
        const pulse = 0.92 + Math.sin(u.phase) * 0.08;
        hz.scale.setScalar(pulse);
        if (gameState.isDead || gameState.jumpY > 0.2) continue;
        if (Math.hypot(hz.position.x - camera.position.x, hz.position.z - camera.position.z) > u.r * 0.85) continue;
        if (gameState.time < u.nextTick) continue;
        u.nextTick = gameState.time + 1.1;
        const def = HAZARD_DEFS[u.hazardType] || HAZARD_DEFS.lava;
        spawnParticles(camera.position, def.color, 8, { spread: 1.6, life: 0.4 });
        if (u.hazardType === 'lava') {
            addLog('Tu marches dans la lave !', 'text-red-400');
            damagePlayer(5 + gameState.depth);
            applyPlayerStatus('burn', 4 + gameState.depth, 2.5);
        } else if (u.hazardType === 'poison') {
            addLog('La vase t\'empoisonne !', 'text-green-400');
            applyPlayerStatus('poison', 4 + gameState.depth, 4);
        } else {
            addLog('La glace engourdit tes jambes.', 'text-cyan');
            addBuff('speed', -0.35, 1.6);
        }
    }
}

// --- Inputs : attaque principale + sorts ---
const primaryAttack = () => doPrimaryAttack();
const touchState = initInputs(primaryAttack, switchAction, () => doJump());

// =====================================================================
//  ATTAQUE PRINCIPALE (selon l'arme equipee)
// =====================================================================
function doPrimaryAttack() {
    if (gameState.isDead || gameState.won || gameState.isBlocking || gameState.menuOpen) return;
    if (gameState.time < gameState.attackReady) return;

    const a = activeAction();
    if (!a) return;
    if (a.kind === 'tool') return;   // pioche : creuser géré au maintien (voir step)
    const spd = 1 - Math.min(0.6, gameState.stats.attackSpeed);

    // Action = SORT : on lance le sort sélectionné
    if (a.kind === 'spell') {
        gameState.currentSpellIndex = a.spellIndex;
        castSpell(camera, scene, mobs, boss, GameData.spells[a.spellIndex], spellWorldHooks());
        gameState.attackReady = gameState.time + 0.2;
        swingView('cast');
        return;
    }

    // Action = ARME
    const w = a.item;
    if (w.attackType === 'ranged') {
        fireArrow(camera, scene, w);
        gameState.attackReady = gameState.time + 0.55 * 1.2 * spd;
        swingView('shoot');
        return;
    }
    meleeAttack(w);
    gameState.attackReady = gameState.time + 0.45 * spd;
    swingView('melee');
}

// Résout les marqueurs "idb:<clé>" (assets importés dans la Forge) en dataURI
// depuis IndexedDB. Les chemins de fichiers (assets/...) restent inchangés.
async function resolveIdbAssets() {
    const resolveVal = async (v) => {
        if (Array.isArray(v)) { const out = []; for (const e of v) { const r = await resolveVal(e); if (r) out.push(r); } return out; }
        if (typeof v === 'string' && v.startsWith('idb:')) return await idbGet(v.slice(4));
        if (v && typeof v === 'object') {
            const out = {};
            for (const [k, val] of Object.entries(v)) out[k] = await resolveVal(val);
            return out;
        }
        return v;
    };
    const fix = async (obj, key) => {
        const r = await resolveVal(obj[key]);
        if (r == null || (Array.isArray(r) && !r.length)) delete obj[key]; else obj[key] = r;
    };
    const pm = GameData.propModels || {}; for (const k in pm) await fix(pm, k);
    const pt = GameData.propTextures || {}; for (const k in pt) await fix(pt, k);
    const au = GameData.audio || {};
    await fix(au, 'music');
    const sfx = au.sfx || {}; for (const k in sfx) await fix(sfx, k);
    // Textures custom (environnement global + par biome) importées dans la Forge
    const env = GameData.environment || {}; await fix(env, 'floor'); await fix(env, 'wall');
    for (const b of (GameData.biomes || [])) { await fix(b, 'floorTex'); await fix(b, 'wallTex'); await fix(b, 'ceilTex'); }
    // Sons par entité (monstres + boss) importés dans la Forge
    const ent = [...(GameData.monsters || []), ...(GameData.bosses || [])];
    for (const m of ent) { await fix(m, 'walkSound'); await fix(m, 'attackSound'); await fix(m, 'deathSound'); }
    // Sprites et FX importés dans la Forge
    const visualEntities = [...(GameData.items || []), ...(GameData.uniques || []), ...(GameData.monsters || []), ...(GameData.bosses || []), ...(GameData.objects || []), ...(GameData.spells || [])];
    for (const e of visualEntities) { await fix(e, 'sprite'); await fix(e, 'fx'); await fix(e, 'projectileSprite'); }
    // Modèles 3D des objets (coffre fermé/ouvert) importés
    for (const o of (GameData.objects || [])) { await fix(o, 'model'); await fix(o, 'modelOpen'); }
}
const _assetsReady = resolveIdbAssets().then(() => { if (playing) applyAudioConfig(); }).catch(() => { });

// Applique la config audio de la Forge : échantillons par catégorie + musique
function applyAudioConfig() {
    const a = GameData.audio || {};
    if (a.sfx) registerSamples(a.sfx);
    preloadRegisteredSamples();
    if (a.music && String(a.music).trim()) { stopAmbient(); startMusicTrack(a.music); }
    else startAmbient();
}

let spellAssetsWarmed = false;
const warmedSpellAssets = [];
function warmSpellAssets() {
    if (spellAssetsWarmed) return;
    spellAssetsWarmed = true;
    const group = new THREE.Group();
    group.frustumCulled = false;
    const seen = new Set();
    const texLoader = new THREE.TextureLoader();

    GameData.spells.forEach((sp, i) => {
        if (sp.sprite && typeof sp.sprite === 'string' && !seen.has(sp.sprite)) {
            seen.add(sp.sprite);
            const tex = texLoader.load(sp.sprite);
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.NearestFilter;
            warmedSpellAssets.push(tex);
        }
        const fx = sp.fx;
        const key = fx && typeof fx === 'object' ? `${fx.src}|${fx.cols || 1}|${fx.rows || 1}` : '';
        if (!fx || !key || seen.has(key)) return;
        seen.add(key);
        const anim = makeAnimatedSprite(fx, { scale: 0.04, color: sp.color });
        anim.sprite.material.opacity = 0.01;
        anim.sprite.frustumCulled = false;
        anim.sprite.position.set(-0.7 + (i % 8) * 0.2, 1.15, -1.4 - Math.floor(i / 8) * 0.1);
        group.add(anim.sprite);
        warmedSpellAssets.push(anim);
    });

    if (!group.children.length) return;
    scene.add(group);
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    scene.remove(group);
    warmedSpellAssets.push(group);
}

function unlinkBreakableObject(obj) {
    for (let i = breakables.length - 1; i >= 0; i--) {
        if (breakables[i].container === obj || breakables[i].mesh === obj) breakables.splice(i, 1);
    }
}

function smashContainer(obj) {
    const d = obj && obj.userData;
    if (!d || d.isOpen) return false;
    d.isOpen = true;
    if (!playSample('container')) playChestSound();
    freePropCell(obj.position.x, obj.position.z);
    spawnParticles(obj.position, '#caa24d', 16, { spread: 2.6, life: 0.55 });
    spawnRing(obj.position, '#ffd24d', { radius: 1.15, life: 0.35, y: 0.22 });

    if (d.type === 'coffin') {
        obj.visible = false;
        if (Math.random() < 0.35) {
            addLog('Une creature jaillit du cercueil brise !', 'text-red-500');
            playBossRoar();
            const m = createMob(scene, obj.position.x, obj.position.z, pickMonster());
            applyMonsterScale(m, gameState.depth);
            m.userData.aggro = true; m.userData.aggroUntil = gameState.time + 30;
            mobs.push(m);
        } else {
            addLog('Cercueil fracasse : tresor revele !', 'text-green-400');
            dropLoot(obj.position.x, obj.position.z, { goldMin: 6, goldMax: 22 + gameState.depth * 4, rolls: 1, chance: 1, boost: 1 });
        }
        return true;
    }

    obj.visible = false;
    if (d.type === 'container') {
        const label = d.name === 'barrel' ? 'Tonneau' : d.name === 'crate' ? 'Caisse' : d.name === 'wardrobe' ? 'Armoire' : 'Contenant';
        addLog(`${label} fracasse !`, 'text-green-400');
        dropLoot(obj.position.x, obj.position.z, { goldMin: 3, goldMax: 14 + gameState.depth * 3, rolls: 1, chance: 0.7, boost: 0 });
        return true;
    }

    addLog('Coffre fracasse !', 'text-green-400');
    dropLoot(obj.position.x, obj.position.z, {
        goldMin: d.goldMin || 0, goldMax: d.goldMax || 0,
        rolls: d.lootRolls || 1, chance: 1, boost: d.rarityBoost || 0
    });
    return true;
}

function destroyBreakableAt(index) {
    const b = breakables[index];
    if (!b) return false;
    if (b.container) {
        const ok = smashContainer(b.container);
        breakables.splice(index, 1);
        return ok;
    }
    b.mesh.visible = false;
    breakables.splice(index, 1);
    freePropCell(b.x, b.z);
    spawnParticles({ x: b.x, y: 0.4, z: b.z, distanceTo: () => 0 }, b.kind === 'cobweb' ? '#cfd2d8' : '#caa24d', 12, { spread: 2, life: 0.4 });
    if (b.spider) {
        if (Math.random() < 0.5) {
            addLog('Une araignée jaillit de la toile !', 'text-red-400');
            const mob = createMob(scene, b.x, b.z, GameData.monsters.find(m => m.id === 'spider') || pickMonster());
            mob.userData.aggro = true;
            mobs.push(mob);
        }
    } else if (b.loot && Math.random() < (b.loot.chance || 0.3)) {
        dropLoot(b.x, b.z, { goldMin: 1, goldMax: b.loot.goldMax || 6, rolls: Math.random() < 0.25 ? 1 : 0, chance: 0.5 });
    }
    return true;
}

function spellWorldHooks() {
    return { breakables, destroyBreakableAt };
}

function meleeAttack(w) {
    playWeaponSwing(w.weaponClass);
    const range = w.range || 2.2;
    const cleave = w.weaponClass === 'greatsword' || w.weaponClass === 'axe';
    const aim = new THREE.Vector3(); camera.getWorldDirection(aim); aim.normalize();
    const dir = aim.clone(); dir.y = 0; dir.normalize();   // pour la détection de cible (horizontale)

    // Effet de fente : arc orienté DANS le plan de vue (suit où on regarde, haut/bas)
    const fx = camera.position.clone().add(aim.clone().multiplyScalar(range * 0.5));
    const variant = (vm3d.meleeVariant + 1) % 3;           // le prochain coup (swingView est appelé après)
    const roll = variant === 0 ? 0.7 : variant === 1 ? -0.7 : Math.PI / 2;
    spawnSlash(fx, camera.quaternion, { color: cleave ? '#ffd9a0' : '#e6e6e6', radius: range * 0.5, roll, life: 0.16 });

    const targets = [...mobs]; if (!gameState.bossDead && boss) targets.push(boss);
    let hitAny = false;
    for (const t of targets) {
        if (t.userData.dead) continue;
        const to = new THREE.Vector3().subVectors(t.position, camera.position); to.y = 0;
        const dist = to.length();
        if (dist > range) continue;
        to.normalize();
        if (dir.dot(to) < 0.25) continue;          // hors du cone frontal
        const { amount, crit } = computeWeaponDamage();
        applyDamage(t, amount, crit, scene, mobs, boss, activeWeaponStatus(w.status));
        hitAny = true;
        // Préfixe "Puissante" : chance d'explosion (dégâts de zone autour de la cible)
        if (w.special && w.special.explode && Math.random() < 0.25) {
            spawnRing(t.position, '#ff7722', { radius: 2.4, life: 0.4, y: 0.3 });
            spawnParticles(t.position, '#ff8844', 18, { spread: 4, life: 0.5 });
            for (const o of targets) { if (!o.userData.dead && o !== t && o.position.distanceTo(t.position) < 2.4) applyDamage(o, Math.round(amount * 0.6), false, scene, mobs, boss); }
        }
        if (!cleave) break;
    }
    // Casse le décor à portée (tonneaux non, mais clutter/toiles/mobilier) -> drop
    for (let i = breakables.length - 1; i >= 0; i--) {
        const b = breakables[i];
        const to = new THREE.Vector3(b.x - camera.position.x, 0, b.z - camera.position.z);
        if (to.length() > range + 0.3) continue;
        to.normalize(); if (dir.dot(to) < 0.2) continue;
        if (destroyBreakableAt(i)) hitAny = true;
    }
    if (!hitAny) playSwish();
}
function playSwish() { /* leger feedback visuel deja via ring */ }

function activeWeaponStatus(baseStatus) {
    const coating = gameState.weaponCoating;
    if (coating && coating.until > gameState.time) return coating.status;
    if (coating && coating.until <= gameState.time) gameState.weaponCoating = null;
    return baseStatus;
}

// Lancer de sort dedie (touche)
function doCast() {
    if (gameState.isDead || gameState.won || gameState.menuOpen) return;
    castSpell(camera, scene, mobs, boss, undefined, spellWorldHooks());
    swingView('cast');
}

// Esquive : impulsion dans la direction du mouvement (ou vers l'avant) + i-frames
function doDash() {
    if (gameState.isDead || gameState.won || gameState.menuOpen) return;
    if (gameState.time < gameState.dashCdUntil || gameState.stamina < 30) return;
    gameState.stamina -= 30;
    if (!playSample('dash')) playSwingSound();   // son d'esquive (personnalisable dans la Forge)
    gameState.dashCdUntil = gameState.time + 0.8;
    gameState.dashUntil = gameState.time + 0.2;
    gameState.invulnUntil = gameState.dashUntil + 0.15;  // i-frames courtes : esquive forte, pas invincibilite permanente
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
    const side = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
    const mv = new THREE.Vector3();
    if (input.forward) mv.add(dir.clone().multiplyScalar(input.forward));
    if (input.strafe) mv.add(side.clone().multiplyScalar(input.strafe));
    if (mv.lengthSq() === 0) mv.copy(dir);
    mv.normalize();
    gameState.dashDir = { x: mv.x, z: mv.z };
    spawnParticles(camera.position, '#88ddff', 16, { spread: 3, life: 0.4 });
    fovPunch = 7;   // sensation de vitesse (retombe tout seul)
}
window.addEventListener('keydown', e => { if (e.code === 'ControlLeft') { e.preventDefault(); doDash(); } });

// Saut (Espace) : depuis le sol uniquement
function doJump() {
    if (gameState.isDead || gameState.won || gameState.menuOpen) return;
    if (gameState.jumpY <= 0.02 && gameState.jumpVel <= 0) gameState.jumpVel = 5.6;
}
window.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); doJump(); } });

// Grande carte (Tab) + clic sur la minimap
function toggleBigMap(force) {
    const m = document.getElementById('bigmap');
    if (!m) return;
    const show = force != null ? force : m.classList.contains('hidden');
    m.classList.toggle('hidden', !show);
}
window.addEventListener('keydown', e => { if (e.code === 'Tab') { e.preventDefault(); toggleBigMap(); } });
document.getElementById('minimap')?.addEventListener('click', () => toggleBigMap());
document.getElementById('bigmap')?.addEventListener('click', () => toggleBigMap(false));

// =====================================================================
//  VIEWMODEL
// =====================================================================
// Le viewmodel est désormais 3D (viewmodel.js). On masque l'ancien emoji DOM.
const vm = document.getElementById('viewmodel');
const offVm = document.getElementById('offhand-view');
if (vm) vm.style.display = 'none';
if (offVm) offVm.style.display = 'none';

function refreshViewmodel() {
    const eq = playerInventory.equipment;
    const a = (typeof actions !== 'undefined') ? activeAction() : null;
    let w = null, showOff = false;
    if (a && (a.kind === 'weapon' || a.kind === 'tool')) {
        w = a.item;
        showOff = (a.item.attackType === 'melee' && a.item.hands === 1);   // bouclier seulement avec arme mêlée 1-main
    } else if (a && a.kind === 'spell') {
        w = eq.magic || null;            // sort -> bâton magique en main (sinon mains nues), PAS épée/bouclier
    } else {
        w = eq.mainHand; showOff = true;
    }
    vm3d.setWeapon(w);
    vm3d.setOffhand(showOff ? eq.offHand : null);
}
function swingView(kind) { vm3d.play(kind); }
function setGuard(on) { vm3d.setBlock(on); }

// =====================================================================
//  BLOCAGE (clic droit / Shift)
// =====================================================================
window.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousedown', e => {
    if (gameState.menuOpen) return;
    if (e.button === 2) {
        gameState.isBlocking = true; setGuard(true);
    }
});
document.addEventListener('mouseup', e => {
    if (e.button === 2) { gameState.isBlocking = false; setGuard(false); }
});
// Creuse le bloc de mur visé (un clic = un bloc). Retourne true si creusé.
function digOnce() {
    if (!miningMode || gameState.isDead || gameState.menuOpen) return;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.normalize();
    const t = rayTarget(camera.position.x, camera.position.z, dir.x, dir.z, 4.5);
    if (!t.hit) return;
    const fxPos = { x: t.digX + 0.5, y: 1.0, z: t.digZ + 0.5, distanceTo: () => 0 };
    if (digWall(t.digX, t.digZ)) { spawnParticles(fxPos, '#ccc6b8', 14, { spread: 2.2, life: 0.45 }); if (!playSample('dig')) playSwingSound(); }
}
// Pose un bloc (texture de mur) sur la case visée (un clic = un bloc)
function buildOnce() {
    if (gameState.isDead || gameState.menuOpen) return;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.normalize();
    const t = rayTarget(camera.position.x, camera.position.z, dir.x, dir.z, 4.5);
    const bx = t.buildX, bz = t.buildZ;
    if (bx === Math.floor(camera.position.x) && bz === Math.floor(camera.position.z)) return;   // pas sous tes pieds
    if (placeBlock(bx, bz, buildTexture)) { spawnParticles({ x: bx + 0.5, y: 1.0, z: bz + 0.5, distanceTo: () => 0 }, '#caa24d', 8, { spread: 1.5, life: 0.3 }); if (!playSample('build')) playSwingSound(); }
}
// Maintien : répète creuser/construire toutes les ~0.16 s
function updateMining(dt) {
    if (digging) { digTick -= dt; if (digTick <= 0) { digTick = 0.16; digOnce(); } }
    if (buildingBlocks) { buildTick -= dt; if (buildTick <= 0) { buildTick = 0.16; buildOnce(); } }
}
// Barre de construction : vignettes des textures de mur de la bibliothèque
async function setupBuildBar() {
    const root = document.getElementById('build-colors'); if (!root) return;
    if (!_buildTextures) {
        try { const man = await fetch('assets/manifest.json?_=' + Date.now()).then(r => r.json()); _buildTextures = man.images || []; }
        catch (e) { _buildTextures = ['assets/textures/wall.png', 'assets/textures/floor.png']; }
        // textures de mur/sol d'abord, puis le reste
        _buildTextures.sort((a, b) => (b.includes('textures/') ? 1 : 0) - (a.includes('textures/') ? 1 : 0));
    }
    root.innerHTML = '';
    _buildTextures.forEach(tex => {
        const sw = document.createElement('div');
        sw.title = tex.split('/').pop();
        sw.style.cssText = `width:22px;height:22px;border-radius:3px;cursor:pointer;background-image:url('${tex}');background-size:cover;image-rendering:pixelated;border:2px solid ${tex === buildTexture ? '#fff' : 'transparent'};flex:0 0 auto`;
        sw.addEventListener('click', () => { buildTexture = tex; setupBuildBar(); });
        root.appendChild(sw);
    });
}
// Marteau : pose le décor sélectionné sur la case visée (snap grille)
function placeAssetAtTarget() {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.normalize();
    const t = rayTarget(camera.position.x, camera.position.z, dir.x, dir.z, 4.5);
    const bx = t.buildX, bz = t.buildZ;
    if (bx === Math.floor(camera.position.x) && bz === Math.floor(camera.position.z)) { addLog('Pas sous tes pieds.', 'text-gray-400'); return; }
    if (placeAsset(bx, bz, selectedProp, propRot)) { spawnParticles({ x: bx + 0.5, y: 0.5, z: bz + 0.5, distanceTo: () => 0 }, '#caa24d', 8, { spread: 1.5, life: 0.3 }); if (!playSample('build')) playSwingSound(); }
    else addLog('Impossible de poser ici.', 'text-gray-400');
}
function removeAssetAtTarget() {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.normalize();
    const t = rayTarget(camera.position.x, camera.position.z, dir.x, dir.z, 4.5);
    let bx = t.buildX, bz = t.buildZ;
    if (!hasAsset(bx, bz)) { bx = Math.floor(camera.position.x + dir.x * 1.2); bz = Math.floor(camera.position.z + dir.z * 1.2); }
    if (removeAsset(bx, bz)) spawnParticles({ x: bx + 0.5, y: 0.5, z: bz + 0.5, distanceTo: () => 0 }, '#aaaaaa', 8, { spread: 1.5, life: 0.3 });
}
function setupPropBar() {
    const root = document.getElementById('prop-list'); if (!root) return;
    root.innerHTML = '';
    PLACE_PROPS.forEach(p => {
        const b = document.createElement('button');
        b.className = 'px-1.5 py-0.5 rounded text-[9px] border ' + (p === selectedProp ? 'border-amber-400 text-amber-200 bg-amber-900/40' : 'border-white/15 text-slate-300 hover:bg-white/10');
        b.textContent = p;
        b.addEventListener('click', () => { selectedProp = p; setupPropBar(); });
        root.appendChild(b);
    });
}
// R fait pivoter le décor à poser (90°)
window.addEventListener('keydown', e => { if (e.code === 'KeyR' && toolMode === 'place') { propRot += Math.PI / 2; addLog('Rotation ' + Math.round(propRot / Math.PI * 180) % 360 + '°', 'text-amber-300'); } });
window.addEventListener('keydown', e => { if (e.code === 'ShiftLeft') { gameState.isBlocking = true; setGuard(true); } });
window.addEventListener('keyup', e => { if (e.code === 'ShiftLeft') { gameState.isBlocking = false; setGuard(false); } });
// Lancer de sort : touche C
window.addEventListener('keydown', e => { if (e.code === 'KeyC') doCast(); });

// =====================================================================
//  BARRE D'ACTION (armes équipées + sorts, unifiée)
//  La molette / 1-N choisit l'action active ; le clic l'exécute.
// =====================================================================
const spellBarEl = document.getElementById('spell-bar');
let actions = [];        // [{kind:'weapon'|'tool'|'spell', ...}]
let actionIndex = 0;
// Ancienne boucle pioche/marteau desactivee pour garder l'ADN dungeon crawler.
let toolMode = null;     // 'mine' (pioche) | 'place' (marteau) | null
let miningMode = false;  // = toolMode === 'mine' (compat)
let digging = false, buildingBlocks = false, digTick = 0, buildTick = 0;
let buildTexture = 'assets/textures/wall.png';   // texture de mur du bloc à poser
let _buildTextures = null;
let selectedProp = 'barrel', propRot = 0;
const PLACE_PROPS = ['barrel', 'crate', 'table', 'chair', 'wardrobe', 'vase', 'carpet', 'column', 'cage', 'skull', 'rock', 'painting', 'tapestry', 'coffin'];

function rebuildActions() {
    actions = [];
    const eq = playerInventory.equipment;
    const mh = eq.mainHand, oh = eq.offHand, rg = eq.ranged;
    // Mêlée (main + dual-wield secondaire), puis arme à distance (slot dédié), puis sorts.
    // Le bâton/sceptre (slot magic) ne frappe pas : il booste les sorts (passif) + s'affiche pour caster.
    if (mh && mh.attackType === 'melee') actions.push({ kind: 'weapon', item: mh });
    if (oh && oh.attackType === 'melee') actions.push({ kind: 'weapon', item: oh });
    if (rg && rg.attackType === 'ranged') actions.push({ kind: 'weapon', item: rg });
    // Sorts : débloqués par niveau (progression RPG)
    GameData.spells.forEach((sp, i) => { if ((sp.unlockLevel || 1) <= gameState.level) actions.push({ kind: 'spell', spellIndex: i }); });
    if (actionIndex >= actions.length) actionIndex = 0;
}
function activeAction() { return actions[actionIndex]; }

function buildActionBar() {
    rebuildActions();
    if (!spellBarEl) return;
    spellBarEl.innerHTML = '';
    actions.forEach((a, idx) => {
        const cell = document.createElement('div');
        cell.className = 'spell-cell relative w-8 h-8 border flex items-center justify-center text-sm bg-black cursor-pointer';
        if (a.kind === 'weapon' || a.kind === 'tool') {
            cell.style.borderColor = a.kind === 'tool' ? '#caa24d' : rarityColor(a.item.rarity || 'green');
            cell.innerHTML = `<span style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">${itemIconHTML(a.item)}</span>`;
            cell.title = a.item.name;
        } else {
            const sp = GameData.spells[a.spellIndex];
            cell.style.borderColor = sp.color;
            const spellIcon = sp.sprite ? `<img src="${sp.sprite}" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated">` : `<span style="color:${sp.color}">${sp.icon || sp.name[0]}</span>`;
            cell.innerHTML = `${spellIcon}
                <span class="spell-cd absolute inset-0 bg-black/70 flex items-center justify-center text-[9px] text-white" style="display:none"></span>
                <span class="absolute -bottom-1 -right-1 text-[7px] text-blue-300">${sp.manaCost}</span>`;
            cell.title = `${sp.name} - ${sp.desc || ''}`;
        }
        cell.addEventListener('click', () => { actionIndex = idx; updateActionSelection(); });
        spellBarEl.appendChild(cell);
    });
    updateActionSelection();
}
function updateActionSelection() {
    if (!spellBarEl) return;
    Array.from(spellBarEl.children).forEach((c, i) => {
        const on = i === actionIndex;
        c.style.boxShadow = on ? '0 0 8px #4deeea' : 'none';
        c.style.borderWidth = on ? '2px' : '1px';
    });
    const a = activeAction();
    const nameEl = document.getElementById('current-spell-name');
    if (a) {
        if (a.kind === 'spell') { gameState.currentSpellIndex = a.spellIndex; if (nameEl) nameEl.innerText = GameData.spells[a.spellIndex].name; }
        else if (nameEl) nameEl.innerText = a.item.name;
    }
    // Les outils de construction ne sont plus exposes en partie.
    toolMode = null;
    miningMode = toolMode === 'mine';
    const bb = document.getElementById('build-bar'), pb = document.getElementById('prop-bar');
    if (bb) bb.classList.toggle('hidden', toolMode !== 'mine');
    if (pb) pb.classList.toggle('hidden', toolMode !== 'place');
    refreshViewmodel();
}
function updateSpellCooldowns() {
    if (!spellBarEl) return;
    Array.from(spellBarEl.children).forEach((c, i) => {
        const a = actions[i]; if (!a || a.kind !== 'spell') return;
        const sp = GameData.spells[a.spellIndex], cdEl = c.querySelector('.spell-cd'), left = spellCooldownLeft(sp.id);
        if (cdEl) { if (left > 0.05) { cdEl.style.display = 'flex'; cdEl.innerText = left.toFixed(1); } else cdEl.style.display = 'none'; }
        c.style.opacity = gameState.mana < sp.manaCost ? '0.45' : '1';
    });
}
function switchAction(dir) {
    if (!actions.length) return;
    actionIndex = (actionIndex + dir + actions.length) % actions.length;
    updateActionSelection();
}
window.addEventListener('keydown', e => {
    const n = parseInt(e.key);
    if (n >= 1 && n <= actions.length) { actionIndex = n - 1; updateActionSelection(); }
    if (e.key === 'm' || e.key === 'M') addLog(toggleMute() ? 'Son coupe' : 'Son active');
});

// =====================================================================
//  INVENTAIRE
// =====================================================================
const invModal = document.getElementById('inventory-modal');
const invGrid = document.getElementById('inventory-grid');
document.getElementById('toggle-inventory')?.addEventListener('click', toggleInventory);
document.getElementById('close-inventory')?.addEventListener('click', toggleInventory);
window.addEventListener('keydown', e => { if (e.code === 'KeyI') toggleInventory(); });

// Ouvre/ferme un menu : libere la souris (sort du pointer lock) et met en pause ;
// reverrouille a la fermeture.
function setMenu(open) {
    gameState.menuOpen = open;
    if (open) { try { document.exitPointerLock(); } catch (e) { } }
    else { try { renderer.domElement.requestPointerLock(); } catch (e) { } }
}

function toggleInventory() {
    if (!invModal) return;
    if (invModal.classList.contains('hidden')) { invModal.classList.remove('hidden'); renderInventory(); setMenu(true); }
    else { invModal.classList.add('hidden'); setMenu(false); }
}

// Icône d'item : image (sprite) si dispo, sinon emoji
function itemIconHTML(item) {
    const col = rarityColor(item.rarity || 'green');
    if (typeof item.sprite === 'string' && item.sprite.trim())
        return `<img src="${item.sprite}" draggable="false" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated;padding:1px">`;
    return `<span style="color:${col}">${item.icon || (item.name ? item.name[0] : '?')}</span>`;
}

function itemTooltip(item) {
    let s = `${item.name} [${rarityName(item.rarity || 'green')}]`;
    if (item.tier) s += ` T${item.tier}`;
    if (item.itemLevel) s += `\nNiv. objet: ${item.itemLevel}`;
    if (item.weaponClass) s += `\nClasse: ${item.weaponClass}${item.hands === 2 ? ' (2 mains)' : ''}`;
    const st = itemStats(item);
    const lines = Object.entries(st).map(([k, v]) => `  ${k}: ${v > 0 && !['speed', 'crit'].includes(k) ? '+' : ''}${(['crit', 'attackSpeed', 'speed', 'block', 'parry', 'lifesteal', 'xpBonus'].includes(k) ? Math.round(v * 100) + '%' : v)}`);
    if (lines.length) s += '\n' + lines.join('\n');
    if (item.heal) s += `\n  Soin: +${item.heal}`;
    if (item.manaRestore) s += `\n  Mana: +${item.manaRestore}`;
    if (item.special) {
        const sp = [];
        if (item.special.multishot) sp.push(`x${item.special.multishot} projectiles en cône`);
        if (item.special.extraBounce) sp.push(`+${item.special.extraBounce} rebonds`);
        if (sp.length) s += `\n★ UNIQUE : ${sp.join(', ')}`;
    }
    // Comparaison vs l'objet equipe dans le meme slot
    const cslot = playerInventory.slotForItem(item);
    if (cslot) {
        const eq = playerInventory.equipment[cslot];
        if (eq && eq !== item) {
            const a = itemStats(item), b = itemStats(eq), keys = new Set([...Object.keys(a), ...Object.keys(b)]);
            const pctKeys = ['crit', 'attackSpeed', 'speed', 'block', 'parry', 'lifesteal', 'xpBonus'];
            const deltas = [];
            keys.forEach(k => {
                const d = (a[k] || 0) - (b[k] || 0);
                if (Math.abs(d) > 1e-6) { const disp = pctKeys.includes(k) ? Math.abs(Math.round(d * 100)) + '%' : Math.abs(Math.round(d)); deltas.push(`${k} ${d > 0 ? '▲+' : '▼-'}${disp}`); }
            });
            s += `\nvs équipé (${eq.name}): ${deltas.length ? deltas.join(', ') : '='}`;
        }
    }
    if (item.desc) s += `\n${item.desc}`;
    return s;
}

// =====================================================================
//  TOOLTIP RPG (HTML, comparaison vert/rouge vs l'objet équipé)
// =====================================================================
const STAT_LABELS = {
    damage: 'Dégâts', spellPower: 'Puissance', defense: 'Défense', crit: 'Critique',
    attackSpeed: 'Vitesse atk', speed: 'Vitesse', maxHp: 'PV max', maxMana: 'Mana max',
    manaRegen: 'Régén mana', block: 'Blocage', parry: 'Parade', lifesteal: 'Vol de vie',
    stealth: 'Furtivité', xpBonus: 'Bonus XP'
};
const PCT_STATS = ['crit', 'attackSpeed', 'speed', 'block', 'parry', 'lifesteal', 'xpBonus'];
function fmtStat(k, v) { return PCT_STATS.includes(k) ? (Math.round(v * 100) + '%') : Math.round(v); }
function fmtSigned(k, v) { const s = v > 0 ? '+' : ''; return s + fmtStat(k, v); }

const CRAFT_RARITIES = ['green', 'blue', 'yellow', 'purple', 'mythic'];
const CRAFT_GROUPS = {
    armor: { label: 'Armure', types: ['helmet', 'chest', 'legs', 'boots', 'belt', 'gloves', 'cape'], dust: 140, ingots: { yellow: 8, purple: 2 }, boost: 5 },
    jewel: { label: 'Bijou', types: ['ring', 'necklace'], dust: 180, ingots: { yellow: 10, purple: 3 }, boost: 6 },
    weapon: { label: 'Arme', types: ['weapon', 'shield', 'offhand'], dust: 220, ingots: { yellow: 12, purple: 4 }, boost: 7 },
    potion: { label: 'Potion', types: [], dust: 75, ingots: { blue: 5, yellow: 2 }, boost: 4 },
    poison: { label: 'Poison', types: [], dust: 95, ingots: { blue: 6, yellow: 3 }, boost: 4 }
};
const INGOT_LABELS = { green: 'Lingot vert', blue: 'Lingot bleu', yellow: 'Lingot jaune', purple: 'Lingot violet', mythic: 'Lingot mythique' };
const INGOT_COLORS = { green: '#3ee85e', blue: '#3ea8ff', yellow: '#ffd24d', purple: '#c44dff', mythic: '#ff5544' };

function materialDef(id, qty = 1) {
    if (id === 'magic_dust') return { id, name: 'Poussiere magique', type: 'material', qty, rarity: 'blue', icon: '*', value: 1, desc: 'Ressource de craft et amelioration.' };
    const rarity = id.replace('ingot_', '');
    return { id, name: INGOT_LABELS[rarity] || 'Lingot', type: 'material', qty, rarity, icon: '■', value: 2, desc: 'Lingot obtenu en demontant un objet.' };
}

function materialCount(id) {
    const it = playerInventory.items.find(x => x && x.type === 'material' && x.id === id);
    return it ? (it.qty || 1) : 0;
}

function addMaterial(id, qty) {
    return playerInventory.addItem(materialDef(id, qty));
}

function consumeMaterial(id, qty) {
    let left = qty;
    for (let i = playerInventory.items.length - 1; i >= 0 && left > 0; i--) {
        const it = playerInventory.items[i];
        if (!it || it.type !== 'material' || it.id !== id) continue;
        const take = Math.min(left, it.qty || 1);
        it.qty = (it.qty || 1) - take;
        left -= take;
        if (it.qty <= 0) playerInventory.removeItem(i);
    }
    return left <= 0;
}

function hasMaterials(cost) {
    return Object.entries(cost).every(([id, qty]) => materialCount(id) >= qty);
}

function consumeMaterials(cost) {
    if (!hasMaterials(cost)) return false;
    Object.entries(cost).forEach(([id, qty]) => consumeMaterial(id, qty));
    return true;
}

function craftCost(group) {
    const def = CRAFT_GROUPS[group];
    let cost = { magic_dust: def.dust };
    Object.entries(def.ingots).forEach(([rarity, qty]) => { cost[`ingot_${rarity}`] = qty; });
    return cost;
}

function upgradeCost(item) {
    const level = item.craftLevel || 0;
    const mult = Math.pow(2, level);
    const rarity = item.rarity || 'green';
    return { magic_dust: 160 * mult, [`ingot_${rarity}`]: 4 * mult };
}

function costText(cost) {
    return Object.entries(cost).map(([id, qty]) => `${qty} ${materialDef(id).name}`).join(', ');
}

function craftedStatsBoost(item, mult) {
    const st = item.stats || item.baseStats || {};
    const next = {};
    Object.entries(st).forEach(([k, v]) => {
        next[k] = PCT_STATS.includes(k) ? Math.round(v * mult * 1000) / 1000 : Math.max(1, Math.round(v * mult));
    });
    item.stats = next;
    item.baseStats = undefined;
}

function randomBaseForGroup(group) {
    const def = CRAFT_GROUPS[group];
    if (!def || group === 'potion' || group === 'poison') return null;
    const pool = GameData.items.filter(it => def.types.includes(it.type) && isEquippable(it));
    return pool[Math.floor(Math.random() * pool.length)] || null;
}

function craftedConsumable(group) {
    if (group === 'poison') {
        return { id: 'crafted_poison_' + Date.now(), name: 'Poison concentre', type: 'consumable', rarity: 'purple', icon: 'P', statusBuff: { type: 'poison', dps: 14, duration: 7 }, value: 80, desc: 'Applique un venin puissant a tes prochaines attaques pendant 30 s.' };
    }
    return { id: 'crafted_elixir_' + Date.now(), name: 'Elixir superieur', type: 'consumable', rarity: 'purple', icon: 'E', heal: 120, manaRestore: 90, staminaRestore: 100, buff: { stat: 'damage', amount: 28, duration: 18 }, value: 90, desc: 'Potion craft puissante, soin, mana, vigueur et rage.' };
}

function itemTipHTML(item) {
    const col = rarityColor(item.rarity || 'green');
    let h = `<div style="color:${col};font-weight:bold;border-bottom:1px solid #333;padding-bottom:3px;margin-bottom:3px">${item.name}</div>`;
    h += `<div style="color:#9aa6b8">${rarityName(item.rarity || 'green')}${item.tier ? ' · Tier ' + item.tier : ''}${item.itemLevel ? ' · Niv. objet ' + item.itemLevel : ''}`;
    if (item.weaponClass) h += ` · ${item.weaponClass}${item.hands === 2 ? ' (2 mains)' : ''}`;
    else if (item.type) h += ` · ${item.type}`;
    if (item.crafted) h += ` · Craft +${item.craftLevel || 0}`;
    if (item.type === 'material') h += ` · ${item.qty || 1}`;
    h += `</div>`;

    const st = itemStats(item);
    const eqSlot = playerInventory.slotForItem(item);
    const eq = eqSlot ? playerInventory.equipment[eqSlot] : null;
    const cmp = (eq && eq !== item) ? itemStats(eq) : null;

    const rows = Object.entries(st);
    if (rows.length) {
        h += `<div style="margin-top:4px">`;
        rows.forEach(([k, v]) => {
            let line = `<div style="display:flex;justify-content:space-between"><span style="color:#cdd6e4">${STAT_LABELS[k] || k}</span><span style="color:#fff">${fmtSigned(k, v)}`;
            if (cmp) {
                const d = (v || 0) - (cmp[k] || 0);
                if (Math.abs(d) > 1e-6) {
                    const good = d > 0; const c = good ? '#46e06a' : '#ff5a5a';
                    line += ` <span style="color:${c}">${good ? '▲' : '▼'}${fmtSigned(k, d)}</span>`;
                }
            }
            line += `</span></div>`;
            h += line;
        });
        // stats présentes sur l'équipé mais absentes ici -> perte (rouge)
        if (cmp) Object.entries(cmp).forEach(([k, v]) => {
            if (st[k] === undefined && Math.abs(v) > 1e-6) {
                h += `<div style="display:flex;justify-content:space-between"><span style="color:#7a8499">${STAT_LABELS[k] || k}</span><span style="color:#ff5a5a">▼${fmtSigned(k, -v)}</span></div>`;
            }
        });
        h += `</div>`;
    }
    if (item.heal) h += `<div style="color:#46e06a">Soin +${item.heal}</div>`;
    if (item.manaRestore) h += `<div style="color:#6cc4ff">Mana +${item.manaRestore}</div>`;
    if (item.staminaRestore) h += `<div style="color:#9be08a">Vigueur +${item.staminaRestore}</div>`;
    if (item.statusBuff) h += `<div style="color:#66dd33">Enduit : ${item.statusBuff.type} (${item.statusBuff.dps}/s, ${item.statusBuff.duration}s)</div>`;
    if (item.status) h += `<div style="color:#c88aff">Effet : ${item.status.type} (${item.status.dps}/s, ${item.status.duration}s)</div>`;
    if (item.special) {
        const sp = [];
        if (item.special.multishot) sp.push(`×${item.special.multishot} projectiles en cône`);
        if (item.special.extraBounce) sp.push(`+${item.special.extraBounce} rebonds`);
        if (item.special.thorns) sp.push(`Renvoie ${item.special.thorns} dégâts aux attaquants`);
        if (item.special.onKillHeal) sp.push(`+${item.special.onKillHeal} PV par ennemi tué`);
        if (item.special.frostAura) sp.push(`Aura de givre (${item.special.frostAura} m)`);
        if (item.special.execute) sp.push(`+${Math.round(item.special.execute * 100)}% dégâts sous 30% PV`);
        if (item.special.goldFind) sp.push(`+${Math.round(item.special.goldFind * 100)}% or trouvé`);
        if (item.special.cheatDeath) sp.push('Évite la mort (1× par étage)');
        if (item.special.explode) sp.push('Chance d\'explosion en mêlée');
        if (sp.length) h += `<div style="color:#ffd24d;margin-top:2px">★ ${sp.join(' · ')}</div>`;
    }
    if (cmp) h += `<div style="color:#7a8499;font-style:italic;margin-top:3px;border-top:1px solid #2a2a33;padding-top:2px">comparé à : ${eq.name}</div>`;
    if (item.desc) h += `<div style="color:#8b93a6;font-style:italic;margin-top:2px">${item.desc}</div>`;
    return { html: h, color: col };
}

let _tipEl = null;
const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let _tipTouchHideBound = false;

function positionTip(cx, cy) {
    const pad = 14, w = _tipEl.offsetWidth || 240, hgt = _tipEl.offsetHeight || 160;
    let x = cx + pad, y = cy + pad;
    if (x + w > window.innerWidth) x = cx - w - pad;
    if (y + hgt > window.innerHeight) y = window.innerHeight - hgt - 4;
    _tipEl.style.left = Math.max(2, x) + 'px'; _tipEl.style.top = Math.max(2, y) + 'px';
}

// Sur mobile : un tap ailleurs (hors infobulle) referme l'infobulle ouverte par appui long.
function ensureTipTouchHide() {
    if (_tipTouchHideBound) return;
    _tipTouchHideBound = true;
    document.addEventListener('touchstart', e => {
        if (_tipEl && !_tipEl.classList.contains('hidden') && !_tipEl.contains(e.target)) _tipEl.classList.add('hidden');
    }, { passive: true });
}

// Affiche les stats d'un objet : survol a la souris, appui long au doigt.
// onDrop (optionnel) ajoute un bouton "Jeter" dans l'infobulle tactile.
function attachItemTip(el, item, onDrop) {
    if (!_tipEl) _tipEl = document.getElementById('item-tip');
    if (!_tipEl) return;
    const showAt = (cx, cy, touch) => {
        const t = itemTipHTML(item);
        _tipEl.innerHTML = t.html; _tipEl.style.borderColor = t.color;
        if (touch && onDrop) {
            const b = document.createElement('button');
            b.className = 'mt-2 w-full py-1 border border-red-600 text-red-200 text-[11px]';
            b.textContent = '🗑 Jeter';
            b.addEventListener('click', ev => { ev.stopPropagation(); _tipEl.classList.add('hidden'); onDrop(); });
            _tipEl.appendChild(b);
        }
        _tipEl.style.pointerEvents = (touch && onDrop) ? 'auto' : 'none';
        _tipEl.classList.remove('hidden');
        positionTip(cx, cy);
    };
    el.addEventListener('mouseenter', e => showAt(e.clientX, e.clientY, false));
    el.addEventListener('mousemove', e => { if (!_tipEl.classList.contains('hidden')) positionTip(e.clientX, e.clientY); });
    el.addEventListener('mouseleave', () => _tipEl.classList.add('hidden'));

    if (IS_TOUCH) {
        ensureTipTouchHide();
        let timer = null, sx = 0, sy = 0;
        const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
        el.addEventListener('touchstart', e => {
            const tch = e.touches[0]; sx = tch.clientX; sy = tch.clientY;
            el._tipHeld = false;
            timer = setTimeout(() => {
                timer = null; el._tipHeld = true;
                const r = el.getBoundingClientRect();
                showAt(r.left + r.width / 2, r.top, true);
            }, 420);
        }, { passive: true });
        el.addEventListener('touchmove', e => {
            const tch = e.touches[0];
            if (Math.abs(tch.clientX - sx) > 10 || Math.abs(tch.clientY - sy) > 10) cancel();
        }, { passive: true });
        el.addEventListener('touchend', cancel);
        el.addEventListener('touchcancel', cancel);
    }
}

function renderCraftPanel() {
    const root = document.getElementById('craft-panel');
    if (!root) return;
    const mats = [
        `Poussiere ${materialCount('magic_dust')}`,
        ...CRAFT_RARITIES.map(r => `<span style="color:${INGOT_COLORS[r]}">${INGOT_LABELS[r]} ${materialCount(`ingot_${r}`)}</span>`)
    ].join(' · ');
    root.innerHTML = `<div class="text-yellow-300 mb-1">BANC DE CRAFT</div><div class="text-gray-300 mb-2">${mats}</div>`;
    const rows = document.createElement('div');
    rows.className = 'flex flex-col gap-1';
    Object.entries(CRAFT_GROUPS).forEach(([key, def]) => {
        const cost = craftCost(key);
        const btn = document.createElement('button');
        btn.className = 'w-full text-left border border-yellow-800/70 hover:bg-yellow-900/30 px-2 py-1';
        btn.innerHTML = `<span class="text-yellow-200">${def.label}</span><br><span class="text-gray-400">${costText(cost)}</span>`;
        btn.disabled = !hasMaterials(cost);
        if (btn.disabled) btn.className += ' opacity-40';
        btn.onclick = () => craftItem(key);
        rows.appendChild(btn);
    });
    root.appendChild(rows);
}

function renderInventory() {
    // Equipement
    const eqRoot = document.getElementById('equipment-slots');
    if (eqRoot) {
        eqRoot.innerHTML = '';
        SLOTS.forEach(slot => {
            const it = playerInventory.equipment[slot];
            const cell = document.createElement('div');
            cell.className = 'relative h-11 border flex flex-col items-center justify-center text-[8px] cursor-pointer';
            cell.style.borderColor = it ? rarityColor(it.rarity || 'green') : '#444';
            cell.style.background = '#0a0a0a';
            if (it) {
                cell.innerHTML = itemIconHTML(it);
                if (it.tier) cell.innerHTML += `<span class="absolute top-0 left-0 text-[8px] leading-none bg-black/80 px-0.5 text-yellow-300">T${it.tier}</span>`;
                attachItemTip(cell, it);
                cell.onclick = () => { if (cell._tipHeld) { cell._tipHeld = false; return; } if (playerInventory.unequip(slot)) { recomputeStats(); buildActionBar(); updateHUD(); renderInventory(); } };
            } else {
                cell.innerHTML = `<span class="text-gray-600">${SLOT_LABELS[slot]}</span>`;
                cell.onclick = null;
            }
            eqRoot.appendChild(cell);
        });
    }

    // Stats
    const statsEl = document.getElementById('inv-stats');
    if (statsEl) {
        const s = gameState.stats;
        statsEl.innerHTML =
            `<span class="text-red-400">ATK ${Math.round(s.damage)}</span> · <span class="text-purple-400">MAG ${Math.round(s.spellPower)}</span> · ` +
            `<span class="text-cyan-300">DEF ${Math.round(s.defense)}</span> · <span class="text-yellow-400">CRIT ${Math.round(s.crit * 100)}%</span><br>` +
            `<span class="text-sky-300">BLOC ${Math.round(s.block * 100)}%</span> · <span class="text-green-300">PARADE ${Math.round(s.parry * 100)}%</span> · ` +
            `<span class="text-gray-300">FURT ${s.stealth}</span> · <span class="text-pink-300">VOL ${Math.round(s.lifesteal * 100)}%</span>`;
    }

    // Attributs
    const ap = document.getElementById('attr-points');
    if (ap) ap.innerText = gameState.attrPoints > 0 ? `(${gameState.attrPoints} pts)` : '';
    const attrRoot = document.getElementById('attr-panel');
    if (attrRoot) {
        attrRoot.innerHTML = '';
        Object.entries(ATTRIBUTES).forEach(([key, def]) => {
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between text-[10px]';
            row.innerHTML = `<span title="${def.desc}">${def.name} <b class="text-white">${gameState.attributes[key]}</b></span>`;
            const btn = document.createElement('button');
            btn.className = 'btn px-2 ' + (gameState.attrPoints > 0 ? 'text-cyan border border-cyan-700' : 'text-gray-600 border border-gray-700');
            btn.innerText = '+';
            btn.onclick = () => {
                if (gameState.attrPoints > 0) { gameState.attributes[key]++; gameState.attrPoints--; recomputeStats(); updateHUD(); renderInventory(); }
            };
            row.appendChild(btn);
            attrRoot.appendChild(row);
        });
    }

    // Compétences passives
    const sp = document.getElementById('skill-points');
    if (sp) sp.innerText = (gameState.skillPoints || 0) > 0 ? `(${gameState.skillPoints} pts)` : '';
    const skillRoot = document.getElementById('skill-panel');
    if (skillRoot) {
        skillRoot.innerHTML = '';
        SKILL_DEFS.forEach(def => {
            const rank = skillRank(def.id);
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between text-[10px]';
            row.title = def.desc;
            const pips = '●'.repeat(rank) + '○'.repeat(def.max - rank);
            row.innerHTML = `<span><span style="color:${def.color}">${def.icon}</span> ${def.name} <span style="color:${def.color};letter-spacing:1px">${pips}</span></span>`;
            const btn = document.createElement('button');
            const can = canLearnSkill(def.id);
            btn.className = 'btn px-2 ' + (can ? 'text-cyan border border-cyan-700' : 'text-gray-600 border border-gray-700');
            btn.innerText = '+';
            btn.onclick = () => {
                if (learnSkill(def.id)) {
                    recomputeStats();
                    addLog(`Compétence : ${def.name} rang ${skillRank(def.id)}`, def.color);
                    updateHUD(); renderInventory();
                    if (playing) saveGame();
                }
            };
            row.appendChild(btn);
            skillRoot.appendChild(row);
        });
    }

    // Sac
    if (invGrid) {
        invGrid.innerHTML = '';
        playerInventory.items.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'relative w-11 h-11 border bg-gray-900 flex items-center justify-center text-base cursor-pointer hover:brightness-150';
            div.style.borderColor = rarityColor(item.rarity || 'green');
            div.innerHTML = itemIconHTML(item);
            if (item.tier) div.innerHTML += `<span class="absolute top-0 left-0 text-[8px] leading-none bg-black/80 px-0.5 text-yellow-300">T${item.tier}</span>`;
            if ((item.qty || 1) > 1) div.innerHTML += `<span class="absolute bottom-0 right-0 text-[9px] leading-none bg-black/75 px-0.5 rounded-tl text-white">${item.qty}</span>`;
            attachItemTip(div, item, () => dropItem(index));
            div.addEventListener('click', () => { if (div._tipHeld) { div._tipHeld = false; return; } useOrEquip(index); });
            div.addEventListener('contextmenu', e => { e.preventDefault(); dropItem(index); });
            if (item.type !== 'material' && item.id !== 'vault_key') {
                const dis = document.createElement('button');
                dis.className = 'absolute top-0 right-0 text-[8px] leading-none bg-red-950/90 text-red-200 px-1 border-l border-b border-red-700';
                dis.innerText = 'D';
                dis.title = 'Demonter';
                dis.onclick = e => { e.stopPropagation(); dismantleItem(index); };
                div.appendChild(dis);
            }
            if (item.crafted && isEquippable(item)) {
                const up = document.createElement('button');
                up.className = 'absolute bottom-0 left-0 text-[9px] leading-none bg-yellow-900/90 text-yellow-100 px-1 border-r border-t border-yellow-600';
                up.innerText = '+';
                up.title = 'Ameliorer';
                up.onclick = e => { e.stopPropagation(); upgradeCraftedItem(index); };
                div.appendChild(up);
            }
            invGrid.appendChild(div);
        });
    }
    renderCraftPanel();
}

function useOrEquip(index) {
    const item = playerInventory.items[index];
    if (!item) return;
    const slot = playerInventory.slotForItem(item);
    if (slot) { if (playerInventory.equipItem(index)) { recomputeStats(); buildActionBar(); addLog(`Équipé : ${item.name}`, rarityColor(item.rarity || 'green')); } }
    else if (item.type === 'consumable') { applyConsumable(item); if ((item.qty || 1) > 1) item.qty--; else playerInventory.removeItem(index); }
    else { addLog('Objet sans usage.', 'text-gray-400'); return; }
    updateHUD(); renderInventory();
}

function addItemWithAutoEquip(item, opts = {}) {
    if (!item) return false;
    const shouldAutoEquip = gameState.autoEquipEmptySlots && playerInventory.canAutoEquip(item);
    if (!playerInventory.addItem(item)) return false;
    if (shouldAutoEquip) {
        const index = playerInventory.items.indexOf(item);
        if (index >= 0 && playerInventory.equipItem(index) && opts.log) addLog(`Équipé : ${item.name}`, rarityColor(item.rarity || 'green'));
    }
    return true;
}

function autoEquipExistingEmptySlots() {
    if (!gameState.autoEquipEmptySlots) return false;
    let changed = false;
    for (let i = 0; i < playerInventory.items.length; i++) {
        const item = playerInventory.items[i];
        if (!playerInventory.canAutoEquip(item)) continue;
        if (playerInventory.equipItem(i)) {
            changed = true;
            i = -1;
        }
    }
    return changed;
}

function dismantleItem(index) {
    const item = playerInventory.items[index];
    if (!item || item.type === 'material' || item.id === 'vault_key') { addLog('Impossible a demonter.', 'text-gray-400'); return; }
    const rarity = item.rarity || 'green';
    const rarityIndex = Math.max(0, CRAFT_RARITIES.indexOf(rarity));
    const dust = item.type === 'consumable' ? 4 + rarityIndex * 4 : 12 + rarityIndex * 12 + (item.crafted ? 20 : 0);
    const ingots = item.type === 'consumable' ? Math.max(1, rarityIndex) : 2 + rarityIndex * 2 + (item.tier || 1);
    playerInventory.removeItem(index);
    addMaterial('magic_dust', dust);
    addMaterial(`ingot_${rarity}`, ingots);
    addLog(`Demonte : ${item.name} (+${dust} poussiere, +${ingots} lingots)`, rarityColor(rarity));
    recomputeStats(); buildActionBar(); updateHUD(); renderInventory();
}

function craftItem(group) {
    const def = CRAFT_GROUPS[group];
    if (!def) return;
    const cost = craftCost(group);
    if (!consumeMaterials(cost)) { addLog('Materiaux insuffisants.', 'text-red-400'); return; }
    let item;
    if (group === 'potion' || group === 'poison') {
        item = craftedConsumable(group);
    } else {
        const base = randomBaseForGroup(group);
        if (!base) { addLog('Recette indisponible.', 'text-red-400'); return; }
        item = rollItemInstance(base, { rarity: 'purple', boost: def.boost, tier: Math.max(2, gameState.worldTier || 1), itemLevel: (gameState.depth || 1) + 8 });
        craftedStatsBoost(item, 1.28);
        item.crafted = true;
        item.craftLevel = 0;
        item.name = `${item.name} forge`;
        item.desc = `${item.desc ? item.desc + ' ' : ''}Objet cree au banc de craft.`;
    }
    if (!addItemWithAutoEquip(item, { log: true })) {
        addLog('Inventaire plein.', 'text-red-400');
        Object.entries(cost).forEach(([id, qty]) => addMaterial(id, qty));
        return;
    }
    addLog(`Cree : ${item.name}`, rarityColor(item.rarity || 'purple'));
    recomputeStats(); buildActionBar(); updateHUD(); renderInventory();
}

function upgradeCraftedItem(index) {
    const item = playerInventory.items[index];
    if (!item || !item.crafted || !isEquippable(item)) { addLog('Seul un equipement crafte peut etre ameliore.', 'text-gray-400'); return; }
    const cost = upgradeCost(item);
    if (!consumeMaterials(cost)) { addLog('Materiaux insuffisants.', 'text-red-400'); return; }
    item.craftLevel = (item.craftLevel || 0) + 1;
    craftedStatsBoost(item, 1.18);
    item.name = item.name.replace(/ \+\d+$/, '') + ` +${item.craftLevel}`;
    item.value = Math.round((item.value || 20) * 1.35);
    addLog(`Ameliore : ${item.name}`, rarityColor(item.rarity || 'purple'));
    recomputeStats(); buildActionBar(); updateHUD(); renderInventory();
}

function dropItem(index) {
    const it = playerInventory.removeItem(index);
    if (it) { addLog(`Jeté : ${it.name}`, 'text-gray-500'); renderInventory(); }
}
function applyConsumable(item) {
    if (item.heal) { gameState.hp = Math.min(gameState.maxHp, gameState.hp + item.heal); spawnDamageNumber(camera.position, item.heal, { color: '#3ee85e', prefix: '+' }); addLog(`+${item.heal} PV`, 'text-green-400'); swingView('drink'); }
    if (item.manaRestore) { gameState.mana = Math.min(gameState.maxMana, gameState.mana + item.manaRestore); addLog(`+${item.manaRestore} Mana`, 'text-blue-400'); }
    if (item.staminaRestore) { gameState.stamina = Math.min(gameState.maxStamina, gameState.stamina + item.staminaRestore); addLog(`+${item.staminaRestore} Vigueur`, 'text-green-300'); }
    if (item.buff) { addBuff(item.buff.stat, item.buff.amount, item.buff.duration, { id: item.id || item.buff.stat, name: item.name, icon: item.icon, color: rarityColor(item.rarity || 'yellow'), sprite: item.sprite }); addLog(`Buff +${item.buff.amount} ${item.buff.stat}`, 'text-orange'); }
    if (item.statusBuff) { gameState.weaponCoating = { status: item.statusBuff, until: gameState.time + 30 }; addLog('Arme enduite de poison.', 'text-green-300'); }
    if (item.cure) { gameState.playerStatus = {}; spawnRing(camera.position, '#7ade4a', { radius: 1.2, life: 0.4, y: 0.2 }); addLog('Statuts purgés.', 'text-green-300'); }
    if (item.aoeDamage) {
        const radius = item.aoeRadius || 4;
        spawnRing(camera.position, '#ff8830', { radius, life: 0.5, y: 0.3 });
        spawnParticles(camera.position, '#ff8830', 24, { spread: 5, life: 0.6 });
        triggerShake(0.045, 0.3);
        const targets = [...mobs]; if (!gameState.bossDead && boss) targets.push(boss);
        for (const tgt of targets) {
            if (!tgt.userData.dead && tgt.position.distanceTo(camera.position) <= radius) applyDamage(tgt, item.aoeDamage, false, scene, mobs, boss);
        }
        addLog('La bombe explose !', 'text-orange');
    }
    if (item.teleport) {
        const L = getLayout();
        if (L) {
            spawnParticles(camera.position, '#aa44ff', 16, { spread: 3, life: 0.5 });
            camera.position.set(L.spawn.x, 1.2, L.spawn.z);
            spawnParticles(camera.position, '#aa44ff', 20, { spread: 3, life: 0.6 });
            addLog('Rappelé au début de l\'étage.', 'text-purple-300');
        }
    }
}
window.addEventListener('keydown', e => {
    if (e.code === 'KeyF') {
        quaffPotion();
    }
});
function quaffPotion() {
    const idx = playerInventory.items.findIndex(it => it.type === 'consumable' && it.heal);
    if (idx >= 0) { const it = playerInventory.items[idx]; applyConsumable(it); if ((it.qty || 1) > 1) it.qty--; else playerInventory.removeItem(idx); updateHUD(); if (!invModal.classList.contains('hidden')) renderInventory(); }
    else addLog('Aucune potion de soin.', 'text-red-400');
}

// --- Boutons tactiles additionnels (mobile) ---
document.getElementById('cast-btn')?.addEventListener('touchstart', e => { e.preventDefault(); doCast(); }, { passive: false });
const _blockBtn = document.getElementById('block-btn');
if (_blockBtn) {
    _blockBtn.addEventListener('touchstart', e => { e.preventDefault(); gameState.isBlocking = true; setGuard(true); }, { passive: false });
    _blockBtn.addEventListener('touchend', e => { e.preventDefault(); gameState.isBlocking = false; setGuard(false); });
}
// Bouton tactile = touchstart (reactif, sans latence) avec repli click pour hybride souris/tactile.
function bindTapButton(id, fn) {
    const b = document.getElementById(id);
    if (!b) return;
    let handled = false;
    b.addEventListener('touchstart', e => { e.preventDefault(); handled = true; fn(); }, { passive: false });
    b.addEventListener('click', () => { if (handled) { handled = false; return; } fn(); });
}
bindTapButton('potion-btn', quaffPotion);
bindTapButton('map-btn', () => toggleBigMap());
bindTapButton('pause-btn', togglePause);
bindTapButton('dash-btn', doDash);
bindTapButton('spellnext-btn', () => switchAction(1));
bindTapButton('mute-btn', () => {
    const m = toggleMute();
    const btn = document.getElementById('mute-btn');
    if (btn) btn.textContent = m ? '🔇' : '🔊';
    addLog(m ? 'Son coupe' : 'Son active');
});

// =====================================================================
//  MARCHAND
// =====================================================================
let merchant = null;
let shopStock = [];
let npcs = [];
let breakables = [];   // décor cassable en mêlée (mesh + position + butin), fourni par dungeon
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// Sprite-personnage (PNJ) avec échelle corrigée selon le ratio de l'image
function makeBillboard(path, height = 1.4) {
    const mat = new THREE.SpriteMaterial({ map: null, transparent: true });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(height, height, 1);
    new THREE.TextureLoader().load(path, tex => {
        tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
        mat.map = tex; mat.needsUpdate = true;
        const img = tex.image; const aspect = img && img.height ? img.width / img.height : 0.7;
        spr.scale.set(height * aspect, height, 1);
    });
    return spr;
}

// PNJ d'ambiance (sprites détourés dans assets/npc)
const NPC_DEFS = [
    { sprite: 'assets/npc/sprite-40-17.png', name: 'Barde', lines: ['♪ Une ballade pour les âmes perdues...', 'Reviens vivant, j’écrirai ton chant !'] },
    { sprite: 'assets/npc/sprite-42-18.png', name: 'Nain ivre', lines: ['Hips ! T’as pas vu ma hache ?', 'Encore une chope et je descends avec toi !'] },
    { sprite: 'assets/npc/sprite-73-1.png', name: 'Prisonnier', lines: ['Sors-moi d’ici, pitié...', 'Les murs bougent la nuit, je te jure.'] },
    { sprite: 'assets/npc/sprite-4-14.png', name: 'Garde', lines: ['Reste sur tes gardes, l’étage est infesté.', 'Le portail mène toujours plus bas.'] },
    { sprite: 'assets/npc/sprite-183-121.png', name: 'Mage errant', lines: ['Les runes parlent à qui sait écouter.', 'Cherche les leviers, ils ouvrent l’invisible.'] },
    { sprite: 'assets/npc/sprite-45-11.png', name: 'Voyageuse', lines: ['On raconte qu’un trésor dort plus bas.', 'Méfie-toi des cercueils trop neufs...'] }
];
function spawnNPCs(L) {
    const count = 1 + (Math.random() < 0.6 ? 1 : 0);
    const used = new Set();
    for (let i = 0; i < count; i++) {
        const def = NPC_DEFS[ri(0, NPC_DEFS.length - 1)];
        // case de sol libre, pas trop près du spawn
        let px = null, pz = null;
        for (let t = 0; t < 30; t++) {
            const r = L.rooms[ri(0, L.rooms.length - 1)];
            const x = ri(r.x, r.x + r.w - 1) + 0.5, z = ri(r.y, r.y + r.h - 1) + 0.5;
            if (checkCollision({ x, z })) continue;
            if (Math.hypot(x - L.spawn.x, z - L.spawn.z) < 3) continue;
            if (used.has(Math.floor(x) + ',' + Math.floor(z))) continue;
            px = x; pz = z; used.add(Math.floor(x) + ',' + Math.floor(z)); break;
        }
        if (px == null) continue;
        const spr = makeBillboard(def.sprite, 1.5);
        spr.position.set(px, 0.75, pz);
        spr.userData = { npc: true, name: def.name, lines: def.lines, nextTalk: 0 };
        scene.add(spr); npcs.push(spr);
    }
}
// --- Chauves-souris : mob volant, sprite généré (2 frames de battement d'ailes) ---
function makeBatSprite() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 32;
    const x = c.getContext('2d');
    const draw = (ox, wingY) => {
        x.fillStyle = '#2a2233';
        x.beginPath(); x.ellipse(ox + 16, 18, 4, 6, 0, 0, 7); x.fill();                 // corps
        x.beginPath(); x.moveTo(ox + 13, 16); x.quadraticCurveTo(ox + 4, wingY, ox + 1, 17); x.lineTo(ox + 6, 18); x.lineTo(ox + 13, 20); x.closePath(); x.fill(); // aile G
        x.beginPath(); x.moveTo(ox + 19, 16); x.quadraticCurveTo(ox + 28, wingY, ox + 31, 17); x.lineTo(ox + 26, 18); x.lineTo(ox + 19, 20); x.closePath(); x.fill(); // aile D
        x.fillRect(ox + 13, 9, 2, 3); x.fillRect(ox + 17, 9, 2, 3);                     // oreilles
        x.fillStyle = '#ff5555'; x.fillRect(ox + 14, 15, 1, 1); x.fillRect(ox + 17, 15, 1, 1); // yeux
    };
    draw(0, 6); draw(32, 14);     // frame0 ailes hautes, frame1 ailes basses
    return c.toDataURL();
}
const BAT_SPRITE = makeBatSprite();
const BAT_DATA = {
    id: 'bat', name: 'Chauve-souris', hp: 14, damage: 6, xp: 8, color: '#3a2f4a',
    scale: 0.5, speed: 2.7, attackRange: 1.2, attackRate: 0.025, detect: 13, behavior: 'chaser', gait: 'float',
    sprite: { type: 'sheet', src: BAT_SPRITE, cols: 2, rows: 1, fps: 9, anims: { idle: { row: 0, frames: 2, fps: 9, loop: true }, walk: { row: 0, frames: 2, fps: 11, loop: true } } },
    gold: [1, 5], lootChance: 0.12
};
function spawnBats(L, depth) {
    const n = 2 + Math.floor(Math.random() * 3);   // 2-4
    for (let i = 0; i < n; i++) {
        let px = null, pz = null;
        for (let t = 0; t < 20; t++) {
            const r = L.rooms[ri(0, L.rooms.length - 1)];
            const x = ri(r.x, r.x + r.w - 1) + 0.5, z = ri(r.y, r.y + r.h - 1) + 0.5;
            if (checkCollision({ x, z })) continue;
            if (Math.hypot(x - L.spawn.x, z - L.spawn.z) < 5) continue;
            px = x; pz = z; break;
        }
        if (px == null) continue;
        const m = createMob(scene, px, pz, BAT_DATA);
        m.userData.baseY = 1.65; m.position.y = 1.65;   // vole en hauteur
        applyMonsterScale(m, depth);
        mobs.push(m);
    }
}
function spawnMerchant(L) {
    merchant = makeBillboard('assets/npc/sprite-3-95.png', 1.5);
    // case sol proche du spawn
    const offs = [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [2, 0], [0, 2]];
    let px = L.spawn.x, pz = L.spawn.z;
    for (const [ox, oz] of offs) { if (!checkCollision({ x: L.spawn.x + ox, z: L.spawn.z + oz })) { px = L.spawn.x + ox; pz = L.spawn.z + oz; break; } }
    merchant.position.set(px, 0.75, pz);
    merchant.userData = { merchant: true };
    scene.add(merchant);
    // stock du marchand (qualite croissante avec la profondeur)
    shopStock = [];
    for (let i = 0; i < 5; i++) { const it = generateLoot(1, Math.floor((L.depth - 1) / 2), { tier: lootTier(L.depth, 1) })[0]; if (it) shopStock.push(it); }
}
function shopPrice(it) { return Math.max(2, Math.round(it.value || 5)); }
function openShop() {
    setMenu(true);
    document.getElementById('shop-modal').classList.remove('hidden');
    renderShop();
}
function closeShop() { document.getElementById('shop-modal').classList.add('hidden'); setMenu(false); }
function switchDungeonMode() {
    gameState.mode = gameState.mode === 'labyrinth' ? 'delve' : 'labyrinth';
    addLog(`Mode : ${gameState.mode === 'labyrinth' ? 'Labyrinthe infini' : 'Delve (descente)'}`, 'text-cyan');
    closeShop();
    loadFloor(gameState.depth);   // régénère l'étage courant dans le nouveau mode
}
document.getElementById('shop-switch-mode')?.addEventListener('click', switchDungeonMode);
function renderShop() {
    document.getElementById('shop-gold').innerText = `Or ${gameState.gold}`;
    const sm = document.getElementById('shop-mode'); if (sm) sm.innerText = gameState.mode === 'labyrinth' ? 'Labyrinthe' : 'Delve';
    const buy = document.getElementById('shop-buy'); buy.innerHTML = '';
    shopStock.forEach((it, idx) => {
        const price = shopPrice(it), col = rarityColor(it.rarity || 'green');
        const row = el2('div', 'flex items-center justify-between border p-1 text-[10px] cursor-pointer hover:bg-white/5');
        row.style.borderColor = col;
        row.innerHTML = `<span style="display:flex;align-items:center;gap:5px;color:${col}"><span style="width:18px;height:18px;display:inline-flex">${itemIconHTML(it)}</span>${it.name}${it.tier ? ' T' + it.tier : ''}</span><span class="text-yellow-400">${price}</span>`;
        attachItemTip(row, it);
        row.onclick = () => buyItem(idx);
        buy.appendChild(row);
    });
    if (!shopStock.length) buy.innerHTML = '<div class="text-gray-500 text-[10px]">Stock épuisé.</div>';
    const sell = document.getElementById('shop-sell'); sell.innerHTML = '';
    playerInventory.items.forEach((it, idx) => {
        const price = Math.max(1, Math.round(shopPrice(it) * 0.5)), col = rarityColor(it.rarity || 'green');
        const row = el2('div', 'flex items-center justify-between border border-white/10 p-1 text-[10px] cursor-pointer hover:bg-white/5');
        row.innerHTML = `<span style="display:flex;align-items:center;gap:5px;color:${col}"><span style="width:18px;height:18px;display:inline-flex">${itemIconHTML(it)}</span>${it.name}${it.tier ? ' T' + it.tier : ''}${(it.qty || 1) > 1 ? ' ×' + it.qty : ''}</span><span class="text-green-400">+${price}</span>`;
        attachItemTip(row, it);
        row.onclick = () => sellItem(idx);
        sell.appendChild(row);
    });
}
function el2(tag, cls) { const e = document.createElement(tag); e.className = cls; return e; }
function buyItem(idx) {
    const it = shopStock[idx]; if (!it) return;
    const price = shopPrice(it);
    if (gameState.gold < price) { addLog('Pas assez d\'or.', 'text-red-400'); return; }
    if (!addItemWithAutoEquip(JSON.parse(JSON.stringify(it)), { log: true })) { addLog('Inventaire plein.', 'text-red-400'); return; }
    gameState.gold -= price; shopStock.splice(idx, 1); playCoinSound(); recomputeStats(); buildActionBar(); updateHUD(); renderShop();
}
function sellItem(idx) {
    const it = playerInventory.items[idx]; if (!it) return;
    const price = Math.max(1, Math.round(shopPrice(it) * 0.5));
    if ((it.qty || 1) > 1) it.qty--; else playerInventory.removeItem(idx);   // pile : vente à l'unité
    gameState.gold += price; playCoinSound();
    recomputeStats(); buildActionBar(); updateHUD(); renderShop();
}
document.getElementById('close-shop')?.addEventListener('click', closeShop);

// =====================================================================
//  PAUSE / RÉGLAGES
// =====================================================================
function togglePause() {
    if (gameState.isDead || gameState.won) return;
    const m = document.getElementById('pause-modal'); if (!m) return;
    if (m.classList.contains('hidden')) { m.classList.remove('hidden'); setMenu(true); }
    else { m.classList.add('hidden'); setMenu(false); }
}
window.addEventListener('keydown', e => {
    if (e.code !== 'Escape') return;
    if (invModal && !invModal.classList.contains('hidden')) { toggleInventory(); return; }
    const shop = document.getElementById('shop-modal'); if (shop && !shop.classList.contains('hidden')) { closeShop(); return; }
    togglePause();
});
function persistSettings() {
    const e = GameData.environment;
    saveSettings({ fov: e.fov, pixelation: e.pixelation, weaponY: e.weaponY, normalStrength: e.normalStrength, bloomStrength: e.bloomStrength, bloomRadius: e.bloomRadius, bloomThreshold: e.bloomThreshold, volume: getVolume(), autoEquipEmptySlots: gameState.autoEquipEmptySlots });
}
function wirePauseControls() {
    const fovS = document.getElementById('set-fov'); const fovV = document.getElementById('fov-val');
    if (fovS) { fovS.value = GameData.environment.fov || 75; fovV.innerText = fovS.value; fovS.addEventListener('input', () => { GameData.environment.fov = +fovS.value; fovV.innerText = fovS.value; setRenderSize(); persistSettings(); }); }
    const pixS = document.getElementById('set-pixel'); const pixV = document.getElementById('pixel-val');
    if (pixS) { pixS.value = GameData.environment.pixelation != null ? GameData.environment.pixelation : 60; pixV.innerText = pixS.value; pixS.addEventListener('input', () => { GameData.environment.pixelation = +pixS.value; pixV.innerText = pixS.value; setRenderSize(); persistSettings(); }); }
    const wyS = document.getElementById('set-weapon-y'); const wyV = document.getElementById('weapon-y-val');
    if (wyS) {
        const init = Math.round((GameData.environment.weaponY || 0) * 100);
        wyS.value = init; wyV.innerText = init;
        if (vm3d.setWeaponY) vm3d.setWeaponY(GameData.environment.weaponY || 0);
        wyS.addEventListener('input', () => { const v = +wyS.value / 100; GameData.environment.weaponY = v; wyV.innerText = wyS.value; if (vm3d.setWeaponY) { vm3d.setWeaponY(v); vm3d.update(0, false); } persistSettings(); });
    }
    const volS = document.getElementById('set-volume'); const volV = document.getElementById('vol-val');
    if (volS) { volS.value = Math.round(getVolume() * 100); volV.innerText = volS.value; volS.addEventListener('input', () => { setVolume(+volS.value / 100); volV.innerText = volS.value; persistSettings(); }); }
    const bloomS = document.getElementById('set-bloom'); const bloomV = document.getElementById('bloom-val');
    if (bloomS) {
        const init = Math.round((GameData.environment.bloomStrength != null ? GameData.environment.bloomStrength : 0.85) * 100);
        bloomS.value = init; bloomV.innerText = init;
        bloomS.addEventListener('input', () => { const v = +bloomS.value / 100; GameData.environment.bloomStrength = v; bloomV.innerText = bloomS.value; if (bloomPass) bloomPass.strength = v; persistSettings(); });
    }
    const autoEquipS = document.getElementById('set-auto-equip');
    if (autoEquipS) {
        autoEquipS.checked = gameState.autoEquipEmptySlots !== false;
        autoEquipS.addEventListener('change', () => { gameState.autoEquipEmptySlots = autoEquipS.checked; persistSettings(); });
    }
    document.getElementById('resume-btn')?.addEventListener('click', togglePause);
    document.getElementById('editor-btn')?.addEventListener('click', () => { saveGame(); window.location.href = 'forge.html'; });   // la partie reste en localStorage
    document.getElementById('newgame-btn')?.addEventListener('click', () => { if (confirm('Effacer la sauvegarde et recommencer un nouveau personnage ?')) { deleteSave(); location.reload(); } });
}

// =====================================================================
//  HUD
// =====================================================================
function updateHUD() {
    const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
    set('hp-bar', el => el.style.width = `${Math.max(0, (gameState.hp / gameState.maxHp) * 100)}%`);
    set('hp-text', el => el.innerText = `${Math.max(0, Math.ceil(gameState.hp))}/${gameState.maxHp}`);
    set('mana-bar', el => el.style.width = `${Math.max(0, (gameState.mana / gameState.maxMana) * 100)}%`);
    set('mana-text', el => el.innerText = `${Math.floor(gameState.mana)}/${gameState.maxMana}`);
    set('xp-bar', el => el.style.width = `${(gameState.xp / gameState.maxXp) * 100}%`);
    set('xp-text', el => el.innerText = `XP ${gameState.xp}/${gameState.maxXp}`);
    set('level-display', el => el.innerText = `Lv ${gameState.level}${(gameState.attrPoints > 0 || gameState.skillPoints > 0) ? ' •' : ''}`);
    set('gold-display', el => el.innerText = `Or ${gameState.gold}`);
    set('honor-display', el => el.innerText = `Honneur ${gameState.honor}`);
    set('kills-display', el => el.innerText = `Kills ${gameState.kills}`);
    set('stamina-bar', el => el.style.width = `${(gameState.stamina / gameState.maxStamina) * 100}%`);
    const sb = document.getElementById('status-bar');
    if (sb) {
        const buffIcons = activeBuffs().map(buff => {
            const left = Math.ceil(buff.left);
            const color = buff.color || '#ffd24d';
            const label = `${buff.name || buff.stat} : ${left}s`;
            const src = typeof buff.sprite === 'string' ? buff.sprite : (buff.sprite && buff.sprite.src);
            const icon = src
                ? `<img src="${src}" style="width:22px;height:22px;object-fit:contain;image-rendering:pixelated">`
                : `<span style="color:${color}">${buff.icon || '◆'}</span>`;
            return `<span title="${label}" style="display:inline-flex;align-items:center;gap:2px;margin-right:6px;color:${color};font-size:14px;vertical-align:middle">${icon}<span>${left}</span></span>`;
        }).join('');
        let icons = buffIcons + activePlayerStatuses().map(st => `<span title="${st.label}" style="color:${st.color}">${st.icon}</span>`).join(' ');
        const w = gameState.ward;
        if (w && w.until > gameState.time && w.amount > 0) icons = `<span title="Égide : ${Math.ceil(w.amount)} dégâts absorbés" style="color:#ffd24d">◈${Math.ceil(w.amount)}</span> ` + icons;
        sb.innerHTML = icons;
    }
}

// =====================================================================
//  JOUEUR
// =====================================================================
let stepTimer = 0, mobStepTimer = 0, batChirpTimer = 2, autosaveTimer = 3;
// Vecteurs réutilisés chaque frame (zéro allocation dans la boucle de jeu)
const _pDir = new THREE.Vector3(), _pSide = new THREE.Vector3(), _pMove = new THREE.Vector3(), _pNext = new THREE.Vector3();
function updatePlayer(dt) {
    if (input.lookX !== 0) { camera.rotation.y -= input.lookX * 0.002; input.lookX = 0; }
    if (input.lookY !== 0) { camera.rotation.x -= input.lookY * 0.002; camera.rotation.x = Math.max(-1.5, Math.min(1.5, camera.rotation.x)); input.lookY = 0; }
    camera.rotation.y += input.turn * ROT_SPEED * dt;

    const speedMult = Math.max(0.3, 1 + gameState.stats.speed) * (gameState.isBlocking ? 0.5 : 1);
    const speed = MOVE_SPEED * speedMult * dt;
    const dir = _pDir; camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
    const side = _pSide.crossVectors(dir, camera.up).normalize();
    const moveVec = _pMove.set(0, 0, 0);
    if (input.forward !== 0) moveVec.add(dir.multiplyScalar(input.forward));
    if (input.strafe !== 0) moveVec.add(side.multiplyScalar(input.strafe));
    if (moveVec.lengthSq() > 0) moveVec.normalize().multiplyScalar(speed);

    // Saut : intégration de la gravité (avant le déplacement -> on peut franchir un trou en l'air)
    if (gameState.jumpY > 0 || gameState.jumpVel > 0) {
        gameState.jumpVel -= 16 * dt;
        gameState.jumpY = Math.max(0, gameState.jumpY + gameState.jumpVel * dt);
        if (gameState.jumpY === 0) gameState.jumpVel = 0;
    }
    const airborne = gameState.jumpY > 0.25;
    // Passe si pas de collision, OU si on est en l'air au-dessus d'un trou
    const canGo = (x, z) => !checkCollision({ x, z }) || (airborne && isPit(x, z));

    // Rayon de collision : on s'arrete AVANT la face du mur (sinon on voit a travers)
    const R = 0.28;
    const nextPos = _pNext.copy(camera.position).add(moveVec);
    if (moveVec.x !== 0 && canGo(nextPos.x + Math.sign(moveVec.x) * R, camera.position.z)) camera.position.x = nextPos.x;
    if (moveVec.z !== 0 && canGo(camera.position.x, nextPos.z + Math.sign(moveVec.z) * R)) camera.position.z = nextPos.z;

    // Bruits de pas du joueur (cadence selon la garde)
    const moving = moveVec.lengthSq() > 0 && !airborne;
    stepTimer -= dt;
    if (moving && stepTimer <= 0) { playFootstep('player'); stepTimer = gameState.isBlocking ? 0.55 : 0.42; }

    // Esquive (dash) : impulsion + i-frames
    if (gameState.time < gameState.dashUntil) {
        const ds = 17 * dt, dx = gameState.dashDir.x * ds, dz = gameState.dashDir.z * ds;
        if (dx !== 0 && canGo(camera.position.x + dx + Math.sign(dx) * R, camera.position.z)) camera.position.x += dx;
        if (dz !== 0 && canGo(camera.position.x, camera.position.z + dz + Math.sign(dz) * R)) camera.position.z += dz;
    }

    // Chute dans un trou : si on retombe au sol au-dessus d'une fosse
    if (gameState.jumpY <= 0.05 && isPit(camera.position.x, camera.position.z)) {
        addLog('Tu tombes dans le trou !', 'text-red-500');
        damagePlayer(14);
        camera.position.x = lastSafePos.x; camera.position.z = lastSafePos.z;
        gameState.jumpVel = 4.5; gameState.jumpY = 0.01;   // petit rebond pour ressortir
    } else if (gameState.jumpY <= 0.05 && !isPit(camera.position.x, camera.position.z)) {
        lastSafePos.set(camera.position.x, 0, camera.position.z);
    }

    const bob = (!airborne && (input.forward !== 0 || input.strafe !== 0)) ? Math.sin(gameState.time * 12) * 0.05 : 0;
    camera.position.y = 1.2 + bob + gameState.jumpY;

    torchLight.position.copy(camera.position); torchLight.position.y -= 0.2;
    const torchOn = hasTorch();
    torchLight.distance = torchOn ? 30 : 22;
    torchLight.intensity = (torchOn ? 3.2 : 1.35) + Math.random() * 0.22;
    torchLight.color.set(torchOn ? 0xffaa44 : 0xd8e4ff);
}

// --- Secousse d'écran + punch de FOV (impacts, dash, explosions) ---
let shakeAmp = 0, shakeUntil = 0, fovPunch = 0;
function triggerShake(amp, dur = 0.25) {
    shakeAmp = Math.max(shakeAmp, amp);
    shakeUntil = Math.max(shakeUntil, gameState.time + dur);
}
window.triggerShake = triggerShake;
function updateCameraFeel(dt) {
    // roulis aléatoire décroissant (ne touche pas à la position -> pas de conflit collision)
    if (gameState.time < shakeUntil && shakeAmp > 0.0005) {
        camera.rotation.z = (Math.random() - 0.5) * shakeAmp;
        shakeAmp *= Math.pow(0.001, dt);   // décroissance rapide
    } else if (camera.rotation.z !== 0) {
        camera.rotation.z = 0; shakeAmp = 0;
    }
    // punch de FOV (dash) : élargit brièvement le champ puis revient
    if (fovPunch > 0.05) {
        camera.fov = (GameData.environment.fov || 75) + fovPunch;
        fovPunch *= Math.pow(0.02, dt);
        camera.updateProjectionMatrix();
    } else if (fovPunch !== 0) {
        fovPunch = 0;
        camera.fov = GameData.environment.fov || 75;
        camera.updateProjectionMatrix();
    }
    // Vignette de danger : pulse rouge quand les PV sont bas
    if (!_dmgOverlay) _dmgOverlay = document.getElementById('damage-overlay');
    if (_dmgOverlay && !gameState.isDead && gameState.hp > 0 && gameState.hp / gameState.maxHp < 0.25) {
        const pulse = 0.15 + (0.5 + Math.sin(gameState.time * 5) * 0.5) * 0.1;
        const cur = parseFloat(_dmgOverlay.style.opacity) || 0;
        if (cur < pulse) _dmgOverlay.style.opacity = pulse;
    }
}
let _dmgOverlay = null;

function damagePlayer(rawAmount) {
    if (gameState.isDead || gameState.won) return;
    if (gameState.time < gameState.invulnUntil) { spawnDamageNumber(camera.position, 'ESQUIVE', { color: '#88ddff' }); return; }
    const res = mitigate(rawAmount);
    if (res.parried) {
        spawnDamageNumber(camera.position, 'PARADE', { color: '#3ee85e' });
        spawnSpriteFx(FX_GUARD_SHIMMER, camera.position, { scale: 1.25, yOffset: 0.18, life: 0.35, depthTest: false });
        addLog('Parade !', 'text-green-400');
        return;
    }
    // Égide (bouclier absorbant) : encaisse avant les PV
    const ward = gameState.ward;
    if (ward && ward.until > gameState.time && ward.amount > 0) {
        const absorbed = Math.min(ward.amount, res.amount);
        ward.amount -= absorbed;
        res.amount -= absorbed;
        spawnDamageNumber(camera.position, absorbed, { color: '#ffd24d', prefix: '◈' });
        if (ward.amount <= 0) { gameState.ward = null; addLog('Ton égide vole en éclats !', 'text-yellow-300'); spawnRing(camera.position, '#ffd24d', { radius: 1.4, life: 0.4, y: 0.3 }); }
        if (res.amount <= 0) { updateHUD(); return; }
    }
    gameState.hp -= res.amount;
    if (res.blocked) {
        spawnSpriteFx(FX_GUARD_SHIMMER, camera.position, { scale: 1.15, yOffset: 0.18, life: 0.3, depthTest: false });
        playBlockHit();
        addLog(`Bloqué (-${res.amount})`, 'text-sky-300');
    } else playHurtSound();

    const dmgOv = document.getElementById('damage-overlay');
    if (dmgOv) { dmgOv.style.opacity = Math.min(0.85, 0.25 + res.amount / 40); setTimeout(() => dmgOv.style.opacity = 0, 160); }
    document.body.classList.add('hit-effect'); setTimeout(() => document.body.classList.remove('hit-effect'), 350);
    triggerShake(Math.min(0.045, 0.012 + res.amount * 0.0012), 0.22);
    updateHUD();
    if (gameState.hp <= 0 && !gameState.isDead) {
        if (tryPhoenix()) return;
        gameState.hp = 0; gameState.isDead = true; onPlayerDeath();
    }
}

// Plume de Phénix : évite la mort une fois par étage (retour à 50% PV)
function tryPhoenix() {
    if (!gameState.specials || !gameState.specials.cheatDeath || gameState.cheatDeathUsed) return false;
    gameState.cheatDeathUsed = true;
    gameState.hp = Math.max(1, Math.round(gameState.maxHp * 0.5));
    gameState.playerStatus = {};
    gameState.invulnUntil = gameState.time + 1.5;
    addLog('★ La Plume de Phénix te ramène des cendres !', 'text-orange');
    spawnRing(camera.position, '#ff8830', { radius: 2.5, life: 0.7, y: 0.2 });
    spawnParticles(camera.position, '#ffb060', 30, { spread: 5, life: 0.9 });
    playLevelUpSound();
    updateHUD();
    return true;
}

// =====================================================================
//  INTERACTIONS (coffres + secrets + portail)
// =====================================================================
function updateInteraction() {
    if (!input.interact) return;
    input.interact = false;
    // marchand proche ?
    if (merchant && camera.position.distanceTo(merchant.position) < 2.5) { openShop(); return; }
    for (const ev of dungeonEvents) {
        if (ev.userData.used) continue;
        if (camera.position.distanceTo(ev.position) < 2.2) { activateDungeonEvent(ev); return; }
    }
    // coffre proche ?
    for (const obj of objects) {
        if (obj.userData.isOpen) continue;
        if (camera.position.distanceTo(obj.position) < 2.5) { openContainer(obj); return; }
    }
    // porte de caveau verrouillée ?
    if (vaultDoorNear(camera.position)) {
        const ki = playerInventory.items.findIndex(it => it && it.id === 'vault_key');
        if (ki >= 0) {
            playerInventory.removeItem(ki);
            if (tryUnlockVault(camera.position)) {
                addLog('La clé tourne... le caveau s\'ouvre !', 'text-yellow-300');
                spawnParticles(camera.position, '#ffd24d', 22, { spread: 3, life: 0.6 });
                playChestSound();
            }
        } else addLog('Scellé. La clé est portée par un champion de l\'étage.', 'text-gray-300');
        return;
    }
    // sinon, tente de reveler un passage secret
    if (tryRevealSecret(camera.position)) {
        addLog('Passage secret découvert !', 'text-purple-400');
        spawnParticles(camera.position, '#c44dff', 20, { spread: 3 });
        playChestSound();
    }
}

function openContainer(obj) {
    const d = obj.userData; d.isOpen = true; if (!playSample('container')) playChestSound();
    unlinkBreakableObject(obj);
    if (d.type === 'coffin') return openCoffin(obj);
    if (d.type === 'container') return searchContainer(obj);
    if (d.type === 'chest') { if (d.modelOpen) swapObjectModel(obj, d.modelOpen); else if (obj.material) obj.material.map = chestOpenTexture; addLog('Coffre ouvert !', 'text-green-400'); }
    else { obj.visible = false; spawnParticles(obj.position, '#8B4513', 16, { spread: 3, life: 0.6 }); addLog('Tonneau brisé !', 'text-green-400'); }
    spawnRing(obj.position, '#ffd24d', { radius: 1.2, life: 0.4, y: 0.2 });
    dropLoot(obj.position.x, obj.position.z, {
        goldMin: d.goldMin || 0, goldMax: d.goldMax || 0,
        rolls: d.lootRolls || 1, chance: 1, boost: d.rarityBoost || 0
    });
}

// Contenant fouillable (tonneau/caisse/armoire) : butin (tonneau/caisse se brisent)
function searchContainer(obj) {
    const name = obj.userData.name;
    spawnParticles(obj.position, '#caa24d', 14, { spread: 2, life: 0.5 });
    spawnRing(obj.position, '#ffd24d', { radius: 1.1, life: 0.4, y: 0.3 });
    if (name === 'barrel' || name === 'crate') { obj.visible = false; freePropCell(obj.position.x, obj.position.z); spawnParticles(obj.position, '#8B4513', 16, { spread: 2.5, life: 0.6 }); addLog(`${name === 'barrel' ? 'Tonneau' : 'Caisse'} fouillé !`, 'text-green-400'); }
    else addLog('Armoire fouillée !', 'text-green-400');
    dropLoot(obj.position.x, obj.position.z, { goldMin: 3, goldMax: 14 + gameState.depth * 3, rolls: 1, chance: 0.7, boost: 0 });
}

// Cercueil : 45% embuscade (monstre jaillit), sinon trésor
function openCoffin(obj) {
    const lid = obj.children[1]; if (lid) { lid.rotation.x = -0.55; lid.position.z -= 0.35; lid.position.y += 0.05; }   // couvercle s'ouvre
    spawnRing(obj.position, '#caa24d', { radius: 1.4, life: 0.5, y: 0.3 });
    if (Math.random() < 0.45) {
        addLog('Une créature jaillit du cercueil !', 'text-red-500');
        playBossRoar();
        spawnParticles(obj.position, '#6a2a2a', 22, { spread: 3, life: 0.7 });
        const m = createMob(scene, obj.position.x, obj.position.z, pickMonster());
        applyMonsterScale(m, gameState.depth);
        m.userData.aggro = true; m.userData.aggroUntil = gameState.time + 30;
        mobs.push(m);
    } else {
        addLog('Le cercueil recèle un trésor !', 'text-green-400');
        spawnParticles(obj.position, '#ffd24d', 18, { spread: 2.5, life: 0.7 });
        dropLoot(obj.position.x, obj.position.z, { goldMin: 6, goldMax: 22 + gameState.depth * 4, rolls: 1, chance: 1, boost: 1 });
    }
}

function dimEvent(ev) {
    ev.userData.used = true;
    ev.traverse(o => {
        if (o.material) {
            o.material.opacity = Math.min(o.material.opacity || 1, 0.35);
            o.material.transparent = true;
            if (o.material.emissiveIntensity != null) o.material.emissiveIntensity *= 0.25;
        }
        if (o.isLight) o.intensity *= 0.25;
    });
}

function activateDungeonEvent(ev) {
    const type = ev.userData.eventType;
    dimEvent(ev);
    if (type === 'fountain') {
        const hp = Math.round(gameState.maxHp * 0.28);
        const mana = Math.round(gameState.maxMana * 0.35);
        gameState.hp = Math.min(gameState.maxHp, gameState.hp + hp);
        gameState.mana = Math.min(gameState.maxMana, gameState.mana + mana);
        spawnRing(ev.position, '#58d8ff', { radius: 1.8, life: 0.6, y: 0.2 });
        spawnParticles(ev.position, '#58d8ff', 24, { spread: 3, life: 0.8 });
        addLog(`Fontaine etherique : +${hp} PV, +${mana} mana`, 'text-cyan');
        return;
    }
    if (type === 'rune_cache') {
        spawnRing(ev.position, '#ffd24d', { radius: 1.6, life: 0.5, y: 0.2 });
        spawnParticles(ev.position, '#ffd24d', 22, { spread: 2.5, life: 0.7 });
        dropLoot(ev.position.x, ev.position.z, { goldMin: 18, goldMax: 45 + gameState.depth * 8, rolls: 2, chance: 1, boost: 1 });
        addLog('Cache scellee ouverte !', 'text-yellow-400');
        return;
    }

    const roll = Math.random();
    spawnRing(ev.position, '#c44dff', { radius: 2.0, life: 0.7, y: 0.2 });
    if (roll < 0.55) {
        const stat = Math.random() < 0.5 ? 'damage' : 'spellPower';
        addBuff(stat, 8 + gameState.depth * 2, 25);
        spawnParticles(ev.position, '#c44dff', 28, { spread: 3.5, life: 0.8 });
        addLog(stat === 'damage' ? 'Benediction runique : puissance accrue !' : 'Benediction runique : magie accrue !', 'text-purple-300');
    } else {
        addLog('L autel appelle des gardiens !', 'text-red-400');
        damagePlayer(8 + gameState.depth * 2);
        for (let k = 0; k < 2; k++) {
            const sp = spawnPointNear(ev.position.x, ev.position.z);
            const m = createMob(scene, sp.x, sp.z, pickMonster());
            applyMonsterScale(m, gameState.depth);
            m.userData.aggro = true;
            mobs.push(m);
            spawnParticles(m.position, '#c44dff', 12, { spread: 2.5 });
        }
    }
}

function updateTraps(dt) {
    for (const tr of traps) {
        const u = tr.userData;
        u.phase += dt * 3;
        const pulse = 0.85 + Math.sin(u.phase) * 0.12;
        tr.scale.setScalar(pulse);
        if (gameState.isDead || gameState.time < (u.nextTrigger || 0)) continue;
        if (Math.hypot(tr.position.x - camera.position.x, tr.position.z - camera.position.z) > 0.62 || gameState.jumpY > 0.2) continue;
        u.nextTrigger = gameState.time + 3.0;
        const kind = u.trapType;
        const color = kind === 'flame' ? '#ff6622' : kind === 'frost' ? '#7fdfff' : '#d8d2bf';
        spawnSpriteFx(FX_TRAP_FLARE, tr.position, { scale: 1.1, yOffset: 0.12, life: 0.35 });
        spawnRing(tr.position, color, { radius: 1.1, life: 0.35, y: 0.08 });
        spawnParticles(tr.position, color, 18, { spread: 2.2, life: 0.45 });
        if (kind === 'flame') {
            addLog('Piege de feu !', 'text-red-400');
            damagePlayer(8 + gameState.depth * 2);
            applyPlayerStatus('burn', 4 + gameState.depth, 3);
        } else if (kind === 'frost') {
            addLog('Piege de givre !', 'text-cyan');
            damagePlayer(6 + gameState.depth);
            applyPlayerStatus('freeze', 2, 2.5);
        } else {
            addLog('Pointes dissimulees !', 'text-orange');
            damagePlayer(12 + gameState.depth * 2);
        }
    }
}

// =====================================================================
//  BOSS
// =====================================================================
function updateBoss(dt) {
    if (!boss || gameState.bossDead || !boss.visible) return;
    const u = boss.userData;
    const dist = boss.position.distanceTo(camera.position);
    u.phase += dt * 4; boss.position.y = u.baseY + Math.sin(u.phase) * 0.1;
    if (u.hitFlash > 0) { u.hitFlash -= dt; boss.material.color.setHex(0xff5555); }
    else boss.material.color.setHex(gameState.bossEnraged ? 0xff8844 : 0xffffff);

    // Flip horizontal de combat (le boss se balance quand le joueur est proche)
    if (dist < 12) { u.flipT = (u.flipT || 0) + dt; if (u.flipT > 0.4) { u.flipT = 0; u.facing = -(u.facing || 1); } }
    else u.facing = 1;
    boss.scale.x = Math.abs(boss.scale.x) * (u.facing || 1);

    // Ticks de statut sur le boss
    tickEntityStatus(u, boss.position, (amt, col) => dealDirectDamage(boss, amt, col, scene, mobs, boss));
    if (gameState.bossDead) return;

    // Exécution d'un Choc Sismique télégraphié
    if (u.pendingSlam && gameState.time >= u.pendingSlam.at) {
        const ps = u.pendingSlam; u.pendingSlam = null;
        spawnRing({ x: ps.x, y: 0.2, z: ps.z }, '#ff2020', { radius: ps.range, life: 0.4, y: 0.2 });
        spawnParticles({ x: ps.x, y: 0.3, z: ps.z, distanceTo: () => 0 }, '#ff5522', 26, { spread: 5 });
        document.body.classList.add('hit-effect'); setTimeout(() => document.body.classList.remove('hit-effect'), 300);
        const d = Math.hypot(camera.position.x - ps.x, camera.position.z - ps.z);
        triggerShake(d < ps.range + 4 ? 0.05 : 0.02, 0.35);   // le sol tremble même si on esquive
        if (d < ps.range) { addLog('Choc Sismique !', 'text-red-500'); damagePlayer(ps.dmg); }
    }

    const t = gameState.time;
    (u.abilities || []).forEach(ab => {
        const ready = u.abilityTimers[ab.id] || 0;
        if (t >= ready && dist < (ab.range || 6) + 2) {
            u.abilityTimers[ab.id] = t + ab.cooldown;
            if (ab.id === 'slam') {
                // Télégraphe : zone d'avertissement à l'endroit ciblé, impact 0.8s après
                spawnRing({ x: camera.position.x, y: 0.16, z: camera.position.z }, '#ff5050', { radius: ab.range, life: 0.8, y: 0.16 });
                u.pendingSlam = { at: t + 0.8, range: ab.range, dmg: ab.damage, x: camera.position.x, z: camera.position.z };
                addLog('Le Boss prépare un Choc ! (esquive)', 'text-orange');
            } else if (ab.id === 'summon') {
                addLog('Le Boss invoque !', 'text-red-400');
                for (let k = 0; k < (ab.count || 2); k++) { const sp = spawnPointNear(boss.position.x, boss.position.z); const m = createMob(scene, sp.x, sp.z, pickMonster()); applyMonsterScale(m, gameState.depth); mobs.push(m); spawnParticles(m.position, '#c44dff', 8, { spread: 2.5 }); }
            }
        }
    });

    let moving = false, attacking = false;
    if (dist < u.attackRange) { attacking = true; if (gameState.time >= (u.nextAttack || 0)) { u.nextAttack = gameState.time + attackInterval(u); addLog('Le Boss frappe !', 'text-red-500'); playClip(u.attackSound); damagePlayer(u.damage); } }
    else if (dist < 24) {
        // Poursuite : direct si ligne de vue, sinon contournement par le champ de navigation
        let mx = (camera.position.x - boss.position.x) / dist, mz = (camera.position.z - boss.position.z) / dist;
        if (!hasLineOfSight(boss.position.x, boss.position.z, camera.position.x, camera.position.z)
            && flowDirection(boss.position.x, boss.position.z, TMP_DIR)) { mx = TMP_DIR.x; mz = TMP_DIR.z; }
        moving = moveEntity(boss, mx * u.speed * dt, mz * u.speed * dt, false);
    }
    if (u.anim) { u.anim.setState(attacking ? 'attack' : moving ? 'walk' : 'idle'); u.anim.update(dt); }
}

// Deplacement avec collision axe par axe (glisse le long des murs, ne traverse pas).
// phaser=true : ignore les murs (classe ghost).
function moveEntity(ent, dx, dz, phaser) {
    if (phaser) { ent.position.x += dx; ent.position.z += dz; return (dx !== 0 || dz !== 0); }
    let moved = false;
    if (dx !== 0 && !checkCollision(new THREE.Vector3(ent.position.x + dx, 0, ent.position.z))) { ent.position.x += dx; moved = true; }
    if (dz !== 0 && !checkCollision(new THREE.Vector3(ent.position.x, 0, ent.position.z + dz))) { ent.position.z += dz; moved = true; }
    return moved;
}

// =====================================================================
//  MOBS (avec furtivite)
// =====================================================================
// --- Projectiles ENNEMIS (monstres "ranged") -> visent le joueur ---
const enemyProjectiles = [];
function clearEnemyProjectiles() { enemyProjectiles.forEach(p => scene.remove(p.mesh)); enemyProjectiles.length = 0; }
function spawnEnemyProjectile(from, color, speed, damage) {
    const col = new THREE.Color(color || '#ff5544');
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ color: col }));
    mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })));
    const light = new THREE.PointLight(col, 1.6, 5); mesh.add(light);
    mesh.position.copy(from); mesh.position.y = 1.1;
    const dir = new THREE.Vector3().subVectors(camera.position, mesh.position).normalize();
    scene.add(mesh);
    enemyProjectiles.push({ mesh, vel: dir.multiplyScalar(speed || 9), life: 4, damage: damage || 6 });
}
function updateEnemyProjectiles(dt) {
    for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
        const p = enemyProjectiles[i]; let rm = false;
        const nx = p.mesh.position.x + p.vel.x * dt, nz = p.mesh.position.z + p.vel.z * dt;
        if (checkCollision({ x: nx, z: p.mesh.position.z }) || checkCollision({ x: p.mesh.position.x, z: nz })) rm = true;
        else { p.mesh.position.x = nx; p.mesh.position.z = nz; }
        p.life -= dt;
        if (!rm && p.mesh.position.distanceTo(camera.position) < 0.7) { damagePlayer(p.damage); spawnParticles(camera.position, '#ff7755', 8, { spread: 2 }); rm = true; }
        if (rm || p.life <= 0) { spawnParticles(p.mesh.position, '#ff7755', 6, { spread: 1.5, life: 0.3 }); scene.remove(p.mesh); enemyProjectiles.splice(i, 1); }
    }
}

const TMP_DIR = { x: 0, z: 0 };

// Alerte de meute : les mobs proches d'un allié qui repère/subit le joueur s'activent
function alertPack(from, radius = 7) {
    const r2 = radius * radius;
    for (const o of mobs) {
        const ou = o.userData;
        if (ou.dead || ou.aggro) continue;
        const dx = o.position.x - from.position.x, dz = o.position.z - from.position.z;
        if (dx * dx + dz * dz < r2) ou.aggro = true;
    }
}

function meleeHitPlayer(mob, mult = 1) {
    const u = mob.userData;
    addLog(`${u.name} frappe !`, 'text-red-400');
    playClip(u.attackSound);
    damagePlayer(Math.round(u.damage * mult));
    // Épines (Égide Éternelle) : l'attaquant en mêlée se blesse
    const thorns = gameState.specials && gameState.specials.thorns;
    if (thorns > 0 && !u.dead && !gameState.isDead) dealDirectDamage(mob, thorns, '#c8ff66', scene, mobs, boss);
    if (u.affix === 'vampiric') {
        const heal = Math.max(2, Math.round(u.damage * 0.45));
        u.hp = Math.min(u.maxHp, u.hp + heal);
        spawnDamageNumber(mob.position, heal, { color: '#ff5668', prefix: '+' });
    }
    if (u.statusOnHit) applyPlayerStatus(u.statusOnHit.type, u.statusOnHit.dps, u.statusOnHit.duration);
}

function updateMobs(dt) {
    updateEnemyProjectiles(dt);
    updateFlowField(camera.position.x, camera.position.z, gameState.time);
    const px = camera.position.x, pz = camera.position.z;
    const t = gameState.time;

    for (const mob of mobs) {
        const u = mob.userData;
        if (u.dead) {
            if (u.affix === 'explosive' && !u.exploded) {
                u.exploded = true;
                spawnRing(mob.position, '#ff5522', { radius: 3, life: 0.5, y: 0.2 });
                spawnParticles(mob.position, '#ff7722', 14, { spread: 4, life: 0.45, maxCount: 10 });
                if (mob.position.distanceTo(camera.position) < 3) { addLog('Élite explose !', 'text-red-500'); damagePlayer(18); }
            }
            if (u.anim && !u.deathDone) { u.anim.update(dt); if (u.anim.finished) { u.deathDone = true; mob.visible = false; } }
            continue;
        }

        const dxp = px - mob.position.x, dzp = pz - mob.position.z;
        const playerDist = Math.hypot(dxp, dzp) || 0.001;
        const toX = dxp / playerDist, toZ = dzp / playerDist;

        // LOD : mob lointain et passif -> mise à jour espacée (gros gain CPU)
        if (!u.aggro && playerDist > 26) {
            u.lodT = (u.lodT || 0) - dt;
            if (u.lodT > 0) continue;
            u.lodT = 0.22;
        }

        u.phase += dt * 6;
        if (u.hitFlash > 0) { u.hitFlash -= dt; mob.material.color.setHex(0xffffff); mob.material.color.lerp(new THREE.Color(0xff3030), 0.7); }
        else mob.material.color.setHex(u.tint || 0xffffff);

        // Ticks de statut (brûlure/poison/saignement/givre)
        tickEntityStatus(u, mob.position, (amt, col) => dealDirectDamage(mob, amt, col, scene, mobs, boss));
        if (u.dead) continue;

        if (u.elite && playerDist < 15 && t >= (u.nextAuraFx || 0)) {
            u.nextAuraFx = t + 0.55 + Math.random() * 0.35;
            spawnParticles(mob.position, u.affixColor || '#ffdd55', 3, { spread: 1.2, life: 0.32, size: 0.1, gravity: 0.2, maxCount: 3 });
        }

        // Aura de givre (Lame de Givre Éternel) : ralentit les ennemis proches
        const aura = gameState.specials && gameState.specials.frostAura;
        if (aura && playerDist < aura) u.slowUntil = Math.max(u.slowUntil || 0, t + 0.4);

        let moving = false, attacking = false;
        if (!gameState.isDead) {
            // Ligne de vue (cache court : recalcul ~8x/s par mob proche)
            u.losT = (u.losT || 0) - dt;
            if (u.losT <= 0) {
                u.losT = 0.12;
                u.los = playerDist < 22 && hasLineOfSight(mob.position.x, mob.position.z, px, pz);
            }

            const detect = detectRange(u.detect || 13);
            if (!u.aggro && playerDist < detect && (playerDist < 2.6 || u.los)) { u.aggro = true; u.packAlert = true; }
            else if (u.aggro && playerDist > detect * 2.2) { u.aggro = false; u.chargeState = null; u.windupAt = 0; }
            if (u.packAlert) { u.packAlert = false; alertPack(mob); }

            let spd = u.speed;
            if (u.slowUntil > t) spd *= 0.4;
            const phaser = u.behavior === 'phaser';
            const embedded = checkCollision(mob.position);   // coincé dans un mur ?
            const wantsRanged = u.behavior === 'caster' || u.ranged;
            const stopDist = wantsRanged ? Math.min(5, Math.max(4, u.attackRange)) : u.attackRange * 0.8;
            const fleeing = u.coward && u.hp < u.maxHp * 0.32 && playerDist < 8;

            if (u.chargeState) {
                // --- CHARGE des brutes : télégraphe immobile puis ruée en ligne droite ---
                const cs = u.chargeState;
                attacking = true;
                if (cs.phase === 'windup') {
                    if (Math.random() < 0.25) spawnParticles(mob.position, '#ff7733', 2, { spread: 1.2, life: 0.25, size: 0.09, maxCount: 2 });
                    if (t >= cs.until) { cs.phase = 'dash'; cs.until = t + 0.8; cs.dx = toX; cs.dz = toZ; playClip(u.attackSound); }
                } else {
                    const cspd = spd * 3.3;
                    const moved = moveEntity(mob, cs.dx * cspd * dt, cs.dz * cspd * dt, false);
                    moving = true;
                    if (playerDist < u.attackRange * 1.1) {
                        meleeHitPlayer(mob, 1.45);
                        u.nextAttack = t + attackInterval(u);
                        u.chargeState = null;
                    } else if (!moved || t >= cs.until) u.chargeState = null;
                }
            } else if (fleeing && u.aggro && !embedded) {
                // Couard blessé : fuit, longe le mur s'il est bloqué
                moving = moveEntity(mob, -toX * spd * 1.2 * dt, -toZ * spd * 1.2 * dt, false);
                if (!moving) moving = moveEntity(mob, -toZ * spd * dt, toX * spd * dt, false);
            } else if (u.aggro) {
                // Déclenchement de charge (loup-garou, chevalier sanglant, furie, élites Vif...)
                if (u.charger && u.los && playerDist > 3.2 && playerDist < 10 && t >= (u.chargeCd || 0)) {
                    u.chargeCd = t + 5.5 + Math.random() * 2;
                    u.chargeState = { phase: 'windup', start: t, until: t + 0.55 };
                    addLog(`${u.name} se ramasse pour charger !`, 'text-orange');
                    spawnFlash({ x: mob.position.x, y: mob.position.y + 0.4 * u.scale, z: mob.position.z }, '#ff7733', { size: 0.35, life: 0.3 });
                }

                // --- Déplacement ---
                if (wantsRanged && u.los && playerDist < 3.4) {
                    // Kite : garde ses distances
                    moving = moveEntity(mob, -toX * spd * 0.9 * dt, -toZ * spd * 0.9 * dt, phaser);
                } else if (playerDist > stopDist || embedded) {
                    // Direct si ligne de vue, sinon contournement par le champ de navigation
                    let mx = toX, mz = toZ;
                    if (!phaser && !embedded && !u.los && flowDirection(mob.position.x, mob.position.z, TMP_DIR)) { mx = TMP_DIR.x; mz = TMP_DIR.z; }
                    moving = moveEntity(mob, mx * spd * dt, mz * spd * dt, phaser || embedded);
                    if (!moving && !phaser && !embedded) {
                        // bloqué contre un angle : glisse latéralement pour contourner
                        u.slideSign = u.slideSign || (Math.random() < 0.5 ? -1 : 1);
                        moving = moveEntity(mob, -mz * u.slideSign * spd * dt, mx * u.slideSign * spd * dt, false);
                        if (!moving) u.slideSign = -u.slideSign;
                    }
                } else if (wantsRanged && u.los) {
                    // À bonne distance : strafe latéral (cible mouvante)
                    u.strafeT = (u.strafeT || 0) - dt;
                    if (u.strafeT <= 0) { u.strafeT = 1 + Math.random() * 1.4; u.strafeSign = Math.random() < 0.5 ? -1 : 1; }
                    moving = moveEntity(mob, -toZ * u.strafeSign * spd * 0.55 * dt, toX * u.strafeSign * spd * 0.55 * dt, false);
                }

                // Séparation légère : les meutes encerclent au lieu de s'empiler
                if (moving && mobs.length < 70) {
                    let sx = 0, sz = 0;
                    for (const o of mobs) {
                        if (o === mob || o.userData.dead) continue;
                        const ox = mob.position.x - o.position.x, oz = mob.position.z - o.position.z;
                        const d2 = ox * ox + oz * oz;
                        if (d2 > 0.72 || d2 < 1e-6) continue;
                        const d = Math.sqrt(d2);
                        sx += (ox / d) * (0.85 - d); sz += (oz / d) * (0.85 - d);
                    }
                    if (sx || sz) moveEntity(mob, sx * dt * 2.2, sz * dt * 2.2, false);
                }

                // --- ATTAQUE MÊLÉE télégraphée (préparation visible, esquivable) ---
                if (playerDist < u.attackRange && !embedded) {
                    attacking = true;
                    if (!u.windupAt && t >= (u.nextAttack || 0)) {
                        u.windupAt = t + 0.38;
                        spawnFlash({ x: mob.position.x, y: mob.position.y + 0.55 * u.scale, z: mob.position.z }, '#ff4444', { size: 0.22, life: 0.32 });
                    }
                }
                if (u.windupAt && t >= u.windupAt) {
                    u.windupAt = 0;
                    u.nextAttack = t + attackInterval(u);
                    if (playerDist < u.attackRange * 1.3 && !embedded) meleeHitPlayer(mob);
                }

                // --- Tir à distance : uniquement à vue (plus de tirs dans les murs) ---
                if (wantsRanged && !embedded && u.los && playerDist > 1.4 && playerDist < (u.detect || 13) && t >= (u.nextShot || 0)) {
                    u.nextShot = t + attackInterval(u) * 1.3;
                    if (Math.random() < (u.projChance != null ? u.projChance : 1)) {
                        attacking = true; playClip(u.attackSound);
                        spawnEnemyProjectile(mob.position, u.projColor || u.color, u.projSpeed || 9, Math.max(2, Math.round(u.damage * 0.8)));
                    }
                }
            } else {
                // Errance : respecte les murs (ne phase QUE pour sortir d'un mur où il serait coincé)
                u.wanderTimer -= dt;
                if (u.wanderTimer <= 0) {
                    u.wanderTimer = 1.5 + Math.random() * 2.5;
                    if (Math.random() < 0.6) { const a = Math.random() * Math.PI * 2; u.wanderDir = { x: Math.cos(a), z: Math.sin(a) }; }
                    else u.wanderDir = null;
                }
                if (embedded) {
                    moving = moveEntity(mob, toX * spd * dt, toZ * spd * dt, true);
                } else if (u.wanderDir) {
                    moving = moveEntity(mob, u.wanderDir.x * spd * 0.4 * dt, u.wanderDir.z * spd * 0.4 * dt, false);
                    if (!moving) u.wanderTimer = 0;   // bloque par un mur -> nouveau cap
                }
            }
        }

        // Démarche selon le type : float = lévitation (pas de rebond de marche),
        // hop = sauts (slimes), walk = rebond seulement en mouvement.
        if (u.gait === 'float') {
            mob.position.y = u.baseY + Math.sin(u.phase * 0.55) * 0.13 * u.scale;
        } else if (u.gait === 'hop') {
            mob.position.y = u.baseY + (moving ? Math.abs(Math.sin(u.phase * 1.1)) * 0.22 * u.scale : 0);
        } else {
            mob.position.y = u.baseY + (moving ? Math.abs(Math.sin(u.phase)) * 0.08 * u.scale : 0);
        }

        // Flip horizontal de combat : se balance gauche/droite quand aggro
        if (u.aggro) { u.flipT += dt; if (u.flipT > 0.4) { u.flipT = 0; u.facing = -u.facing; } }
        else u.facing = 1;
        mob.scale.x = Math.abs(mob.scale.x) * u.facing;

        u.moving = moving;
        if (u.anim) { u.anim.setState(attacking ? 'attack' : moving ? 'walk' : 'idle'); u.anim.update(dt); }
    }
}

// =====================================================================
//  PORTAIL / DESCENTE
// =====================================================================
let portalHintShown = false;
function updatePortalLogic(dt) {
    updatePortal(dt, gameState.time);
    if (!isAtPortal(camera.position)) { portalHintShown = false; return; }
    // Delve : il faut vaincre le boss ; Labyrinthe : portail toujours ouvert
    if (gameState.mode === 'labyrinth' || gameState.bossDead) {
        descend();
    } else if (!portalHintShown) {
        portalHintShown = true;
        addLog('Le portail est scellé. Vaincs le Gardien !', 'text-purple-300');
    }
}
function descend() {
    spawnParticles(camera.position, '#aa44ff', 30, { spread: 4 });
    gameState.hp = Math.min(gameState.maxHp, gameState.hp + gameState.maxHp * 0.3);
    gameState.mana = gameState.maxMana;
    loadFloor(gameState.depth + 1);
}

// =====================================================================
//  XP / NIVEAU
// =====================================================================
function gainXp(amount) {
    amount = Math.round(amount * (1 + gameState.stats.xpBonus));
    gameState.xp += amount;
    let leveled = false;
    const prevLevel = gameState.level;
    while (gameState.xp >= gameState.maxXp) {
        leveled = true;
        gameState.xp -= gameState.maxXp; gameState.level++;
        gameState.maxXp = Math.floor(gameState.maxXp * 1.5);
        gameState.attrPoints += 3;                 // 3 points d'attribut par niveau
        gameState.skillPoints = (gameState.skillPoints || 0) + 1;   // 1 point de compétence par niveau
        recomputeStats();
        gameState.hp = gameState.maxHp; gameState.mana = gameState.maxMana;
        addLog(`★ Niveau ${gameState.level} ! +3 attributs, +1 compétence`, 'text-yellow-400');
        playLevelUpSound();
        spawnRing(camera.position, '#ffd24d', { radius: 3, life: 0.7, y: 0.2 });
        spawnParticles(camera.position, '#ffd24d', 30, { spread: 5, life: 0.9 });
    }
    if (leveled) {
        // Sorts débloqués entre l'ancien et le nouveau niveau
        GameData.spells.forEach(sp => {
            const ul = sp.unlockLevel || 1;
            if (ul > prevLevel && ul <= gameState.level) addLog(`✦ Nouveau sort débloqué : ${sp.name} !`, 'text-purple-300');
        });
        buildActionBar();
        if (playing) saveGame();
    }
    updateHUD();
}
window.gainXp = gainXp;

// =====================================================================
//  FIN DE PARTIE
// =====================================================================
function showEndScreen(title, color, sub) {
    const ov = document.getElementById('end-screen'); if (!ov) return;
    document.getElementById('end-title').innerText = title;
    document.getElementById('end-title').style.color = color;
    document.getElementById('end-sub').innerHTML = sub;
    ov.classList.remove('hidden'); ov.style.display = 'flex';
    gameState.menuOpen = true;
    try { document.exitPointerLock(); } catch (e) { }
}
function onPlayerDeath() {
    addLog('VOUS ETES MORT', 'text-red-700'); playGameOver();
    const lostGold = Math.floor(gameState.gold * 0.2);
    showEndScreen('TU ES TOMBÉ', '#ff3030',
        `Niv. ${gameState.level} - Étage ${gameState.depth} - ${gameState.kills} kills<br>` +
        `<span class="text-yellow-400">Tu perds ${lostGold} or</span><br>` +
        `<span class="text-cyan">Retour au checkpoint : étage ${gameState.checkpointDepth}</span>`);
    saveGame();
}

// Réapparition au dernier checkpoint (début de l'étage), avec pénalité d'or
function respawnAtCheckpoint() {
    const ov = document.getElementById('end-screen');
    if (ov) { ov.classList.add('hidden'); ov.style.display = 'none'; }
    gameState.isDead = false; gameState.menuOpen = false; gameState.won = false;
    gameState.gold = Math.floor(gameState.gold * 0.8);
    loadFloor(gameState.checkpointDepth);
    gameState.hp = gameState.maxHp; gameState.mana = gameState.maxMana; gameState.stamina = gameState.maxStamina;
    gameState.invulnUntil = gameState.time + 2;   // bref répit
    updateHUD();
    try { renderer.domElement.requestPointerLock(); } catch (e) { }
}
function onBossDefeated() {
    // Pas de fin : on continue plus bas via le portail
    spawnRing(boss.position, '#aa44ff', { radius: 2.5, life: 0.8, y: 0.2 });
    addLog(`Gardien de l'étage ${gameState.depth} vaincu ! Rejoins le portail.`, 'text-orange');
    playVictory();
}
window.onBossDefeated = onBossDefeated;

// =====================================================================
//  BOUCLE
// =====================================================================
const clock = new THREE.Clock();
let playing = false;
let hudTimer = 0, minimapTimer = 0, cooldownUiTimer = 0, ambientFxTimer = 0;

const BIOME_AMBIENCE = {
    crypt: { color: '#c8c0a0', spread: 1.8, size: 0.05, gravity: 0.12, every: 0.42 },
    ice: { color: '#bfe6ff', spread: 2.2, size: 0.06, gravity: 0.05, every: 0.34 },
    forge: { color: '#ff8844', spread: 2.0, size: 0.07, gravity: -0.4, every: 0.32 },
    void: { color: '#c060ff', spread: 2.4, size: 0.07, gravity: -0.2, every: 0.34 },
    toxic: { color: '#9aff66', spread: 1.8, size: 0.06, gravity: -0.05, every: 0.4 },
    ossuary: { color: '#d8d2bf', spread: 1.8, size: 0.05, gravity: 0.1, every: 0.44 },
    ember: { color: '#ff7733', spread: 2.0, size: 0.07, gravity: -0.45, every: 0.3 },
    deep_void: { color: '#a050ff', spread: 2.6, size: 0.07, gravity: -0.2, every: 0.3 }
};

function updateBiomeAmbience(dt) {
    if (!currentBiome || gameState.isDead || gameState.preview) return;
    const cfg = BIOME_AMBIENCE[currentBiome.id] || BIOME_AMBIENCE.crypt;
    ambientFxTimer -= dt;
    if (ambientFxTimer > 0) return;
    ambientFxTimer = cfg.every + Math.random() * 0.18;
    const p = camera.position.clone();
    const a = Math.random() * Math.PI * 2;
    const r = 1.8 + Math.random() * 4.2;
    p.x += Math.cos(a) * r;
    p.z += Math.sin(a) * r;
    p.y = 0.5 + Math.random() * 1.7;
    spawnParticles(p, cfg.color, 2, { spread: cfg.spread, life: 1.0, size: cfg.size, gravity: cfg.gravity, maxCount: 2 });
}

function step(dt) {
    if (gameState.menuOpen) { updateHUD(); return; }   // pause quand un menu est ouvert
    gameState.time += dt;
    // Autosave continu (objets/PV/or/progression) : on ne perd rien en actualisant
    if (playing && !gameState.isDead && !gameState.preview) { autosaveTimer -= dt; if (autosaveTimer <= 0) { autosaveTimer = 2.5; saveGame(); } }
    if (!gameState.isDead) {
        gameState.mana = Math.min(gameState.maxMana, gameState.mana + gameState.manaRegen * dt);
        gameState.stamina = Math.min(gameState.maxStamina, gameState.stamina + 25 * dt);
        // Ticks de statut subis par le joueur (poison/saignement...)
        tickPlayerStatus((amt, col) => {
            gameState.hp -= Math.max(1, Math.round(amt));
            spawnDamageNumber(camera.position, Math.max(1, Math.round(amt)), { color: col });
            if (gameState.hp <= 0 && !gameState.isDead && !tryPhoenix()) { gameState.hp = 0; gameState.isDead = true; onPlayerDeath(); }
        }, camera.position);
    }
    if (gameState.buffs.length) { const b = gameState.buffs.length; gameState.buffs = gameState.buffs.filter(x => x.until > gameState.time); if (gameState.buffs.length !== b) recomputeStats(); }

    updateInputs(touchState, primaryAttack);
    updatePlayer(dt);
    updateCameraFeel(dt);
    vm3d.update(dt, input.forward !== 0 || input.strafe !== 0);
    updateInteraction();
    updateTraps(dt);
    updateHazards(dt);
    updateBoss(dt);
    updateMobs(dt);
    updateBiomeAmbience(dt);
    // Pas des monstres : le plus proche qui marche (pas les volants) et chasse
    mobStepTimer -= dt;
    if (mobStepTimer <= 0 && !gameState.isDead) {
        let near = null, nd = 7;
        for (const m of mobs) {
            const u = m.userData;
            if (u.gait === 'float' || u.dead || !u.aggro || !u.moving) continue;
            const d = m.position.distanceTo(camera.position);
            if (d < nd) { nd = d; near = m; }
        }
        if (near) { if (!playClip(near.userData.walkSound, 0.5)) playFootstep((near.userData.scale || 1) >= 1.4 || near.userData.elite ? 'heavy' : 'mob'); mobStepTimer = 0.5; }
        else mobStepTimer = 0.3;
    }
    // Cri de chauve-souris quand l'une vole à proximité
    batChirpTimer -= dt;
    if (batChirpTimer <= 0 && !gameState.isDead) {
        const bat = mobs.find(m => m.userData.id === 'bat' && !m.userData.dead && m.position.distanceTo(camera.position) < 8);
        if (bat) { playSample('bat', 0.4); batChirpTimer = 2.5 + Math.random() * 2.5; }
        else batChirpTimer = 1.5;
    }
    // PNJ : salutation passive quand on approche + ils font face au joueur
    for (const n of npcs) {
        const d = camera.position.distanceTo(n.position);
        if (d < 2.4 && gameState.time > n.userData.nextTalk) {
            const L = n.userData.lines; addLog(`${n.userData.name} : « ${L[ri(0, L.length - 1)]} »`, 'text-amber-300');
            n.userData.nextTalk = gameState.time + 12;
        }
    }
    updateSpells(dt, scene, mobs, boss, camera, spellWorldHooks());
    updatePickups(dt, camera);
    updateEffects(dt, camera);
    updatePortalLogic(dt);
    minimapTimer -= dt;
    if (minimapTimer <= 0) {
        minimapTimer = 0.12;
        drawMinimap(camera, boss);
    }
    const bm = document.getElementById('bigmap');
    if (bm && !bm.classList.contains('hidden')) drawBigMap(camera, boss, mobs, objects);
    cooldownUiTimer -= dt;
    if (cooldownUiTimer <= 0) {
        cooldownUiTimer = 0.08;
        updateSpellCooldowns();
    }
    hudTimer -= dt;
    if (hudTimer <= 0) {
        hudTimer = 0.08;
        updateHUD();
    }
}
function animate() {
    requestAnimationFrame(animate);
    if (!playing) return;
    if (document.hidden) { clock.getDelta(); return; }
    const dt = Math.min(0.04, clock.getDelta());
    step(dt);
    if (useBloom && composer) composer.render(); else renderer.render(scene, camera);
}

// =====================================================================
//  INIT
// =====================================================================
function giveStartGear() {
    const give = id => { const base = GameData.items.find(i => i.id === id) || DEFAULT_GAME_DATA.items.find(i => i.id === id); if (base) addItemWithAutoEquip(rollItemInstance(base, { rarity: 'green' })); };
    give('sword'); give('shield');
    give('crossbow'); give('staff');     // démontre les slots Distance & Magie (à équiper depuis le sac)
    addItemWithAutoEquip({ ...GameData.items.find(i => i.id === 'potion_heal') });
    addItemWithAutoEquip({ ...GameData.items.find(i => i.id === 'potion_heal') });
    addItemWithAutoEquip({ ...GameData.items.find(i => i.id === 'potion_mana') });
    playerInventory.equipItem(playerInventory.items.findIndex(i => i.id === 'sword'));
    playerInventory.equipItem(playerInventory.items.findIndex(i => i.id === 'shield'));
}

let animating = false;
// Lance la partie. fresh=true : nouveau perso ; fresh=false : reprise d'un save.
async function startGame(fresh, startDepth) {
    document.getElementById('start-screen').style.display = 'none';
    const ui = document.getElementById('ui-layer'); ui.classList.remove('hidden'); ui.classList.add('flex');
    await _assetsReady;
    if (fresh) giveStartGear();
    autoEquipExistingEmptySlots();
    recomputeStats();
    if (fresh) {
        gameState.hp = gameState.maxHp; gameState.mana = gameState.maxMana; gameState.stamina = gameState.maxStamina;
    } else {   // reprise : on garde les vitals sauvegardés (position seule remise à zéro)
        gameState.hp = Math.min(gameState.maxHp, gameState.savedHp != null ? gameState.savedHp : gameState.maxHp);
        gameState.mana = Math.min(gameState.maxMana, gameState.savedMana != null ? gameState.savedMana : gameState.maxMana);
        gameState.stamina = Math.min(gameState.maxStamina, gameState.savedStamina != null ? gameState.savedStamina : gameState.maxStamina);
    }
    buildActionBar(); updateHUD(); wirePauseControls(); warmSpellAssets();
    playing = true;
    loadFloor(startDepth || 1);
    addLog(`${gameState.charName} - ${bonusById(gameState.charBonusId).name}`, 'text-cyan');
    applyAudioConfig();
    if (!gameState.preview) saveGame();
    if (!animating) { animating = true; animate(); }
}

// --- Création de personnage : aperçu live du bonus selon le nom ---
let selectedMode = 'delve';
const nameInput = document.getElementById('char-name');
function previewChar() {
    const name = (nameInput && nameInput.value) || 'Bjorn';
    const c = deriveCharacter(name);
    const b = bonusById(c.bonusId);
    const bonusEl = document.getElementById('char-bonus');
    const attrEl = document.getElementById('char-attrs');
    if (bonusEl) bonusEl.innerHTML = `★ ${b.name} - <span class="text-slate-300">${b.desc}</span>`;
    if (attrEl) attrEl.innerText = 'Attributs : ' + Object.entries(c.attributes).filter(([, v]) => v > 0).map(([k, v]) => `${k} +${v}`).join('  ');
}
if (nameInput) { nameInput.addEventListener('input', previewChar); previewChar(); }

function pickMode(m) {
    selectedMode = m;
    const d = document.getElementById('mode-delve'), l = document.getElementById('mode-lab');
    if (d) { d.style.borderColor = m === 'delve' ? '#4deeea' : '#164e4e'; d.style.color = m === 'delve' ? '#4deeea' : '#6b7280'; }
    if (l) { l.style.borderColor = m === 'labyrinth' ? '#4deeea' : '#164e4e'; l.style.color = m === 'labyrinth' ? '#4deeea' : '#6b7280'; }
}
document.getElementById('mode-delve')?.addEventListener('click', () => pickMode('delve'));
document.getElementById('mode-lab')?.addEventListener('click', () => pickMode('labyrinth'));

// Bouton CRÉER & JOUER (nouveau personnage)
document.getElementById('start-btn')?.addEventListener('click', () => {
    const name = (nameInput && nameInput.value.trim()) || 'Bjorn';
    applyCharacter(deriveCharacter(name));
    gameState.mode = selectedMode;
    startGame(true, 1);
});

// Bouton CONTINUER (reprise du save) + REPRISE AUTOMATIQUE au rechargement.
// Le rechargement ne fait QUE remettre la position au début de l'étage : on
// conserve objets, PV, or, niveau, progression. (Le menu ne réapparaît que sans save.)
// Mode PREVIEW de biome (depuis la Forge : index.html?preview=<biomeId>) : décor seul, n'écrase pas la save
const _previewBiome = new URLSearchParams(location.search).get('preview');
const _save = (!_previewBiome && hasSave()) ? loadGame() : null;
if (_previewBiome) {
    gameState.preview = true;
    setForcedBiome(_previewBiome);
    applyCharacter(deriveCharacter('Testeur'));
    gameState.mode = 'delve';
    startGame(true, 1);
    addLog(`Aperçu du biome « ${_previewBiome} »`, 'text-fuchsia-300');
} else if (_save) {
    const cb = document.getElementById('continue-btn');
    if (cb) {
        cb.classList.remove('hidden');
        cb.innerHTML = `▶ CONTINUER<br><span class="text-[9px] text-slate-400">${_save.name || 'Héros'} · ${_save.mode === 'labyrinth' ? 'Labyrinthe' : 'Delve'} ${_save.depth || 1} · Niv.${_save.level || 1}</span>`;
        cb.addEventListener('click', () => { applySave(_save); startGame(false, _save.depth || 1); });
    }
    // Reprise auto (évite de perdre sa progression en actualisant)
    applySave(_save);
    startGame(false, _save.depth || 1);
}

document.getElementById('restart-btn')?.addEventListener('click', respawnAtCheckpoint);

window.addEventListener('resize', setRenderSize);

// Debug
window.BJORN = { gameState, get mobs() { return mobs; }, get boss() { return boss; }, camera, primaryAttack, doCast, step, scene, playerInventory, GameData, loadFloor, checkCollision, isAtPortal, getLayout, cellAt, mitigate, recomputeStats, refreshViewmodel, tryRevealSecret, detectRange, get useBloom() { return useBloom; }, get bloom() { return bloomPass; }, vm3d, refreshViewmodel, swingView, isPit, toggleBigMap, get objects() { return objects; }, get npcs() { return npcs; }, get merchant() { return merchant; }, get enemyProjectiles() { return enemyProjectiles; }, get breakables() { return breakables; }, placeAsset, removeAsset, hasAsset, digWall, placeBlock, switchDungeonMode, buildActionBar, switchAction, get actions() { return actions; }, get actionIndex() { return actionIndex; }, set actionIndex(v) { actionIndex = v; updateActionSelection(); }, renderFrame: () => { if (useBloom && composer) composer.render(); else renderer.render(scene, camera); } };
