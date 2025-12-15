import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { GameData } from './data.js';

const textureLoader = new THREE.TextureLoader();

export function createObject(scene, x, z, objectData) {
    const map = textureLoader.load(objectData.sprite || 'assets/sprites/chest.png');
    map.magFilter = THREE.NearestFilter;

    const mat = new THREE.SpriteMaterial({ map: map });
    const sprite = new THREE.Sprite(mat);

    const scale = objectData.scale || 1.0;
    sprite.scale.set(scale, scale, 1);

    sprite.position.set(x, scale / 2, z);

    // Store data for interaction
    sprite.userData = { ...objectData, type: 'object' };

    scene.add(sprite);
    return sprite;
}
