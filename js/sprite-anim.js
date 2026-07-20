import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

// =====================================================================
//  SPRITES ANIMES
//  Supporte 3 formes de "sprite" dans les donnees :
//   1) "assets/<image>.png"                   (chemin, statique - legacy)
//   2) { type:'image', src }                  (image unique, src = chemin ou dataURL)
//   3) { type:'sheet', src, cols, rows, fps,  (spritesheet en grille)
//        anims:{ idle:{row,frames,fps,loop}, walk:{...}, attack:{...}, death:{...} } }
//
//  Convention de grille : chaque animation occupe une LIGNE (row), de la
//  colonne 0 a frames-1. UV THREE : origine en bas a gauche.
// =====================================================================

const loader = new THREE.TextureLoader();
THREE.Cache.enabled = true;

function configureTexture(tex) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
}

// Charge une texture propre par sprite. THREE.Cache garde les donnees image en cache.
function loadTexture(src) {
    if (!src) return null;
    return configureTexture(loader.load(src));
}

// Texture procedurale de secours (mob sans sprite)
function fallbackTexture(color) {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 32, 32);
    ctx.fillStyle = color || '#cccccc';
    ctx.fillRect(10, 10, 12, 18);
    ctx.fillRect(12, 4, 8, 8);
    ctx.fillStyle = '#0ff';
    ctx.fillRect(13, 6, 2, 2); ctx.fillRect(17, 6, 2, 2);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    return tex;
}

// Normalise n'importe quelle forme de spec en structure interne
export function normalizeSpriteSpec(spec, fallbackColor) {
    let src = null, cols = 1, rows = 1, isSheet = false, fps = 8, anims = null;

    if (typeof spec === 'string') {
        src = spec.trim() || null;
    } else if (spec && typeof spec === 'object') {
        src = (spec.src || '').trim() || null;
        if (spec.type === 'sheet') {
            isSheet = true;
            cols = Math.max(1, spec.cols || 1);
            rows = Math.max(1, spec.rows || 1);
            fps = spec.fps || 8;
            anims = spec.anims || null;
        }
    }

    // Animations par defaut si feuille sans anims explicites : 1ere ligne en boucle
    if (isSheet && !anims) {
        anims = { idle: { row: 0, frames: cols, fps, loop: true } };
    }
    if (!isSheet) {
        anims = { idle: { row: 0, frames: 1, fps: 1, loop: true } };
    }

    return { src, cols, rows, isSheet, fps, anims };
}

// Cree un sprite anime + son controleur
export function makeAnimatedSprite(spec, opts = {}) {
    const scale = opts.scale || 1;
    const fallbackColor = opts.color;
    const norm = normalizeSpriteSpec(spec, fallbackColor);

    // Respecte le ratio largeur/hauteur d'une frame (sinon sprites ecrases).
    const applyAspect = (image) => {
        if (!image || !image.width) return;
        const fw = image.width / norm.cols, fh = image.height / norm.rows;
        const a = (fw > 0 && fh > 0) ? fw / fh : 1;
        sprite.scale.set(scale * a, scale, 1);
    };

    // Texture propre a cette entite (offset/repeat independants), avec callback d'aspect
    const tex = norm.src ? loadTexture(norm.src) : fallbackTexture(fallbackColor);
    tex.repeat.set(1 / norm.cols, 1 / norm.rows);

    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, color: 0xffffff });
    mat.rotation = THREE.MathUtils.degToRad(opts.rotationDegrees || 0);
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(scale, scale, 1);
    let aspectApplied = false;
    const updateAspect = () => {
        if (!aspectApplied && tex.image && tex.image.width) {
            applyAspect(tex.image);
            aspectApplied = true;
        }
    };
    updateAspect();

    const ctrl = {
        sprite, material: mat, texture: tex,
        cols: norm.cols, rows: norm.rows, anims: norm.anims,
        state: 'idle', frame: 0, timer: 0, finished: false,

        hasState(name) { return !!this.anims[name]; },

        setState(name) {
            if (name === this.state) return;
            if (!this.anims[name]) return;          // ignore si l'etat n'existe pas
            this.state = name;
            this.frame = 0;
            this.timer = 0;
            this.finished = false;
            this._applyFrame();
        },

        _applyFrame() {
            const a = this.anims[this.state] || this.anims.idle;
            const col = Math.min(this.frame, (a.frames || 1) - 1);
            const row = a.row || 0;
            // origine UV en bas a gauche -> ligne 0 = haut de l'image
            this.texture.offset.set(col / this.cols, 1 - (row + 1) / this.rows);
        },

        update(dt) {
            updateAspect();
            const a = this.anims[this.state] || this.anims.idle;
            const frames = a.frames || 1;
            if (frames <= 1) { this._applyFrame(); return; }
            const fps = a.fps || this.fps || 8;
            this.timer += dt;
            const frameDur = 1 / fps;
            while (this.timer >= frameDur) {
                this.timer -= frameDur;
                this.frame++;
                if (this.frame >= frames) {
                    if (a.loop === false) { this.frame = frames - 1; this.finished = true; }
                    else this.frame = 0;
                }
            }
            this._applyFrame();
        }
    };
    ctrl.fps = norm.fps;
    ctrl._applyFrame();
    return ctrl;
}

