import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { GameData } from './data.js';
import { gameState } from './state.js';

export const CHUNK_SIZE = 16;
export const RENDER_DISTANCE = 2;
const WALL_HEIGHT = 3;

const chunks = new Map(); // "x,z" -> { mesh, data }
const textureLoader = new THREE.TextureLoader();

// Load textures from GameData
let wallTexture, floorTexture;
function loadTextures() {
    wallTexture = textureLoader.load(GameData.environment.wall || 'assets/textures/wall.png');
    floorTexture = textureLoader.load(GameData.environment.floor || 'assets/textures/floor.png');

    // Pixel art settings
    wallTexture.magFilter = THREE.NearestFilter;
    wallTexture.minFilter = THREE.NearestFilter;

    // Fix Aspect Ratio: Wall is 3 units high, so repeat texture 3 times vertically
    wallTexture.wrapS = THREE.RepeatWrapping;
    wallTexture.wrapT = THREE.RepeatWrapping;
    wallTexture.repeat.set(1, WALL_HEIGHT);

    floorTexture.magFilter = THREE.NearestFilter;
    floorTexture.minFilter = THREE.NearestFilter;
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
}
loadTextures();

// Improved Noise for "Rooms"
function pseudoRandom(x, z) {
    return Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
}

function noise(x, z) {
    // Simple value noise smoothing
    const floorX = Math.floor(x);
    const floorZ = Math.floor(z);

    const s = pseudoRandom(floorX, floorZ);
    const t = pseudoRandom(floorX + 1, floorZ);
    const u = pseudoRandom(floorX, floorZ + 1);
    const v = pseudoRandom(floorX + 1, floorZ + 1);

    const fx = x - floorX;
    const fz = z - floorZ;

    const i1 = s + (t - s) * fx;
    const i2 = u + (v - u) * fx;
    return i1 + (i2 - i1) * fz;
}

function generateChunkData(cx, cz) {
    const data = [];
    for (let z = 0; z < CHUNK_SIZE; z++) {
        const row = [];
        for (let x = 0; x < CHUNK_SIZE; x++) {
            const wx = cx * CHUNK_SIZE + x;
            const wz = cz * CHUNK_SIZE + z;

            // Zoom out noise for larger rooms (scale 0.1)
            const n = noise(wx * 0.15, wz * 0.15);

            // Threshold: < 0.4 is wall, > 0.4 is floor (Open caves)
            // Add some high frequency noise for detail
            const detail = pseudoRandom(wx, wz) * 0.1;

            let isWall = (n + detail) < 0.35 ? 1 : 0;

            // Always clear spawn area (0,0)
            if (Math.abs(wx) < 3 && Math.abs(wz) < 3) isWall = 0;

            row.push(isWall);
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

    // Use MeshStandardMaterial for better lighting reaction
    const wallMat = new THREE.MeshStandardMaterial({
        map: wallTexture,
        color: 0x888888, // Fallback color
        roughness: 0.8,
        metalness: 0.2
    });
    const floorMat = new THREE.MeshStandardMaterial({
        map: floorTexture,
        color: 0x888888, // Fallback color
        roughness: 0.8,
        metalness: 0.1
    });

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

    for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
        for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
            buildChunkMesh(cx + x, cz + z, scene);
        }
    }

    chunks.forEach((chunk, key) => {
        const [kcx, kcz] = key.split(',').map(Number);
        if (Math.abs(kcx - cx) > RENDER_DISTANCE + 1 || Math.abs(kcz - cz) > RENDER_DISTANCE + 1) {
            if (chunk.mesh) {
                scene.remove(chunk.mesh);
                chunk.mesh = null;
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
    // Safety check boundaries
    if (rx < 0 || rx >= CHUNK_SIZE || rz < 0 || rz >= CHUNK_SIZE) return true;

    // Check if chunk exists (it should, but safety first)
    if (!chunk || !chunk.data || !chunk.data[rz]) return true;

    return chunk.data[rz][rx] === 1;
}

export function findEmptySpotAround(px, pz) {
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

export function drawMinimap(camera, boss) {
    const canvas = document.getElementById('minimap');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 80, 80);

    const px = camera.position.x;
    const pz = camera.position.z;
    const scale = 4; // Pixels per world unit

    // Draw visible chunks
    const cx = Math.floor(px / CHUNK_SIZE);
    const cz = Math.floor(pz / CHUNK_SIZE);

    for (let z = -1; z <= 1; z++) {
        for (let x = -1; x <= 1; x++) {
            const chunk = getChunk(cx + x, cz + z);
            if (!chunk) continue;

            const ox = (cx + x) * CHUNK_SIZE;
            const oz = (cz + z) * CHUNK_SIZE;

            for (let r = 0; r < CHUNK_SIZE; r++) {
                for (let c = 0; c < CHUNK_SIZE; c++) {
                    if (chunk.data[r][c] === 1) {
                        const wx = ox + c;
                        const wz = oz + r;

                        // Relative to player center (40, 40)
                        const dx = (wx - px) * scale + 40;
                        const dy = (wz - pz) * scale + 40;

                        if (dx >= 0 && dx < 80 && dy >= 0 && dy < 80) {
                            ctx.fillStyle = '#2a4a4a';
                            ctx.fillRect(dx, dy, scale, scale);
                        }
                    }
                }
            }
        }
    }

    // Player
    ctx.fillStyle = '#0ff';
    ctx.fillRect(40 - 2, 40 - 2, 4, 4);

    // Boss (if close)
    if (gameState && !gameState.bossDead && boss) {
        const dx = (boss.position.x - px) * scale + 40;
        const dy = (boss.position.z - pz) * scale + 40;
        if (dx >= 0 && dx < 80 && dy >= 0 && dy < 80) {
            ctx.fillStyle = '#f00';
            ctx.fillRect(dx - 3, dy - 3, 6, 6);
        }
    }
}