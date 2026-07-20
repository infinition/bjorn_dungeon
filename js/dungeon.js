import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.128.0/examples/jsm/loaders/GLTFLoader.js';
import { GameData } from './data.js';
import { floorPopulation } from './scaling.js';

// Modèles 3D personnalisés (glTF/GLB) qui remplacent un prop procédural.
// GameData.propModels[name] = URL ou data-URI base64 d'un .glb/.gltf (édité dans la Forge).
const _gltfLoader = new GLTFLoader();

// =====================================================================
//  DONJON - generation en salles + couloirs, portes, secrets, portail.
//  Donjon infini : un portail descend a l'etage suivant (depth+1).
// =====================================================================

export const WALL_HEIGHT = 3;

// Codes de cellule
const WALL = 0, ROOM = 1, CORR = 2, DOOR = 3, SECRET = 4, PORTAL = 5, PIT = 6, LOCKED = 7;
const PASSABLE = new Set([ROOM, CORR, DOOR, PORTAL]); // SECRET/LOCKED + PIT bloquent (PIT franchissable seulement en saut, géré côté joueur)

export function isPit(x, z) {
    if (!layout) return false;
    const ix = Math.floor(x), iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= layout.size || iz >= layout.size) return false;
    return layout.grid[iz][ix] === PIT;
}

let layout = null;   // { grid, size, rooms, spawn, bossSpawn, portal, mobSpawns, chestSpawns, secretDoors }
let group = null;    // THREE.Group du decor
let wallMesh = null; // InstancedMesh des murs
let portalMesh = null;
let secretIndex = {}; // "cx,cz" -> index d'instance de mur (pour masquer a la revelation)
let wallIndex = {};   // "cx,cz" -> index d'instance pour TOUS les murs (creuser)
let playerBlocks = {}; // "cx,cz" -> mesh de bloc posé par le joueur (construire)
let flames = [];      // torches murales animees { sprite, light, phase, baseI }
let propBlocks = new Set();  // cellules "cx,cz" occupees par un gros prop -> collision
let breakables = [];         // décor cassable (mêlée) : { mesh, x, z, kind, loot }
export function getBreakables() { return breakables; }
let forcedBiomeId = null;    // preview : force un biome précis
export function setForcedBiome(id) { forcedBiomeId = id || null; }

// Textures procedurales (torche / rune), additives
let _flameTex = null, _runeTex = null;
function flameTexture() {
    if (_flameTex) return _flameTex;
    const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
    const g = x.createRadialGradient(16, 18, 1, 16, 18, 16);
    g.addColorStop(0, 'rgba(255,255,210,1)'); g.addColorStop(0.4, 'rgba(255,170,60,0.9)');
    g.addColorStop(1, 'rgba(255,80,0,0)');
    x.fillStyle = g; x.beginPath(); x.ellipse(16, 16, 9, 14, 0, 0, 7); x.fill();
    _flameTex = new THREE.CanvasTexture(c); return _flameTex;
}
// --- Normal maps procedurales (relief des murs / du sol) ---
// heightFn(x,y,size) -> hauteur 0..1 ; conversion en normal-map tangent-space.
function makeNormalMap(size, heightFn, diff) {
    const H = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = heightFn(x, y, size);
    const at = (x, y) => H[((y % size) + size) % size * size + (((x % size) + size) % size)];
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size); const d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = (at(x - 1, y) - at(x + 1, y)) * diff;
        const dy = (at(x, y - 1) - at(x, y + 1)) * diff;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        d[i] = (dx / len * 0.5 + 0.5) * 255;
        d[i + 1] = (dy / len * 0.5 + 0.5) * 255;
        d[i + 2] = (1 / len * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
}
function wallHeight(x, y) {
    const bw = 16, bh = 8, row = Math.floor(y / bh), shift = (row % 2) * (bw / 2);
    const mortar = ((x + shift) % bw) < 1.6 || (y % bh) < 1.6;
    return mortar ? 0.15 : 0.85 + Math.sin(x * 0.8 + y) * 0.05;   // creux au mortier
}
function floorHeight(x, y) {
    return 0.5 + 0.25 * Math.sin(x * 0.9 + y * 0.3) + 0.2 * Math.sin(x * 0.2 - y * 0.85) + 0.05 * Math.sin(x * 3.1);
}

function usesProceduralNormal(src) {
    // Le relief procedural a ete dessine pour les textures internes. Sur une
    // texture importee dans la Forge, il cree des aplats rouge/cyan parasites.
    return typeof src === 'string' && src.startsWith('assets/textures/');
}

const RUNE_GLYPHS = ['ᚱ', 'ᚦ', 'ᚲ', 'ᛟ', 'ᛉ', 'ᚷ', 'ᛏ', '◇'];
function runeTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.font = '24px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = '#fff'; x.shadowBlur = 4;
    x.fillText(RUNE_GLYPHS[Math.floor(Math.random() * RUNE_GLYPHS.length)], 16, 17);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
}

const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rnd(a, b + 1));

