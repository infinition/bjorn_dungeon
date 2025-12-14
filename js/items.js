import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { chestTexture } from './textures.js';

export function createChest(scene) {
    const chestMat = new THREE.SpriteMaterial({ map: chestTexture });
    const chest = new THREE.Sprite(chestMat);
    chest.position.set(1.5, 0.5, 7.5);
    scene.add(chest);
    return chest;
}
