import { gameState } from './state.js';

export const input = {
    forward: 0,
    turn: 0,
    strafe: 0,
    fire: false,
    interact: false, // AJOUT : Variable pour l'interaction
    lookX: 0,
    lookY: 0
};

export const keys = {};

export function initInputs(fireWeaponCallback, switchSpellCallback) {
    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => {
        keys[e.code] = false;
        if (e.code === 'Space') input.fire = false;
        // On remet interact à false quand on relâche E pour éviter le spam
        if (e.code === 'KeyE') input.interact = false;
    });

    // Mouse / Pointer Lock
    const canvas = document.getElementById('game-canvas');
    if (canvas) {
        canvas.addEventListener('click', () => {
            canvas.requestPointerLock();
        });
    }

    // Gestion du mouvement souris
    document.addEventListener('mousemove', e => {
        if (document.pointerLockElement === canvas) {
            input.lookX += e.movementX;
            input.lookY += e.movementY;
        }
    });

    document.addEventListener('mousedown', e => {
        if (document.pointerLockElement && e.button === 0) {
            gameState.isFiring = true;
            if (fireWeaponCallback) fireWeaponCallback();
        }
    });

    document.addEventListener('mouseup', () => {
        gameState.isFiring = false;
    });

    document.addEventListener('wheel', e => {
        if (document.pointerLockElement && switchSpellCallback) {
            const dir = Math.sign(e.deltaY);
            switchSpellCallback(dir);
        }
    });

    // Touch logic setup
    const touchState = { left: { x: 0, y: 0, id: null }, right: { x: 0, y: 0, id: null } };

    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        const touchControls = document.getElementById('touch-controls');
        if (touchControls) {
            touchControls.classList.remove('hidden');

            const handleTouch = (e, type, elem) => {
                e.preventDefault();
                for (let i = 0; i < e.changedTouches.length; i++) {
                    const t = e.changedTouches[i];
                    if (e.type === 'touchstart') {
                        if (touchState[type].id === null) touchState[type].id = t.identifier;
                    }

                    if (touchState[type].id === t.identifier) {
                        const rect = elem.getBoundingClientRect();
                        const cx = rect.left + rect.width / 2;
                        const cy = rect.top + rect.height / 2;

                        let dx = t.clientX - cx;
                        let dy = t.clientY - cy;
                        const maxDist = 50;
                        const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDist);
                        const angle = Math.atan2(dy, dx);

                        const kx = Math.cos(angle) * dist;
                        const ky = Math.sin(angle) * dist;

                        elem.querySelector('.stick-knob').style.transform =
                            `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;

                        touchState[type].x = kx / maxDist;
                        touchState[type].y = ky / maxDist;
                    }
                }
            };

            const resetTouch = (e, type, elem) => {
                e.preventDefault();
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === touchState[type].id) {
                        touchState[type].id = null;
                        touchState[type].x = 0;
                        touchState[type].y = 0;
                        elem.querySelector('.stick-knob').style.transform = 'translate(-50%, -50%)';
                    }
                }
            };

            const lStick = document.getElementById('stick-left');
            if (lStick) {
                lStick.addEventListener('touchstart', e => handleTouch(e, 'left', lStick), { passive: false });
                lStick.addEventListener('touchmove', e => handleTouch(e, 'left', lStick), { passive: false });
                lStick.addEventListener('touchend', e => resetTouch(e, 'left', lStick));
            }

            const rStick = document.getElementById('stick-right');
            if (rStick) {
                rStick.addEventListener('touchstart', e => handleTouch(e, 'right', rStick), { passive: false });
                rStick.addEventListener('touchmove', e => handleTouch(e, 'right', rStick), { passive: false });
                rStick.addEventListener('touchend', e => resetTouch(e, 'right', rStick));
            }

            const btn = document.getElementById('shoot-btn');
            if (btn) {
                btn.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    gameState.isFiring = true;
                    if (fireWeaponCallback) fireWeaponCallback();
                }, { passive: false });
                btn.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    gameState.isFiring = false;
                });
            }

            // Bouton Touch Interaction (Optionnel, si tu en ajoutes un dans le HTML)
            const interactBtn = document.getElementById('interact-btn');
            if (interactBtn) {
                interactBtn.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    input.interact = true;
                }, { passive: false });
                interactBtn.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    input.interact = false;
                });
            }
        }
    }

    return touchState;
}

export function updateInputs(touchState, fireWeaponCallback) {
    // Reset basic values
    input.forward = 0;
    input.turn = 0;
    input.strafe = 0;
    // On ne reset pas interact ici à false brutalement sinon le keypress n'est pas détecté,
    // mais on s'assure qu'il est synchronisé avec les touches.
    input.interact = false;

    // --- KEYBOARD ---
    if (keys['KeyW'] || keys['KeyZ'] || keys['ArrowUp']) input.forward = 1;
    if (keys['KeyS'] || keys['ArrowDown']) input.forward = -1;
    if (keys['KeyA'] || keys['KeyQ']) input.strafe = -1;
    if (keys['KeyD']) input.strafe = 1;
    if (keys['ArrowLeft']) input.turn = 1;
    if (keys['ArrowRight']) input.turn = -1;

    // --- AJOUT : TOUCHE E POUR INTERACTION ---
    if (keys['KeyE']) input.interact = true;

    if (keys['Space'] && !gameState.isFiring) {
        gameState.isFiring = true;
        if (fireWeaponCallback) fireWeaponCallback();
    }

    // --- TOUCH ---
    if (Math.abs(touchState.left.y) > 0.1) input.forward = -touchState.left.y;
    if (Math.abs(touchState.left.x) > 0.1) input.strafe = touchState.left.x;
    if (Math.abs(touchState.right.x) > 0.1) input.turn = -touchState.right.x * 2.0;

    // --- GAMEPAD ---
    let gp = null;
    try {
        if (navigator.getGamepads) {
            const gamepads = navigator.getGamepads();
            for (let i = 0; i < gamepads.length; i++) {
                if (gamepads[i]) {
                    gp = gamepads[i];
                    break;
                }
            }
        }
    } catch (err) { }

    if (gp) {
        const DZ = 0.15;
        if (gp.axes) {
            if (Math.abs(gp.axes[1]) > DZ) input.forward = -gp.axes[1];
            if (Math.abs(gp.axes[0]) > DZ) input.strafe = gp.axes[0];
            if (Math.abs(gp.axes[2]) > DZ) input.turn = -gp.axes[2] * 2;
        }

        const isPressed = (btnIndex) => gp.buttons && gp.buttons[btnIndex] && gp.buttons[btnIndex].pressed;

        // Tirer (RT ou A)
        if ((isPressed(7) || isPressed(0)) && !gameState.isFiring) {
            gameState.isFiring = true;
            if (fireWeaponCallback) fireWeaponCallback();
        }
        if (!isPressed(7) && !isPressed(0)) gameState.isFiring = false;

        // Interaction (Bouton X/Carré - index 2, ou bouton Y/Triangle - index 3)
        if (isPressed(2)) input.interact = true;
    }
}