// --------------------------------------------------------------------
//  GENERATION
// --------------------------------------------------------------------
export function generateFloor(depth = 1, mode = 'delve') {
    const cfg = GameData.dungeon || {};
    const _biomes = GameData.biomes || [];
    const _biome = forcedBiomeId ? (_biomes.find(b => b.id === forcedBiomeId) || null) : (_biomes.length ? _biomes[(depth - 1) % _biomes.length] : null);
    const lab = mode === 'labyrinth';                 // labyrinthe : plus grand, salles petites, dédale
    const pop = floorPopulation(depth, mode);
    const size = (cfg.size || 44) + (lab ? 16 : 0) + Math.min(10, Math.floor(pop.roomBonus * 0.8));
    const grid = Array.from({ length: size }, () => new Int8Array(size).fill(WALL));

    const rooms = [];
    const nRooms = (lab ? ri(16, 22) : ri(cfg.roomsMin || 7, cfg.roomsMax || 11)) + pop.roomBonus;
    let tries = 0;
    while (rooms.length < nRooms && tries < 300) {
        tries++;
        const w = lab ? ri(3, 6 + pop.roomSizeBonus) : ri(cfg.roomMin || 5, (cfg.roomMax || 11) + pop.roomSizeBonus);
        const h = lab ? ri(3, 6 + pop.roomSizeBonus) : ri(cfg.roomMin || 5, (cfg.roomMax || 11) + pop.roomSizeBonus);
        const x = ri(2, size - w - 2);
        const y = ri(2, size - h - 2);
        const rect = { x, y, w, h, cx: Math.floor(x + w / 2), cy: Math.floor(y + h / 2) };
        // pas de chevauchement (avec marge)
        if (rooms.some(r => x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y)) continue;
        rooms.push(rect);
        for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j][i] = ROOM;
    }

    // Connexions : chaine + quelques boucles
    const carveH = (x0, x1, y) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) if (grid[y][x] === WALL) grid[y][x] = CORR; };
    const carveV = (y0, y1, x) => { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) if (grid[y][x] === WALL) grid[y][x] = CORR; };
    const connect = (a, b) => {
        if (Math.random() < 0.5) { carveH(a.cx, b.cx, a.cy); carveV(a.cy, b.cy, b.cx); }
        else { carveV(a.cy, b.cy, a.cx); carveH(a.cx, b.cx, b.cy); }
    };
    for (let i = 1; i < rooms.length; i++) connect(rooms[i - 1], rooms[i]);
    for (let k = 0; k < (lab ? 8 : 2) && rooms.length > 3; k++) connect(rooms[ri(0, rooms.length - 1)], rooms[ri(0, rooms.length - 1)]);

    // Portes : aux entrees de salle (cellule de couloir adjacente a une salle)
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
        if (grid[y][x] !== CORR) continue;
        const around = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => grid[y + dy][x + dx]);
        if (around.includes(ROOM) && Math.random() < 0.5) grid[y][x] = DOOR;
    }

    // Trous : dans des couloirs ETROITS (1 case). Franchissables au saut par le
    // joueur, infranchissables par les monstres -> piège tactique pour semer les mobs.
    // Les anciens trous au sol sont desactives tant qu'ils n'ont pas de vraie
    // mecanique de chute. Les pieges passent maintenant par des props caches.

    // Salle de depart / boss (la plus eloignee)
    const start = rooms[0];
    let boss = rooms[1] || rooms[0], best = -1;
    rooms.forEach(r => { const d = Math.hypot(r.cx - start.cx, r.cy - start.cy); if (d > best) { best = d; boss = r; } });

    // Portail dans la salle du boss
    const portalCell = { cx: boss.cx, cz: Math.min(boss.y + boss.h - 2, boss.cy + 1) };
    grid[portalCell.cz][portalCell.cx] = PORTAL;

    // Chambre secrete : petite piece collee a une salle, separee par une porte secrete
    const secretDoors = [];
    const chestSpawns = [];
    placeSecretChamber(grid, size, rooms, start, boss, secretDoors, chestSpawns);

    // Caveau scellé : chambre verrouillée au butin garanti, la clé est portée par un champion
    const vaultDoors = [];
    placeVaultChamber(grid, size, rooms, start, boss, vaultDoors, chestSpawns);

    // --- THÈMES DE SALLE : chaque salle raconte quelque chose et pilote ses spawns ---
    const otherRooms = rooms.filter(r => r !== start && r !== boss);
    const themed = { treasury: [], lair: [], storage: [], graveyard: [], sanctum: [], guard: [] };
    let hasTreasury = false, hasSanctum = false;
    start.theme = 'start'; boss.theme = 'boss';
    for (const r of otherRooms) {
        const area = r.w * r.h;
        const roll = Math.random();
        if (!hasTreasury && roll < 0.14 && area >= 16) { r.theme = 'treasury'; hasTreasury = true; }
        else if (roll < 0.30) r.theme = 'lair';
        else if (roll < 0.44) r.theme = 'storage';
        else if (roll < 0.55) r.theme = 'graveyard';
        else if (!hasSanctum && roll < 0.65) { r.theme = 'sanctum'; hasSanctum = true; }
        else if (roll < 0.74 && area >= 12) r.theme = 'guard';
        else r.theme = 'plain';
        if (themed[r.theme]) themed[r.theme].push(r);
    }

    // Coffres : dispersion de base + trésorerie (rare/maudit garanti) + salle de garde
    const mobSpawns = [];
    const nChests = (cfg.chestsPerFloor || 3);
    for (let i = 0; i < nChests && otherRooms.length; i++) {
        const r = otherRooms[ri(0, otherRooms.length - 1)];
        // Type d'objet : restreint au biome si défini, sinon coffres par défaut
        const bo = _biome && Array.isArray(_biome.objects) && _biome.objects.length ? _biome.objects : null;
        const ct = bo ? bo[ri(0, bo.length - 1)] : (Math.random() < 0.08 ? 'chest_cursed' : Math.random() < 0.25 ? 'chest_rare' : 'chest_common');
        chestSpawns.push({ x: r.cx + 0.5, z: r.cy + 0.5, type: ct });
    }
    themed.treasury.forEach(r => {
        chestSpawns.push({ x: r.cx + 0.5, z: r.cy + 0.5, type: Math.random() < 0.4 ? 'chest_cursed' : 'chest_rare' });
        chestSpawns.push({ x: r.cx - 0.5, z: r.cy + 1.5, type: 'chest_common' });
    });
    themed.guard.forEach(r => {
        chestSpawns.push({ x: r.cx + 0.5, z: r.cy + 0.5, type: 'chest_rare' });
        mobSpawns.push({ x: r.cx + 1.5, z: r.cy + 0.5, elite: true });   // champion de garde
    });

    // Cercueils : 3-4 dans les salles "cimetière", sinon 1-2 dispersés
    const coffinSpawns = [];
    const coffinRooms = themed.graveyard.length ? themed.graveyard : otherRooms;
    const nCoffins = themed.graveyard.length ? themed.graveyard.length * 3 : 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < nCoffins && coffinRooms.length; i++) {
        const r = coffinRooms[i % coffinRooms.length];
        const x = ri(r.x, r.x + r.w - 1), z = ri(r.y, r.y + r.h - 1);
        if (grid[z][x] !== ROOM) continue;
        if (Math.hypot(x - start.cx, z - start.cy) < 5) continue;
        if (coffinSpawns.some(c => Math.hypot(c.x - (x + 0.5), c.z - (z + 0.5)) < 1.5)) continue;
        coffinSpawns.push({ x: x + 0.5, z: z + 0.5 });
    }

    // Contenants FOUILLABLES (tonneau/caisse/armoire) -> butin via E, dans les salles.
    // (test mural LOCAL : le `layout` module n'est pas encore assigné ici)
    const localWallOff = (x, z) => {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const c = (x + dx < 0 || z + dz < 0 || x + dx >= size || z + dz >= size) ? WALL : grid[z + dz][x + dx];
            if (c === WALL || c === SECRET) return [dx, dz];
        }
        return null;
    };
    const containerSpawns = [];
    const cTypes = ['barrel', 'crate', 'wardrobe'];
    // Les salles "réserve" débordent de contenants fouillables
    const nCont = 2 + ri(0, 2) + themed.storage.length * 3;
    let cguard = 0;
    while (containerSpawns.length < nCont && cguard < 260) {
        cguard++;
        const storagePick = themed.storage.length && containerSpawns.length < themed.storage.length * 3;
        const r = storagePick ? themed.storage[containerSpawns.length % themed.storage.length]
            : (otherRooms.length ? otherRooms[ri(0, otherRooms.length - 1)] : rooms[ri(0, rooms.length - 1)]);
        const x = ri(r.x, r.x + r.w - 1), z = ri(r.y, r.y + r.h - 1);
        if (grid[z][x] !== ROOM) continue;
        if (Math.hypot(x - start.cx, z - start.cy) < 3) continue;
        if (containerSpawns.some(c => Math.floor(c.x) === x && Math.floor(c.z) === z)) continue;
        const name = cTypes[ri(0, cTypes.length - 1)];
        const off = name === 'wardrobe' ? localWallOff(x, z) : null;
        if (name === 'wardrobe' && !off) continue;
        containerSpawns.push({ x: x + 0.5, z: z + 0.5, name, rotY: off ? wallFacingRotY(off) : Math.random() * Math.PI * 2, againstWall: !!off, off });
    }

    // Evenements de salle : petits choix/bonus fantasy pour rendre l'etage memorable.
    const eventSpawns = [];
    const eventTypes = ['shrine', 'fountain', 'rune_cache'];
    // Sanctuaire : événement garanti au centre de la salle
    themed.sanctum.forEach(r => eventSpawns.push({ x: r.cx + 0.5, z: r.cy + 0.5, type: eventTypes[ri(0, eventTypes.length - 1)] }));
    const nEvents = lab ? 3 : 2;
    let eguard = 0;
    while (eventSpawns.length < nEvents && eguard < 160 && otherRooms.length) {
        eguard++;
        const r = otherRooms[ri(0, otherRooms.length - 1)];
        const x = ri(r.x + 1, r.x + r.w - 2), z = ri(r.y + 1, r.y + r.h - 2);
        if (grid[z]?.[x] !== ROOM) continue;
        if (Math.hypot(x - start.cx, z - start.cy) < 6 || Math.hypot(x - boss.cx, z - boss.cy) < 4) continue;
        if (eventSpawns.some(e => Math.hypot(e.x - (x + 0.5), e.z - (z + 0.5)) < 4)) continue;
        eventSpawns.push({ x: x + 0.5, z: z + 0.5, type: eventTypes[eventSpawns.length % eventTypes.length] });
    }

    // Pieges caches : poses plus tard sous certains props cochables dans la Forge.
    const trapSpawns = [];
    const trapBudget = Math.min(lab ? 10 : 7, 2 + Math.floor(depth * 0.6));

    // Flaques de danger propres au biome (lave / poison / glace), lisibles au sol
    const hazardSpawns = [];
    const HAZARD_BY_BIOME = { forge: 'lava', ember: 'lava', toxic: 'poison', ice: 'ice' };
    const hazardType = _biome ? (_biome.hazard || HAZARD_BY_BIOME[_biome.id]) : null;
    if (hazardType) {
        const nHaz = 3 + ri(0, 3);
        let hguard = 0;
        while (hazardSpawns.length < nHaz && hguard < 140) {
            hguard++;
            const r = rooms[ri(0, rooms.length - 1)];
            if (r === start) continue;
            const x = ri(r.x + 1, r.x + r.w - 2), z = ri(r.y + 1, r.y + r.h - 2);
            if (grid[z]?.[x] !== ROOM) continue;
            if (Math.hypot(x - start.cx, z - start.cy) < 6) continue;
            if (hazardSpawns.some(h => Math.hypot(h.x - (x + 0.5), h.z - (z + 0.5)) < 3)) continue;
            hazardSpawns.push({ x: x + 0.5, z: z + 0.5, r: 0.8 + Math.random() * 0.6, type: hazardType });
        }
    }

    // Tanieres : meutes d'un même monstre (biaisées par le biome)
    themed.lair.forEach(r => {
        const pool = _biome && Array.isArray(_biome.monsters) && _biome.monsters.length ? _biome.monsters : null;
        const mid = pool ? pool[ri(0, pool.length - 1)] : null;
        const n = 3 + ri(0, 2);
        for (let k = 0; k < n; k++) {
            const x = ri(r.x, r.x + r.w - 1), z = ri(r.y, r.y + r.h - 1);
            if (grid[z][x] !== ROOM) continue;
            if (Math.hypot(x - start.cx, z - start.cy) < 6) continue;
            mobSpawns.push({ x: x + 0.5, z: z + 0.5, monsterId: mid });
        }
    });

    // Mobs : disperses dans les salles (sauf depart), nombre croissant avec depth
    const nMobs = (cfg.mobsPerFloorBase || 7) + depth + pop.mobBonus;
    let guard = 0;
    while (mobSpawns.length < nMobs && guard < 500) {
        guard++;
        const r = rooms[ri(0, rooms.length - 1)];
        if (r === start) continue;
        const x = ri(r.x, r.x + r.w - 1), z = ri(r.y, r.y + r.h - 1);
        if (grid[z][x] !== ROOM) continue;
        if (Math.hypot(x - start.cx, z - start.cy) < 6) continue; // pas trop pres du spawn
        mobSpawns.push({ x: x + 0.5, z: z + 0.5 });
    }

    // Biome selon la profondeur
    const biome = _biome;   // respecte le biome forcé (preview) ou celui de la profondeur

    layout = {
        grid, size, rooms, depth, biome,
        spawn: { x: start.cx + 0.5, z: start.cy + 0.5 },
        bossSpawn: { x: boss.cx + 0.5, z: boss.cy + 0.5 },
        portal: { x: portalCell.cx + 0.5, z: portalCell.cz + 0.5 },
        mobSpawns, chestSpawns, coffinSpawns, containerSpawns, eventSpawns, trapSpawns, trapBudget, secretDoors, vaultDoors, hazardSpawns
    };
    return layout;
}

