import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { RENDER_WIDTH, RENDER_HEIGHT, MOVE_SPEED, ROT_SPEED } from './constants.js';
import { GameData } from './data.js';
import { gameState } from './state.js';
import { addLog } from './utils.js';
import { checkCollision, updateChunks, drawMinimap } from './maps.js';
import { createBoss, createMob } from './sprites.js';
import { createObject } from './items.js';
import { fireWeapon, updateSpells } from './spells.js';
import { input, initInputs, updateInputs } from './inputs.js';
import { playerInventory } from './inventory.js';

// --- CONFIGURATION CLAVIER ---
export const IS_AZERTY = true;

// --- THREE.JS SETUP ---
const container = document.getElementById('canvas-container');

// 1. SETUP AMBIANCE
const scene = new THREE.Scene();

// Couleur de fond gris-bleu très sombre
const fogColor = 0x111118;
scene.background = new THREE.Color(fogColor);

// Brouillard Linéaire
scene.fog = new THREE.Fog(fogColor, 2, 22);

const camera = new THREE.PerspectiveCamera(70, RENDER_WIDTH / RENDER_HEIGHT, 0.1, 100);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio > 1 ? 1 : 1);
renderer.domElement.id = 'game-canvas';
if (container) container.appendChild(renderer.domElement);

// --- CHARGEMENT TEXTURE COFFRE OUVERT ---
// On prépare la texture pour qu'elle soit prête quand on ouvrira un coffre
const textureLoader = new THREE.TextureLoader();
// Assure-toi que l'image est bien dans assets/sprites/ ou change le chemin ici
const chestOpenTexture = textureLoader.load('assets/sprites/chest_opened.png');
chestOpenTexture.magFilter = THREE.NearestFilter;
chestOpenTexture.minFilter = THREE.NearestFilter;

// --- LIGHTS ---
const ambientLight = new THREE.AmbientLight(0x303050, 0.6);
scene.add(ambientLight);

const torchLight = new THREE.PointLight(0xffaa00, 2.5, 25);
torchLight.castShadow = false;
scene.add(torchLight);

// Infinite Map Init
updateChunks(camera.position, scene);

// Entities
camera.position.set(0.5, 1.2, 0.5);

// Boss Spawn
const boss = createBoss(scene, 5, 5);

// Objects (Chests) Spawn
const objects = [];
for (let i = 0; i < 5; i++) {
    const objData = GameData.objects[0]; // Default chest
    if (objData) {
        const ox = (Math.random() - 0.5) * 20 + 5;
        const oz = (Math.random() - 0.5) * 20 + 5;
        // On crée l'objet
        const chest = createObject(scene, ox, oz, objData);
        // On ajoute une propriété pour savoir s'il est ouvert ou fermé
        chest.userData.isOpen = false;
        objects.push(chest);
    }
}

// Mobs Spawn
const mobs = [];
const totalSpawnChance = GameData.monsters.reduce((sum, m) => sum + (m.spawnChance || 0.1), 0);

for (let i = 0; i < 5; i++) {
    let random = Math.random() * totalSpawnChance;
    let selectedMob = GameData.monsters[0];

    for (const mob of GameData.monsters) {
        random -= (mob.spawnChance || 0.1);
        if (random <= 0) {
            selectedMob = mob;
            break;
        }
    }
    mobs.push(createMob(scene, i * 2 + 5, i * 2 + 5, selectedMob));
}

// Inputs
const touchState = initInputs(() => fireWeapon(camera, scene), switchSpell);

// Spell Switching Logic
function updateSpellUI() {
    const spellBar = document.getElementById('spell-bar');
    if (!spellBar) return;
    Array.from(spellBar.children).forEach((child, index) => {
        if (index === gameState.currentSpellIndex) {
            child.classList.remove('border-cyan-800');
            child.classList.add('border-white', 'bg-cyan-900');
        } else {
            child.classList.add('border-cyan-800');
            child.classList.remove('border-white', 'bg-cyan-900');
        }
    });
}

function switchSpell(dir) {
    gameState.currentSpellIndex += dir;
    if (gameState.currentSpellIndex < 0) gameState.currentSpellIndex = gameState.spells.length - 1;
    if (gameState.currentSpellIndex >= gameState.spells.length) gameState.currentSpellIndex = 0;

    addLog(`Sort: ${gameState.spells[gameState.currentSpellIndex]}`);
    updateSpellUI();
}

// Inventory UI Logic
const invModal = document.getElementById('inventory-modal');
const invGrid = document.getElementById('inventory-grid');
const toggleInvBtn = document.getElementById('toggle-inventory');
const closeInvBtn = document.getElementById('close-inventory');

// Ajout des Event Listeners pour l'inventaire
if (toggleInvBtn) toggleInvBtn.addEventListener('click', toggleInventory);
if (closeInvBtn) closeInvBtn.addEventListener('click', toggleInventory);

function toggleInventory() {
    if (!invModal) return;
    if (invModal.classList.contains('hidden')) {
        invModal.classList.remove('hidden');
        renderInventory();
    } else {
        invModal.classList.add('hidden');
    }
}

function renderInventory() {
    if (!invGrid) return;
    invGrid.innerHTML = '';
    playerInventory.items.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'w-12 h-12 border border-gray-600 bg-gray-800 flex items-center justify-center text-xs cursor-pointer hover:border-cyan';
        div.innerText = item.name ? item.name.charAt(0).toUpperCase() : '?';
        div.title = item.name || 'Item';
        invGrid.appendChild(div);
    });
}

