import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

function createPixelTexture(width, height, colorFn) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const color = colorFn(x, y, width, height);
            imgData.data[i] = color[0];     // R
            imgData.data[i + 1] = color[1]; // G
            imgData.data[i + 2] = color[2]; // B
            imgData.data[i + 3] = color[3]; // A
        }
    }
    ctx.putImageData(imgData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
}

export const wallTexture = createPixelTexture(64, 64, (x, y, w, h) => {
    const brickW = 16;
    const brickH = 8;
    const row = Math.floor(y / brickH);
    const shift = (row % 2) * (brickW / 2);
    const col = Math.floor((x + shift) / brickW);

    const isMortar = (x + shift) % brickW === 0 || y % brickH === 0;

    if (isMortar) return [10, 15, 20, 255];

    const noise = Math.random() * 20;
    const r = 30 + noise;
    const g = 40 + noise;
    const b = 45 + noise + (Math.random() > 0.9 ? 30 : 0);
    return [r, g, b, 255];
});

export const floorTexture = createPixelTexture(64, 64, (x, y) => {
    const noise = Math.random() * 30;
    return [20 + noise, 15 + noise, 10 + noise, 255];
});

// Boss Texture
const bossCanvas = document.createElement('canvas');
bossCanvas.width = 64; bossCanvas.height = 64;
const bCtx = bossCanvas.getContext('2d');
bCtx.fillStyle = 'rgba(0,0,0,0)'; bCtx.fillRect(0, 0, 64, 64);
bCtx.fillStyle = '#2a2015'; bCtx.fillRect(20, 20, 24, 40);
bCtx.fillStyle = '#444'; bCtx.fillRect(24, 10, 16, 14);
bCtx.fillStyle = '#0ff'; bCtx.fillRect(28, 14, 2, 2); bCtx.fillRect(34, 14, 2, 2);
bCtx.strokeStyle = '#4deeea'; bCtx.lineWidth = 2;
bCtx.beginPath();
bCtx.moveTo(24, 12); bCtx.lineTo(16, 4); bCtx.lineTo(20, 0);
bCtx.moveTo(40, 12); bCtx.lineTo(48, 4); bCtx.lineTo(44, 0);
bCtx.stroke();
bCtx.fillStyle = '#666'; bCtx.fillRect(10, 30, 4, 34);
bCtx.fillStyle = '#4deeea'; bCtx.fillRect(6, 30, 12, 8);
bCtx.fillStyle = '#0ff'; bCtx.font = '10px monospace'; bCtx.fillText('ᚱ', 28, 40);

export const bossTexture = new THREE.CanvasTexture(bossCanvas);
bossTexture.magFilter = THREE.NearestFilter;

// Chest Texture
const chestCanvas = document.createElement('canvas');
chestCanvas.width = 32; chestCanvas.height = 32;
const cCtx = chestCanvas.getContext('2d');
cCtx.fillStyle = '#8B4513'; cCtx.fillRect(4, 12, 24, 16);
cCtx.strokeStyle = '#DAA520'; cCtx.lineWidth = 2; cCtx.strokeRect(4, 12, 24, 16);
cCtx.fillStyle = '#0ff'; cCtx.fillRect(14, 18, 4, 6);
export const chestTexture = new THREE.CanvasTexture(chestCanvas);
chestTexture.magFilter = THREE.NearestFilter;