// Caveau scellé : chambre 4x4 fermée par une porte verrouillée (LOCKED).
// La clé est confiée à un champion de l'étage (voir game.js).
function placeVaultChamber(grid, size, rooms, start, boss, vaultDoors, chestSpawns) {
    if (Math.random() < 0.25) return;   // pas de caveau à chaque étage
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const shuffled = [...rooms].sort(() => Math.random() - 0.5);
    for (const r of shuffled) {
        if (r === start || r === boss) continue;
        for (const [dx, dy] of dirs) {
            const cw = 4, ch = 4;
            let bx, by, doorX, doorZ;
            if (dx === 1) { bx = r.x + r.w + 1; by = r.cy - 1; doorX = r.x + r.w; doorZ = r.cy; }
            else if (dx === -1) { bx = r.x - cw - 1; by = r.cy - 1; doorX = r.x - 1; doorZ = r.cy; }
            else if (dy === 1) { bx = r.cx - 1; by = r.y + r.h + 1; doorX = r.cx; doorZ = r.y + r.h; }
            else { bx = r.cx - 1; by = r.y - ch - 1; doorX = r.cx; doorZ = r.y - 1; }

            if (bx < 2 || by < 2 || bx + cw >= size - 2 || by + ch >= size - 2) continue;
            let free = true;
            for (let j = by - 1; j <= by + ch; j++) for (let i = bx - 1; i <= bx + cw; i++) {
                if (i < 0 || j < 0 || i >= size || j >= size || grid[j][i] !== WALL) { free = false; }
            }
            if (!free) continue;

            for (let j = by; j < by + ch; j++) for (let i = bx; i < bx + cw; i++) grid[j][i] = ROOM;
            grid[doorZ][doorX] = LOCKED;
            vaultDoors.push({ cx: doorX, cz: doorZ });
            // Butin garanti : coffre maudit + coffre rare
            chestSpawns.push({ x: bx + cw / 2, z: by + ch / 2, type: 'chest_cursed', vault: true });
            chestSpawns.push({ x: bx + cw / 2 - 1, z: by + ch / 2 + 1, type: 'chest_rare', vault: true });
            return;
        }
    }
}

// Porte de caveau proche du joueur (non déverrouillée), ou null
export function vaultDoorNear(pos) {
    if (!layout || !layout.vaultDoors) return null;
    for (const vd of layout.vaultDoors) {
        if (vd.opened) continue;
        if (Math.hypot((vd.cx + 0.5) - pos.x, (vd.cz + 0.5) - pos.z) < 1.9) return vd;
    }
    return null;
}

// Déverrouille la porte de caveau proche : la cellule devient une porte franchissable
export function tryUnlockVault(pos) {
    const vd = vaultDoorNear(pos);
    if (!vd) return false;
    vd.opened = true;
    layout.grid[vd.cz][vd.cx] = DOOR;
    const idx = wallIndex[`${vd.cx},${vd.cz}`];
    if (idx !== undefined && wallMesh) {
        const dummy = new THREE.Object3D();
        dummy.position.set(0, -999, 0); dummy.scale.set(0.001, 0.001, 0.001); dummy.updateMatrix();
        wallMesh.setMatrixAt(idx, dummy.matrix);
        wallMesh.instanceMatrix.needsUpdate = true;
    }
    return true;
}

function placeSecretChamber(grid, size, rooms, start, boss, secretDoors, chestSpawns) {
    // cherche une salle avec de la place pour coller une chambre 4x4 a 2 cases
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const r of rooms) {
        if (r === start) continue;
        for (const [dx, dy] of dirs) {
            const cw = 4, ch = 4;
            // origine de la chambre, separee d'une case de mur
            let bx, by, doorX, doorZ;
            if (dx === 1) { bx = r.x + r.w + 1; by = r.cy - 1; doorX = r.x + r.w; doorZ = r.cy; }
            else if (dx === -1) { bx = r.x - cw - 1; by = r.cy - 1; doorX = r.x - 1; doorZ = r.cy; }
            else if (dy === 1) { bx = r.cx - 1; by = r.y + r.h + 1; doorX = r.cx; doorZ = r.y + r.h; }
            else { bx = r.cx - 1; by = r.y - ch - 1; doorX = r.cx; doorZ = r.y - 1; }

            if (bx < 2 || by < 2 || bx + cw >= size - 2 || by + ch >= size - 2) continue;
            // verifie que l'emplacement est vide (mur)
            let free = true;
            for (let j = by - 1; j <= by + ch; j++) for (let i = bx - 1; i <= bx + cw; i++) {
                if (i < 0 || j < 0 || i >= size || j >= size || grid[j][i] !== WALL) { free = false; }
            }
            if (!free) continue;

            // creuse la chambre + la porte secrete (reste un "mur" jusqu'a revelation)
            for (let j = by; j < by + ch; j++) for (let i = bx; i < bx + cw; i++) grid[j][i] = ROOM;
            grid[doorZ][doorX] = SECRET;
            secretDoors.push({ cx: doorX, cz: doorZ });
            // trefor garanti dans la chambre secrete
            chestSpawns.push({ x: bx + cw / 2, z: by + ch / 2, type: 'chest_rare', secret: true });
            return;
        }
    }
}

