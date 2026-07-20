import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

// =====================================================================
//  VIEWMODEL 3D - arme(s) en première personne, attachée(s) à la caméra.
//  Modèles low-poly procéduraux par classe d'arme, éclairés (bloom sur
//  les parties émissives : gemme de bâton, flamme de torche, runes).
// =====================================================================

// Poses de repos (espace caméra). Ajuste ici si besoin.
const MAIN_REST = { pos: new THREE.Vector3(0.32, -0.30, -0.72), rot: new THREE.Euler(0.15, -0.18, 0.05) };
const OFF_REST = { pos: new THREE.Vector3(-0.34, -0.32, -0.72), rot: new THREE.Euler(0.1, 0.2, -0.05) };

// Teinte métallique selon la rareté
const RARITY_METAL = { green: '#cfcfcf', blue: '#bcd0ff', yellow: '#ffe6a0', purple: '#e2b0ff', mythic: '#ffb0a0' };
function metalOf(r) { return RARITY_METAL[r] || '#cfcfcf'; }
function glowsFor(r) { return r === 'yellow' || r === 'purple' || r === 'mythic'; }

function mat(color, o = {}) {
    return new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: o.rough != null ? o.rough : 0.55,
        metalness: o.metal != null ? o.metal : 0.6,
        emissive: new THREE.Color(o.emissive || '#000000'),
        emissiveIntensity: o.emi || 0
    });
}
function part(geo, material, pos, rot) {
    const m = new THREE.Mesh(geo, material);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    return m;
}

