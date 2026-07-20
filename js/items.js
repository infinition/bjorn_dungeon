import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.128.0/examples/jsm/loaders/GLTFLoader.js';
import { GameData } from './data.js';

const textureLoader = new THREE.TextureLoader();
const _gltf = new GLTFLoader();
const _modelCache = {};
function loadGLB(url) {
    if (!_modelCache[url]) _modelCache[url] = new Promise((res, rej) => _gltf.load(url, g => res(g.scene), undefined, rej));
    return _modelCache[url];
}
// Met un modèle à l'échelle (base au sol, recentré) et l'ajoute au holder
function fitInto(holder, template, targetH) {
    const m = template.clone(true);
    const box = new THREE.Box3().setFromObject(m);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const s = (targetH || 1) / maxDim;
    m.scale.setScalar(s);
    m.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    holder.add(m);
    holder.userData._modelMesh = m;
    return m;
}

export function createObject(scene, x, z, objectData) {
    // Coffre/objet en MODÈLE 3D (GLB) si défini, sinon sprite
    if (objectData.model && String(objectData.model).trim()) {
        const holder = new THREE.Group();
        holder.position.set(x, 0, z);
        holder.userData = { ...objectData, type: 'object' };
        loadGLB(objectData.model).then(t => fitInto(holder, t, objectData.scale || 1))
            .catch(() => { /* repli sprite si échec */ const s = makeSprite(objectData); s.position.set(0, (objectData.scale || 1) / 2, 0); holder.add(s); });
        scene.add(holder);
        return holder;
    }
    const sprite = makeSprite(objectData);
    sprite.position.set(x, (objectData.scale || 1) / 2, z);
    sprite.userData = { ...objectData, type: 'object' };
    scene.add(sprite);
    return sprite;
}

function makeSprite(objectData) {
    const map = textureLoader.load(objectData.sprite || 'assets/sprites/chest_closed.png');
    map.magFilter = THREE.NearestFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map }));
    const scale = objectData.scale || 1.0;
    sprite.scale.set(scale, scale, 1);
    return sprite;
}

// Remplace le modèle d'un objet 3D (ex: coffre fermé -> ouvert)
export function swapObjectModel(holder, url) {
    if (!holder || !url) return false;
    if (holder.userData._modelMesh) holder.remove(holder.userData._modelMesh);
    loadGLB(url).then(t => fitInto(holder, t, holder.userData.scale || 1)).catch(() => { });
    return true;
}