// --------------------------------------------------------------------
//  RENDU (InstancedMesh)
// --------------------------------------------------------------------
export function buildFloorMesh(scene) {
    disposeFloor(scene);
    const { grid, size, biome } = layout;
    group = new THREE.Group();
    flames = [];

    const wallTint = new THREE.Color(biome ? biome.wallTint : '#8a8a8a');
    const floorTint = new THREE.Color(biome ? biome.floorTint : '#9a9a9a');
    const runeColor = biome ? biome.rune : '#4deeea';
    const lightColor = biome ? biome.light : '#ffaa44';

    const loader = new THREE.TextureLoader();
    // Textures par biome si définies (Forge), sinon textures globales de l'environnement
    const wallSrc = (biome && biome.wallTex) || GameData.environment.wall || 'assets/textures/wall.png';
    const floorSrc = (biome && biome.floorTex) || GameData.environment.floor || 'assets/textures/floor.png';
    const wallTex = loader.load(wallSrc);
    const floorTex = loader.load(floorSrc);
    [wallTex, floorTex].forEach(t => { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; });
    floorTex.repeat.set(size / 2, size / 2);
    // Le mur fait WALL_HEIGHT de haut pour 1 de large : on repete la texture
    // verticalement pour que les briques restent carrees (sinon ecrasees).
    wallTex.repeat.set(1, WALL_HEIGHT);

    // Force de la normal map (relief), reglable
    const nStr = GameData.environment.normalStrength != null ? GameData.environment.normalStrength : 0.6;

    // Sol + plafond (grands plans)
    const floorOpts = { map: floorTex, roughness: 0.92, metalness: 0.05, color: floorTint };
    if (nStr > 0 && usesProceduralNormal(floorSrc)) {
        const floorNormal = makeNormalMap(64, floorHeight, 5);
        floorNormal.repeat.copy(floorTex.repeat); floorNormal.magFilter = THREE.NearestFilter;
        floorOpts.normalMap = floorNormal;
        floorOpts.normalScale = new THREE.Vector2(nStr, nStr);
    }
    const floorMat = new THREE.MeshStandardMaterial(floorOpts);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(size / 2, 0, size / 2);
    group.add(floor);
    // Plafond : texturé si le biome fournit ceilTex, sinon plan coloré (brouillard assombri)
    let ceilMat;
    if (biome && biome.ceilTex) {
        const ceilTex = loader.load(biome.ceilTex);
        ceilTex.magFilter = THREE.NearestFilter; ceilTex.minFilter = THREE.NearestFilter;
        ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping; ceilTex.repeat.set(size / 2, size / 2);
        ceilMat = new THREE.MeshStandardMaterial({ map: ceilTex, color: new THREE.Color(biome.wallTint || '#888'), roughness: 1, metalness: 0 });
    } else {
        const ceilCol = new THREE.Color(biome ? biome.fogColor : '#070709').multiplyScalar(0.6);
        ceilMat = new THREE.MeshBasicMaterial({ color: ceilCol });
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(size, size), ceilMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.set(size / 2, WALL_HEIGHT, size / 2);
    group.add(ceil);

    // Murs en InstancedMesh (inclut portes secretes + portes verrouillees, masquees a l'ouverture)
    const wallCells = [];
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) if (grid[z][x] === WALL || grid[z][x] === SECRET || grid[z][x] === LOCKED) wallCells.push([x, z]);

    const wallOpts = { map: wallTex, roughness: 0.85, metalness: 0.15, color: wallTint };
    if (nStr > 0 && usesProceduralNormal(wallSrc)) {
        const wallNormal = makeNormalMap(64, wallHeight, 6);
        wallNormal.repeat.copy(wallTex.repeat); wallNormal.magFilter = THREE.NearestFilter;
        wallOpts.normalMap = wallNormal;
        wallOpts.normalScale = new THREE.Vector2(nStr, nStr);
    }
    const wallMat = new THREE.MeshStandardMaterial(wallOpts);
    wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, WALL_HEIGHT, 1), wallMat, wallCells.length);
    const dummy = new THREE.Object3D();
    secretIndex = {}; wallIndex = {};
    wallCells.forEach(([x, z], i) => {
        dummy.position.set(x + 0.5, WALL_HEIGHT / 2, z + 0.5);
        dummy.updateMatrix();
        wallMesh.setMatrixAt(i, dummy.matrix);
        wallIndex[`${x},${z}`] = i;                                  // tous les murs (pour creuser)
        if (grid[z][x] === SECRET) secretIndex[`${x},${z}`] = i;
    });
    wallMesh.instanceMatrix.needsUpdate = true;
    group.add(wallMesh);

    // Portail (anneau lumineux)
    const p = layout.portal;
    portalMesh = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.12, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xaa44ff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9 }));
    ring.position.set(0, 1.1, 0);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24),
        new THREE.MeshBasicMaterial({ color: 0x6611aa, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    disc.position.set(0, 1.1, 0);
    const plight = new THREE.PointLight(0xaa44ff, 1.5, 8);
    plight.position.set(0, 1.1, 0);
    portalMesh.add(ring, disc, plight);
    portalMesh.position.set(p.x, 0, p.z);
    group.add(portalMesh);

    decorateFloor(group, runeColor, lightColor);

    scene.add(group);
    return group;
}

// Direction (offset) vers un mur adjacent a une cellule de sol, ou null
function wallOffset(x, z) {
    if (!layout) return null;   // sécurité : jamais appelé avant l'assignation du layout
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
        const c = (x + dx < 0 || z + dz < 0 || x + dx >= layout.size || z + dz >= layout.size) ? WALL : layout.grid[z + dz][x + dx];
        if (c === WALL || c === SECRET) return [dx, dz];
    }
    return null;
}
// Rotation Y pour qu'un plan (normale +Z) ou un meuble fasse FACE à la salle (dos au mur)
function wallFacingRotY(off) {
    if (off[0] === 1) return -Math.PI / 2;
    if (off[0] === -1) return Math.PI / 2;
    if (off[1] === 1) return Math.PI;
    return 0;
}
// Decal plaqué sur un mur (ne s'enfonce pas) : plan tout près de la face du mur
function makeWallDecal(material, w, h) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    m.renderOrder = 1;
    return m;
}

function decorateFloor(group, runeColor, lightColor) {
    const { grid, size, rooms } = layout;
    const isFloor = (x, z) => { const c = grid[z]?.[x]; return c === ROOM || c === CORR || c === DOOR || c === PORTAL; };
    const lc = new THREE.Color(lightColor);

    // Torches murales (lumiere chaude) : ~1 par salle, plafonne
    let torchBudget = 9;
    for (const r of rooms) {
        if (torchBudget <= 0) break;
        let placed = false;
        for (let tries = 0; tries < 12 && !placed; tries++) {
            const x = ri(r.x, r.x + r.w - 1), z = ri(r.y, r.y + r.h - 1);
            if (!isFloor(x, z)) continue;
            const off = wallOffset(x, z); if (!off) continue;
            const fx = x + 0.5 + off[0] * 0.46, fz = z + 0.5 + off[1] * 0.46;

            const bracket = makeTorchBracket(off); bracket.position.set(fx, 1.55, fz); group.add(bracket);
            // Halo 3D (sphère émissive) -> ne billboarde plus par-dessus le joueur
            const glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffb24a, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false }));
            glow.position.set(fx, 1.82, fz);
            glow.add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), new THREE.MeshBasicMaterial({ color: 0xff8a33, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })));
            group.add(glow);
            const light = new THREE.PointLight(lc, 1.7, 8.5); light.position.set(fx, 1.9, fz);
            group.add(light);
            flames.push({ glow, light, phase: Math.random() * 6.28, baseI: 1.7 });
            placed = true; torchBudget--;
        }
    }

    // Runes : DECALS 3D plaqués sur la face du mur (ne s'enfoncent plus quand on bouge)
    const runeCount = Math.min(46, Math.floor(size * 0.9));
    for (let i = 0; i < runeCount; i++) {
        const x = ri(1, size - 2), z = ri(1, size - 2);
        if (!isFloor(x, z)) continue;
        const off = wallOffset(x, z); if (!off) continue;
        const s = 0.4 + Math.random() * 0.3;
        const rune = makeWallDecal(new THREE.MeshBasicMaterial({ map: runeTexture(), color: new THREE.Color(runeColor), blending: THREE.AdditiveBlending, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }), s, s);
        rune.position.set(x + 0.5 + off[0] * 0.495, 1.0 + Math.random() * 1.3, z + 0.5 + off[1] * 0.495);
        rune.rotation.y = wallFacingRotY(off);
        group.add(rune);
    }

    // Portes de caveau : serrure runique dorée plaquée sur la face + lueur
    for (const vd of (layout.vaultDoors || [])) {
        const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => isFloor(vd.cx + dx, vd.cz + dz));
        if (!adj) continue;
        const off = [-adj[0], -adj[1]];   // direction salle -> porte
        const mat = new THREE.MeshBasicMaterial({ map: runeTexture(), color: new THREE.Color('#ffd24d'), blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
        const decal = makeWallDecal(mat, 0.66, 0.66);
        decal.position.set(vd.cx + adj[0] + 0.5 + off[0] * 0.495, 1.4, vd.cz + adj[1] + 0.5 + off[1] * 0.495);
        decal.rotation.y = wallFacingRotY(off);
        group.add(decal);
        const light = new THREE.PointLight(new THREE.Color('#ffd24d'), 0.9, 4);
        light.position.set(vd.cx + adj[0] + 0.5, 1.5, vd.cz + adj[1] + 0.5);
        group.add(light);
    }

    scatterProps(group);
    placeLevers(group);
}

