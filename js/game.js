import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { RENDER_WIDTH, RENDER_HEIGHT, MOVE_SPEED, ROT_SPEED } from './constants.js';
import { gameState } from './state.js';
import { addLog } from './utils.js';
import { buildMap, drawMinimap, checkCollision, findEmptySpot, mapData, updateChunks, findEmptySpotAround } from './maps.js';
import { createBoss, createMob } from './sprites.js';
import { createChest } from './items.js';
import { fireWeapon, updateSpells } from './spells.js';
import { input, initInputs, updateInputs } from './inputs.js';
import { playerInventory } from './inventory.js';

// --- THREE.JS SETUP ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x050505, 0.1, 15);

const camera = new THREE.PerspectiveCamera(70, RENDER_WIDTH / RENDER_HEIGHT, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio > 1 ? 1 : 1);
container.appendChild(renderer.domElement);

// Lights
const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
scene.add(ambientLight);

const torchLight = new THREE.PointLight(0xd68c3e, 1, 15);
scene.add(torchLight);

// Infinite Map Init
// We don't buildMap() once anymore, we updateChunks() in loop
// But we need initial chunks
updateChunks(camera.position, scene);

// Entities
// Find spawn for player (0,0 is safe in our noise gen)
camera.position.set(0.5, 1.2, 0.5);

// Boss Spawn
const boss = createBoss(scene, 5, 5); // Temp pos

// Chest Spawn
const chest = createChest(scene);
chest.position.set(2, 0.5, 2);

// Mobs
const mobs = [];
// Spawn some initial mobs
for (let i = 0; i < 5; i++) {
    mobs.push(createMob(scene, i * 2 + 5, i * 2 + 5));
}

// Inputs
const touchState = initInputs(() => fireWeapon(camera, scene));

// Inventory UI Logic
const invModal = document.getElementById('inventory-modal');
const invGrid = document.getElementById('inventory-grid');
const toggleInvBtn = document.getElementById('toggle-inventory');
const closeInvBtn = document.getElementById('close-inventory');

function toggleInventory() {
    if (invModal.classList.contains('hidden')) {
        invModal.classList.remove('hidden');
        renderInventory();
    } else {
        invModal.classList.add('hidden');
    }
}

function renderInventory() {
    invGrid.innerHTML = '';
    playerInventory.items.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'w-12 h-12 border border-gray-600 bg-gray-800 flex items-center justify-center text-xs cursor-pointer hover:border-cyan';
        div.innerText = item.name ? item.name.substring(0, 4) : '???';
        div.onclick = () => {
            addLog(`Equipé: ${item.name}`);
            playerInventory.equipItem(index, 'mainHand'); // Simple equip logic
            renderInventory();
        };
        invGrid.appendChild(div);
    });
}

if (toggleInvBtn) toggleInvBtn.onclick = toggleInventory;
if (closeInvBtn) closeInvBtn.onclick = toggleInventory;

function updatePlayer(dt) {
    if (gameState.isDead) return;

    // Rotation
    camera.rotation.y += input.turn * ROT_SPEED * dt;

    // Movement
    const speed = MOVE_SPEED * dt;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const side = new THREE.Vector3().crossVectors(camera.up, dir).normalize();

    const moveVec = new THREE.Vector3();
    if (input.forward !== 0) moveVec.add(dir.multiplyScalar(input.forward * speed));
    if (input.strafe !== 0) moveVec.add(side.multiplyScalar(input.strafe * speed));

    const nextPos = camera.position.clone().add(moveVec);

    if (!checkCollision(new THREE.Vector3(nextPos.x, 0, camera.position.z))) {
        camera.position.x = nextPos.x;
    }
    if (!checkCollision(new THREE.Vector3(camera.position.x, 0, nextPos.z))) {
        camera.position.z = nextPos.z;
    }

    // Head bob
    if (input.forward !== 0 || input.strafe !== 0) {
        camera.position.y = 1.2 + Math.sin(Date.now() * 0.015) * 0.05;
    }

    // Update Torch Pos
    torchLight.position.copy(camera.position);
    torchLight.intensity = 0.8 + Math.random() * 0.4;

    // Update Map Chunks
    updateChunks(camera.position, scene);
}

function updateBoss(dt) {
    if (gameState.bossDead) return;

    const dist = boss.position.distanceTo(camera.position);

    if (dist < 2.5) {
        if (Math.random() < 0.02) {
            addLog("Le Boss attaque !", "text-red-500");
            gameState.hp -= 10;
            const hpBar = document.getElementById('hp-bar');
            if (hpBar) hpBar.style.width = `${gameState.hp}%`;

            const dmgOv = document.getElementById('damage-overlay');
            if (dmgOv) {
                dmgOv.style.opacity = 0.8;
                setTimeout(() => dmgOv.style.opacity = 0, 200);
            }

            document.body.classList.add('hit-effect');
            setTimeout(() => document.body.classList.remove('hit-effect'), 500);

            if (gameState.hp <= 0) {
                gameState.isDead = true;
                addLog("VOUS ETES MORT", "text-red-700");
            }
        }
    } else if (dist < 15) { // Increased aggro range
        const dir = new THREE.Vector3().subVectors(camera.position, boss.position).normalize();
        const newPos = boss.position.clone().add(dir.multiplyScalar(1.5 * dt)); // Faster boss
        if (!checkCollision(newPos)) {
            boss.position.x = newPos.x;
            boss.position.z = newPos.z;
        }
    }
}

// --- MAIN LOOP ---
const clock = new THREE.Clock();
let playing = false;

function animate() {
    requestAnimationFrame(animate);
    if (!playing) return;

    const dt = clock.getDelta();

    updateInputs(touchState, () => fireWeapon(camera, scene));
    updatePlayer(dt);
    updateBoss(dt);
    updateSpells(dt, scene, mobs, boss);
    // drawMinimap(camera, boss); // Minimap needs update for chunks, disabled for now

    renderer.render(scene, camera);
}

// --- INIT ---
const startBtn = document.getElementById('start-btn');
if (startBtn) {
    startBtn.addEventListener('click', () => {
        const startScreen = document.getElementById('start-screen');
        if (startScreen) startScreen.style.display = 'none';

        const uiLayer = document.getElementById('ui-layer');
        if (uiLayer) {
            uiLayer.classList.remove('hidden');
            uiLayer.classList.add('flex');
        }

        const bossLabel = document.getElementById('boss-hp-label');
        if (bossLabel) bossLabel.classList.remove('hidden');

        playing = true;
        addLog("Systèmes activés.");
        addLog("Donjon généré.");

        // Test Item
        playerInventory.addItem({ name: "Epee Rouille", type: "weapon", damage: 5 });
        playerInventory.addItem({ name: "Potion", type: "consumable", heal: 20 });
    });
}

window.addEventListener('resize', () => {
    setTimeout(() => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }, 100);
});

animate();