// --- PLAYER MOVEMENT LOGIC ---
function updatePlayer(dt) {
    if (input.lookX !== 0) {
        camera.rotation.y -= input.lookX * 0.002;
        input.lookX = 0;
    }
    if (input.lookY !== 0) {
        camera.rotation.x -= input.lookY * 0.002;
        camera.rotation.x = Math.max(-1.5, Math.min(1.5, camera.rotation.x));
        input.lookY = 0;
    }

    camera.rotation.y += input.turn * ROT_SPEED * dt;

    const speed = MOVE_SPEED * dt;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();

    const side = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
    const moveVec = new THREE.Vector3();
    if (input.forward !== 0) moveVec.add(dir.multiplyScalar(input.forward));
    if (input.strafe !== 0) moveVec.add(side.multiplyScalar(input.strafe));

    if (moveVec.lengthSq() > 0) {
        moveVec.normalize().multiplyScalar(speed);
    }

    const nextPos = camera.position.clone().add(moveVec);

    if (!checkCollision(new THREE.Vector3(nextPos.x, 0, camera.position.z))) {
        camera.position.x = nextPos.x;
    }
    if (!checkCollision(new THREE.Vector3(camera.position.x, 0, nextPos.z))) {
        camera.position.z = nextPos.z;
    }

    if (input.forward !== 0 || input.strafe !== 0) {
        camera.position.y = 1.2 + Math.sin(Date.now() * 0.015) * 0.05;
    } else {
        camera.position.y = THREE.MathUtils.lerp(camera.position.y, 1.2, dt * 5);
    }

    // --- MISE A JOUR TORCHE ---
    torchLight.position.copy(camera.position);
    torchLight.position.y -= 0.2;
    torchLight.intensity = 2.2 + Math.random() * 0.6;

    updateChunks(camera.position, scene);
}

// --- GESTION DES COFFRES (MISE A JOUR) ---
function updateInteraction() {
    if (!input.interact) return;

    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];

        // Si le coffre est déjà ouvert, on passe au suivant
        if (obj.userData.isOpen) continue;

        const dist = camera.position.distanceTo(obj.position);

        if (dist < 2.5) {
            addLog("Coffre ouvert !", "text-green-400");

            // 1. Changer l'apparence du coffre
            obj.material.map = chestOpenTexture; // Change la texture
            obj.userData.isOpen = true; // Marque le coffre comme ouvert

            // 2. Donner le loot
            const randomItem = GameData.items[Math.floor(Math.random() * GameData.items.length)];
            if (randomItem) {
                playerInventory.addItem({ ...randomItem });
                addLog(`Trouvé : ${randomItem.name}`);
            }

            // NOTE: On ne supprime PLUS l'objet de la scène (scene.remove) 
            // ni du tableau (objects.splice) pour qu'il reste visible.

            input.interact = false;
            return;
        }
    }

    input.interact = false;
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
    } else if (dist < 15) {
        const dir = new THREE.Vector3().subVectors(camera.position, boss.position).normalize();
        const newPos = boss.position.clone().add(dir.multiplyScalar(1.5 * dt));
        if (!checkCollision(newPos)) {
            boss.position.x = newPos.x;
            boss.position.z = newPos.z;
        }
    }
}

function gainXp(amount) {
    gameState.xp += amount;
    if (gameState.xp >= gameState.maxXp) {
        gameState.xp -= gameState.maxXp;
        gameState.level++;
        gameState.maxXp = Math.floor(gameState.maxXp * 1.5);
        gameState.maxHp += 20;
        gameState.hp = gameState.maxHp;
        addLog(`Niveau ${gameState.level} atteint !`, "text-yellow-400");

        const levelDisplay = document.getElementById('level-display');
        if (levelDisplay) levelDisplay.innerText = `Lv ${gameState.level}`;
    }

    const xpBar = document.getElementById('xp-bar');
    if (xpBar) xpBar.style.width = `${(gameState.xp / gameState.maxXp) * 100}%`;

    const xpText = document.getElementById('xp-text');
    if (xpText) xpText.innerText = `XP ${gameState.xp}/${gameState.maxXp}`;
}
window.gainXp = gainXp;

function updateMobs(dt) {
    if (gameState.isDead) return;

    mobs.forEach(mob => {
        if (!mob.userData || mob.userData.dead) return;

        const dist = mob.position.distanceTo(camera.position);

        if (dist < 15 && dist > 1.0) {
            const dir = new THREE.Vector3().subVectors(camera.position, mob.position).normalize();
            const newPos = mob.position.clone().add(dir.multiplyScalar((mob.userData.speed || 1.0) * dt));

            if (!checkCollision(newPos)) {
                mob.position.x = newPos.x;
                mob.position.z = newPos.z;
            }
        }

        if (dist < 1.5) {
            if (Math.random() < 0.01) {
                addLog(`${mob.userData.name} attaque !`, "text-red-400");
                gameState.hp -= (mob.userData.damage || 5);
                const hpBar = document.getElementById('hp-bar');
                if (hpBar) hpBar.style.width = `${gameState.hp}%`;

                if (gameState.hp <= 0) {
                    gameState.isDead = true;
                    addLog("VOUS ETES MORT", "text-red-700");
                }
            }
        }
    });
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

    // AJOUT DE L'APPEL A LA FONCTION D'INTERACTION
    updateInteraction();

    updateBoss(dt);
    updateMobs(dt);
    updateSpells(dt, scene, mobs, boss);
    drawMinimap(camera, boss);

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

        const sword = GameData.items.find(i => i.type === 'weapon') || GameData.items[0];
        const potion = GameData.items.find(i => i.type === 'consumable') || GameData.items[1];

        if (sword) playerInventory.addItem({ ...sword });
        if (potion) playerInventory.addItem({ ...potion });

        animate();
    });
}

// Handle Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});