// =====================================================================
//  DÉCOR 3D - props bas-poly placés logiquement (mobilier, os, colonnes...)
// =====================================================================
const _mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: o.rough ?? 0.9, metalness: o.metal ?? 0.05, emissive: new THREE.Color(o.emissive || '#000'), emissiveIntensity: o.emi || 0, flatShading: !!o.flat, transparent: !!o.transparent, opacity: o.opacity ?? 1 });
function _box(w, h, d, m, x = 0, y = 0, z = 0) { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.position.set(x, y, z); return me; }
function _cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 8) { const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); me.position.set(x, y, z); return me; }
const _propTexLoader = new THREE.TextureLoader();
const _propTexCache = {};
const _propTexBuildSource = {};
function propTextureSource(name) {
    const src = GameData.propTextures && GameData.propTextures[name];
    if (Array.isArray(src)) {
        const list = src.filter(x => typeof x === 'string' && x.trim());
        return list.length ? list[ri(0, list.length - 1)] : null;
    }
    return (typeof src === 'string' && src.trim()) ? src : null;
}
function propTexture(name, forcedSrc) {
    const src = forcedSrc !== undefined ? forcedSrc : (_propTexBuildSource[name] || propTextureSource(name));
    if (!src || typeof src !== 'string' || !src.trim()) return null;
    if (!_propTexCache[src]) {
        const t = _propTexLoader.load(src);
        t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        _propTexCache[src] = t;
    }
    return _propTexCache[src];
}
function propMat(name, fallback, o = {}) {
    const tex = propTexture(name, o.textureSrc);
    if (!tex) return _mat(fallback, o);
    return new THREE.MeshStandardMaterial({
        map: tex, color: 0xffffff,
        roughness: o.rough ?? 0.85, metalness: o.metal ?? 0.05,
        transparent: true, alphaTest: 0.04, side: o.side || THREE.FrontSide
    });
}
function propDecalMat(name, fallback, o = {}) {
    const tex = propTexture(name, o.textureSrc);
    if (!tex) return _mat(fallback, { ...o, transparent: o.transparent, opacity: o.opacity });
    return new THREE.MeshBasicMaterial({
        map: tex, color: 0xffffff, transparent: true, alphaTest: 0.04,
        side: THREE.DoubleSide, depthWrite: false
    });
}
function applyPropTexture(name, model, textureSrc) {
    const tex = propTexture(name, textureSrc);
    if (!tex) return;
    model.traverse(obj => {
        if (!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        const next = mats.map(m => {
            const n = m.clone();
            n.map = tex; n.color = new THREE.Color(0xffffff);
            n.transparent = true; n.alphaTest = 0.04; n.needsUpdate = true;
            return n;
        });
        obj.material = Array.isArray(obj.material) ? next : next[0];
    });
}

// --- Constructeurs de props (retournent un Group posé sur le sol y=0) ---
const PROP_BUILDERS = {
    barrel() { const g = new THREE.Group(); const w = propMat('barrel', '#6b4a2a', { rough: 0.95 }); g.add(_cyl(0.22, 0.26, 0.6, w, 0, 0.3, 0, 10)); const band = _mat('#3a3a40', { metal: 0.7, rough: 0.5 }); g.add(_cyl(0.27, 0.27, 0.05, band, 0, 0.14, 0, 10), _cyl(0.27, 0.27, 0.05, band, 0, 0.46, 0, 10)); return g; },
    crate() { const g = new THREE.Group(); const w = propMat('crate', '#7a5630', { rough: 0.95 }); const c = _box(0.5, 0.5, 0.5, w, 0, 0.25, 0); g.add(c); const e = _mat('#5a3e22'); g.add(_box(0.54, 0.06, 0.54, e, 0, 0.25, 0), _box(0.06, 0.54, 0.54, e, 0, 0.25, 0)); return g; },
    table() { const g = new THREE.Group(); const w = propMat('table', '#5a3e22', { rough: 0.95 }); g.add(_box(0.9, 0.08, 0.6, w, 0, 0.62, 0)); const leg = propMat('table', '#42301a'); for (const [sx, sz] of [[-0.38, -0.23], [0.38, -0.23], [-0.38, 0.23], [0.38, 0.23]]) g.add(_box(0.08, 0.6, 0.08, leg, sx, 0.3, sz)); return g; },
    chair() { const g = new THREE.Group(); const w = propMat('chair', '#4a3420', { rough: 0.95 }); g.add(_box(0.32, 0.06, 0.32, w, 0, 0.34, 0)); g.add(_box(0.32, 0.4, 0.06, w, 0, 0.54, -0.13)); const leg = propMat('chair', '#382818'); for (const [sx, sz] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]]) g.add(_box(0.05, 0.34, 0.05, leg, sx, 0.17, sz)); return g; },
    wardrobe() { const g = new THREE.Group(); const w = propMat('wardrobe', '#4a3018', { rough: 0.95 }); g.add(_box(0.8, 1.7, 0.45, w, 0, 0.85, 0)); const d = propMat('wardrobe', '#3a2412'); g.add(_box(0.36, 1.5, 0.04, d, -0.2, 0.85, 0.23), _box(0.36, 1.5, 0.04, d, 0.2, 0.85, 0.23)); const k = _mat('#caa24d', { metal: 0.8, rough: 0.4 }); g.add(_box(0.05, 0.05, 0.06, k, -0.04, 0.85, 0.25), _box(0.05, 0.05, 0.06, k, 0.04, 0.85, 0.25)); return g; },
    bones() { const g = new THREE.Group(); const b = propMat('bones', '#d8d2bf', { rough: 1 }); for (let i = 0; i < 3; i++) { const r = _cyl(0.035, 0.035, 0.4, b, (Math.random() - 0.5) * 0.3, 0.05, (Math.random() - 0.5) * 0.3, 6); r.rotation.set(Math.PI / 2, 0, Math.random() * 3); g.add(r); } return g; },
    skull() { const g = new THREE.Group(); const b = propMat('skull', '#e2dcc8', { rough: 1 }); const s = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), b); s.position.y = 0.13; g.add(s); g.add(_box(0.16, 0.07, 0.12, b, 0, 0.04, 0.04)); const eye = _mat('#000', { emissive: '#1a0a0a' }); g.add(_box(0.035, 0.04, 0.02, eye, -0.045, 0.14, 0.11), _box(0.035, 0.04, 0.02, eye, 0.045, 0.14, 0.11)); return g; },
    rock() { const g = new THREE.Group(); const m = propMat('rock', '#5b5b63', { rough: 1, flat: true }); const r = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18 + Math.random() * 0.12, 0), m); r.position.y = 0.12; r.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); r.scale.set(1, 0.7 + Math.random() * 0.3, 1); g.add(r); return g; },
    cage() { const g = new THREE.Group(); const bar = propMat('cage', '#33333a', { metal: 0.7, rough: 0.5 }); const R = 0.28, H = 1.3; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.add(_cyl(0.022, 0.022, H, bar, Math.cos(a) * R, H / 2, Math.sin(a) * R, 5)); } g.add(_cyl(R + 0.02, R + 0.02, 0.04, bar, 0, 0.02, 0, 10), _cyl(R + 0.02, R + 0.02, 0.04, bar, 0, H, 0, 10)); const sk = PROP_BUILDERS.skull(); sk.position.y = 0.0; sk.scale.set(0.8, 0.8, 0.8); g.add(sk); return g; },
    coffin() { const g = new THREE.Group(); const w = propMat('coffin', '#43301c', { rough: 0.95 }); const body = _box(0.55, 0.34, 1.7, w, 0, 0.17, 0); g.add(body); const lid = propMat('coffin', '#523c24'); g.add(_box(0.5, 0.06, 1.6, lid, 0.02, 0.36, 0)); const cross = _mat('#caa24d', { metal: 0.6, rough: 0.5, emissive: '#3a2c10', emi: 0.3 }); g.add(_box(0.08, 0.02, 0.34, cross, 0, 0.4, -0.45), _box(0.08, 0.02, 0.12, cross, 0, 0.4, -0.45)); return g; },
    vase() { const g = new THREE.Group(); const m = propMat('vase', '#b5723a', { rough: 0.8 }); g.add(_cyl(0.1, 0.16, 0.34, m, 0, 0.17, 0, 12), _cyl(0.13, 0.1, 0.08, m, 0, 0.37, 0, 12)); const band = _mat('#caa24d', { metal: 0.6, rough: 0.4 }); g.add(_cyl(0.165, 0.165, 0.03, band, 0, 0.22, 0, 12)); return g; },
    // Tapis : decal plat au sol (le joueur marche dessus, ne clippe pas)
    carpet() { const g = new THREE.Group(); if (propTexture('carpet')) { const o = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), propDecalMat('carpet', '#5a1f28')); o.rotation.x = -Math.PI / 2; o.position.y = 0.025; g.add(o); return g; } const o = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), _mat('#5a1f28', { rough: 1 })); o.rotation.x = -Math.PI / 2; o.position.y = 0.02; const inn = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.85), _mat('#7c2c38', { rough: 1, emissive: '#2a0a10', emi: 0.12 })); inn.rotation.x = -Math.PI / 2; inn.position.y = 0.025; g.add(o, inn); return g; },
    // Colonne pleine hauteur (placée mi-encastrée dans un coin de mur)
    column() { const g = new THREE.Group(); const m = propMat('column', '#7d756a', { rough: 0.9 }); g.add(_cyl(0.17, 0.2, WALL_HEIGHT, m, 0, WALL_HEIGHT / 2, 0, 14)); g.add(_box(0.52, 0.2, 0.52, m, 0, 0.1, 0), _box(0.52, 0.2, 0.52, m, 0, WALL_HEIGHT - 0.1, 0)); return g; }
};
// Tableau encadré (decal mural) - orienté/positionné par scatterProps
function makePainting() { const g = new THREE.Group(); const w = 0.7, h = 0.5; g.add(_box(w + 0.09, h + 0.09, 0.04, _mat('#3a2a16', { rough: 0.8, metal: 0.1 }))); const cols = ['#3a5a7a', '#6a3a2a', '#3a6a4a', '#5a3a6a', '#7a6a3a']; const c = cols[ri(0, cols.length - 1)]; const img = new THREE.Mesh(new THREE.PlaneGeometry(w, h), propDecalMat('painting', c, { rough: 1, emissive: c, emi: 0.1 })); img.position.z = 0.03; g.add(img); return g; }
// Tapisserie suspendue (decal mural, plus haute)
function makeTapestry() { const g = new THREE.Group(); if (propTexture('tapestry')) { g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.3), propDecalMat('tapestry', '#5a2630'))); return g; } g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.3), _mat('#5a2630', { rough: 1 }))); const trim = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 1.05), _mat('#caa24d', { rough: 0.6, emissive: '#3a2c10', emi: 0.2 })); trim.position.z = 0.01; g.add(trim); return g; }