export function createViewmodel(camera) {
    const main = new THREE.Group();
    const off = new THREE.Group();
    main.position.copy(MAIN_REST.pos); main.rotation.copy(MAIN_REST.rot);
    off.position.copy(OFF_REST.pos); off.rotation.copy(OFF_REST.rot);
    camera.add(main); camera.add(off);

    let gemMat = null, flameMat = null, flameLight = null, flameSprite = null;
    let bobT = 0, lastYaw = camera.rotation.y, lastPitch = camera.rotation.x, swayX = 0, swayY = 0;
    let anim = null, animT = 0, animDur = 0;     // animation en cours
    let blocking = false;

    function clearGroup(g) {
        while (g.children.length) {
            const c = g.children[0]; g.remove(c);
            if (c.geometry) c.geometry.dispose();
            if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose());
        }
    }

    // ---- Arme dessinée en plan texturé (sprite fourni) ----
    function buildSpriteWeapon(item) {
        const m = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, depthTest: true });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
        plane.scale.set(0.45, 0.62, 1);
        main.add(plane);
        const tex = new THREE.TextureLoader().load(item.viewSprite, t => {
            const im = t.image; if (im && im.width) plane.scale.set(0.62 * (im.width / im.height), 0.62, 1);
        });
        tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
        m.map = tex; m.needsUpdate = true;
    }

    // ---- Modèles d'arme (main principale) ----
    function buildMain(item) {
        clearGroup(main); gemMat = null;
        if (item && item.viewSprite) { buildSpriteWeapon(item); return; }   // arme en image
        const wc = item ? item.weaponClass : null;
        const r = item ? (item.rarity || 'green') : 'green';
        const metal = metalOf(r);
        const wood = '#6b4a2b';
        const glow = glowsFor(r);
        const runeCol = r === 'mythic' ? '#ff6a4a' : r === 'purple' ? '#c44dff' : '#ffd24d';

        if (!wc) { // poing nu
            main.add(part(new THREE.BoxGeometry(0.1, 0.09, 0.13), mat('#caa07a', { metal: 0, rough: 0.9 }), [0, 0, 0]));
            return;
        }
        if (wc === 'sword' || wc === 'greatsword' || wc === 'dagger') {
            const long = wc === 'greatsword' ? 0.75 : wc === 'dagger' ? 0.26 : 0.5;
            main.add(part(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), mat(wood, { metal: 0.1, rough: 0.9 }), [0, -0.02, 0]));
            main.add(part(new THREE.BoxGeometry(0.14, 0.03, 0.04), mat('#d8b24a', { metal: 0.8, rough: 0.3 }), [0, 0.07, 0]));
            const blade = part(new THREE.BoxGeometry(0.045, long, 0.012), mat(metal, { metal: 0.95, rough: 0.2, emissive: glow ? runeCol : '#000', emi: glow ? 0.6 : 0 }), [0, 0.07 + long / 2, 0]);
            blade.scale.set(1, 1, 1);
            main.add(blade);
            main.add(part(new THREE.ConeGeometry(0.024, 0.06, 4), mat(metal, { metal: 0.95, rough: 0.2 }), [0, 0.07 + long + 0.02, 0]));
        } else if (wc === 'axe') {
            main.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), mat(wood, { metal: 0.1, rough: 0.9 }), [0, 0.2, 0]));
            main.add(part(new THREE.BoxGeometry(0.18, 0.16, 0.04), mat(metal, { metal: 0.9, rough: 0.25, emissive: glow ? runeCol : '#000', emi: glow ? 0.5 : 0 }), [0.08, 0.44, 0]));
        } else if (wc === 'staff') {
            main.add(part(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 8), mat(wood, { metal: 0.1, rough: 0.85 }), [0, 0.2, 0]));
            gemMat = mat('#4deeea', { metal: 0.3, rough: 0.1, emissive: '#4deeea', emi: 1.4 });
            main.add(part(new THREE.IcosahedronGeometry(0.06, 0), gemMat, [0, 0.6, 0]));
        } else if (wc === 'bow') {
            const bowMat = mat(wood, { metal: 0.1, rough: 0.8 });
            const arc = part(new THREE.TorusGeometry(0.28, 0.018, 6, 16, Math.PI * 1.1), bowMat, [0, 0.18, 0], [0, Math.PI / 2, 0]);
            main.add(arc);
            // corde
            const cordMat = new THREE.LineBasicMaterial({ color: 0xdddddd });
            const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.18 - 0.26, 0.0), new THREE.Vector3(0, 0.18 + 0.26, 0.0)]);
            main.add(new THREE.Line(g, cordMat));
        } else if (wc === 'crossbow') {
            main.add(part(new THREE.BoxGeometry(0.05, 0.4, 0.05), mat(wood, { metal: 0.1, rough: 0.85 }), [0, 0.18, 0]));
            main.add(part(new THREE.BoxGeometry(0.4, 0.04, 0.04), mat(metal, { metal: 0.8, rough: 0.4 }), [0, 0.34, 0.02]));
        } else {
            main.add(part(new THREE.BoxGeometry(0.05, 0.4, 0.05), mat(metal), [0, 0.15, 0]));
        }
    }

    // ---- Main secondaire (bouclier / torche) ----
    function buildOff(item) {
        clearGroup(off); flameMat = null;
        if (flameLight) { flameLight = null; }
        if (!item) return;
        const r = item.rarity || 'green';
        if (item.type === 'shield') {
            const metal = metalOf(r);
            off.add(part(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 16), mat('#7a5a3a', { metal: 0.2, rough: 0.8 }), [0, 0, 0], [Math.PI / 2, 0, 0]));
            off.add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), mat(metal, { metal: 0.9, rough: 0.3, emissive: glowsFor(r) ? '#ffd24d' : '#000', emi: glowsFor(r) ? 0.5 : 0 }), [0, 0.02, 0], [Math.PI / 2, 0, 0]));
        } else if (item.type === 'torch') {
            off.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 8), mat('#5a3a1a', { metal: 0, rough: 1 }), [0, 0, 0]));
            flameMat = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
            flameSprite = part(new THREE.SphereGeometry(0.06, 8, 8), flameMat, [0, 0.2, 0]);
            off.add(flameSprite);
            flameLight = new THREE.PointLight(0xffaa44, 1.6, 6);
            flameLight.position.set(0, 0.22, 0);
            off.add(flameLight);
        }
    }

    // ---- API ----
    let weaponY = 0;   // décalage vertical réglable (monter/baisser les armes)
    const ctrl = {
        groupMain: main, groupOff: off,
        setWeapon(item) { buildMain(item); },
        setOffhand(item) { buildOff(item); },
        setBlock(on) { blocking = on; },
        setWeaponY(v) { weaponY = v; },
        meleeVariant: 0,
        play(type) {
            anim = type; animT = 0;
            animDur = type === 'drink' ? 0.6 : type === 'cast' ? 0.32 : type === 'shoot' ? 0.3 : 0.28;
            if (type === 'melee') ctrl.meleeVariant = (ctrl.meleeVariant + 1) % 3;   // alterne les coups
        },

        update(dt, moving) {
            // sway : l'arme retarde sur la rotation caméra
            const dYaw = camera.rotation.y - lastYaw; lastYaw = camera.rotation.y;
            const dPitch = camera.rotation.x - lastPitch; lastPitch = camera.rotation.x;
            const tgtX = Math.max(-0.06, Math.min(0.06, -dYaw * 6));
            const tgtY = Math.max(-0.06, Math.min(0.06, dPitch * 6));
            swayX += (tgtX - swayX) * Math.min(1, dt * 10);
            swayY += (tgtY - swayY) * Math.min(1, dt * 10);

            // bob
            bobT += dt * (moving ? 9 : 2.5);
            const bob = Math.sin(bobT) * (moving ? 0.012 : 0.005);
            const bobS = Math.cos(bobT * 0.5) * (moving ? 0.01 : 0.004);

            // offsets d'animation
            let aPos = new THREE.Vector3(), aRot = new THREE.Vector3();
            if (anim) {
                animT += dt; const t = Math.min(1, animT / animDur);
                const ease = Math.sin(t * Math.PI);          // 0->1->0
                if (anim === 'melee') {
                    // Coup balayé, avec variantes (droite->gauche, gauche->droite, vertical)
                    if (ctrl.meleeVariant === 0) { aPos.x = -0.55 * ease; aPos.z = -0.14 * ease; aRot.z = 1.5 * ease; aRot.x = -0.3 * ease; }
                    else if (ctrl.meleeVariant === 1) { aPos.x = 0.5 * ease; aPos.z = -0.14 * ease; aRot.z = -1.5 * ease; aRot.x = -0.3 * ease; }
                    else { aPos.y = -0.4 * ease; aPos.z = -0.14 * ease; aRot.x = -1.7 * ease; }
                }
                else if (anim === 'shoot') { aPos.z = 0.12 * Math.sin(t * Math.PI); aRot.x = -0.25 * ease; }
                else if (anim === 'cast') { aPos.z = -0.18 * ease; aRot.x = -0.5 * ease; if (gemMat) gemMat.emissiveIntensity = 1.4 + 3.0 * ease; }
                else if (anim === 'drink') { aRot.set(-0.6 * ease, 0, -0.8 * ease); }
                if (t >= 1) { anim = null; if (gemMat) gemMat.emissiveIntensity = 1.4; }
            }

            // garde (bouclier levé)
            const blockOff = blocking ? new THREE.Vector3(0.18, 0.14, 0.1) : new THREE.Vector3(0, 0, 0);

            main.position.set(MAIN_REST.pos.x + swayX + aPos.x, MAIN_REST.pos.y + weaponY + bob + swayY + aPos.y, MAIN_REST.pos.z + aPos.z);
            main.rotation.set(MAIN_REST.rot.x + aRot.x + swayY * 1.5, MAIN_REST.rot.y + aRot.y - swayX * 1.5, MAIN_REST.rot.z + aRot.z + bobS);

            off.position.set(OFF_REST.pos.x + swayX - blockOff.x, OFF_REST.pos.y + weaponY + bob + swayY + blockOff.y, OFF_REST.pos.z + blockOff.z);
            off.rotation.set(OFF_REST.rot.x + (blocking ? -0.5 : 0) + swayY * 1.5, OFF_REST.rot.y - swayX * 1.5, OFF_REST.rot.z);

            // flamme de torche
            if (flameMat) {
                const f = 0.8 + Math.sin(bobT * 4) * 0.15 + Math.random() * 0.1;
                flameMat.opacity = 0.9 * f;
                if (flameSprite) flameSprite.scale.setScalar(0.9 + f * 0.3);
                if (flameLight) flameLight.intensity = 1.4 * f;
            }
        }
    };
    return ctrl;
}
