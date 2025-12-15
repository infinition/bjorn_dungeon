import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { gameState } from './state.js';
import { GameData } from './data.js';
import { playShootSound } from './sounds.js';
import { addLog } from './utils.js';

const projectiles = [];

export function updateSpells(dt, scene, mobs, boss) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));
        p.life -= dt;

        // Collision with mobs/boss
        // Simple distance check
        let hit = false;

        // Check Boss
        if (!gameState.bossDead && boss && p.mesh.position.distanceTo(boss.position) < 1.0) {
            hitBoss(boss, p.damage);
            hit = true;
        }

        // Check Mobs
        for (let j = mobs.length - 1; j >= 0; j--) {
            const mob = mobs[j];
            if (mob.userData && !mob.userData.dead && p.mesh.position.distanceTo(mob.position) < 1.0) {
                hitMob(mob, p.damage, scene);
                hit = true;
                break; // One hit per projectile
            }
        }

        if (hit || p.life <= 0) {
            scene.remove(p.mesh);
            projectiles.splice(i, 1);
        }
    }
}

function hitMob(mob, damage, scene) {
    if (!mob.userData) return;

    mob.userData.hp -= damage;

    // Update UI Bar (Generic Target)
    const hpBar = document.getElementById('boss-hp-bar');
    const hpLabel = document.getElementById('boss-hp-label');
    const barContainer = document.getElementById('target-bar-container');

    if (hpBar && hpLabel && barContainer) {
        // Show bar
        barContainer.classList.remove('hidden');
        hpLabel.classList.remove('hidden');
        hpLabel.innerText = mob.userData.name;

        const pct = (mob.userData.hp / (mob.userData.maxHp || 20)) * 100;
        hpBar.style.width = `${Math.max(0, pct)}%`;

        // Reset hide timer
        if (window.targetBarTimeout) clearTimeout(window.targetBarTimeout);
        window.targetBarTimeout = setTimeout(() => {
            barContainer.classList.add('hidden');
        }, 3000);
    }

    // Flash effect
    mob.material.color.setHex(0xff0000);
    setTimeout(() => {
        if (mob.material) mob.material.color.setHex(parseInt(mob.userData.color.replace('#', '0x')));
    }, 100);

    if (mob.userData.hp <= 0) {
        mob.userData.dead = true;
        mob.visible = false;
        addLog(`${mob.userData.name} éliminé !`, "text-green-400");

        // Gain XP
        if (window.gainXp) window.gainXp(10 + Math.floor(Math.random() * 10));

        // Hide bar immediately on death
        if (barContainer) barContainer.classList.add('hidden');
    }
}

function hitBoss(boss, damage) {
    gameState.bossHp -= damage;
    const bossPct = (gameState.bossHp / gameState.bossMaxHp) * 100;

    const hpBar = document.getElementById('boss-hp-bar');
    const hpLabel = document.getElementById('boss-hp-label');
    const barContainer = document.getElementById('target-bar-container');

    if (hpBar && hpLabel && barContainer) {
        barContainer.classList.remove('hidden');
        hpLabel.classList.remove('hidden');
        hpLabel.innerText = "BOSS";
        hpBar.style.width = `${Math.max(0, bossPct)}%`;

        if (window.targetBarTimeout) clearTimeout(window.targetBarTimeout);
        window.targetBarTimeout = setTimeout(() => {
            barContainer.classList.add('hidden');
        }, 5000);
    }

    if (Math.random() > 0.7) addLog("Critique! 25 dégâts", "text-red-400");

    boss.material.color.setHex(0xff0000);
    setTimeout(() => boss.material.color.setHex(0xffffff), 100);

    if (gameState.bossHp <= 0) {
        gameState.bossDead = true;
        boss.visible = false;
        addLog("BOSS VAINCU!", "text-orange");
        if (barContainer) barContainer.classList.add('hidden');
    }
}

export function fireWeapon(camera, scene) {
    if (gameState.isDead) return;

    playShootSound();

    // Create Projectile
    const geom = new THREE.SphereGeometry(0.1, 4, 4);

    const spellName = gameState.spells[gameState.currentSpellIndex];
    const spellData = GameData.spells.find(s => s.name === spellName) || GameData.spells[0];

    let color = new THREE.Color(spellData.color);

    const mat = new THREE.MeshBasicMaterial({ color: color });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(camera.position);

    // Offset slightly forward and down
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    mesh.position.add(dir.clone().multiplyScalar(0.5));
    mesh.position.y -= 0.2;

    scene.add(mesh);

    projectiles.push({
        mesh: mesh,
        velocity: dir.multiplyScalar(10), // Speed
        life: 2.0, // Seconds
        damage: spellData.damage
    });

    // Weapon Recoil Animation
    const flash = document.createElement('div');
    flash.style.position = 'absolute';
    flash.style.top = '0'; flash.style.left = '0';
    flash.style.width = '100%'; flash.style.height = '100%';
    flash.style.background = 'rgba(77, 238, 234, 0.2)';
    flash.style.zIndex = '50';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 50);
}