// Toile d'araignée : triangle dans un coin haut, contre un mur
function makeCobweb() {
    if (propTexture('cobweb')) {
        const web = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.74), propDecalMat('cobweb', '#cfd2d8'));
        web.renderOrder = 2;
        return web;
    }
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.6, 0); sh.lineTo(0, 0.6); sh.closePath();
    const geo = new THREE.ShapeGeometry(sh);
    const m = new THREE.MeshBasicMaterial({ color: 0xcfd2d8, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
    return new THREE.Mesh(geo, m);
}

// Support de torche 3D (bras + coupe), orienté vers la salle
function makeTorchBracket(off) { const g = new THREE.Group(); const w = _mat('#2a2a30', { metal: 0.6, rough: 0.5 }); g.add(_cyl(0.025, 0.03, 0.34, w, 0, 0, 0, 6)); const cup = _cyl(0.07, 0.04, 0.1, _mat('#1a1a1e', { metal: 0.7, rough: 0.4 }), 0, 0.2, 0, 8); g.add(cup); g.rotation.z = off[0] * 0.5; g.rotation.x = -off[1] * 0.5; return g; }

// Props "solides" : bloquent leur case quand posés au centre (pas contre le mur)
const SOLID_PROPS = new Set(['table', 'crate', 'barrel', 'cage', 'coffin', 'wardrobe']);

// Charge un modèle UNE fois par URL (cache) ; les instances sont clonées.
const _modelCache = {};
function loadModel(url) {
    if (!_modelCache[url]) _modelCache[url] = new Promise((res, rej) => _gltfLoader.load(url, g => res(g.scene), undefined, rej));
    return _modelCache[url];
}
// Construit un prop : modèle 3D custom (GLB/glTF) si défini, sinon mesh procédural.
function buildPropGroup(name) {
    const baseRot = ((GameData.propRotations && GameData.propRotations[name]) || 0) * Math.PI / 180;
    const url = GameData.propModels && GameData.propModels[name];
    const textureSrc = propTextureSource(name);
    if (url && typeof url === 'string' && url.trim()) {
        const holder = new THREE.Group(); holder.rotation.y = baseRot;
        loadModel(url).then(template => {
            const model = template.clone(true);
            applyPropTexture(name, model, textureSrc);
            const box = new THREE.Box3().setFromObject(model);
            const size = new THREE.Vector3(); box.getSize(size);
            const center = new THREE.Vector3(); box.getCenter(center);
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const s = (GameData.propScales && GameData.propScales[name] ? GameData.propScales[name] : 0.9) / maxDim;
            model.scale.setScalar(s);
            model.position.set(-center.x * s, -box.min.y * s, -center.z * s);  // recentré XZ, base au sol
            holder.add(model);
        }).catch(() => { if (PROP_BUILDERS[name]) holder.add(PROP_BUILDERS[name]()); });  // repli procédural si échec
        return holder;
    }
    _propTexBuildSource[name] = textureSrc;
    let g;
    try { g = PROP_BUILDERS[name] ? PROP_BUILDERS[name]() : new THREE.Group(); }
    finally { delete _propTexBuildSource[name]; }
    g.rotation.y = baseRot;
    return g;
}
export function makeProp(name) { return buildPropGroup(name); }
export function isPropBlocked(x, z) { return propBlocks.has(Math.floor(x) + ',' + Math.floor(z)); }
// Libère / occupe une case (objet cassé -> on enlève sa collision invisible)
export function freePropCell(x, z) { propBlocks.delete(Math.floor(x) + ',' + Math.floor(z)); }
export function blockPropCell(x, z) { propBlocks.add(Math.floor(x) + ',' + Math.floor(z)); }

function scatterProps(rootGroup) {
    const { grid, size, rooms } = layout;
    const isFloor = (x, z) => { const c = grid[z]?.[x]; return c === ROOM || c === CORR || c === DOOR; };
    const occupied = new Set();
    propBlocks = new Set();
    const reserve = (x, z) => { occupied.add(x + ',' + z); };
    // ne pas encombrer spawn/portail/boss
    reserve(Math.floor(layout.spawn.x), Math.floor(layout.spawn.z));
    if (layout.portal) reserve(layout.portal.x, layout.portal.z);

    breakables = [];
    const allow = layout.biome && Array.isArray(layout.biome.props) && layout.biome.props.length ? new Set(layout.biome.props) : null;
    const allowProp = (name) => !allow || allow.has(name);
    const isWall = (x, z) => { const c = grid[z]?.[x]; return c === undefined || c === WALL || c === SECRET; };
    const BREAK_LOOT = { vase: { goldMax: 14, chance: 0.45 }, rock: { goldMax: 6, chance: 0.2 }, skull: { goldMax: 8, chance: 0.3 }, bones: { goldMax: 6, chance: 0.25 }, table: { goldMax: 10, chance: 0.3 }, chair: { goldMax: 6, chance: 0.2 } };
    const trapTypes = ['spikes', 'flame', 'frost'];
    const trapProps = new Set(Array.isArray(GameData.dungeon?.trapProps) ? GameData.dungeon.trapProps : ['bones', 'rock']);
    const rawTrapChance = Number(GameData.dungeon?.trapPropChance ?? 0.18);
    const trapChance = Math.max(0, Math.min(1, rawTrapChance > 1 ? rawTrapChance / 100 : rawTrapChance));
    const tryHideTrap = (builder, px, pz, opts = {}) => {
        if (opts.wall || !trapProps.has(builder) || !layout.trapBudget || trapChance <= 0) return;
        if ((layout.trapSpawns || []).length >= layout.trapBudget) return;
        if (Math.hypot(px - layout.spawn.x, pz - layout.spawn.z) < 7) return;
        if ((layout.trapSpawns || []).some(t => Math.hypot(t.x - px, t.z - pz) < 2.6)) return;
        if (Math.random() > trapChance) return;
        layout.trapSpawns.push({ x: px, z: pz, type: trapTypes[ri(0, trapTypes.length - 1)], hidden: true, propKind: builder });
    };

    // Pose un prop. opts: { wall, breakable } -> facing mur correct + enregistrement cassable.
    const place = (builder, x, z, opts = {}) => {
        if (!allowProp(builder) || occupied.has(x + ',' + z) || !isFloor(x, z)) return false;
        const off = wallOffset(x, z);
        if (opts.wall && !off) return false;
        const g = buildPropGroup(builder);
        let px = x + 0.5, pz = z + 0.5;
        if (opts.wall && off) { px += off[0] * 0.34; pz += off[1] * 0.34; g.rotation.y += wallFacingRotY(off); }   // dos au mur (+ rotation de base)
        else { px += (Math.random() - 0.5) * 0.3; pz += (Math.random() - 0.5) * 0.3; g.rotation.y += Math.random() * Math.PI * 2; }
        g.position.set(px, 0, pz);
        rootGroup.add(g); reserve(x, z);
        if (SOLID_PROPS.has(builder) && !opts.wall) propBlocks.add(x + ',' + z);
        if (opts.breakable) breakables.push({ mesh: g, x: px, z: pz, kind: builder, loot: BREAK_LOOT[builder] || { goldMax: 6, chance: 0.2 } });
        tryHideTrap(builder, px, pz, opts);
        return true;
    };

    const floorProps = ['bones', 'skull', 'rock', 'vase'];
    let columnBudget = Math.min(10, Math.ceil(rooms.length * 0.8));

    for (const r of rooms) {
        const area = r.w * r.h;
        const budget = Math.max(1, Math.floor(area / 9));
        // Tapis au centre des grandes salles (decal plat)
        if (area >= 16 && Math.random() < 0.45 && allowProp('carpet')) place('carpet', r.cx, r.cy, {});
        // Table + chaises (mobilier cassable)
        if (area >= 20 && Math.random() < 0.5 && allowProp('table')) {
            const tx = ri(r.x + 1, r.x + r.w - 2), tz = ri(r.y + 1, r.y + r.h - 2);
            if (place('table', tx, tz, { breakable: true }) && allowProp('chair')) place('chair', tx + 1, tz, { breakable: true }) || place('chair', tx - 1, tz, { breakable: true });
        }
        // Clutter cassable au sol
        for (let k = 0; k < budget; k++) {
            const x = ri(r.x, r.x + r.w - 1), z = ri(r.y, r.y + r.h - 1);
            const b = floorProps[ri(0, floorProps.length - 1)];
            place(b, x, z, { breakable: true });
        }
        // Cage macabre occasionnelle
        if (Math.random() < 0.22 && allowProp('cage')) place('cage', ri(r.x, r.x + r.w - 1), ri(r.y, r.y + r.h - 1), {});

        // Tableau / tapisserie : decal mural à hauteur (ne s'enfonce pas)
        if (Math.random() < 0.6) {
            for (let t = 0; t < 6; t++) {
                const x = ri(r.x, r.x + r.w - 1), z = ri(r.y, r.y + r.h - 1);
                if (!isFloor(x, z)) continue; const off = wallOffset(x, z); if (!off) continue;
                const tap = Math.random() < 0.5;
                if (!allowProp(tap ? 'tapestry' : 'painting')) break;
                const art = tap ? makeTapestry() : makePainting();
                art.position.set(x + 0.5 + off[0] * 0.49, tap ? 1.45 : 1.6, z + 0.5 + off[1] * 0.49);
                art.rotation.y = wallFacingRotY(off);
                rootGroup.add(art); break;
            }
        }

        // Colonnes encastrées dans les coins de la salle (mi-dans le mur)
        if (columnBudget > 0 && allowProp('column') && Math.random() < 0.7) {
            for (const [cx, cz, sx, sz] of [[r.x, r.y, -1, -1], [r.x + r.w - 1, r.y, 1, -1], [r.x, r.y + r.h - 1, -1, 1], [r.x + r.w - 1, r.y + r.h - 1, 1, 1]]) {
                if (columnBudget <= 0) break;
                if (!isFloor(cx, cz) || occupied.has(cx + ',' + cz)) continue;
                if (!(isWall(cx + sx, cz) && isWall(cx, cz + sz))) continue;   // vrai coin (2 murs perpendiculaires)
                const col = buildPropGroup('column');
                col.position.set(cx + 0.5 + sx * 0.5, 0, cz + 0.5 + sz * 0.5);   // sur le sommet du coin -> ~50% dans le mur
                rootGroup.add(col); reserve(cx, cz); columnBudget--;
                if (Math.random() < 0.6) break;
            }
        }

        // Toiles d'araignée dans les COINS (entre 2 murs) - cassables (chance d'araignée)
        if (allowProp('cobweb') && Math.random() < 0.55) {
            for (let t = 0; t < 8; t++) {
                const x = ri(r.x, r.x + r.w - 1), z = ri(r.y, r.y + r.h - 1);
                if (!isFloor(x, z)) continue;
                const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => isWall(x + dx, z + dz));
                if (dirs.length < 2) continue;   // besoin d'un vrai coin
                const a = dirs[0], b = dirs[1];
                const web = makeCobweb();
                web.position.set(x + 0.5 + (a[0] + b[0]) * 0.32, WALL_HEIGHT - 0.6, z + 0.5 + (a[1] + b[1]) * 0.32);
                web.rotation.y = Math.atan2(-(a[0] + b[0]), (a[1] + b[1]));
                rootGroup.add(web);
                breakables.push({ mesh: web, x: x + 0.5, z: z + 0.5, kind: 'cobweb', loot: null, spider: true });
                break;
            }
        }
    }
}

