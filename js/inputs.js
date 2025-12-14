import { gameState } from './state.js';

export const input = {
    forward: 0,
    turn: 0,
    strafe: 0,
    fire: false
};

export const keys = {};

export function initInputs(fireWeaponCallback) {
    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => {
        keys[e.code] = false;
        if (e.code === 'Space') input.fire = false;
    });

    // Touch logic
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
                btn.addEventListener('touchstart', (e) => { e.preventDefault(); gameState.isFiring = true; fireWeaponCallback(); }, { passive: false });
                btn.addEventListener('touchend', (e) => { e.preventDefault(); gameState.isFiring = false; });
            }
        }
    }

    return touchState;
}

export function updateInputs(touchState, fireWeaponCallback) {
    input.forward = 0;
    input.turn = 0;
    input.strafe = 0;

    // Keyboard
    if (keys['KeyW'] || keys['ArrowUp']) input.forward = 1;
    if (keys['KeyS'] || keys['ArrowDown']) input.forward = -1;
    if (keys['KeyA']) input.strafe = -1;
    if (keys['KeyD']) input.strafe = 1;
    if (keys['ArrowLeft']) input.turn = 1;
    if (keys['ArrowRight']) input.turn = -1;
    if (keys['Space'] && !gameState.isFiring) {
        gameState.isFiring = true;
        fireWeaponCallback();
    }

    // Touch
    if (Math.abs(touchState.left.y) > 0.1) input.forward = -touchState.left.y;
    if (Math.abs(touchState.left.x) > 0.1) input.strafe = touchState.left.x;
    if (Math.abs(touchState.right.x) > 0.1) input.turn = -touchState.right.x * 1.5;

    // Gamepad
    let gp = null;
    try {
        if (navigator.getGamepads) {
            const gamepads = navigator.getGamepads();
            if (gamepads && gamepads.length > 0) {
                gp = gamepads[0];
            }
        }
    } catch (err) { }

    if (gp) {
        if (gp.axes && gp.axes.length >= 4) {
            if (Math.abs(gp.axes[1]) > 0.1) input.forward = -gp.axes[1];
            if (Math.abs(gp.axes[0]) > 0.1) input.strafe = gp.axes[0];
            if (Math.abs(gp.axes[2]) > 0.1) input.turn = -gp.axes[2] * 2;
        }

        const isPressed = (btnIndex) => gp.buttons && gp.buttons[btnIndex] && gp.buttons[btnIndex].pressed;

        if (isPressed(7) && !gameState.isFiring) { // RT
            gameState.isFiring = true;
            fireWeaponCallback();
        }
        if (!isPressed(7)) gameState.isFiring = false;
    }
}
