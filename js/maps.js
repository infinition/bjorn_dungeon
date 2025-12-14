import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { WALL_HEIGHT } from './constants.js';
import { wallTexture, floorTexture } from './textures.js';

export const CHUNK_SIZE = 16;
export const RENDER_DISTANCE = 2; // Radius of chunks to render

const chunks = new Map(); // "x,z" -> { mesh, data }

// Simplex/Perlin noise replacement for simplicity (Random Walk / Cellular)
// We will use a deterministic random based on coordinates to ensure same chunk is generated same way
function pseudoRandom(x, z) {
    return Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
}

function generateChunkData(cx, cz) {
    const data = [];
    for (let z = 0; z < CHUNK_SIZE; z++) {
        const row = [];
        for (let x = 0; x < CHUNK_SIZE; x++) {
            const wx = cx * CHUNK_SIZE + x;
            const wz = cz * CHUNK_SIZE + z;

            // Simple noise generation
            const noise = pseudoRandom(wx, wz);
            // 20% chance of wall, but clear center (0,0)
            if (wx === 0 && wz === 0) {
                row.push(0);
            } else {
                row.push(noise < 0.2 ? 1 : 0);
            }
        }
        data.push(row);
    }
    return data;
}

export function getChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (chunks.has(key)) return chunks.get(key);

    const data = generateChunkData(cx, cz);
    const chunk = {
        data: data,
        mesh: null
    };
    chunks.set(key, chunk);
    return chunk;
}

export function buildChunkMesh(cx, cz, scene) {
    const chunk = getChunk(cx, cz);
    if (chunk.mesh) return chunk.mesh;

    const group = new THREE.Group();
    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

    const floorGeo = new THREE.PlaneGeometry(1, 1);
    const wallGeo = new THREE.BoxGeometry(1, WALL_HEIGHT, 1);
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTexture });
    const floorMat = new THREE.MeshLambertMaterial({ map: floorTexture });

    // Optimization: Merge geometries? For now, keep simple group
    for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
            const type = chunk.data[z][x];

            if (type === 0) {
                const floor = new THREE.Mesh(floorGeo, floorMat);
                floor.rotation.x = -Math.PI / 2;
                floor.position.set(x, 0, z);
                group.add(floor);

                const ceil = new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
                ceil.rotation.x = Math.PI / 2;
                ceil.position.set(x, WALL_HEIGHT, z);
                group.add(ceil);
            } else if (type === 1) {
                const wall = new THREE.Mesh(wallGeo, wallMat);
                wall.position.set(x, WALL_HEIGHT / 2, z);
                group.add(wall);
            }
        }
    }

    scene.add(group);
    chunk.mesh = group;
    return group;
}

export function updateChunks(playerPos, scene) {
    const cx = Math.floor(playerPos.x / CHUNK_SIZE);
    const cz = Math.floor(playerPos.z / CHUNK_SIZE);

    // Load nearby
    for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
        for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
            buildChunkMesh(cx + x, cz + z, scene);
        }
    }

    // Unload far (Optional, for memory)
    // For now, keep them in memory but maybe hide them?
    // Let's just keep adding for now, browser can handle a lot of simple meshes.
    // Ideally we remove from scene if distance > RENDER_DISTANCE + 1
    chunks.forEach((chunk, key) => {
        const [kcx, kcz] = key.split(',').map(Number);
        if (Math.abs(kcx - cx) > RENDER_DISTANCE + 1 || Math.abs(kcz - cz) > RENDER_DISTANCE + 1) {
            if (chunk.mesh) {
                scene.remove(chunk.mesh);
                chunk.mesh = null; // Dispose?
            }
        }
    });
}

export function checkCollision(pos) {
    const cx = Math.floor(pos.x / CHUNK_SIZE);
    const cz = Math.floor(pos.z / CHUNK_SIZE);
    const rx = Math.floor(pos.x - cx * CHUNK_SIZE);
    const rz = Math.floor(pos.z - cz * CHUNK_SIZE);

    const chunk = getChunk(cx, cz);

    // Bounds check within chunk (should always be valid if math is right)
    if (rx < 0 || rx >= CHUNK_SIZE || rz < 0 || rz >= CHUNK_SIZE) return true;

    return chunk.data[rz][rx] === 1;
}

export function findEmptySpotAround(px, pz) {
    // Find empty spot near player
    const cx = Math.floor(px / CHUNK_SIZE);
    const cz = Math.floor(pz / CHUNK_SIZE);
    const chunk = getChunk(cx, cz);

    for (let i = 0; i < 50; i++) {
        const rx = Math.floor(Math.random() * CHUNK_SIZE);
        const rz = Math.floor(Math.random() * CHUNK_SIZE);
        if (chunk.data[rz][rx] === 0) {
            return { x: cx * CHUNK_SIZE + rx, y: cz * CHUNK_SIZE + rz };
        }
    }
    return { x: px, y: pz };
}