// Leviers 3D près des passages secrets (repère visuel ; E révèle via tryRevealSecret)
function placeLevers(rootGroup) {
    const doors = layout.secretDoors || [];
    for (const d of doors) {
        const dx0 = d.cx, dz0 = d.cz;
        // case de sol adjacente au mur secret
        const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => {
            const c = layout.grid[dz0 + dz]?.[dx0 + dx];
            return c === ROOM || c === CORR || c === DOOR;
        });
        if (!adj) continue;
        const fx = dx0 + 0.5 - adj[0] * 0.42, fz = dz0 + 0.5 - adj[1] * 0.42;
        const g = new THREE.Group();
        const base = _cyl(0.07, 0.09, 0.18, _mat('#2a2a30', { metal: 0.6, rough: 0.5 }), 0, 0.09, 0, 8); g.add(base);
        const handle = _cyl(0.025, 0.025, 0.32, _mat('#7a3a1a', { metal: 0.3, rough: 0.6 }), 0, 0.3, 0, 6);
        handle.rotation.x = -adj[1] * 0.6; handle.rotation.z = adj[0] * 0.6; g.add(handle);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), _mat('#caa24d', { metal: 0.7, rough: 0.4, emissive: '#3a2c10', emi: 0.5 }));
        knob.position.set(adj[0] * 0.18, 0.44, adj[1] * 0.18); g.add(knob);
        g.position.set(fx, 0, fz);
        rootGroup.add(g);
    }
}

export function updatePortal(dt, t) {
    if (portalMesh) {
        portalMesh.children[0].rotation.z += dt * 1.5;     // anneau tournant
        const s = 1 + Math.sin(t * 3) * 0.08;
        portalMesh.children[1].scale.set(s, s, s);
    }
    // scintillement des torches
    for (const f of flames) {
        const flick = 0.75 + Math.sin(t * 11 + f.phase) * 0.15 + Math.random() * 0.12;
        f.light.intensity = f.baseI * flick;
        if (f.glow) { f.glow.scale.setScalar(0.85 + flick * 0.3); f.glow.material.opacity = 0.7 + flick * 0.25; }
    }
}

export function disposeFloor(scene) {
    if (group) { scene.remove(group); group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }); }
    group = null; wallMesh = null; portalMesh = null; secretIndex = {}; wallIndex = {}; playerBlocks = {}; placedAssets = {}; flames = []; propBlocks = new Set(); breakables = [];
}

// --------------------------------------------------------------------
//  REQUETES
// --------------------------------------------------------------------
export function cellAt(x, z) {
    if (!layout) return WALL;
    const ix = Math.floor(x), iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= layout.size || iz >= layout.size) return WALL;
    return layout.grid[iz][ix];
}

export function checkCollision(pos) {
    const c = cellAt(pos.x, pos.z);
    if (!PASSABLE.has(c)) return true;          // mur et porte secrete (non revelee)
    return propBlocks.has(Math.floor(pos.x) + ',' + Math.floor(pos.z));  // gros mobilier
}

// La cellule bloque-t-elle la ligne de vue ? (murs pleins et portes closes)
export function blocksSight(x, z) {
    const c = cellAt(x, z);
    return c === WALL || c === SECRET || c === LOCKED;
}

export function tryRevealSecret(pos) {
    if (!layout) return false;
    for (const sd of layout.secretDoors) {
        if (sd.revealed) continue;
        const d = Math.hypot((sd.cx + 0.5) - pos.x, (sd.cz + 0.5) - pos.z);
        if (d < 1.8) {
            sd.revealed = true;
            layout.grid[sd.cz][sd.cx] = DOOR;
            // masque l'instance de mur
            const idx = secretIndex[`${sd.cx},${sd.cz}`];
            if (idx !== undefined && wallMesh) {
                const dummy = new THREE.Object3D();
                dummy.position.set(0, -999, 0); dummy.scale.set(0.001, 0.001, 0.001); dummy.updateMatrix();
                wallMesh.setMatrixAt(idx, dummy.matrix);
                wallMesh.instanceMatrix.needsUpdate = true;
            }
            return true;
        }
    }
    return false;
}