// Cree un plane anime. Utilise pour les projectiles couches dans le monde.
export function makeAnimatedPlaneSprite(spec, opts = {}) {
    const scale = opts.scale || 1;
    const fallbackColor = opts.color;
    const norm = normalizeSpriteSpec(spec, fallbackColor);
    const tex = norm.src ? loadTexture(norm.src) : fallbackTexture(fallbackColor);
    tex.repeat.set(1 / norm.cols, 1 / norm.rows);

    const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        color: 0xffffff,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const geom = new THREE.PlaneGeometry(1, 1);
    // Le plan projectile est orienté par une base monde (billboard/direction) :
    // on retourne la coord V pour que l'image s'affiche à l'endroit, pas la tête en bas.
    const uv = geom.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    uv.needsUpdate = true;
    const mesh = new THREE.Mesh(geom, mat);
    mesh.scale.set(scale, scale, 1);
    let root = mesh;
    const extraMeshes = [];
    const mirrorMode = opts.mirrorMode || (opts.crossPlane ? 'cross' : 'flat');
    const mirrorAngles = mirrorMode === 'radial' ? [45, 90, 135]
        : mirrorMode === 'cross' ? [90]
        : [];
    if (mirrorAngles.length) {
        root = new THREE.Group();
        root.add(mesh);
        for (const deg of mirrorAngles) {
            const m = new THREE.Mesh(geom, mat);
            m.rotation.y = THREE.MathUtils.degToRad(deg);
            m.scale.copy(mesh.scale);
            extraMeshes.push(m);
            root.add(m);
        }
    }

    const applyAspect = (image) => {
        if (!image || !image.width) return;
        const fw = image.width / norm.cols, fh = image.height / norm.rows;
        const a = (fw > 0 && fh > 0) ? fw / fh : 1;
        mesh.scale.set(scale * a, scale, 1);
        for (const m of extraMeshes) m.scale.copy(mesh.scale);
    };
    let aspectApplied = false;
    const updateAspect = () => {
        if (!aspectApplied && tex.image && tex.image.width) {
            applyAspect(tex.image);
            aspectApplied = true;
        }
    };
    updateAspect();

    const ctrl = {
        sprite: root, material: mat, texture: tex,
        cols: norm.cols, rows: norm.rows, anims: norm.anims,
        state: 'idle', frame: 0, timer: 0, finished: false,

        hasState(name) { return !!this.anims[name]; },

        setState(name) {
            if (name === this.state) return;
            if (!this.anims[name]) return;
            this.state = name;
            this.frame = 0;
            this.timer = 0;
            this.finished = false;
            this._applyFrame();
        },

        _applyFrame() {
            const a = this.anims[this.state] || this.anims.idle;
            const col = Math.min(this.frame, (a.frames || 1) - 1);
            const row = a.row || 0;
            this.texture.offset.set(col / this.cols, 1 - (row + 1) / this.rows);
        },

        update(dt) {
            updateAspect();
            const a = this.anims[this.state] || this.anims.idle;
            const frames = a.frames || 1;
            if (frames <= 1) { this._applyFrame(); return; }
            const fps = a.fps || this.fps || 8;
            this.timer += dt;
            const frameDur = 1 / fps;
            while (this.timer >= frameDur) {
                this.timer -= frameDur;
                this.frame++;
                if (this.frame >= frames) {
                    if (a.loop === false) { this.frame = frames - 1; this.finished = true; }
                    else this.frame = 0;
                }
            }
            this._applyFrame();
        }
    };
    ctrl.fps = norm.fps;
    ctrl._applyFrame();
    return ctrl;
}

// Resout juste la source d'image (pour pickups / aperçus simples)
export function spriteSrc(spec) {
    if (typeof spec === 'string') return spec;
    if (spec && typeof spec === 'object') return spec.src || null;
    return null;
}
