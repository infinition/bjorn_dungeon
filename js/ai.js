import { getLayout, checkCollision, blocksSight } from './dungeon.js';

// =====================================================================
//  IA - navigation partagée par tous les monstres.
//  - Flow field : BFS depuis la case du joueur, recalculé ~3x/s.
//    Chaque mob lit la direction "vers le joueur" en O(1) -> pathfinding
//    autour des murs sans A* par mob (très économe).
//  - Ligne de vue : échantillonnage de la grille (2 points par case).
// =====================================================================

const REBUILD_EVERY = 0.35;   // secondes entre deux reconstructions du champ
const NEI4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NEI8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

let dist = null;      // Int16Array size*size : distance BFS au joueur (-1 non visité, -2 mur)
let size = 0;
let queue = null;
let nextBuildAt = -1;

export function resetFlowField() { dist = null; size = 0; nextBuildAt = -1; }

export function updateFlowField(px, pz, time) {
    const L = getLayout();
    if (!L) return;
    if (time < nextBuildAt && dist && size === L.size) return;
    nextBuildAt = time + REBUILD_EVERY;
    size = L.size;
    const n = size * size;
    if (!dist || dist.length !== n) { dist = new Int16Array(n); queue = new Int32Array(n); }
    dist.fill(-1);
    const sx = Math.floor(px), sz = Math.floor(pz);
    if (sx < 0 || sz < 0 || sx >= size || sz >= size) return;
    let head = 0, tail = 0;
    const start = sz * size + sx;
    dist[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
        const cur = queue[head++];
        const cx = cur % size, cz = (cur / size) | 0;
        const d = dist[cur];
        for (let k = 0; k < 4; k++) {
            const nx = cx + NEI4[k][0], nz = cz + NEI4[k][1];
            if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
            const ni = nz * size + nx;
            if (dist[ni] !== -1) continue;
            if (checkCollision({ x: nx + 0.5, z: nz + 0.5 })) { dist[ni] = -2; continue; }
            dist[ni] = d + 1;
            queue[tail++] = ni;
        }
    }
}

// Remplit out {x,z} avec la direction (normalisée) qui rapproche du joueur
// en suivant le champ. Retourne false si la case n'est pas couverte (repli direct).
export function flowDirection(x, z, out) {
    if (!dist || !size) return false;
    const cx = Math.floor(x), cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= size || cz >= size) return false;
    const here = dist[cz * size + cx];
    if (here == null || here < 0) return false;
    let bx = 0, bz = 0, best = here, found = false;
    for (let k = 0; k < 8; k++) {
        const ox = NEI8[k][0], oz = NEI8[k][1];
        const nx = cx + ox, nz = cz + oz;
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        const d = dist[nz * size + nx];
        if (d < 0) continue;
        // diagonale : refuse si un des deux orthogonaux est un mur (pas de coin coupé)
        if (ox !== 0 && oz !== 0) {
            if (dist[cz * size + nx] < 0 || dist[nz * size + cx] < 0) continue;
        }
        if (d < best) { best = d; bx = nx; bz = nz; found = true; }
    }
    if (!found) return false;
    const dx = bx + 0.5 - x, dz = bz + 0.5 - z;
    const len = Math.hypot(dx, dz) || 1;
    out.x = dx / len;
    out.z = dz / len;
    return true;
}

// Ligne de vue sur la grille (murs et portes secrètes bloquent).
export function hasLineOfSight(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return true;
    const steps = Math.ceil(len * 2);
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (blocksSight(x0 + dx * t, z0 + dz * t)) return false;
    }
    return true;
}
