import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { gameState } from './state.js';
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
            hitBoss(boss);
            hit = true;
        }

        // Check Mobs (TODO)

        if (hit || p.life <= 0) {
            scene.remove(p.mesh);
            projectiles.splice(i, 1);
        }
    }
}

function hitBoss(boss) {
    gameState.bossHp -= 15 + Math.random() * 10;
    const bossPct = (gameState.bossHp / gameState.bossMaxHp) * 100;
    const bossBar = document.getElementById('boss-hp-bar');
    if (bossBar) bossBar.style.width = `${Math.max(0, bossPct)}%`;

    if (Math.random() > 0.7) addLog("Critique! 25 dégâts", "text-red-400");

    boss.material.color.setHex(0xff0000);
    setTimeout(() => boss.material.color.setHex(0xffffff), 100);

    if (gameState.bossHp <= 0) {
        gameState.bossDead = true;
        boss.visible = false;
        addLog("BOSS VAINCU!", "text-orange");
    }
}

export function fireWeapon(camera, scene) {
    if (gameState.isDead) return;

    playShootSound();

    // Create Projectile
    const geom = new THREE.SphereGeometry(0.1, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0x4deeea });
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
        life: 2.0 // Seconds
    });

    // Weapon Recoil Animation (Camera shake handled in game loop ideally, or here via state)
    // For now, simple flash
    const flash = document.createElement('div');
    flash.style.position = 'absolute';
    flash.style.top = '0'; flash.style.left = '0';
    flash.style.width = '100%'; flash.style.height = '100%';
    flash.style.background = 'rgba(77, 238, 234, 0.2)';
    flash.style.zIndex = '50';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 50);
}