export function isAtPortal(pos) {
    if (!layout) return false;
    return Math.hypot(layout.portal.x - pos.x, layout.portal.z - pos.z) < 1.1;
}

export function getLayout() { return layout; }

// --------------------------------------------------------------------
//  CREUSER / CONSTRUIRE (mode pioche, type Minecraft)
// --------------------------------------------------------------------
// Cellule visée par le regard : 1er mur (à creuser) + cellule libre juste avant (à construire).
export function rayTarget(px, pz, dx, dz, reach = 4.5) {
    let prevX = Math.floor(px), prevZ = Math.floor(pz);
    const step = 0.12;
    for (let t = step; t <= reach; t += step) {
        const x = px + dx * t, z = pz + dz * t;
        const cx = Math.floor(x), cz = Math.floor(z);
        if (cx === prevX && cz === prevZ) continue;
        const c = cellAt(x, z);
        if (c === WALL || c === SECRET) return { hit: true, digX: cx, digZ: cz, buildX: prevX, buildZ: prevZ };
        prevX = cx; prevZ = cz;
    }
    return { hit: false, digX: null, digZ: null, buildX: prevX, buildZ: prevZ };
}
// Creuse un mur (instance OU bloc joueur) -> devient passable. Retourne true si creusé.
export function digWall(cx, cz) {
    if (!layout || cx < 0 || cz < 0 || cx >= layout.size || cz >= layout.size) return false;
    const key = `${cx},${cz}`;
    if (playerBlocks[key]) {
        const m = playerBlocks[key]; if (m.parent) m.parent.remove(m);
        if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose();
        delete playerBlocks[key]; layout.grid[cz][cx] = CORR; return true;
    }
    const c = layout.grid[cz][cx];
    if (c !== WALL && c !== SECRET) return false;
    layout.grid[cz][cx] = CORR;
    const idx = wallIndex[key];
    if (idx !== undefined && wallMesh) {
        const dummy = new THREE.Object3D();
        dummy.position.set(0, -999, 0); dummy.scale.set(0.001, 0.001, 0.001); dummy.updateMatrix();
        wallMesh.setMatrixAt(idx, dummy.matrix); wallMesh.instanceMatrix.needsUpdate = true;
    }
    return true;
}
const BUILD_MATS = {};
function buildMaterial(tex) {
    const key = tex || 'assets/textures/wall.png';
    if (!BUILD_MATS[key]) {
        if (typeof key === 'string' && key[0] === '#') {
            BUILD_MATS[key] = new THREE.MeshStandardMaterial({ color: new THREE.Color(key), roughness: 0.85, metalness: 0.1 });
        } else {
            const t = new THREE.TextureLoader().load(key);
            t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
            t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, WALL_HEIGHT);
            BUILD_MATS[key] = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0.15 });
        }
    }
    return BUILD_MATS[key];
}
// Pose un bloc plein (texture de mur) sur une cellule libre. Retourne true si posé.
export function placeBlock(cx, cz, tex) {
    if (!group || !layout || cx < 0 || cz < 0 || cx >= layout.size || cz >= layout.size) return false;
    if (!PASSABLE.has(layout.grid[cz][cx])) return false;     // déjà occupé (mur/fosse)
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, WALL_HEIGHT, 1), buildMaterial(tex));
    m.position.set(cx + 0.5, WALL_HEIGHT / 2, cz + 0.5);
    group.add(m); playerBlocks[`${cx},${cz}`] = m;
    layout.grid[cz][cx] = WALL;
    return true;
}

// --- Marteau : poser/retirer un décor 3D de la bibliothèque (snap grille) ---
let placedAssets = {}; // "cx,cz" -> mesh
export function placeAsset(cx, cz, name, rotY = 0) {
    if (!group || !layout || cx < 0 || cz < 0 || cx >= layout.size || cz >= layout.size) return false;
    if (!PASSABLE.has(layout.grid[cz][cx])) return false;     // pas sur un mur/fosse
    const key = `${cx},${cz}`;
    if (placedAssets[key]) return false;                       // déjà un décor sur cette case
    const g = makeProp(name); if (!g) return false;
    g.position.set(cx + 0.5, 0, cz + 0.5); g.rotation.y = rotY;
    group.add(g); placedAssets[key] = g;
    return true;
}
export function removeAsset(cx, cz) {
    const key = `${cx},${cz}`; const m = placedAssets[key];
    if (!m) return false;
    if (m.parent) m.parent.remove(m);
    m.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    delete placedAssets[key]; return true;
}
export function hasAsset(cx, cz) { return !!placedAssets[`${cx},${cz}`]; }

// --------------------------------------------------------------------
//  MINIMAP
// --------------------------------------------------------------------
export function drawMinimap(camera, boss) {
    const canvas = document.getElementById('minimap');
    if (!canvas || !layout) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 80, 80);
    const px = camera.position.x, pz = camera.position.z, scale = 3;

    for (let z = 0; z < layout.size; z++) for (let x = 0; x < layout.size; x++) {
        const c = layout.grid[z][x];
        const dx = (x + 0.5 - px) * scale + 40, dy = (z + 0.5 - pz) * scale + 40;
        if (dx < 0 || dx >= 80 || dy < 0 || dy >= 80) continue;
        let col = null;
        if (c === LOCKED) col = '#a80';
        else if (c === WALL || c === SECRET) col = '#243';
        else if (c === DOOR) col = '#caa';
        else if (c === PIT) col = '#622';
        else if (c === CORR) col = '#1a2a2a';
        else if (c === PORTAL) col = '#a4f';
        else col = '#2a4a4a';
        ctx.fillStyle = col; ctx.fillRect(dx, dy, scale, scale);
    }
    // portail
    const portDx = (layout.portal.x - px) * scale + 40, portDy = (layout.portal.z - pz) * scale + 40;
    if (portDx >= 0 && portDx < 80 && portDy >= 0 && portDy < 80) { ctx.fillStyle = '#c5f'; ctx.fillRect(portDx - 2, portDy - 2, 4, 4); }
    // boss
    if (boss && !boss.userData.dead && boss.visible) {
        const bdx = (boss.position.x - px) * scale + 40, bdy = (boss.position.z - pz) * scale + 40;
        if (bdx >= 0 && bdx < 80 && bdy >= 0 && bdy < 80) { ctx.fillStyle = '#f00'; ctx.fillRect(bdx - 2, bdy - 2, 5, 5); }
    }
    // joueur
    ctx.fillStyle = '#0ff'; ctx.fillRect(38, 38, 4, 4);
}

// Grande carte : tout l'étage tient dans le canvas #bigmap-canvas
export function drawBigMap(camera, boss, mobs, objects) {
    const canvas = document.getElementById('bigmap-canvas');
    if (!canvas || !layout) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, n = layout.size;
    const cs = Math.floor(Math.min(W, H) / n);
    const ox = Math.floor((W - cs * n) / 2), oy = Math.floor((H - cs * n) / 2);
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);

    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
        const c = layout.grid[z][x];
        let col = null;
        if (c === WALL) col = '#1c2630';
        else if (c === SECRET) col = '#1c2630';
        else if (c === LOCKED) col = '#d8a530';
        else if (c === DOOR) col = '#c9a86a';
        else if (c === PIT) col = '#7a2222';
        else if (c === CORR) col = '#243440';
        else if (c === PORTAL) col = '#b24dff';
        else if (c === ROOM) col = '#33505f';
        if (col) { ctx.fillStyle = col; ctx.fillRect(ox + x * cs, oy + z * cs, cs, cs); }
    }
    const mark = (wx, wz, color, r) => { ctx.fillStyle = color; ctx.fillRect(ox + wx * cs - r, oy + wz * cs - r, r * 2, r * 2); };
    // coffres
    (objects || []).forEach(o => { if (o.userData && !o.userData.isOpen && o.visible) mark(o.position.x, o.position.z, '#ffd24d', cs); });
    // portail
    mark(layout.portal.x, layout.portal.z, '#e0a0ff', cs + 1);
    // boss
    if (boss && !boss.userData.dead && boss.visible) mark(boss.position.x, boss.position.z, '#ff3030', cs + 2);
    // mobs
    (mobs || []).forEach(m => { if (!m.userData.dead && m.userData.aggro) mark(m.position.x, m.position.z, '#ff8866', cs); });
    // joueur
    mark(camera.position.x, camera.position.z, '#4deeea', cs + 2);
    // direction du joueur
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    ctx.strokeStyle = '#4deeea'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(ox + camera.position.x * cs, oy + camera.position.z * cs);
    ctx.lineTo(ox + (camera.position.x + dir.x * 2.5) * cs, oy + (camera.position.z + dir.z * 2.5) * cs);
    ctx.stroke();
}
