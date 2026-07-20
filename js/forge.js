import { DEFAULT_GAME_DATA, FORGE_KEY } from './data.js';
import { idbPut, idbGet, idbDelete } from './assets-db.js';

// =====================================================================
//  BJORN FORGE - studio de contenu (assets, sprites animes, stats...)
// =====================================================================

const clone = (o) => JSON.parse(JSON.stringify(o));
const cloneValue = (o) => o === undefined ? undefined : clone(o);

// --- Etat ---
let project = loadProject();
let currentTab = 'monsters';
let selected = 0;
const activePreviews = [];   // animations de preview a annuler au re-render

function loadProject() {
    let p = null;
    try { const saved = localStorage.getItem(FORGE_KEY); if (saved) p = JSON.parse(saved); } catch (e) { console.warn(e); }
    if (!p) p = clone(DEFAULT_GAME_DATA);
    return normalizeProject(p);
}

// Applique toutes les migrations de schema sur un projet (localStorage ou disque).
function normalizeProject(p) {
    if (!p) p = clone(DEFAULT_GAME_DATA);
    // Migration : garantit les nouvelles collections
    if (!p.bosses) p.bosses = p.boss ? [p.boss] : clone(DEFAULT_GAME_DATA.bosses);
    if (!p.biomes) p.biomes = clone(DEFAULT_GAME_DATA.biomes);
    // Garantit les champs texture (sol/mur/plafond) sur les biomes existants
    p.biomes.forEach(b => { ['floorTex', 'wallTex', 'ceilTex'].forEach(k => { if (b[k] === undefined) b[k] = ''; }); if (!Array.isArray(b.objects)) b.objects = []; if (!Array.isArray(b.props)) b.props = []; b.props = b.props.filter(x => x !== 'gem'); });
    // Garantit les nouveaux champs son + tir sur les monstres/boss existants
    (p.monsters || []).forEach(m => { ['walkSound', 'attackSound', 'deathSound'].forEach(k => { if (m[k] === undefined) m[k] = ''; }); if (m.ranged === undefined) m.ranged = false; });
    (p.bosses || []).forEach(b => { ['walkSound', 'attackSound', 'deathSound'].forEach(k => { if (b[k] === undefined) b[k] = ''; }); });
    if (!p.library) p.library = { audio: [], images: [], models: [] };
    if (!p.propTextures) p.propTextures = {};
    if (!p.dungeon) p.dungeon = clone(DEFAULT_GAME_DATA.dungeon || {});
    if (!Array.isArray(p.dungeon.trapProps)) p.dungeon.trapProps = ['bones', 'rock'];
    if (p.dungeon.trapPropChance === undefined) p.dungeon.trapPropChance = 0.18;
    if (!p.rarities) p.rarities = clone(DEFAULT_GAME_DATA.rarities);
    if (!p.uniques) p.uniques = clone(DEFAULT_GAME_DATA.uniques || []);
    if (!p.bonuses) p.bonuses = clone(DEFAULT_GAME_DATA.bonuses || []);
    if (!p.statusDefs) p.statusDefs = clone(DEFAULT_GAME_DATA.statusDefs || []);
    (p.objects || []).forEach(o => { if (o.model === undefined) o.model = ''; if (o.modelOpen === undefined) o.modelOpen = ''; });
    const migrateProjectileRotation = (o) => {
        if (!o || o.projectileSpriteRotation !== undefined) return;
        if (o.projectileSpriteAngle !== undefined) o.projectileSpriteRotation = { x: 0, y: 0, z: Number(o.projectileSpriteAngle) || 0 };
    };
    (p.spells || []).forEach(migrateProjectileRotation);
    (p.items || []).forEach(o => { if (o && o.type === 'weapon' && o.attackType === 'ranged') migrateProjectileRotation(o); });
    // Garantit les sons de projectile + impact sur les sorts et armes a distance existants
    const ensureProjectileSounds = (o) => { ['castSound', 'impactSound'].forEach(k => { if (o[k] === undefined) o[k] = ''; }); };
    (p.spells || []).forEach(ensureProjectileSounds);
    (p.items || []).forEach(o => { if (o && o.type === 'weapon' && o.attackType === 'ranged') ensureProjectileSounds(o); });
    return p;
}

function save() {
    // Disque = source de verite (si serveur node). Ecriture asynchrone non bloquante.
    if (serverAvailable) {
        saveProjectToDisk().then(ok => setStatus(ok ? 'Projet sauvé sur disque ✓' : '⚠ Sauvegarde disque échouée (voir console)'));
    } else {
        setStatus('⚠ Serveur non détecté - projet en cache navigateur (lance node server.js pour écrire sur disque).');
    }
    // Miroir localStorage (repli hors-ligne). Peut depasser le quota avec de gros base64.
    try { localStorage.setItem(FORGE_KEY, JSON.stringify(project)); }
    catch (e) { console.warn('[Forge] miroir localStorage sature (normal si assets base64) :', e.message); }
}
function setStatus(msg) { document.getElementById('project-status').innerText = msg; }

// =====================================================================
//  PERSISTANCE DISQUE (serveur node) - source de verite.
//  Sans serveur : repli navigateur (localStorage + IndexedDB) + avertissement.
// =====================================================================
let serverAvailable = false;
let assetCacheBust = Date.now();   // force le rechargement des images reecrites

async function pingServer() {
    try { const r = await fetch('/api/project', { method: 'GET' }); serverAvailable = r.ok; }
    catch (e) { serverAvailable = false; }
    return serverAvailable;
}
async function postJSON(url, payload) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
}
// Ecrit un asset (dataURL) a un chemin assets/... Renvoie le chemin ecrit.
async function writeAssetToDisk(targetPath, dataURL) {
    const res = await postJSON('/api/asset', { path: targetPath, dataURL });
    if (!res.ok) throw new Error(res.error || 'echec ecriture');
    assetCacheBust = Date.now();
    return res.path;
}
async function restoreAssetOnDisk(targetPath) {
    try { const r = await fetch('/api/asset/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: targetPath }) }); assetCacheBust = Date.now(); return r.ok; }
    catch (e) { return false; }
}
async function assetHasDefault(targetPath) {
    if (!serverAvailable || !isDiskPath(targetPath)) return false;
    try { const r = await fetch('/api/asset/has-default?path=' + encodeURIComponent(targetPath)); const j = await r.json(); return !!j.hasDefault; }
    catch (e) { return false; }
}
async function saveProjectToDisk() {
    if (!serverAvailable) return false;
    try { await postJSON('/api/project', project); return true; } catch (e) { console.warn('[Forge] save disque:', e); return false; }
}

const isDiskPath = (v) => typeof v === 'string' && v.startsWith('assets/') && !v.startsWith('assets/_defaults/');
const extFromDataURL = (d) => { const m = /^data:(?:image|audio|video|model|application)\/([a-z0-9.+-]+)/i.exec(d || ''); if (!m) return 'png'; const e = m[1].toLowerCase(); return ({ jpeg: 'jpg', 'gltf-binary': 'glb', 'octet-stream': 'bin', mpeg: 'mp3' })[e] || e; };
const slugify = (s) => String(s || 'entry').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'entry';

// Chemin cible pour un champ d'asset : ecrase le fichier existant si deja sur
// disque, sinon cree assets/custom/<onglet>/<id>_<champ>.<ext>.
function assetTargetPath(currentRef, category, id, field, ext) {
    if (isDiskPath(currentRef)) return currentRef;
    return `assets/custom/${slugify(category)}/${slugify(id)}_${slugify(field)}.${ext}`;
}

// Stocke un asset : disque si serveur, sinon IndexedDB (repli). Renvoie la
// nouvelle reference a stocker dans le projet (chemin assets/... ou idb:...).
async function storeAsset({ currentRef, dataURL, category, id, field, fallbackKey, name, ext, libCategory = 'images' }) {
    ext = ext || extFromDataURL(dataURL);
    if (serverAvailable) {
        try {
            const target = assetTargetPath(currentRef, category, id, field, ext);
            const written = await writeAssetToDisk(target, dataURL);
            addToLibrary(libCategory, written, name || 'asset');
            return written;
        } catch (e) {
            console.warn('[Forge] ecriture disque echouee, repli navigateur:', e);
            setStatus('⚠ Ecriture disque impossible - repli navigateur temporaire.');
        }
    } else {
        setStatus('⚠ Serveur non detecte - modification en cache navigateur (lance node server.js).');
    }
    // Repli : IndexedDB
    const k = fallbackKey || (slugify(category) + ':' + slugify(id) + ':' + slugify(field));
    try { await idbPut(k, dataURL); addToLibrary(libCategory, 'idb:' + k, name || 'asset'); return 'idb:' + k; }
    catch (e) { return dataURL; }
}

// Bouton generique "Restaurer par defaut" (visible si un defaut existe sur disque).
function restoreDefaultButton(getRef, onRestored) {
    const btn = el('button', { class: 'btn text-xs', style: 'display:none', title: 'Revenir a l\'image d\'origine' }, '↺ Défaut');
    const ref = getRef();
    assetHasDefault(ref).then(has => { if (has) btn.style.display = ''; });
    btn.addEventListener('click', async () => {
        const p = getRef();
        if (!isDiskPath(p)) return;
        btn.disabled = true;
        const ok = await restoreAssetOnDisk(p);
        btn.disabled = false;
        if (ok) { setStatus('Image restaurée par défaut ✓'); onRestored && onRestored(); }
        else setStatus('⚠ Aucun défaut à restaurer.');
    });
    return btn;
}

// --- Helpers DOM ---
function el(tag, props = {}, kids = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') e.className = v;
        else if (k === 'style') e.style.cssText = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'html') e.innerHTML = v;
        else if (v !== undefined && v !== null) e.setAttribute(k, v);
    }
    (Array.isArray(kids) ? kids : [kids]).forEach(c => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(c)); });
    return e;
}

// =====================================================================
//  ABSTRACTION DES COLLECTIONS
// =====================================================================
const ARRAY_TABS = ['items', 'uniques', 'monsters', 'spells', 'objects', 'bosses', 'biomes', 'bonuses', 'statusDefs'];
const SINGLE_TABS = ['environment', 'dungeon'];

function getEntities() {
    if (ARRAY_TABS.includes(currentTab)) {
        return (project[currentTab] || []).map((ref, index) => ({ label: ref.name || ref.label || ref.id || ref.type || '(sans nom)', ref, index }));
    }
    if (currentTab === 'environment') return [{ label: 'Environnement', ref: project.environment }];
    if (currentTab === 'dungeon') return [{ label: 'Donjon', ref: project.dungeon }];
    if (currentTab === 'rarities') return Object.entries(project.rarities).map(([rkey, ref]) => ({ label: rkey, ref, rkey }));
    return [];
}

const TEMPLATES = {
    items: () => ({ id: 'new_item', name: 'Nouvel Item', type: 'misc', slot: '', stats: {}, icon: '?', sprite: { type: 'image', src: '' }, rarity: 'common', value: 1, spawnChance: 0.1, desc: '' }),
    monsters: () => ({
        id: 'new_mob', name: 'Nouveau Monstre', hp: 20, damage: 4, xp: 8, color: '#ffffff', scale: 1,
        speed: 1.2, attackRange: 1.5, attackRate: 0.02, behavior: 'chaser',
        sprite: { type: 'sheet', src: '', cols: 4, rows: 4, fps: 8, anims: {
            idle: { row: 0, frames: 4, fps: 6, loop: true }, walk: { row: 1, frames: 4, fps: 10, loop: true },
            attack: { row: 2, frames: 4, fps: 12, loop: false }, death: { row: 3, frames: 4, fps: 8, loop: false }
        } },
        sound: 'default', walkSound: '', attackSound: '', deathSound: '',
        ranged: false, projColor: '#ff5544', projSpeed: 9, projChance: 1,
        gold: [1, 6], loot: [], spawnChance: 0.2
    }),
    spells: () => ({ id: 'new_spell', name: 'Nouveau Sort', type: 'bolt', damage: 10, manaCost: 8, color: '#ffffff', cooldown: 0.5, speed: 12, lifetime: 2, radius: 1.2, icon: '*', sound: 'zap', fx: { type: 'image', src: '' }, projectileSprite: { type: 'image', src: '' }, projectileFx: false, projectileSpriteLayout: 'vertical', projectileSpriteRotation: { x: 0, y: 0, z: 0 }, projectileSpriteVolume: 'cross', projectileScale: 0.9, fxScale: 0.9, castSound: '', impactSound: '', desc: '' }),
    objects: () => ({ id: 'new_obj', name: 'Nouvel Objet', type: 'chest', sprite: { type: 'image', src: '' }, model: '', modelOpen: '', scale: 0.8, lootTable: [], lootRolls: 1, goldMin: 0, goldMax: 10, spawnChance: 0.1 }),
    bosses: () => ({
        id: 'new_boss', name: 'Nouveau Boss', hp: 350, damage: 20, xp: 220,
        color: '#ffffff', scale: 1.8, speed: 1.3, attackRange: 2.6, attackRate: 0.03, detect: 30,
        sprite: { type: 'image', src: '' }, sound: 'roar', walkSound: '', attackSound: '', deathSound: '', gold: [120, 220],
        lootChance: 1, lootRolls: 3, enrageAt: 0.35,
        abilities: [{ id: 'slam', name: 'Choc', cooldown: 6, damage: 25, range: 4 }, { id: 'summon', name: 'Invocation', cooldown: 12, count: 2 }]
    }),
    biomes: () => ({ id: 'new_biome', name: 'Nouveau Biome', wallTint: '#8a8a8a', floorTint: '#9a9a9a', floorTex: '', wallTex: '', ceilTex: '', fogColor: '#0c0c16', ambient: '#282840', ambientI: 0.5, light: '#ffaa44', rune: '#4deeea', boss: '', monsters: [], objects: [], props: [] }),
    uniques: () => ({ id: 'new_unique', name: 'Objet Unique', type: 'offhand', unique: true, baseStats: { spellPower: 15 }, special: { multishot: 3, spread: 0.22 }, icon: '🔱', sprite: { type: 'image', src: '' }, value: 500, desc: 'Effet special...' }),
    bonuses: () => ({ id: 'new_bonus', name: 'Nouveau Bonus', desc: '', stats: {}, lootBoost: 0 }),
    statusDefs: () => ({ type: 'new_status', label: 'Nouvel Effet', color: '#ffffff', tick: 0.5, icon: '✦', slow: false })
};

// Options de <select> selon le contexte
function selectOptions(key) {
    if (key === 'type') {
        if (currentTab === 'items') return ['weapon', 'armor', 'offhand', 'consumable', 'misc'];
        if (currentTab === 'objects') return ['chest', 'breakable'];
        if (currentTab === 'spells') return ['bolt', 'pierce', 'aoe', 'nova', 'heal'];
    }
    if (key === 'slot') return ['', 'mainHand', 'offHand', 'armor'];
    if (key === 'behavior') return ['chaser', 'phaser', 'caster'];
    if (key === 'boss' && currentTab === 'biomes') return ['', ...(project.bosses || []).map(b => b.id)];
    if (key === 'projectileSpriteLayout') return ['vertical', 'horizontal'];
    return null;
}
const STAT_KEYS = ['damage', 'spellPower', 'defense', 'crit', 'attackSpeed', 'speed', 'maxHp', 'maxMana', 'manaRegen'];

// =====================================================================
//  RENDU : tabs, liste, formulaire
// =====================================================================
function renderTabs() {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
}

function renderList() {
    const list = document.getElementById('entity-list');
    list.innerHTML = '';
    const entities = getEntities();

    const isArray = ARRAY_TABS.includes(currentTab) || currentTab === 'rarities';
    document.getElementById('btn-add').style.display = isArray ? '' : 'none';
    document.getElementById('btn-dup').style.display = (ARRAY_TABS.includes(currentTab)) ? '' : 'none';

    entities.forEach((ent, i) => {
        const item = el('div', {
            class: 'list-item btn text-left text-xs ' + (i === selected ? 'active' : ''),
            onclick: () => { selected = i; renderList(); renderForm(); }
        }, [
            el('div', { class: 'font-medium' }, ent.label),
            el('div', { class: 'text-[10px] text-slate-500' }, ent.ref.id || ent.rkey || '')
        ]);
        list.appendChild(item);
    });
    if (selected >= entities.length) selected = Math.max(0, entities.length - 1);
}

function renderForm() {
    activePreviews.splice(0).forEach(p => p.stop());
    const entities = getEntities();
    const ent = entities[selected];
    const editor = document.getElementById('editor');
    const empty = document.getElementById('editor-empty');
    if (!ent) { editor.classList.add('hidden'); empty.classList.remove('hidden'); return; }
    editor.classList.remove('hidden'); empty.classList.add('hidden');

    document.getElementById('editor-title').innerText = (ent.label || '').toUpperCase();
    document.getElementById('btn-delete').classList.toggle('hidden', SINGLE_TABS.includes(currentTab));

    const fields = document.getElementById('form-fields');
    fields.innerHTML = '';
    const obj = ent.ref;

    // Cle de rarete renommable
    if (currentTab === 'rarities') {
        fields.appendChild(fieldRow('clé', textInput(ent.rkey, (v) => renameRarity(ent.rkey, v))));
    }

    // En-tête "carte RPG" (avatar + nom + stats clés) pour les entités à sprite/fx
    if (['monsters', 'bosses', 'items', 'uniques', 'objects', 'spells'].includes(currentTab)) fields.appendChild(cardHeader(obj));

    Object.keys(obj).forEach(key => {
        if (isProjectileVisualOptionKey(obj, key)) return;
        fields.appendChild(buildField(obj, key));
    });

    if (currentTab === 'spells' && obj.projectileFx === undefined) {
        fields.appendChild(fieldRow('utiliser un sprite projectile', boolInput(false, v => { obj.projectileFx = v; save(); renderForm(); })));
    }
    if (currentTab === 'spells' && obj.projectileSprite === undefined) {
        fields.appendChild(fieldRow('Sprite projectile', spriteWidget(obj, 'projectileSprite')));
    }
    if (currentTab === 'spells' && obj.projectileScale === undefined) {
        fields.appendChild(fieldRow('échelle projectile', numberInput(obj.fxScale || 0.9, v => { obj.projectileScale = v; save(); renderForm(); }, 'projectileScale')));
    }

    const rangedItem = currentTab === 'items' && obj.type === 'weapon' && obj.attackType === 'ranged';
    if (rangedItem && obj.projectileSprite === undefined) {
        fields.appendChild(fieldRow('Sprite flèche', spriteWidget(obj, 'projectileSprite')));
    }
    if (rangedItem && obj.projectileScale === undefined) {
        fields.appendChild(fieldRow('échelle flèche', numberInput(0.55, v => { obj.projectileScale = v; save(); renderForm(); }, 'projectileScale')));
    }
    if (rangedItem && obj.castSound === undefined) {
        fields.appendChild(fieldRow('son du projectile', audioRow('son du projectile', 'snd:' + (obj.id || 'e') + ':castSound', () => obj.castSound, v => { obj.castSound = v; }, renderForm)));
    }
    if (rangedItem && obj.impactSound === undefined) {
        fields.appendChild(fieldRow('son d\'impact', audioRow('son d\'impact', 'snd:' + (obj.id || 'e') + ':impactSound', () => obj.impactSound, v => { obj.impactSound = v; }, renderForm)));
    }

    // Liaison bidirectionnelle : dans la fiche monstre, cocher les biomes
    if (currentTab === 'monsters') fields.appendChild(fieldRow('apparaît dans les biomes (cochez)', biomeChecklist(obj)));
    // Aperçu in-game d'un biome (décor seul, sans monstre)
    if (currentTab === 'biomes') fields.appendChild(el('button', { class: 'btn btn-primary w-full mt-2', onclick: () => { save(); window.location.href = 'index.html?preview=' + encodeURIComponent(obj.id); } }, '▶ Tester ce biome (sans monstre)'));
}

function isProjectileVisualOptionKey(obj, key) {
    const projectileOwner = currentTab === 'spells' || (currentTab === 'items' && obj && obj.type === 'weapon' && obj.attackType === 'ranged');
    return projectileOwner && ['projectileSpriteLayout', 'projectileSpriteRotation', 'projectileSpriteAngle', 'projectileSpriteVolume'].includes(key);
}

// Carte RPG : avatar (sprite), nom coloré, méta (type/classe/rareté), badges de stats
function _rarityColor(key) { const r = project.rarities && project.rarities[key]; return (r && r.color) || '#4deeea'; }
function statBadges(obj) {
    const out = [];
    const add = (label, v, col) => { if (v != null && v !== '') out.push(el('span', { class: 'px-2 py-0.5 rounded bg-black/40 border border-white/10', style: 'color:' + col }, `${label} ${v}`)); };
    add('PV', obj.hp, '#ff6b6b'); add('DÉG', obj.damage, '#ffb454'); add('XP', obj.xp, '#9fbfff');
    add('Mana', obj.manaCost, '#6cc4ff'); add('Soin', obj.heal, '#46e06a'); add('CD', obj.cooldown, '#cbd5e1'); add('Portée', obj.radius, '#c4b5fd');
    if (obj.baseStats) Object.entries(obj.baseStats).forEach(([k, v]) => add(k, v, '#86e3c0'));
    if (obj.stats) Object.entries(obj.stats).forEach(([k, v]) => add(k, v, '#86e3c0'));
    return out;
}
function cardHeader(obj) {
    const spec = (obj.sprite || obj.fx) ? toSpec(obj.sprite || obj.fx) : null;
    const src = spec && spec.src;
    const borderCol = obj.rarity ? _rarityColor(obj.rarity) : '#4deeea';
    const avatar = el('div', { class: 'w-20 h-20 rounded-lg border-2 bg-black/40 flex items-center justify-center overflow-hidden shrink-0', style: 'border-color:' + borderCol });
    if (src) { const img = el('img', { class: 'pixelated', style: 'width:100%;height:100%;object-fit:contain' }); _thumbSrc(src).then(s => { if (s) img.src = s; }); avatar.appendChild(img); }
    else avatar.appendChild(el('span', { class: 'text-3xl' }, obj.icon || '❓'));
    const meta = [];
    if (obj.type) meta.push(obj.type);
    if (obj.weaponClass) meta.push(obj.weaponClass + (obj.hands === 2 ? ' · 2 mains' : ''));
    if (obj.behavior) meta.push(obj.behavior);
    if (obj.ranged) meta.push('🏹 tireur');
    if (obj.rarity) meta.push(obj.rarity);
    return el('div', { class: 'glass rounded-lg p-3 flex gap-4 items-center mb-3', style: 'border:1px solid ' + borderCol + '55' }, [
        avatar,
        el('div', { class: 'flex flex-col gap-1 min-w-0' }, [
            el('div', { class: 'text-lg font-bold truncate', style: obj.color ? ('color:' + obj.color) : 'color:' + borderCol }, obj.name || obj.id || '-'),
            el('div', { class: 'text-[11px] text-slate-400' }, meta.join('  ·  ')),
            el('div', { class: 'flex gap-1.5 flex-wrap text-[10px] mt-1' }, statBadges(obj))
        ])
    ]);
}

function defaultEntityFor(obj) {
    if (ARRAY_TABS.includes(currentTab)) {
        const defaults = DEFAULT_GAME_DATA[currentTab];
        if (Array.isArray(defaults)) {
            const idKey = obj && obj.id !== undefined ? 'id' : (obj && obj.type !== undefined ? 'type' : null);
            if (idKey) {
                const found = defaults.find(d => d && d[idKey] === obj[idKey]);
                if (found) return found;
            }
        }
    }
    if (SINGLE_TABS.includes(currentTab)) return DEFAULT_GAME_DATA[currentTab] || null;
    return null;
}

function defaultFieldValue(obj, key) {
    const source = defaultEntityFor(obj);
    if (source && Object.prototype.hasOwnProperty.call(source, key)) return { ok: true, value: cloneValue(source[key]) };
    const makeTemplate = TEMPLATES[currentTab];
    if (makeTemplate) {
        const template = makeTemplate();
        if (Object.prototype.hasOwnProperty.call(template, key)) return { ok: true, value: cloneValue(template[key]) };
    }
    return { ok: false, value: undefined };
}

// Une ligne label + widget avec actions optionnelles
function fieldRow(label, widget, onDelete, onRestore) {
    const head = el('div', { class: 'flex items-center justify-between mb-1' }, [
        el('label', { class: 'text-[11px] uppercase tracking-wider text-cyan-300/80 font-bold' }, label)
    ]);
    const actions = el('div', { class: 'flex items-center gap-2' });
    if (onRestore) actions.appendChild(el('button', { class: 'text-[10px] text-cyan-300 hover:text-cyan-200', onclick: onRestore }, 'défaut'));
    if (onDelete) actions.appendChild(el('button', { class: 'text-[10px] text-red-400 hover:text-red-300', onclick: onDelete }, '× champ'));
    if (actions.childNodes.length) head.appendChild(actions);
    return el('div', { class: 'glass rounded-lg p-3' }, [head, widget]);
}

function buildField(obj, key) {
    const val = obj[key];
    const commit = (v) => { obj[key] = v; save(); if (key === 'name' || key === 'id') renderList(); };
    const delField = (key !== 'id' && key !== 'name') ? () => { delete obj[key]; save(); renderForm(); } : null;
    const def = defaultFieldValue(obj, key);
    const restoreField = (key !== 'id' && key !== 'name' && def.ok) ? () => { obj[key] = cloneValue(def.value); save(); renderForm(); } : null;

    if (key === 'sprite' || key === 'fx' || key === 'projectileSprite') {
        const label = currentTab === 'spells' && key === 'fx' ? 'FX impact' : (key === 'projectileSprite' ? (currentTab === 'items' ? 'Sprite flèche' : 'Sprite projectile') : key);
        return fieldRow(label, spriteWidget(obj, key), delField, restoreField);
    }
    if (/Tex$/.test(key) || key === 'floor' || key === 'wall') return fieldRow(key, textureWidget(obj, key), delField, restoreField);
    if (key === 'model' || key === 'modelOpen') return fieldRow(key === 'model' ? 'modèle 3D (fermé)' : 'modèle 3D (ouvert)', modelWidget(obj, key), delField, restoreField);
    if (key === 'castSound') return fieldRow('son du projectile', audioRow('son du projectile', 'snd:' + (obj.id || 'e') + ':castSound', () => obj.castSound, v => { obj.castSound = v; }, renderForm), delField, restoreField);
    if (key === 'impactSound') return fieldRow('son d\'impact', audioRow('son d\'impact', 'snd:' + (obj.id || 'e') + ':impactSound', () => obj.impactSound, v => { obj.impactSound = v; }, renderForm), delField, restoreField);
    if (/Sound$/.test(key)) return fieldRow(key, audioRow(key, 'snd:' + (obj.id || 'e') + ':' + key, () => obj[key], v => { obj[key] = v; }, renderForm), delField, restoreField);
    if (currentTab === 'biomes' && key === 'monsters') return fieldRow('monstres du biome (cochez)', monsterChecklist(obj), delField, restoreField);
    if (currentTab === 'biomes' && key === 'objects') return fieldRow('objets du biome (cochez)', listChecklist(obj.objects, project.objects || [], o => o.id, o => o.name || o.id), delField, restoreField);
    if (currentTab === 'biomes' && key === 'props') return fieldRow('décor 3D du biome (cochez)', listChecklist(obj.props, PROP_NAMES, x => x, x => x), delField, restoreField);
    if (currentTab === 'dungeon' && key === 'trapProps') return fieldRow('props pouvant cacher un piege', listChecklist(obj.trapProps, PROP_NAMES, x => x, x => x), delField, restoreField);
    if (key === 'stats' || key === 'baseStats') return fieldRow(key, statsWidget(obj, key), delField, restoreField);
    if (key === 'loot') return fieldRow('loot (drops)', lootWidget(obj), delField, restoreField);
    if (key === 'lootTable') return fieldRow('lootTable', lootTableWidget(obj), delField, restoreField);
    if (key === 'abilities') return fieldRow('capacités', abilitiesWidget(obj), delField, restoreField);
    if (key === 'status' || key === 'statusOnHit') return fieldRow(key === 'status' ? 'effet (statut)' : 'effet au contact', statusWidget(obj, key), delField, restoreField);
    if (key === 'special') return fieldRow('effet spécial (unique)', specialWidget(obj, key), delField, restoreField);
    if (key === 'buff') return fieldRow('buff (potion)', buffWidget(obj, key), delField, restoreField);
    if (currentTab === 'spells' && key === 'projectileFx') return fieldRow('utiliser un sprite projectile', boolInput(val, commit), delField, restoreField);
    if (key === 'projectileSpriteLayout') return fieldRow(currentTab === 'items' ? 'orientation flèche' : 'orientation projectile', selectInput(val || (currentTab === 'items' ? 'horizontal' : 'vertical'), ['vertical', 'horizontal'], commit), delField, restoreField);
    if (key === 'projectileSpriteRotation') return fieldRow(currentTab === 'items' ? 'rotation flèche' : 'rotation projectile', rotationInput(val, commit), delField, restoreField);
    if (key === 'projectileSpriteAngle') return fieldRow(currentTab === 'items' ? 'angle flèche ancien' : 'angle projectile ancien', angleInput(val, commit), delField, restoreField);
    if (key === 'projectileScale') return fieldRow(currentTab === 'items' ? 'échelle flèche' : 'échelle projectile', numberInput(val, commit, key), delField, restoreField);
    if (key === 'gold') return fieldRow('or [min,max]', rangeWidget(obj, key), delField, restoreField);
    if (key === 'color' || key.toLowerCase().includes('color')) return fieldRow(key, colorInput(val, commit), delField, restoreField);
    if (key === 'rarity') return fieldRow('rareté', rarityInput(val, commit), delField, restoreField);

    const opts = selectOptions(key);
    if (opts) return fieldRow(key, selectInput(val, opts, commit), delField, restoreField);
    if (typeof val === 'number') return fieldRow(key, numberInput(val, commit, key), delField, restoreField);
    if (typeof val === 'boolean') return fieldRow(key, boolInput(val, commit), delField, restoreField);
    if (val && typeof val === 'object') return fieldRow(key, kvWidget(obj, key), delField, restoreField);   // zéro JSON : éditeur clé→valeur
    return fieldRow(key, textInput(val, commit), delField, restoreField);
}

// --- Widgets simples ---
function textInput(val, commit) {
    return el('input', { class: 'glass-input w-full px-3 py-2 rounded text-sm', value: val ?? '', oninput: e => commit(e.target.value) });
}
function sliderRange(key, val) {
    const k = (key || '').toLowerCase(); val = +val || 0;
    if (/chance|crit|rate|prob|threshold|opacity|lifesteal|block|parry|spawnchance/.test(k)) return [0, 1, 0.01];
    if (/scale|spread|normalstrength/.test(k)) return [0, 3, 0.05];
    if (/speed|radius|fps|hands|ambienti|cooldown|lifetime|enrageat/.test(k)) return [0, Math.max(5, Math.ceil(val * 2)), 0.1];
    if (/maxhp|^hp$/.test(k)) return [0, Math.max(100, Math.ceil(val * 2 / 50) * 50), 5];
    if (/damage|xp|gold|value|detect|manacost|heal|maxmana/.test(k)) return [0, Math.max(50, Math.ceil(val * 2 / 10) * 10), 1];
    return [0, Math.max(10, Math.ceil(val * 2)), val % 1 ? 0.1 : 1];
}
// Slider + saisie manuelle (la valeur manuelle peut dépasser le max du slider)
function numberInput(val, commit, key) {
    const [mn, mx, st] = sliderRange(key, val);
    const num = el('input', { type: 'number', step: 'any', class: 'glass-input w-24 px-2 py-1 rounded text-sm', value: val });
    const range = el('input', { type: 'range', min: mn, max: Math.max(mx, +val || 0), step: st, value: val, class: 'flex-1 accent-cyan-400' });
    range.addEventListener('input', () => { num.value = range.value; commit(parseFloat(range.value)); });
    num.addEventListener('input', () => { const v = num.value === '' ? 0 : parseFloat(num.value); if (v > +range.max) range.max = v; if (v < +range.min) range.min = v; range.value = v; commit(v); });
    return el('div', { class: 'flex items-center gap-3' }, [range, num]);
}
function angleInput(val, commit) {
    const clampStep = v => Math.max(-180, Math.min(180, Math.round((parseFloat(v) || 0) / 10) * 10));
    const value = clampStep(val);
    const num = el('input', { type: 'number', min: -180, max: 180, step: 10, class: 'glass-input w-24 px-2 py-1 rounded text-sm', value });
    const range = el('input', { type: 'range', min: -180, max: 180, step: 10, value, class: 'flex-1 accent-cyan-400' });
    const apply = v => { const next = clampStep(v); num.value = next; range.value = next; commit(next); };
    range.addEventListener('input', () => apply(range.value));
    num.addEventListener('change', () => apply(num.value));
    return el('div', { class: 'flex items-center gap-3' }, [range, num, el('span', { class: 'text-xs text-slate-400' }, 'deg')]);
}
function rotationInput(val, commit) {
    const source = val && typeof val === 'object' ? val : { x: 0, y: 0, z: val || 0 };
    const current = {
        x: Number(source.x || 0),
        y: Number(source.y || 0),
        z: Number(source.z || 0)
    };
    const clampStep = v => Math.max(-180, Math.min(180, Math.round((parseFloat(v) || 0) / 10) * 10));
    const row = (axis) => {
        current[axis] = clampStep(current[axis]);
        const num = el('input', { type: 'number', min: -180, max: 180, step: 10, class: 'glass-input w-20 px-2 py-1 rounded text-sm', value: current[axis] });
        const range = el('input', { type: 'range', min: -180, max: 180, step: 10, value: current[axis], class: 'flex-1 accent-cyan-400' });
        const apply = v => {
            current[axis] = clampStep(v);
            num.value = current[axis];
            range.value = current[axis];
            commit({ x: current.x, y: current.y, z: current.z });
        };
        range.addEventListener('input', () => apply(range.value));
        num.addEventListener('change', () => apply(num.value));
        return el('label', { class: 'flex items-center gap-3 text-xs' }, [
            el('span', { class: 'w-4 text-cyan-300 font-bold' }, axis.toUpperCase()),
            range,
            num,
            el('span', { class: 'text-slate-400' }, 'deg')
        ]);
    };
    return el('div', { class: 'flex flex-col gap-2' }, [row('x'), row('y'), row('z')]);
}
function boolInput(val, commit) {
    const cb = el('input', { type: 'checkbox', class: 'w-5 h-5', onchange: e => commit(e.target.checked) });
    cb.checked = !!val;
    return cb;
}
function selectInput(val, opts, commit) {
    const s = el('select', { class: 'glass-input w-full px-3 py-2 rounded text-sm', onchange: e => commit(e.target.value) },
        opts.map(o => el('option', { value: o }, o || '(aucun)')));
    s.value = val ?? '';
    return s;
}
function colorInput(val, commit) {
    const text = el('input', { class: 'glass-input flex-1 px-3 py-2 rounded text-sm', value: val ?? '#ffffff', oninput: e => { picker.value = e.target.value; commit(e.target.value); } });
    const picker = el('input', { type: 'color', value: val ?? '#ffffff', class: 'h-9 w-10 rounded cursor-pointer bg-transparent', oninput: e => { text.value = e.target.value; commit(e.target.value); } });
    return el('div', { class: 'flex gap-2 items-center' }, [picker, text]);
}
function rarityInput(val, commit) {
    return selectInput(val, Object.keys(project.rarities), commit);
}
function rangeWidget(obj, key) {
    const arr = Array.isArray(obj[key]) ? obj[key] : [0, 0];
    const mk = (i) => el('input', { type: 'number', class: 'glass-input w-24 px-2 py-1 rounded text-sm', value: arr[i], oninput: e => { arr[i] = parseFloat(e.target.value) || 0; obj[key] = arr; save(); } });
    return el('div', { class: 'flex gap-2 items-center' }, ['min', mk(0), 'max', mk(1)]);
}
function jsonWidget(obj, key) {
    const ta = el('textarea', { class: 'glass-input w-full px-3 py-2 rounded text-xs font-mono', rows: 6 });
    ta.value = JSON.stringify(obj[key], null, 2);
    const status = el('div', { class: 'text-[10px] mt-1' }, '');
    ta.addEventListener('input', () => {
        try { obj[key] = JSON.parse(ta.value); status.innerText = 'OK ✓'; status.className = 'text-[10px] mt-1 text-green-400'; save(); }
        catch (e) { status.innerText = 'JSON invalide'; status.className = 'text-[10px] mt-1 text-red-400'; }
    });
    return el('div', {}, [ta, status]);
}

// --- Stats ---
function statsWidget(obj, key = 'stats') {
    if (!obj[key] || typeof obj[key] !== 'object') obj[key] = {};
    const st = obj[key];
    const wrap = el('div', { class: 'flex flex-col gap-2' });
    const redraw = () => {
        wrap.innerHTML = '';
        Object.entries(st).forEach(([k, v]) => {
            wrap.appendChild(el('div', { class: 'flex gap-2 items-center' }, [
                el('span', { class: 'text-xs w-24 text-slate-300' }, k),
                el('input', { type: 'number', step: 'any', class: 'glass-input flex-1 px-2 py-1 rounded text-sm', value: v, oninput: e => { st[k] = parseFloat(e.target.value) || 0; save(); } }),
                el('button', { class: 'text-red-400 text-xs px-2', onclick: () => { delete st[k]; save(); redraw(); } }, '×')
            ]));
        });
        const avail = STAT_KEYS.filter(k => !(k in st));
        const sel = el('select', { class: 'glass-input px-2 py-1 rounded text-xs' }, [el('option', { value: '' }, '+ stat...'), ...avail.map(k => el('option', { value: k }, k))]);
        sel.addEventListener('change', () => { if (sel.value) { st[sel.value] = 0; save(); redraw(); } });
        wrap.appendChild(sel);
    };
    redraw();
    return wrap;
}

// --- Checklists biome <-> monstres (bidirectionnel) ---
function _checkItem(label, checked, onToggle) {
    const cb = el('input', { type: 'checkbox', class: 'mr-1', onchange: e => onToggle(e.target.checked) });
    cb.checked = checked;
    return el('label', { class: 'flex items-center text-xs glass rounded px-2 py-1 cursor-pointer hover:bg-white/10' }, [cb, label]);
}
function monsterChecklist(biome) {
    if (!Array.isArray(biome.monsters)) biome.monsters = [];
    const wrap = el('div', { class: 'grid grid-cols-2 gap-1 max-h-72 overflow-y-auto' });
    (project.monsters || []).forEach(m => wrap.appendChild(_checkItem(m.name || m.id, biome.monsters.includes(m.id), (on) => {
        const i = biome.monsters.indexOf(m.id);
        if (on && i < 0) biome.monsters.push(m.id); else if (!on && i >= 0) biome.monsters.splice(i, 1);
        save();
    })));
    if (!(project.monsters || []).length) wrap.appendChild(el('div', { class: 'text-xs text-slate-500' }, 'Aucun monstre.'));
    return wrap;
}
// Checklist générique : coche des ids dans un tableau (objets, décor 3D…)
function listChecklist(arr, choices, idFn, labelFn) {
    const wrap = el('div', { class: 'grid grid-cols-2 gap-1 max-h-60 overflow-y-auto' });
    (choices || []).forEach(c => {
        const id = idFn(c);
        wrap.appendChild(_checkItem(labelFn(c), Array.isArray(arr) && arr.includes(id), (on) => {
            const i = arr.indexOf(id);
            if (on && i < 0) arr.push(id); else if (!on && i >= 0) arr.splice(i, 1);
            save();
        }));
    });
    if (!(choices || []).length) wrap.appendChild(el('div', { class: 'text-xs text-slate-500' }, '(aucun)'));
    return wrap;
}
function biomeChecklist(monster) {
    const wrap = el('div', { class: 'grid grid-cols-2 gap-1' });
    (project.biomes || []).forEach(b => {
        if (!Array.isArray(b.monsters)) b.monsters = [];
        wrap.appendChild(_checkItem(b.name || b.id, b.monsters.includes(monster.id), (on) => {
            const i = b.monsters.indexOf(monster.id);
            if (on && i < 0) b.monsters.push(monster.id); else if (!on && i >= 0) b.monsters.splice(i, 1);
            save();
        }));
    });
    if (!(project.biomes || []).length) wrap.appendChild(el('div', { class: 'text-xs text-slate-500' }, 'Aucun biome.'));
    return wrap;
}

// =====================================================================
//  ÉDITEURS STRUCTURÉS (zéro JSON : tout en listes/champs cliquables)
// =====================================================================
const STATUS_TYPES = ['burn', 'poison', 'bleed', 'freeze'];
const STATUS_LABELS = { burn: '🔥 Brûlure', poison: '☠ Poison', bleed: '🩸 Saignement', freeze: '❄ Givre' };
const _kvRow = (label, child) => el('label', { class: 'flex items-center gap-2 text-xs' }, [el('span', { class: 'w-24 text-slate-400 shrink-0' }, label), child]);
// Select avec libellés lisibles (valeur ≠ texte affiché)
function labeledSelect(val, options, commit) {
    const s = el('select', { class: 'glass-input px-2 py-1 rounded text-sm flex-1', onchange: e => commit(e.target.value) },
        options.map(o => el('option', { value: o.v }, o.t)));
    s.value = val ?? '';
    return s;
}

function statusWidget(obj, key) {
    let st = obj[key]; if (!st || typeof st !== 'object') st = obj[key] = { type: 'poison', dps: 4, duration: 4 };
    const types = (project.statusDefs && project.statusDefs.length)
        ? project.statusDefs.map(s => ({ v: s.type, t: (s.icon || '') + ' ' + (s.label || s.type) }))
        : STATUS_TYPES.map(t => ({ v: t, t: STATUS_LABELS[t] }));
    return el('div', { class: 'flex flex-col gap-1' }, [
        _kvRow('effet', labeledSelect(st.type, [{ v: '', t: '(aucun)' }, ...types], v => { st.type = v; save(); })),
        _kvRow('dégâts/s', numberInput(st.dps || 0, v => { st.dps = v; save(); }, 'dps')),
        _kvRow('durée (s)', numberInput(st.duration || 0, v => { st.duration = v; save(); }, 'duration'))
    ]);
}
function specialWidget(obj, key) {
    let sp = obj[key]; if (!sp || typeof sp !== 'object') sp = obj[key] = {};
    const numOpt = (k, label, hint) => _kvRow(label, numberInput(sp[k] || 0, v => { if (v) sp[k] = v; else delete sp[k]; save(); }, hint));
    return el('div', { class: 'flex flex-col gap-1' }, [
        numOpt('multishot', 'projectiles', 'count'),
        numOpt('spread', 'écart (cône)', 'spread'),
        numOpt('extraBounce', 'rebonds +', 'count'),
        _kvRow('explosion', boolInput(!!sp.explode, v => { if (v) sp.explode = true; else delete sp.explode; save(); }))
    ]);
}
function buffWidget(obj, key) {
    let b = obj[key]; if (!b || typeof b !== 'object') b = obj[key] = { stat: 'damage', amount: 5, duration: 20 };
    return el('div', { class: 'flex flex-col gap-1' }, [
        _kvRow('stat', selectInput(b.stat, STAT_KEYS, v => { b.stat = v; save(); })),
        _kvRow('valeur', numberInput(b.amount || 0, v => { b.amount = v; save(); }, 'amount')),
        _kvRow('durée (s)', numberInput(b.duration || 0, v => { b.duration = v; save(); }, 'duration'))
    ]);
}
function abilitiesWidget(obj) {
    if (!Array.isArray(obj.abilities)) obj.abilities = [];
    const wrap = el('div', { class: 'flex flex-col gap-2' });
    const redraw = () => {
        wrap.innerHTML = '';
        obj.abilities.forEach((ab, i) => {
            wrap.appendChild(el('div', { class: 'glass rounded p-2 flex flex-col gap-1' }, [
                _kvRow('type', labeledSelect(ab.id, [{ v: 'slam', t: 'Choc sismique' }, { v: 'summon', t: 'Invocation' }, { v: 'nova', t: 'Nova' }, { v: 'charge', t: 'Charge' }].concat(ab.id && !['slam', 'summon', 'nova', 'charge'].includes(ab.id) ? [{ v: ab.id, t: ab.id }] : []), v => { ab.id = v; save(); })),
                _kvRow('nom', textInput(ab.name, v => { ab.name = v; save(); })),
                _kvRow('cooldown', numberInput(ab.cooldown || 0, v => { ab.cooldown = v; save(); }, 'cooldown')),
                _kvRow('dégâts', numberInput(ab.damage || 0, v => { ab.damage = v; save(); }, 'damage')),
                _kvRow('portée', numberInput(ab.range || 0, v => { ab.range = v; save(); }, 'range')),
                _kvRow('nombre', numberInput(ab.count || 0, v => { ab.count = v; save(); }, 'count')),
                el('button', { class: 'btn btn-danger text-xs self-end', onclick: () => { obj.abilities.splice(i, 1); save(); redraw(); } }, '× retirer')
            ]));
        });
        wrap.appendChild(el('button', { class: 'btn btn-primary text-xs self-start', onclick: () => { obj.abilities.push({ id: 'slam', name: 'Nouvelle capacité', cooldown: 6, damage: 20, range: 4 }); save(); redraw(); } }, '+ capacité'));
    };
    redraw();
    return wrap;
}
// Éditeur clé→valeur générique (remplace tout JSON brut)
function kvWidget(obj, key) {
    let o = obj[key]; if (!o || typeof o !== 'object') o = obj[key] = {};
    const wrap = el('div', { class: 'flex flex-col gap-1' });
    const redraw = () => {
        wrap.innerHTML = '';
        Object.keys(o).forEach(k => {
            const v = o[k]; let input;
            if (typeof v === 'number') input = numberInput(v, nv => { o[k] = nv; save(); }, k);
            else if (typeof v === 'boolean') input = boolInput(v, nv => { o[k] = nv; save(); });
            else if (v && typeof v === 'object') input = el('span', { class: 'text-[10px] text-slate-500 flex-1' }, 'objet imbriqué');
            else input = textInput(v, nv => { o[k] = nv; save(); });
            wrap.appendChild(el('div', { class: 'flex items-center gap-2' }, [el('span', { class: 'w-24 text-xs text-slate-400' }, k), input, el('button', { class: 'text-red-400 text-xs px-1', onclick: () => { delete o[k]; save(); redraw(); } }, '×')]));
        });
        const ki = el('input', { class: 'glass-input px-2 py-1 rounded text-xs w-28', placeholder: 'clé' });
        const ty = el('select', { class: 'glass-input px-2 py-1 rounded text-xs' }, [el('option', { value: 'number' }, 'nombre'), el('option', { value: 'text' }, 'texte'), el('option', { value: 'boolean' }, 'oui/non')]);
        wrap.appendChild(el('div', { class: 'flex gap-1 items-center mt-1' }, [ki, ty, el('button', { class: 'btn text-xs', onclick: () => { const k = ki.value.trim(); if (!k || k in o) return; o[k] = ty.value === 'number' ? 0 : ty.value === 'boolean' ? false : ''; save(); redraw(); } }, '+ champ')]));
    };
    redraw();
    return wrap;
}

// --- Loot (array of {id, chance}) ---
function lootWidget(obj) {
    if (!Array.isArray(obj.loot)) obj.loot = [];
    const wrap = el('div', { class: 'flex flex-col gap-2' });
    const itemIds = (project.items || []).map(i => i.id);
    const redraw = () => {
        wrap.innerHTML = '';
        obj.loot.forEach((entry, i) => {
            const idSel = selectInput(entry.id, itemIds, v => { entry.id = v; save(); });
            idSel.className = 'glass-input flex-1 px-2 py-1 rounded text-sm';
            wrap.appendChild(el('div', { class: 'flex gap-2 items-center' }, [
                idSel,
                el('input', { type: 'number', step: '0.05', min: 0, max: 1, class: 'glass-input w-20 px-2 py-1 rounded text-sm', value: entry.chance, oninput: e => { entry.chance = parseFloat(e.target.value) || 0; save(); } }),
                el('button', { class: 'text-red-400 text-xs px-2', onclick: () => { obj.loot.splice(i, 1); save(); redraw(); } }, '×')
            ]));
        });
        wrap.appendChild(el('button', { class: 'btn text-xs self-start', onclick: () => { obj.loot.push({ id: itemIds[0] || '', chance: 0.2 }); save(); redraw(); } }, '+ drop'));
    };
    redraw();
    return wrap;
}

// --- LootTable (array of ids) ---
function lootTableWidget(obj) {
    if (!Array.isArray(obj.lootTable)) obj.lootTable = [];
    const wrap = el('div', { class: 'flex flex-col gap-2' });
    const itemIds = (project.items || []).map(i => i.id);
    const redraw = () => {
        wrap.innerHTML = '';
        const chips = el('div', { class: 'flex flex-wrap gap-1' });
        obj.lootTable.forEach((id, i) => chips.appendChild(el('span', { class: 'glass rounded px-2 py-1 text-xs flex items-center gap-1' }, [
            id, el('button', { class: 'text-red-400', onclick: () => { obj.lootTable.splice(i, 1); save(); redraw(); } }, '×')
        ])));
        wrap.appendChild(chips);
        const sel = el('select', { class: 'glass-input px-2 py-1 rounded text-xs self-start' }, [el('option', { value: '' }, '+ ajouter...'), ...itemIds.map(id => el('option', { value: id }, id))]);
        sel.addEventListener('change', () => { if (sel.value) { obj.lootTable.push(sel.value); save(); redraw(); } });
        wrap.appendChild(sel);
    };
    redraw();
    return wrap;
}

// =====================================================================
//  WIDGET SPRITE (le coeur du studio)
// =====================================================================
function toSpec(sprite) {
    if (!sprite) return { type: 'image', src: '' };
    if (typeof sprite === 'string') return { type: 'image', src: sprite };
    return clone(sprite);
}

// Champ TEXTURE (sol/mur/plafond, env) : aperçu + Importer (IDB) + Bibliothèque
function textureWidget(obj, key) {
    const idbKey = () => 'tex:' + (obj.id || 'env') + ':' + key;
    const wrap = el('div', { class: 'flex items-center gap-2' });
    const setThumb = async (thumb, cur) => {
        if (!cur) {
            thumb.appendChild(el('span', { class: 'text-[8px] text-slate-400' }, '-'));
            return;
        }
        const img = el('img', { class: 'pixelated', style: 'width:100%;height:100%;object-fit:cover' });
        thumb.appendChild(img);
        try {
            const src = await _thumbSrc(cur);
            if (src) img.src = src;
            else {
                thumb.innerHTML = '';
                thumb.appendChild(el('span', { class: 'text-[8px] text-red-300 text-center px-1' }, 'asset perdu'));
            }
        } catch (e) {
            thumb.innerHTML = '';
            thumb.appendChild(el('span', { class: 'text-[8px] text-red-300 text-center px-1' }, 'erreur'));
        }
    };
    const render = () => {
        const cur = obj[key] || '';
        wrap.innerHTML = '';
        const thumb = el('div', { class: 'w-12 h-12 bg-black/40 rounded border border-white/10 flex items-center justify-center overflow-hidden shrink-0' });
        setThumb(thumb, cur);
        const storeTex = async (url, name, currentRef = obj[key]) => {
            obj[key] = await storeAsset({ currentRef, dataURL: url, category: 'textures', id: (obj.id || 'env'), field: key, fallbackKey: idbKey(), name });
            save();
        };
        const fileIn = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
        fileIn.addEventListener('change', async e => {
            const f = e.target.files[0]; if (!f) return;
            await storeTex(await fileToTextureTile(f), f.name);
            render(); setStatus('Texture importée ✓');
        });
        const editTex = async () => {
            const originalRef = obj[key];
            const src = await _thumbSrc(obj[key]);
            if (!src) return;
            const spec = { type: 'image', src };
            openImageEditor(spec, async () => {
                await storeTex(spec.src, 'texture éditée', originalRef);
                render(); setStatus('Texture éditée ✓');
            });
        };
        wrap.append(thumb, fileIn, el('div', { class: 'flex flex-col gap-1' }, [
            el('div', { class: 'flex gap-1' }, [
                el('button', { class: 'btn btn-primary text-xs', onclick: () => fileIn.click() }, '📁 Importer'),
                el('button', { class: 'btn text-xs', onclick: () => openAssetLibrary('images', p => { idbDelete(idbKey()).catch(() => { }); obj[key] = p; save(); render(); }) }, '🗂 Bibliothèque')
            ]),
            el('div', { class: 'flex gap-1' }, [
                cur ? el('button', { class: 'btn text-xs', onclick: editTex }, '✂ Éditer') : el('span'),
                cur ? restoreDefaultButton(() => obj[key], () => render()) : el('span'),
                cur ? el('button', { class: 'btn btn-danger text-xs', onclick: () => { idbDelete(idbKey()).catch(() => { }); obj[key] = ''; save(); render(); } }, 'Retirer')
                    : el('span', { class: 'text-[9px] text-slate-500' }, 'vide = défaut du jeu')
            ])
        ]));
    };
    render();
    return wrap;
}

// Champ MODÈLE 3D (objet/coffre) : importer GLB ou choisir dans la bibliothèque
function modelWidget(obj, key) {
    const idbKey = () => 'objmodel:' + (obj.id || 'o') + ':' + key;
    const wrap = el('div', {});
    const render = () => {
        const cur = obj[key] || ''; const has = !!(cur && String(cur).trim());
        wrap.innerHTML = '';
        const fileIn = el('input', { type: 'file', accept: '.glb,.gltf,model/gltf-binary,model/gltf+json', class: 'hidden' });
        fileIn.addEventListener('change', async () => {
            const f = fileIn.files[0]; if (!f) return;
            const url = await fileToDataURL(f);
            const ext = (f.name.split('.').pop() || 'glb').toLowerCase();
            obj[key] = await storeAsset({ currentRef: obj[key], dataURL: url, category: 'models', id: (obj.id || 'o'), field: key, fallbackKey: idbKey(), name: f.name, ext, libCategory: 'models' });
            save(); render(); setStatus('Modèle 3D importé ✓');
        });
        wrap.append(fileIn, el('div', { class: 'flex items-center gap-2 flex-wrap' }, [
            el('span', { class: 'text-xs ' + (has ? 'text-emerald-400' : 'text-slate-500') }, has ? '● modèle 3D' : '○ (sprite par défaut)'),
            el('button', { class: 'btn btn-primary text-xs', onclick: () => fileIn.click() }, '📁 Importer .glb'),
            el('button', { class: 'btn text-xs', onclick: () => openAssetLibrary('models', p => { idbDelete(idbKey()).catch(() => { }); obj[key] = p; save(); render(); }) }, '🗂 Bibliothèque'),
            has ? restoreDefaultButton(() => obj[key], () => render()) : el('span'),
            has ? el('button', { class: 'btn btn-danger text-xs', onclick: () => { idbDelete(idbKey()).catch(() => { }); obj[key] = ''; save(); render(); } }, 'Retirer') : el('span')
        ]));
    };
    render();
    return wrap;
}

function spriteWidget(obj, key = 'sprite') {
    let spec = toSpec(obj[key]);
    const idbKey = () => 'sprite:' + currentTab + ':' + (obj.id || obj.type || 'entry') + ':' + key;
    const writeBack = () => { obj[key] = spec; save(); };
    // Ecrit l'image sur disque (ou repli navigateur). currentRef donne le fichier
    // a ecraser : si absent/base64, un nouveau chemin custom est cree (= defaut).
    const storeImage = async (url, name, currentRef = spec.src) => {
        spec.src = await storeAsset({
            currentRef, dataURL: url,
            category: currentTab, id: (obj.id || obj.type || 'entry'), field: key,
            fallbackKey: idbKey(), name
        });
        writeBack();
    };

    const wrap = el('div', { class: 'flex flex-col gap-3' });

    const render = () => {
        wrap.innerHTML = '';

        // Aperçu anime
        const previewCanvas = el('canvas', { class: 'pixelated bg-black/40 rounded border border-white/10', width: 96, height: 96, style: 'width:96px;height:96px' });
        const stateSel = el('select', { class: 'glass-input px-2 py-1 rounded text-xs' });
        const states = spec.type === 'sheet' ? Object.keys(spec.anims || { idle: 1 }) : ['idle'];
        states.forEach(s => stateSel.appendChild(el('option', { value: s }, s)));
        const preview = startPreview(previewCanvas, spec, () => stateSel.value);
        activePreviews.push(preview);
        stateSel.addEventListener('change', () => preview.setState(stateSel.value));

        const left = el('div', { class: 'flex flex-col items-center gap-1' }, [previewCanvas, stateSel]);

        // Controles
        const right = el('div', { class: 'flex-1 flex flex-col gap-2' });

        // import + mode
        const fileIn = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
        fileIn.addEventListener('change', async e => {
            const f = e.target.files[0]; if (!f) return;
            await storeImage(await fileToDataURL(f), f.name);
            render();
        });
        const modeSel = selectInput(spec.type, ['image', 'sheet'], v => {
            spec.type = v;
            if (v === 'sheet' && !spec.cols) { spec.cols = 4; spec.rows = 4; spec.fps = 8; }
            if (v === 'sheet' && !spec.anims) spec.anims = defaultAnims(spec.rows);
            writeBack(); render();
        });
        modeSel.className = 'glass-input px-2 py-1 rounded text-xs';

        right.appendChild(el('div', { class: 'flex gap-2 items-center flex-wrap' }, [
            el('button', { class: 'btn btn-primary text-xs', onclick: () => fileIn.click() }, '📁 Importer image'),
            el('button', { class: 'btn text-xs', onclick: () => openAssetLibrary('images', p => { spec.src = p; writeBack(); render(); }) }, '🗂 Bibliothèque'),
            fileIn,
            el('span', { class: 'text-xs text-slate-400' }, 'mode'),
            modeSel,
            el('button', { class: 'btn text-xs ' + (spec.src ? '' : 'opacity-40 pointer-events-none'), onclick: async () => {
                const originalRef = spec.src;                       // fichier a ecraser (chemin d'origine)
                const source = await _thumbSrc(spec.src);
                if (!source) return;
                const editSpec = { ...spec, src: source };
                openImageEditor(editSpec, async () => {
                    await storeImage(editSpec.src, 'sprite édité', originalRef);
                    spec = { ...editSpec, src: spec.src };
                    writeBack();
                    render();
                });
            } }, '✂ Éditer l\'image'),
            restoreDefaultButton(() => spec.src, () => render()),
            el('button', { class: 'btn btn-danger text-xs', onclick: () => { idbDelete(idbKey()).catch(() => { }); spec = { type: 'image', src: '' }; writeBack(); render(); } }, 'Retirer')
        ]));

        right.appendChild(el('div', { class: 'text-[10px] text-slate-500' }, spec.src ? (spec.src.startsWith('data:') ? 'image embarquée (base64)' : spec.src) : 'aucune image'));
        if (currentTab === 'spells' && key === 'fx') {
            right.appendChild(el('div', { class: 'text-[10px] text-amber-300/80' }, 'Sprite joué à l impact. Il reste séparé du visuel du projectile.'));
        }
        if (currentTab === 'spells' && key === 'projectileSprite') {
            right.appendChild(el('div', { class: 'text-[10px] text-amber-300/80' }, 'Active "utiliser un sprite projectile" pour remplacer la boule par cette image ou spritesheet. Les collisions restent identiques.'));
        }
        if (key === 'projectileSprite') {
            right.appendChild(projectilePreviewWidget(obj, spec));
        }

        // grille spritesheet
        if (spec.type === 'sheet') {
            const numF = (k, label, min) => el('label', { class: 'flex items-center gap-1 text-xs' }, [label,
                el('input', { type: 'number', min: min ?? 1, class: 'glass-input w-16 px-2 py-1 rounded', value: spec[k], oninput: e => { spec[k] = parseInt(e.target.value) || 1; writeBack(); preview.refresh(spec); } })]);
            right.appendChild(el('div', { class: 'flex gap-3 flex-wrap' }, [numF('cols', 'cols'), numF('rows', 'rows'), numF('fps', 'fps')]));
            right.appendChild(animsEditor(spec, () => { writeBack(); }));
        }

        wrap.appendChild(el('div', { class: 'flex gap-4' }, [left, right]));
    };

    render();
    return wrap;
}

function projectilePreviewWidget(obj, spec) {
    const clampStep = v => Math.max(-180, Math.min(180, Math.round((parseFloat(v) || 0) / 10) * 10));
    const defaultLayout = currentTab === 'items' ? 'horizontal' : 'vertical';
    let layout = obj.projectileSpriteLayout || defaultLayout;
    const sourceRot = obj.projectileSpriteRotation || { x: 0, y: 0, z: obj.projectileSpriteAngle || 0 };
    const rot = { x: clampStep(sourceRot.x), y: clampStep(sourceRot.y), z: clampStep(sourceRot.z) };
    let volume = ['flat', 'cross', 'radial'].includes(obj.projectileSpriteVolume) ? obj.projectileSpriteVolume : 'cross';
    let currentSrc = '';
    const volumeAngles = (mode) => mode === 'radial' ? [0, 45, 90, 135] : mode === 'cross' ? [0, 90] : [0];
    const previewRoot = el('div', { class: 'relative w-32 h-32', style: 'transform-style:preserve-3d' });
    const buildPlanes = () => {
        previewRoot.replaceChildren(...volumeAngles(volume).map(deg => {
            const plane = el('img', {
                class: 'pixelated absolute inset-0 m-auto' + (deg ? ' opacity-70' : ''),
                style: [
                    'max-width:110px',
                    'max-height:110px',
                    'object-fit:contain',
                    'transform-style:preserve-3d',
                    `transform:rotateY(${deg}deg)`
                ].join(';')
            });
            if (currentSrc) plane.src = currentSrc;
            return plane;
        }));
    };
    const label = el('div', { class: 'text-[10px] text-slate-400' }, '');
    const applyTransform = () => {
        previewRoot.style.transform = `rotateX(${(layout === 'horizontal' ? 68 : 0) + rot.x}deg) rotateY(${rot.y}deg) rotateZ(${rot.z}deg)`;
        label.textContent = `${layout} · ${volume} · X ${rot.x} · Y ${rot.y} · Z ${rot.z}`;
    };
    const commitRotation = () => {
        obj.projectileSpriteLayout = layout;
        obj.projectileSpriteRotation = { x: rot.x, y: rot.y, z: rot.z };
        obj.projectileSpriteVolume = volume;
        delete obj.projectileSpriteAngle;
        save();
        applyTransform();
    };
    const axisRow = (axis) => {
        const num = el('input', { type: 'number', min: -180, max: 180, step: 10, class: 'glass-input w-20 px-2 py-1 rounded text-sm', value: rot[axis] });
        const range = el('input', { type: 'range', min: -180, max: 180, step: 10, value: rot[axis], class: 'flex-1 accent-cyan-400' });
        const apply = v => {
            rot[axis] = clampStep(v);
            num.value = rot[axis];
            range.value = rot[axis];
            commitRotation();
        };
        range.addEventListener('input', () => apply(range.value));
        num.addEventListener('change', () => apply(num.value));
        return el('label', { class: 'flex items-center gap-3 text-xs' }, [
            el('span', { class: 'w-4 text-cyan-300 font-bold' }, axis.toUpperCase()),
            range,
            num
        ]);
    };
    const layoutSel = selectInput(layout, ['vertical', 'horizontal'], v => {
        layout = v;
        commitRotation();
    });
    layoutSel.className = 'glass-input px-2 py-1 rounded text-xs';
    const volumeLabels = { flat: 'plat', cross: 'miroir 90°', radial: 'radial 45°' };
    const volumeSel = el('select', {
        class: 'glass-input px-2 py-1 rounded text-xs',
        onchange: e => { volume = e.target.value; buildPlanes(); commitRotation(); }
    }, ['flat', 'cross', 'radial'].map(m => el('option', { value: m }, volumeLabels[m])));
    volumeSel.value = volume;
    const stage = el('div', {
        class: 'relative h-36 rounded border border-white/10 bg-black/40 flex items-center justify-center overflow-hidden',
        style: 'perspective:420px'
    }, [
        el('div', { class: 'absolute left-5 right-5 top-1/2 h-px bg-cyan-300/30' }),
        el('div', { class: 'absolute right-5 top-1/2 -mt-1 w-0 h-0 border-y-4 border-y-transparent border-l-8 border-l-cyan-300/50' }),
        previewRoot
    ]);
    const box = el('div', { class: 'glass rounded p-2 flex flex-col gap-2' }, [
        el('div', { class: 'text-[10px] uppercase text-cyan-300/70' }, 'aperçu intégré'),
        el('label', { class: 'flex items-center gap-2 text-xs text-slate-400' }, ['orientation', layoutSel]),
        el('label', { class: 'flex items-center gap-2 text-xs text-slate-400' }, ['volume', volumeSel]),
        axisRow('x'),
        axisRow('y'),
        axisRow('z'),
        stage,
        label
    ]);
    buildPlanes();
    applyTransform();
    _thumbSrc(spec && spec.src).then(src => {
        if (src) {
            currentSrc = src;
            previewRoot.querySelectorAll('img').forEach(im => { im.src = src; });
        }
    });
    return box;
}

function defaultAnims(rows) {
    const a = { idle: { row: 0, frames: 4, fps: 6, loop: true } };
    if (rows > 1) a.walk = { row: 1, frames: 4, fps: 10, loop: true };
    if (rows > 2) a.attack = { row: 2, frames: 4, fps: 12, loop: false };
    if (rows > 3) a.death = { row: 3, frames: 4, fps: 8, loop: false };
    return a;
}

function animsEditor(spec, commit) {
    if (!spec.anims) spec.anims = {};
    const box = el('div', { class: 'glass rounded p-2 flex flex-col gap-2' });
    const redraw = () => {
        box.innerHTML = '';
        box.appendChild(el('div', { class: 'text-[10px] uppercase text-cyan-300/70' }, 'animations (état → ligne)'));
        ['idle', 'walk', 'attack', 'death'].forEach(name => {
            const on = !!spec.anims[name];
            const cb = el('input', { type: 'checkbox', class: 'w-4 h-4' });
            cb.checked = on;
            cb.addEventListener('change', () => {
                if (cb.checked) spec.anims[name] = { row: 0, frames: spec.cols || 4, fps: spec.fps || 8, loop: name !== 'attack' && name !== 'death' };
                else delete spec.anims[name];
                commit(); redraw();
            });
            const row = el('div', { class: 'flex items-center gap-2 text-xs' }, [cb, el('span', { class: 'w-14' }, name)]);
            if (on) {
                const a = spec.anims[name];
                const f = (k, lbl, w) => el('label', { class: 'flex items-center gap-1' }, [lbl,
                    el('input', { type: 'number', class: 'glass-input px-1 py-0.5 rounded ' + (w || 'w-12'), value: a[k], oninput: e => { a[k] = parseInt(e.target.value) || 0; commit(); } })]);
                row.append(f('row', 'ligne'), f('frames', 'img'), f('fps', 'fps'));
                const loopCb = el('input', { type: 'checkbox', class: 'w-4 h-4' }); loopCb.checked = a.loop !== false;
                loopCb.addEventListener('change', () => { a.loop = loopCb.checked; commit(); });
                row.append(el('label', { class: 'flex items-center gap-1' }, ['boucle', loopCb]));
            }
            box.appendChild(row);
        });
    };
    redraw();
    return box;
}

// =====================================================================
//  PREVIEW ANIMEE (canvas 2D, independant de Three.js)
// =====================================================================
function startPreview(canvas, spec, getState) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    let img = null, cols = 1, rows = 1, anims = { idle: { row: 0, frames: 1, fps: 1 } };
    let state = getState ? getState() : 'idle';
    let frame = 0, timer = 0, last = performance.now(), raf = null, stopped = false;

    function apply(s) {
        cols = s.type === 'sheet' ? (s.cols || 1) : 1;
        rows = s.type === 'sheet' ? (s.rows || 1) : 1;
        anims = s.type === 'sheet' ? (s.anims || { idle: { row: 0, frames: cols, fps: s.fps || 8, loop: true } }) : { idle: { row: 0, frames: 1, fps: 1, loop: true } };
        if (s.src) {
            const wanted = s.src;
            _thumbSrc(wanted).then(src => {
                if (stopped || wanted !== s.src || !src) return;
                const im = new Image();
                im.onload = () => img = im;
                im.src = src;
            }).catch(() => { img = null; });
        } else img = null;
    }
    apply(spec);

    function loop(now) {
        if (stopped) return;
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        const a = anims[state] || anims.idle || Object.values(anims)[0];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#0c0c10'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (img && a) {
            const fw = img.width / cols, fh = img.height / rows;
            const frames = a.frames || 1, fps = a.fps || 8;
            timer += dt;
            if (frames > 1) {
                while (timer >= 1 / fps) { timer -= 1 / fps; frame++; if (frame >= frames) frame = (a.loop === false) ? frames - 1 : 0; }
            } else frame = 0;
            const sx = (Math.min(frame, frames - 1)) * fw;
            const sy = (a.row || 0) * fh;
            // contain dans le canvas
            const scale = Math.min(canvas.width / fw, canvas.height / fh);
            const dw = fw * scale, dh = fh * scale;
            ctx.drawImage(img, sx, sy, fw, fh, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
        } else {
            ctx.fillStyle = '#334'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
            ctx.fillText('no img', canvas.width / 2, canvas.height / 2);
        }
        raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return {
        setState(s) { state = s; frame = 0; timer = 0; },
        refresh(s) { apply(s); frame = 0; },
        stop() { stopped = true; if (raf) cancelAnimationFrame(raf); }
    };
}

// =====================================================================
//  EDITEUR D'IMAGE (rogner / redim / ratio / chroma / trim)
// =====================================================================
// =====================================================================
//  ÉDITEUR D'IMAGE - moteur sprite complet (détourage silhouette fond noir,
//  gomme manuelle zone/pinceau, contour, recadrage, transparence, resize).
//  Contrat inchangé : openImageEditor(spec, onDone) écrit le PNG édité dans
//  spec.src puis appelle onDone() à la validation.
// =====================================================================
function openImageEditor(spec, onDone) {
    const root = document.getElementById('modal-root');

    const state = {
        img: null,                  // HTMLImageElement de la base courante
        erased: new Set(),          // pixels effacés à la main (index dans la base)
        history: [],                // piles annuler / rétablir (lots de pixels)
        redo: [],
        settings: { silhouette: false, tolerance: 25, outline: false, thickness: 2, crop: false, padding: 2 },
        eraserMode: 'flood',        // 'flood' = zone noire fermée, 'brush' = gomme libre
        eraserRadius: 3,
        result: null,               // canvas résultat (sortie validée)
        offsetX: 0, offsetY: 0,     // décalage de recadrage auto (result -> base)
        zoomSrc: 1, zoomRes: 1,
        cropMode: false, picking: false, crop: null, pickedColor: null
    };

    // --- Canvas source (interactif : gomme, pipette, rognage) ---
    const srcCanvas = el('canvas', { class: 'pixelated border border-white/15 bg-black/40', style: 'cursor:crosshair' });
    const srcCtx = srcCanvas.getContext('2d');
    const srcInfo = el('div', { class: 'text-xs text-slate-400 text-center' }, '');
    // --- Canvas résultat (aperçu transparent, gommable aussi) ---
    const resCanvas = el('canvas', { class: 'pixelated border border-cyan-400/40 bg-black/40', style: 'cursor:crosshair' });
    const resCtx = resCanvas.getContext('2d');
    const resInfo = el('div', { class: 'text-xs text-slate-400 text-center' }, '');
    const info = el('div', { class: 'text-xs text-amber-300/80 text-center min-h-[1em]' }, '');

    const wIn = el('input', { type: 'number', class: 'glass-input w-20 px-2 py-1 rounded text-sm' });
    const hIn = el('input', { type: 'number', class: 'glass-input w-20 px-2 py-1 rounded text-sm' });
    const pixelCb = el('input', { type: 'checkbox', class: 'w-4 h-4' }); pixelCb.checked = true;
    const chromaTol = el('input', { type: 'range', min: 0, max: 120, value: 30, class: 'flex-1' });

    const damier = (c, W, H) => { const cs = 8; for (let y = 0; y < H; y += cs) for (let x = 0; x < W; x += cs) { c.fillStyle = ((x / cs + y / cs) % 2) ? '#1a1a22' : '#11111a'; c.fillRect(x, y, cs, cs); } };

    function renderSrc() {
        const img = state.img; if (!img || !img.width) return;
        const Z = state.zoomSrc;
        srcCanvas.width = img.width * Z; srcCanvas.height = img.height * Z;
        srcCtx.imageSmoothingEnabled = false;
        damier(srcCtx, srcCanvas.width, srcCanvas.height);
        srcCtx.drawImage(img, 0, 0, srcCanvas.width, srcCanvas.height);
        if (state.erased.size) {
            srcCtx.fillStyle = 'rgba(255,0,0,0.5)';
            for (const idx of state.erased) { const x = idx % img.width, y = Math.floor(idx / img.width); srcCtx.fillRect(x * Z, y * Z, Z, Z); }
        }
        if (state.crop) { srcCtx.strokeStyle = '#4deeea'; srcCtx.lineWidth = 2; srcCtx.strokeRect(state.crop.x * Z, state.crop.y * Z, state.crop.w * Z, state.crop.h * Z); }
        srcInfo.innerText = `Source ${img.width} × ${img.height} px - ×${Z}`;
    }

    function renderResult() {
        const rc = state.result; if (!rc) return;
        const Z = Math.max(1, Math.min(8, Math.floor(360 / Math.max(rc.width, rc.height)))) || 1;
        state.zoomRes = Z;
        resCanvas.width = rc.width * Z; resCanvas.height = rc.height * Z;
        resCtx.imageSmoothingEnabled = false;
        damier(resCtx, resCanvas.width, resCanvas.height);
        resCtx.drawImage(rc, 0, 0, resCanvas.width, resCanvas.height);
        resInfo.innerText = `Résultat ${rc.width} × ${rc.height} px`;
    }

    // Recalcule le canvas résultat depuis la base + réglages + effacements
    let rafPending = false;
    function scheduleProcess() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; processImage(); }); }
    function processImage() {
        const img = state.img; if (!img || !img.width) return;
        const w = img.width, h = img.height;
        const sc = newCanvas(w, h); const sctx = sc.getContext('2d'); sctx.imageSmoothingEnabled = false;
        sctx.drawImage(img, 0, 0);
        const data = sctx.getImageData(0, 0, w, h).data;
        const tol = state.settings.tolerance;

        // Fond connecté (flood-fill depuis les bords) uniquement si détourage actif
        const isBackground = new Uint8Array(w * h);
        if (state.settings.silhouette) {
            const isDark = new Uint8Array(w * h);
            for (let i = 0; i < w * h; i++) { const p = i * 4; if (data[p + 3] > 8 && data[p] <= tol && data[p + 1] <= tol && data[p + 2] <= tol) isDark[i] = 1; }
            const q = [];
            for (let x = 0; x < w; x++) { if (isDark[x]) q.push(x); const b = (h - 1) * w + x; if (isDark[b]) q.push(b); }
            for (let y = 0; y < h; y++) { const l = y * w; if (isDark[l]) q.push(l); const r = y * w + (w - 1); if (isDark[r]) q.push(r); }
            let head = 0;
            while (head < q.length) {
                const p = q[head++]; if (isBackground[p]) continue; isBackground[p] = 1;
                const x = p % w, y = (p - x) / w;
                if (x > 0 && isDark[p - 1] && !isBackground[p - 1]) q.push(p - 1);
                if (x < w - 1 && isDark[p + 1] && !isBackground[p + 1]) q.push(p + 1);
                if (y > 0 && isDark[p - w] && !isBackground[p - w]) q.push(p - w);
                if (y < h - 1 && isDark[p + w] && !isBackground[p + w]) q.push(p + w);
            }
        }

        // Masque alpha : fond + pixels effacés + transparence d'origine = transparent
        const alpha = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
            if (state.erased.has(i) || isBackground[i]) { alpha[i] = 0; continue; }
            alpha[i] = data[i * 4 + 3] > 8 ? 255 : 0;
        }

        // Contour noir (dilatation) - seulement avec le détourage
        let finalMask = alpha;
        if (state.settings.silhouette && state.settings.outline && state.settings.thickness > 0) {
            finalMask = dilateMask(alpha, w, h, state.settings.thickness);
        }

        // Recadrage auto optionnel (sur le contenu visible)
        let rw = w, rh = h, ox = 0, oy = 0;
        if (state.settings.crop) {
            let minX = w, minY = h, maxX = -1, maxY = -1;
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (finalMask[y * w + x]) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; } }
            if (maxX < 0) { state.offsetX = 0; state.offsetY = 0; state.result = newCanvas(1, 1); renderResult(); return; }
            const pad = state.settings.padding;
            ox = Math.max(0, minX - pad); oy = Math.max(0, minY - pad);
            rw = Math.min(w, maxX + 1 + pad) - ox; rh = Math.min(h, maxY + 1 + pad) - oy;
        }
        state.offsetX = ox; state.offsetY = oy;

        const rc = newCanvas(rw, rh); const rctx = rc.getContext('2d');
        const rid = rctx.createImageData(rw, rh); const rd = rid.data;
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
            const sx = x + ox, sy = y + oy, si = sy * w + sx, di = (y * rw + x) * 4;
            const isOutline = finalMask[si] && !alpha[si];
            if (isOutline) { rd[di] = 0; rd[di + 1] = 0; rd[di + 2] = 0; rd[di + 3] = 255; }
            else if (alpha[si]) { const p = si * 4; rd[di] = data[p]; rd[di + 1] = data[p + 1]; rd[di + 2] = data[p + 2]; rd[di + 3] = data[p + 3]; }
            else rd[di + 3] = 0;
        }
        rctx.putImageData(rid, 0, 0);
        state.result = rc; renderResult();
    }

    // Charge une nouvelle image de base (réinitialise les effacements/historique)
    function setBase(src) {
        loadImage(src).then(img => {
            state.img = img; state.erased.clear(); state.history.length = 0; state.redo.length = 0;
            state.crop = null; state.cropMode = false; state.picking = false;
            state.zoomSrc = Math.max(1, Math.min(8, Math.floor(360 / Math.max(img.width, img.height)))) || 1;
            wIn.value = img.width; hIn.value = img.height;
            updateUndoRedo(); syncTouchAction();
            renderSrc(); processImage();
        });
    }

    // ---- Effacement manuel (zone noire / gomme) ----
    function floodErase(startX, startY, tolerance) {
        const img = state.img, w = img.width, h = img.height;
        const sc = newCanvas(w, h); const sctx = sc.getContext('2d'); sctx.drawImage(img, 0, 0);
        const data = sctx.getImageData(0, 0, w, h).data;
        const si = (startY * w + startX) * 4;
        if (data[si] > tolerance || data[si + 1] > tolerance || data[si + 2] > tolerance) return [];
        const visited = new Set(); const q = [[startX, startY]]; const out = [];
        while (q.length) {
            const [x, y] = q.shift(); const idx = y * w + x;
            if (visited.has(idx) || state.erased.has(idx)) continue;
            const p = idx * 4;
            if (data[p] <= tolerance && data[p + 1] <= tolerance && data[p + 2] <= tolerance) {
                visited.add(idx); state.erased.add(idx); out.push(idx);
                if (x > 0) q.push([x - 1, y]); if (x < w - 1) q.push([x + 1, y]);
                if (y > 0) q.push([x, y - 1]); if (y < h - 1) q.push([x, y + 1]);
            }
        }
        return out;
    }

    function commit(batch) { if (!batch.length) return; state.history.push(batch); state.redo.length = 0; updateUndoRedo(); }
    function updateUndoRedo() { undoBtn.disabled = state.history.length === 0; redoBtn.disabled = state.redo.length === 0; }
    function undo() {
        if (!state.history.length) return; const b = state.history.pop();
        for (const i of b) state.erased.delete(i); state.redo.push(b);
        updateUndoRedo(); renderSrc(); processImage(); info.innerText = 'Action annulée';
    }
    function redo() {
        if (!state.redo.length) return; const b = state.redo.pop();
        for (const i of b) state.erased.add(i); state.history.push(b);
        updateUndoRedo(); renderSrc(); processImage(); info.innerText = 'Action rétablie';
    }

    function liveResultFeedback(pixels) {
        const rc = state.result; if (!rc) return; const Z = state.zoomRes;
        resCtx.fillStyle = 'rgba(255,0,0,0.6)'; const w = state.img.width;
        for (const idx of pixels) {
            const rx = (idx % w) - state.offsetX, ry = Math.floor(idx / w) - state.offsetY;
            if (rx >= 0 && ry >= 0 && rx < rc.width && ry < rc.height) resCtx.fillRect(rx * Z, ry * Z, Z, Z);
        }
    }

    // Attache gomme/zone à un canvas. toImg(e) -> {x,y} en coords image de base.
    function attachErase(canvas, toImg, opts = {}) {
        let painting = false, stroke = [];
        const brushAt = (e) => {
            const pt = toImg(e); if (!pt) return;
            const img = state.img, rad = state.eraserRadius, added = [];
            for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
                if (dx * dx + dy * dy > rad * rad) continue;
                const x = pt.x + dx, y = pt.y + dy;
                if (x < 0 || x >= img.width || y < 0 || y >= img.height) continue;
                const idx = y * img.width + x;
                if (!state.erased.has(idx)) { state.erased.add(idx); stroke.push(idx); added.push(idx); }
            }
            if (added.length) { renderSrc(); liveResultFeedback(added); }
        };
        canvas.addEventListener('pointerdown', e => {
            if (opts.allowCrop && (state.cropMode || state.picking)) return;   // laissé au handler crop/pick
            if (state.eraserMode === 'brush') { painting = true; stroke = []; try { canvas.setPointerCapture(e.pointerId); } catch (_) { } brushAt(e); e.preventDefault(); }
        });
        canvas.addEventListener('pointermove', e => { if (painting) { brushAt(e); e.preventDefault(); } });
        const end = () => {
            if (!painting) return; painting = false;
            if (stroke.length) { state.history.push(stroke); state.redo.length = 0; updateUndoRedo(); processImage(); info.innerText = `${stroke.length} pixel(s) effacé(s)`; }
            stroke = [];
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('pointerleave', end);
        canvas.addEventListener('click', e => {
            if (state.suppressClick) { state.suppressClick = false; return; }
            if (opts.allowCrop && (state.cropMode || state.picking)) return;
            if (state.eraserMode !== 'flood') return;
            const pt = toImg(e); if (!pt) return;
            const erased = floodErase(pt.x, pt.y, state.settings.tolerance);
            if (erased.length) { commit(erased); renderSrc(); processImage(); info.innerText = `${erased.length} pixel(s) effacé(s)`; }
        });
    }

    const toImgSrc = (e) => { const r = srcCanvas.getBoundingClientRect(); const x = Math.floor((e.clientX - r.left) / state.zoomSrc), y = Math.floor((e.clientY - r.top) / state.zoomSrc); return (x < 0 || x >= state.img.width || y < 0 || y >= state.img.height) ? null : { x, y }; };
    const toImgRes = (e) => { const rc = state.result; if (!rc) return null; const r = resCanvas.getBoundingClientRect(); if (!r.width) return null; const x = Math.floor((e.clientX - r.left) / state.zoomRes) + state.offsetX, y = Math.floor((e.clientY - r.top) / state.zoomRes) + state.offsetY; return (x < 0 || x >= state.img.width || y < 0 || y >= state.img.height) ? null : { x, y }; };
    attachErase(srcCanvas, toImgSrc, { allowCrop: true });
    attachErase(resCanvas, toImgRes);

    // ---- Rognage manuel / pipette (sur le canvas source) ----
    let dragging = false, dragStart = null;
    const syncTouchAction = () => { srcCanvas.style.touchAction = (state.cropMode || state.picking || state.eraserMode === 'brush') ? 'none' : 'auto'; };
    srcCanvas.addEventListener('pointerdown', e => {
        if (!(state.cropMode || state.picking)) return;
        e.preventDefault();
        const pt = toImgSrc(e); if (!pt) return;
        if (state.picking) {
            const px = Math.min(srcCanvas.width - 1, pt.x * state.zoomSrc), py = Math.min(srcCanvas.height - 1, pt.y * state.zoomSrc);
            const d = srcCtx.getImageData(px, py, 1, 1).data;
            state.pickedColor = [d[0], d[1], d[2]]; state.picking = false; state.suppressClick = true; syncTouchAction();
            info.innerText = `Couleur choisie rgb(${state.pickedColor.join(',')})`; return;
        }
        dragging = true; dragStart = pt; state.crop = { x: pt.x, y: pt.y, w: 0, h: 0 };
        try { srcCanvas.setPointerCapture(e.pointerId); } catch (_) { }
    });
    srcCanvas.addEventListener('pointermove', e => {
        if (!dragging) return; e.preventDefault();
        const pt = toImgSrc(e) || { x: dragStart.x, y: dragStart.y };
        state.crop = { x: Math.min(dragStart.x, pt.x), y: Math.min(dragStart.y, pt.y), w: Math.abs(pt.x - dragStart.x), h: Math.abs(pt.y - dragStart.y) };
        renderSrc();
    });
    const endCrop = () => { dragging = false; };
    srcCanvas.addEventListener('pointerup', endCrop);
    srcCanvas.addEventListener('pointercancel', endCrop);

    // ---- UI ----
    const btn = (label, cls, fn) => el('button', { class: 'btn text-xs ' + (cls || ''), onclick: fn }, label);

    // Détourage silhouette
    const silhouetteCb = el('input', { type: 'checkbox', class: 'w-4 h-4' });
    const tolRange = el('input', { type: 'range', min: 0, max: 80, value: state.settings.tolerance, class: 'flex-1' });
    const tolVal = el('span', { class: 'text-cyan-400 text-xs w-6 text-right' }, String(state.settings.tolerance));
    const outlineCb = el('input', { type: 'checkbox', class: 'w-4 h-4' });
    const thickRange = el('input', { type: 'range', min: 1, max: 10, value: state.settings.thickness, class: 'flex-1' });
    const thickVal = el('span', { class: 'text-cyan-400 text-xs w-8 text-right' }, state.settings.thickness + 'px');
    const cropCb = el('input', { type: 'checkbox', class: 'w-4 h-4' });
    const padRange = el('input', { type: 'range', min: 0, max: 20, value: state.settings.padding, class: 'flex-1' });
    const padVal = el('span', { class: 'text-cyan-400 text-xs w-8 text-right' }, state.settings.padding + 'px');
    silhouetteCb.addEventListener('change', () => { state.settings.silhouette = silhouetteCb.checked; scheduleProcess(); });
    tolRange.addEventListener('input', () => { state.settings.tolerance = parseInt(tolRange.value); tolVal.innerText = tolRange.value; scheduleProcess(); });
    outlineCb.addEventListener('change', () => { state.settings.outline = outlineCb.checked; scheduleProcess(); });
    thickRange.addEventListener('input', () => { state.settings.thickness = parseInt(thickRange.value); thickVal.innerText = thickRange.value + 'px'; scheduleProcess(); });
    cropCb.addEventListener('change', () => { state.settings.crop = cropCb.checked; scheduleProcess(); });
    padRange.addEventListener('input', () => { state.settings.padding = parseInt(padRange.value); padVal.innerText = padRange.value + 'px'; scheduleProcess(); });

    // Gomme
    const floodModeBtn = btn('🪣 Zone noire', 'btn-primary', () => setEraserMode('flood'));
    const brushModeBtn = btn('🧽 Gomme', '', () => setEraserMode('brush'));
    const radiusInput = el('input', { type: 'range', min: 1, max: 20, value: state.eraserRadius, class: 'flex-1' });
    const radiusVal = el('span', { class: 'text-cyan-400 text-xs w-6 text-right' }, String(state.eraserRadius));
    radiusInput.addEventListener('input', () => { state.eraserRadius = parseInt(radiusInput.value); radiusVal.innerText = radiusInput.value; });
    const radiusWrap = el('label', { class: 'flex items-center gap-2 text-xs', style: 'display:none' }, ['Rayon', radiusInput, radiusVal]);
    const undoBtn = el('button', { class: 'btn text-xs', disabled: '' }, '↩ Annuler');
    const redoBtn = el('button', { class: 'btn text-xs', disabled: '' }, '↪ Rétablir');
    undoBtn.addEventListener('click', undo); redoBtn.addEventListener('click', redo);
    function setEraserMode(mode) {
        state.eraserMode = mode;
        floodModeBtn.className = 'btn text-xs ' + (mode === 'flood' ? 'btn-primary' : '');
        brushModeBtn.className = 'btn text-xs ' + (mode === 'brush' ? 'btn-primary' : '');
        radiusWrap.style.display = mode === 'brush' ? 'flex' : 'none';
        if (mode === 'brush') { state.cropMode = false; state.picking = false; }
        syncTouchAction();
        info.innerText = mode === 'brush' ? 'Maintiens le clic pour gommer (source ou résultat)' : 'Clique une zone noire fermée pour l\'effacer';
    }

    const section = (title, kids) => el('div', { class: 'glass rounded p-2 flex flex-col gap-2' }, [el('div', { class: 'text-[10px] uppercase text-cyan-300/70' }, title), ...kids]);

    const tools = el('div', { class: 'img-editor-tools w-80 flex flex-col gap-3 text-sm overflow-y-auto max-h-[70vh] pr-1' }, [
        el('h3', { class: 'pixel text-cyan-400 text-xs' }, 'MOTEUR SPRITE'),

        section('détourage silhouette (fond noir)', [
            el('label', { class: 'flex items-center gap-2 text-xs' }, [silhouetteCb, 'Activer le détourage']),
            el('label', { class: 'flex items-center gap-2 text-xs' }, ['Tolérance', tolRange, tolVal]),
            el('label', { class: 'flex items-center gap-2 text-xs' }, [outlineCb, 'Contour noir']),
            el('label', { class: 'flex items-center gap-2 text-xs' }, ['Épaisseur', thickRange, thickVal]),
            el('label', { class: 'flex items-center gap-2 text-xs' }, [cropCb, 'Recadrer (contenu)']),
            el('label', { class: 'flex items-center gap-2 text-xs' }, ['Padding', padRange, padVal])
        ]),

        section('gomme manuelle', [
            el('div', { class: 'flex gap-2' }, [floodModeBtn, brushModeBtn]),
            radiusWrap,
            el('div', { class: 'flex gap-2' }, [undoBtn, redoBtn]),
            el('div', { class: 'text-[10px] text-slate-500' }, 'Gomme utilisable sur la source ET l\'aperçu final.')
        ]),

        section('rogner (manuel)', [
            el('div', { class: 'flex gap-2' }, [
                btn('✂ Mode rognage', '', () => { state.cropMode = !state.cropMode; if (state.cropMode) { state.picking = false; setEraserMode('flood'); } info.innerText = state.cropMode ? 'Glisse sur la source pour rogner' : ''; syncTouchAction(); }),
                btn('Appliquer', 'btn-primary', () => { if (state.crop && state.crop.w > 1 && state.crop.h > 1) { setBase(cropImage(state.img, state.crop)); } })
            ])
        ]),

        section('redimensionner', [
            el('div', { class: 'flex gap-2 items-center text-xs' }, ['L', wIn, 'H', hIn]),
            el('label', { class: 'flex items-center gap-2 text-xs' }, [pixelCb, 'pixel (nearest)']),
            btn('Appliquer la taille', 'btn-primary', () => { const w = parseInt(wIn.value) || state.img.width, h = parseInt(hIn.value) || state.img.height; setBase(resizeImage(state.img, w, h, pixelCb.checked)); })
        ]),

        section('fond transparent (couleur)', [
            el('div', { class: 'flex gap-2' }, [
                btn('🎯 Choisir couleur', '', () => { state.picking = true; state.cropMode = false; setEraserMode('flood'); info.innerText = 'Clique un pixel du fond sur la source'; syncTouchAction(); }),
                btn('Coin H-G', '', () => { const d = srcCtx.getImageData(0, 0, 1, 1).data; state.pickedColor = [d[0], d[1], d[2]]; info.innerText = `rgb(${state.pickedColor.join(',')})`; })
            ]),
            el('label', { class: 'flex items-center gap-2 text-xs' }, ['Tolérance', chromaTol]),
            btn('Rendre transparent', 'btn-primary', () => { if (state.pickedColor) setBase(chromaKey(state.img, state.pickedColor, parseInt(chromaTol.value))); })
        ]),

        section('divers', [btn('Rogner les bords transparents', '', () => setBase(trimTransparent(state.img)))]),

        el('div', { class: 'flex gap-2 mt-1' }, [
            btn('Valider', 'btn-primary flex-1', () => { if (!state.result) processImage(); if (!state.result) { close(); return; } spec.src = state.result.toDataURL('image/png'); close(); onDone && onDone(); }),
            btn('Annuler', 'btn-danger', () => close())
        ])
    ]);

    const previews = el('div', { class: 'flex flex-col gap-2 items-center flex-1 min-w-0' }, [
        el('div', { class: 'flex flex-wrap gap-4 justify-center items-start' }, [
            el('div', { class: 'flex flex-col gap-1 items-center' }, [el('div', { class: 'overflow-auto max-h-[50vh]' }, srcCanvas), srcInfo]),
            el('div', { class: 'flex flex-col gap-1 items-center' }, [el('div', { class: 'overflow-auto max-h-[50vh]' }, resCanvas), resInfo])
        ]),
        info
    ]);

    const panel = el('div', { class: 'img-editor-panel glass rounded-xl p-4 w-full max-w-5xl flex gap-4' }, [previews, tools]);
    const overlay = el('div', { class: 'fixed inset-0 modal-bg flex items-center justify-center z-50 p-4' }, panel);
    function close() { overlay.remove(); }
    root.appendChild(overlay);

    setEraserMode('flood');
    setBase(spec.src);
}

// --- Traitements image (pures, renvoient un dataURL PNG) ---
function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// Dilatation d'un masque binaire (disque de rayon r) pour le contour du sprite
function dilateMask(mask, w, h, radius) {
    const out = new Uint8Array(w * h); const offs = [];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) { if (dx * dx + dy * dy <= radius * radius) offs.push(dy * w + dx); }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (mask[p]) { out[p] = 1; continue; }
        for (const o of offs) { const np = p + o; if (np >= 0 && np < w * h && mask[np]) { out[p] = 1; break; } }
    }
    return out;
}
function cropImage(img, c) {
    const cv = newCanvas(c.w, c.h); const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
    return cv.toDataURL('image/png');
}
function resizeImage(img, w, h, pixel) {
    const cv = newCanvas(w, h); const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = !pixel;
    ctx.drawImage(img, 0, 0, w, h);
    return cv.toDataURL('image/png');
}
function chromaKey(img, color, tol) {
    const cv = newCanvas(img.width, img.height); const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, cv.width, cv.height);
    const d = data.data, [r, g, b] = color;
    for (let i = 0; i < d.length; i += 4) {
        const dist = Math.sqrt((d[i] - r) ** 2 + (d[i + 1] - g) ** 2 + (d[i + 2] - b) ** 2);
        if (dist <= tol) d[i + 3] = 0;
    }
    ctx.putImageData(data, 0, 0);
    return cv.toDataURL('image/png');
}
function trimTransparent(img) {
    const cv = newCanvas(img.width, img.height); const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let minX = cv.width, minY = cv.height, maxX = 0, maxY = 0, found = false;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        if (d[(y * cv.width + x) * 4 + 3] > 8) { found = true; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (!found) return img.src;
    return cropImage(img, { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
}
function fileToDataURL(file) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); }); }
function loadImage(src) {
    return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('Image invalide'));
        img.src = src;
    });
}
async function fileToTextureTile(file, size = 512) {
    const src = await fileToDataURL(file);
    const img = await loadImage(src);
    const side = Math.min(img.width, img.height);
    const sx = Math.floor((img.width - side) / 2);
    const sy = Math.floor((img.height - side) / 2);
    const cv = newCanvas(size, size);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return cv.toDataURL('image/png');
}

// =====================================================================
//  ACTIONS (toolbar, add/dup/delete, rarities)
// =====================================================================
function addEntity() {
    if (ARRAY_TABS.includes(currentTab)) {
        project[currentTab].push(TEMPLATES[currentTab]());
        selected = project[currentTab].length - 1;
    } else if (currentTab === 'rarities') {
        let k = 'new_rarity', n = 1; while (project.rarities[k]) k = 'new_rarity' + (n++);
        project.rarities[k] = { name: 'Nouveau', color: '#ffffff', mult: 1, weight: 10 };
        selected = Object.keys(project.rarities).length - 1;
    } else return;
    save(); renderList(); renderForm();
}
function dupEntity() {
    if (!ARRAY_TABS.includes(currentTab)) return;
    const ents = getEntities(); const cur = ents[selected]; if (!cur) return;
    const copy = clone(cur.ref); copy.id = (copy.id || 'item') + '_copy';
    project[currentTab].splice(selected + 1, 0, copy);
    selected++; save(); renderList(); renderForm();
}
function deleteEntity() {
    const ents = getEntities(); const cur = ents[selected]; if (!cur) return;
    if (ARRAY_TABS.includes(currentTab)) project[currentTab].splice(selected, 1);
    else if (currentTab === 'rarities') delete project.rarities[cur.rkey];
    else return;
    save(); renderList(); renderForm();
}
function renameRarity(oldKey, newKey) {
    if (!newKey || newKey === oldKey || project.rarities[newKey]) return;
    const ordered = {};
    Object.entries(project.rarities).forEach(([k, v]) => { ordered[k === oldKey ? newKey : k] = v; });
    project.rarities = ordered; save(); renderList();
}

function addField() {
    const ents = getEntities(); const obj = ents[selected] && ents[selected].ref; if (!obj) return;
    const key = document.getElementById('new-field-key').value.trim();
    if (!key || key in obj) return;
    const type = document.getElementById('new-field-type').value;
    obj[key] = type === 'number' ? 0 : type === 'boolean' ? false : type === 'color' ? '#ffffff' : '';
    document.getElementById('new-field-key').value = '';
    save(); renderForm();
}

function exportJSON() { downloadText('bjorn-project.json', JSON.stringify(project, null, 2)); }
function exportDataJS() {
    const body = JSON.stringify(project, null, 4);
    const content = `// Genere par Bjorn Forge\nexport const GameData = ${body};\n\n` +
        `export const DEFAULT_GAME_DATA = JSON.parse(JSON.stringify(GameData));\nexport const FORGE_KEY = 'bjorn_forge_project';\n` +
        `try {\n    if (typeof localStorage !== 'undefined') {\n        const saved = localStorage.getItem(FORGE_KEY);\n        if (saved) {\n            const proj = JSON.parse(saved);\n            ['rarities','items','monsters','spells','boss','environment','objects'].forEach(k => { if (proj[k] !== undefined) GameData[k] = proj[k]; });\n        }\n    }\n} catch (e) {}\n` +
        `export function rollRarity() {\n    const entries = Object.entries(GameData.rarities);\n    const total = entries.reduce((s, [, r]) => s + (r.weight || 1), 0);\n    let roll = Math.random() * total;\n    for (const [key, r] of entries) { roll -= (r.weight || 1); if (roll <= 0) return key; }\n    return 'common';\n}\n` +
        `export function rarityColor(key) { return (GameData.rarities[key] || GameData.rarities.common).color; }\n`;
    downloadText('data.js', content);
}
function downloadText(name, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
}
function importJSON(file) {
    const r = new FileReader();
    r.onload = () => { try { project = JSON.parse(r.result); selected = 0; save(); renderAll(); setStatus('Projet importé ✓'); } catch (e) { alert('JSON invalide'); } };
    r.readAsText(file);
}

// =====================================================================
//  BIBLIOTHÈQUE D'ASSETS - parcourir les fichiers déjà dans assets/
// =====================================================================
let _manifest = null;
async function getManifest() {
    if (_manifest) return _manifest;
    try { _manifest = await fetch('assets/manifest.json?_=' + Date.now()).then(r => r.json()); }
    catch (e) { _manifest = { images: [], audio: [], models: [] }; }
    return _manifest;
}
// Enregistre un asset importé dans la bibliothèque du projet (dédup par ref).
function addToLibrary(category, ref, name) {
    if (!project.library) project.library = { audio: [], images: [], models: [] };
    if (!project.library[category]) project.library[category] = [];
    if (!project.library[category].some(e => e.ref === ref)) project.library[category].push({ ref, name: name || 'importé' });
}
async function _thumbSrc(value) {
    if (typeof value === 'string' && value.startsWith('idb:')) return await idbGet(value.slice(4));
    // Chemin disque : casse le cache pour refleter une image reecrite/restauree
    if (isDiskPath(value)) return value + (value.includes('?') ? '&' : '?') + 'v=' + assetCacheBust;
    return value;
}

// Modal de sélection. category: 'images'|'audio'|'models'. Fusionne fichiers + imports.
async function openAssetLibrary(category, onPick) {
    const man = await getManifest();
    // imports du projet d'abord (récents), puis fichiers du manifeste
    const lib = ((project.library && project.library[category]) || []).map(e => ({ value: e.ref, label: e.name, imported: true }));
    const files = (man[category] || []).map(f => ({ value: f, label: f.replace('assets/', ''), imported: false }));
    const all = [...lib, ...files];
    const root = document.getElementById('modal-root');
    const overlay = el('div', { class: 'fixed inset-0 modal-bg flex items-center justify-center z-[400]' });
    const close = () => overlay.remove();
    const grid = el('div', { class: category === 'images' ? 'grid grid-cols-6 gap-2' : 'flex flex-col gap-1' });
    const search = el('input', { class: 'glass-input px-2 py-1 rounded text-xs w-full mb-3', placeholder: 'filtrer…' });
    const renderList = (flt) => {
        grid.innerHTML = ''; flt = (flt || '').toLowerCase();
        const shown = all.filter(e => e.label.toLowerCase().includes(flt));
        if (!shown.length) { grid.appendChild(el('div', { class: 'text-xs text-slate-500' }, 'Aucun asset. (importe, ou `node tools/gen-manifest.cjs`)')); return; }
        shown.forEach(e => {
            const badge = e.imported ? ' ★' : '';
            if (category === 'images') {
                const img = el('img', { class: 'pixelated', style: 'width:46px;height:46px;object-fit:contain' });
                _thumbSrc(e.value).then(s => { if (s) img.src = s; });
                grid.appendChild(el('button', { class: 'flex flex-col items-center gap-1 p-1 rounded hover:bg-white/10', title: e.label, onclick: () => { onPick(e.value); close(); } }, [
                    img, el('span', { class: 'text-[8px] truncate w-full text-center ' + (e.imported ? 'text-amber-300' : 'text-slate-400') }, e.label.split('/').pop() + badge)
                ]));
            } else {
                grid.appendChild(el('div', { class: 'flex items-center gap-2 p-1 rounded hover:bg-white/10' }, [
                    el('span', { class: 'flex-1 text-xs truncate ' + (e.imported ? 'text-amber-300' : ''), title: e.label }, e.label + badge),
                    category === 'audio' ? el('button', { class: 'btn text-xs', onclick: async () => { const s = await _thumbSrc(e.value); if (s) { const a = new Audio(s); a.volume = .7; a.play().catch(() => { }); } } }, '▶') : el('span'),
                    el('button', { class: 'btn btn-primary text-xs', onclick: () => { onPick(e.value); close(); } }, 'Choisir')
                ]));
            }
        });
    };
    search.addEventListener('input', () => renderList(search.value));
    const panel = el('div', { class: 'glass rounded-lg p-4 w-[700px] max-w-[95vw] max-h-[85vh] overflow-y-auto' }, [
        el('div', { class: 'flex items-center justify-between mb-3' }, [
            el('h3', { class: 'pixel text-cyan-400 text-sm' }, 'Bibliothèque - ' + category + ' (★ = importé)'),
            el('button', { class: 'btn btn-danger', onclick: close }, '✕')
        ]),
        search, grid
    ]);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.appendChild(panel); root.appendChild(overlay);
    renderList('');
}

// =====================================================================
//  INIT
// =====================================================================
// --- Décor 3D : assignation de modèles glTF/GLB aux props procéduraux ---
const PROP_NAMES = ['barrel', 'crate', 'table', 'chair', 'wardrobe', 'bones', 'skull', 'rock', 'cage', 'coffin', 'vase', 'carpet', 'column', 'painting', 'tapestry', 'cobweb'];
function propTextureList(name) {
    const v = project.propTextures && project.propTextures[name];
    if (Array.isArray(v)) return v.filter(x => typeof x === 'string' && x.trim());
    if (typeof v === 'string' && v.trim()) return [v];
    return [];
}
function setPropTextureList(name, list) {
    const clean = list.filter(x => typeof x === 'string' && x.trim());
    if (!clean.length) delete project.propTextures[name];
    else project.propTextures[name] = clean.length === 1 ? clean[0] : clean;
}
function addPropTexture(name, value) {
    const list = propTextureList(name);
    if (value && !list.includes(value)) list.push(value);
    setPropTextureList(name, list);
}
async function removePropTextures(name) {
    const list = propTextureList(name);
    await Promise.all(list.map(v => (typeof v === 'string' && v.startsWith('idb:')) ? idbDelete(v.slice(4)).catch(() => { }) : Promise.resolve()));
    delete project.propTextures[name];
}
function renderProps3D() {
    document.getElementById('entity-list').innerHTML = '<div class="text-[11px] text-slate-500 p-2">Décor 3D global (pas une liste).</div>';
    document.getElementById('editor-empty').classList.add('hidden');
    document.getElementById('editor').classList.remove('hidden');
    document.getElementById('editor-title').textContent = 'Décor 3D - modèles personnalisés';
    document.getElementById('btn-delete').classList.add('hidden');
    const addRow = document.getElementById('btn-add-field').parentElement; if (addRow) addRow.style.display = 'none';
    if (!project.propModels) project.propModels = {};
    if (!project.propTextures) project.propTextures = {};
    if (!project.propScales) project.propScales = {};
    const root = document.getElementById('form-fields'); root.innerHTML = '';
    const intro = document.createElement('div'); intro.className = 'text-xs text-slate-400 mb-2';
    intro.innerHTML = 'Remplace un prop procédural par un vrai modèle 3D. Format : <b>glTF 2.0 - .glb (binaire)</b> ou .gltf. Recadré et posé au sol automatiquement. Vide = mesh procédural d\'origine.';
    root.appendChild(intro);
    PROP_NAMES.forEach(name => {
        const has = !!(project.propModels[name] && String(project.propModels[name]).trim());
        const texList = propTextureList(name);
        const hasTex = texList.length > 0;
        const row = document.createElement('div'); row.className = 'glass rounded p-2 flex flex-wrap items-center gap-3';
        const label = document.createElement('span'); label.className = 'w-24 text-sm'; label.textContent = name;
        const status = document.createElement('span'); status.className = 'text-xs flex-1 ' + (has ? 'text-emerald-400' : 'text-slate-500'); status.textContent = has ? '● modèle 3D custom' : '○ procédural';
        const texStatus = document.createElement('span'); texStatus.className = 'text-xs ' + (hasTex ? 'text-amber-300' : 'text-slate-500'); texStatus.textContent = hasTex ? `${texList.length} texture${texList.length > 1 ? 's' : ''}` : 'no tex';
        const texThumb = el('div', { class: 'w-16 h-10 bg-black/40 border border-white/10 rounded grid grid-cols-2 gap-[1px] p-[1px] overflow-hidden shrink-0' });
        if (hasTex) texList.slice(0, 4).forEach(v => _thumbSrc(v).then(s => { if (s) texThumb.appendChild(el('img', { src: s, class: 'pixelated', style: 'width:100%;height:100%;object-fit:cover' })); }));
        else texThumb.appendChild(el('span', { class: 'text-[8px] text-slate-500' }, '-'));
        const imp = document.createElement('button'); imp.className = 'btn'; imp.textContent = 'Importer .glb';
        const impTex = document.createElement('button'); impTex.className = 'btn'; impTex.textContent = '+ Textures';
        const scaleWrap = document.createElement('label'); scaleWrap.className = 'text-xs text-slate-400 flex items-center gap-1'; scaleWrap.textContent = 'taille';
        const scale = document.createElement('input'); scale.type = 'number'; scale.step = '0.1'; scale.className = 'glass-input px-2 py-1 rounded text-xs w-16'; scale.value = project.propScales[name] || 0.9;
        scale.addEventListener('change', () => { project.propScales[name] = parseFloat(scale.value) || 0.9; save(); });
        scaleWrap.appendChild(scale);
        if (!project.propRotations) project.propRotations = {};
        const rotWrap = document.createElement('label'); rotWrap.className = 'text-xs text-slate-400 flex items-center gap-1'; rotWrap.textContent = 'rot°';
        const rot = document.createElement('input'); rot.type = 'number'; rot.step = '90'; rot.className = 'glass-input px-2 py-1 rounded text-xs w-16'; rot.value = project.propRotations[name] || 0;
        rot.addEventListener('change', () => { project.propRotations[name] = parseFloat(rot.value) || 0; save(); });
        rotWrap.appendChild(rot);
        const rm = document.createElement('button'); rm.className = 'btn btn-danger'; rm.textContent = 'Retirer'; rm.style.display = has ? '' : 'none';
        imp.addEventListener('click', () => {
            const fi = document.createElement('input'); fi.type = 'file'; fi.accept = '.glb,.gltf,model/gltf-binary,model/gltf+json';
            fi.addEventListener('change', async () => {
                const f = fi.files[0]; if (!f) return;
                const url = await fileToDataURL(f);
                const ext = (f.name.split('.').pop() || 'glb').toLowerCase();
                project.propModels[name] = await storeAsset({ currentRef: project.propModels[name], dataURL: url, category: 'models', id: 'prop_' + name, field: 'model', fallbackKey: 'prop:' + name, name: f.name, ext, libCategory: 'models' });
                save(); renderProps3D(); setStatus('Modèle 3D importé pour ' + name + ' ✓');
            });
            fi.click();
        });
        const lib = document.createElement('button'); lib.className = 'btn'; lib.textContent = '🗂 Bibliothèque';
        lib.addEventListener('click', () => openAssetLibrary('models', p => { idbDelete('prop:' + name).catch(() => { }); project.propModels[name] = p; save(); renderProps3D(); setStatus('Modèle assigné à ' + name + ' ✓'); }));
        impTex.addEventListener('click', () => {
            const fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.multiple = true;
            fi.addEventListener('change', async () => {
                if (!fi.files.length) return;
                for (let i = 0; i < fi.files.length; i++) {
                    const file = fi.files[i];
                    const url = await fileToDataURL(file);
                    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
                    const token = Date.now().toString(36) + i + Math.floor(Math.random() * 1e4).toString(36);
                    const fallbackKey = `proptex:${name}:${Date.now()}:${i}:${Math.floor(Math.random() * 99999)}`;
                    const ref = await storeAsset({ currentRef: '', dataURL: url, category: 'textures', id: 'prop_' + name, field: token, fallbackKey, name: file.name, ext, libCategory: 'images' });
                    addPropTexture(name, ref);
                }
                save(); renderProps3D();
                setStatus(`${fi.files.length} texture${fi.files.length > 1 ? 's' : ''} ajoutee${fi.files.length > 1 ? 's' : ''} pour ${name} OK`);
            });
            fi.click();
        });
        const libTex = document.createElement('button'); libTex.className = 'btn'; libTex.textContent = '+ Image';
        const rmTex = document.createElement('button'); rmTex.className = 'btn btn-danger'; rmTex.textContent = 'Retirer tex'; rmTex.style.display = hasTex ? '' : 'none';
        libTex.addEventListener('click', () => openAssetLibrary('images', p => { addPropTexture(name, p); save(); renderProps3D(); setStatus('Texture ajoutee a ' + name + ' OK'); }));
        rmTex.addEventListener('click', async () => { await removePropTextures(name); save(); renderProps3D(); });
        rm.addEventListener('click', () => { idbDelete('prop:' + name).catch(() => { }); delete project.propModels[name]; save(); renderProps3D(); });
        const restoreModel = has ? restoreDefaultButton(() => project.propModels[name], () => renderProps3D()) : el('span');
        row.append(label, status, imp, lib, texStatus, texThumb, impTex, libTex, scaleWrap, rotWrap, restoreModel, rm, rmTex);
        root.appendChild(row);
    });
}

// --- Audio : musique d'ambiance + sons assignés par catégorie / par sort ---
const SFX_CATS = [
    { key: 'weapon', label: 'Arme (métal générique)' },
    { key: 'weapon.sword', label: 'Épée' }, { key: 'weapon.axe', label: 'Hache' },
    { key: 'weapon.mace', label: 'Masse' }, { key: 'weapon.dagger', label: 'Dague' },
    { key: 'weapon.spear', label: 'Lance' }, { key: 'weapon.greatsword', label: 'Espadon (2 mains)' },
    { key: 'arrow', label: 'Tir (arc / arbalète)' }, { key: 'block', label: 'Blocage / bouclier' },
    { key: 'dash', label: 'Esquive (dash)' },
    { key: 'spell_cast', label: 'Sort - lancement (générique)' }, { key: 'spell_impact', label: 'Sort - éclat (générique)' }
];
async function resolveAudioUrl(v) { return (typeof v === 'string' && v.startsWith('idb:')) ? await idbGet(v.slice(4)) : v; }
const _toArr = v => !v ? [] : (Array.isArray(v) ? v.slice() : [v]);
const _audioLabel = v => v.startsWith('idb:') || v.startsWith('data:') ? '⬆ (importé)' : v.replace('assets/', '');
function uniqKey(base) { return base + '#' + Date.now() + '-' + Math.floor(Math.random() * 1e4); }

// Champ audio MULTI-VALEURS : plusieurs sons -> diffusion aléatoire en jeu.
function audioRow(label, storeKey, getVal, setVal, rerender) {
    const redraw = rerender || renderAudio;
    const list = _toArr(getVal());
    const writeList = (l) => { setVal(l.length === 0 ? '' : l.length === 1 ? l[0] : l); save(); redraw(); };

    const importMulti = () => {
        const fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'audio/*'; fi.multiple = true;
        fi.addEventListener('change', async () => {
            const l = _toArr(getVal());
            for (const f of fi.files) {
                const url = await fileToDataURL(f);
                const ext = (f.name.split('.').pop() || 'mp3').toLowerCase();
                const token = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
                const ref = await storeAsset({ currentRef: '', dataURL: url, category: 'audio', id: slugify(storeKey), field: token, fallbackKey: uniqKey(storeKey), name: f.name, ext, libCategory: 'audio' });
                l.push(ref);
            }
            writeList(l); setStatus('Audio importé : ' + label + ' ✓');
        });
        fi.click();
    };

    const head = el('div', { class: 'flex items-center gap-2' }, [
        el('span', { class: 'flex-1 text-sm' }, label),
        el('span', { class: 'text-xs ' + (list.length ? 'text-emerald-400' : 'text-slate-500') }, list.length ? ('● ' + list.length + (list.length > 1 ? ' · aléatoire' : '')) : '○ -'),
        el('button', { class: 'btn text-xs', onclick: () => openAssetLibrary('audio', p => { const l = _toArr(getVal()); l.push(p); writeList(l); }) }, '🗂 Bibliothèque'),
        el('button', { class: 'btn text-xs', onclick: importMulti }, '＋ Importer')
    ]);
    const chips = el('div', { class: 'flex flex-col gap-1 mt-1' });
    list.forEach((v, i) => chips.appendChild(el('div', { class: 'flex items-center gap-2 text-[11px]' }, [
        el('span', { class: 'flex-1 truncate text-slate-300', title: v }, _audioLabel(v)),
        el('button', { class: 'btn text-xs', onclick: async () => { const u = await resolveAudioUrl(v); if (u) { const a = new Audio(u); a.volume = .7; a.play().catch(() => { }); } } }, '▶'),
        el('button', { class: 'btn btn-danger text-xs', onclick: () => { const l = _toArr(getVal()); const rem = l.splice(i, 1)[0]; if (typeof rem === 'string' && rem.startsWith('idb:')) idbDelete(rem.slice(4)).catch(() => { }); writeList(l); } }, '✕')
    ])));
    return el('div', { class: 'glass rounded p-2' }, list.length ? [head, chips] : [head]);
}
function renderAudio() {
    document.getElementById('entity-list').innerHTML = '<div class="text-[11px] text-slate-500 p-2">Audio global du jeu.</div>';
    document.getElementById('editor-empty').classList.add('hidden');
    document.getElementById('editor').classList.remove('hidden');
    document.getElementById('editor-title').textContent = 'Audio - musique & sons';
    document.getElementById('btn-delete').classList.add('hidden');
    const addRow = document.getElementById('btn-add-field').parentElement; if (addRow) addRow.style.display = 'none';
    if (!project.audio) project.audio = { music: '', sfx: {} };
    if (!project.audio.sfx) project.audio.sfx = {};
    const A = project.audio, root = document.getElementById('form-fields'); root.innerHTML = '';

    const h = t => { const d = document.createElement('div'); d.className = 'text-cyan-400 text-xs mt-3 mb-1 pixel'; d.textContent = t; return d; };
    root.appendChild(h('MUSIQUE D\'AMBIANCE (boucle)'));
    root.appendChild(audioRow('Piste musicale', 'music', () => A.music, v => A.music = v, 'audio/*'));

    root.appendChild(h('SONS PAR CATÉGORIE'));
    SFX_CATS.forEach(c => root.appendChild(audioRow(c.label, 'sfx:' + c.key, () => A.sfx[c.key], v => A.sfx[c.key] = v)));

    root.appendChild(h('SONS PAR SORT (lancement + éclat)'));
    (project.spells || []).forEach(sp => {
        const wrap = document.createElement('div'); wrap.className = 'glass rounded p-2';
        const title = document.createElement('div'); title.className = 'text-sm mb-1'; title.textContent = `${sp.icon || '✦'} ${sp.name}`;
        wrap.appendChild(title);
        const ck = 'spell.' + sp.id + '.cast', ik = 'spell.' + sp.id + '.impact';
        wrap.appendChild(audioRow('- lancement', 'sfx:' + ck, () => A.sfx[ck], v => A.sfx[ck] = v));
        wrap.appendChild(audioRow('- éclat (impact)', 'sfx:' + ik, () => A.sfx[ik], v => A.sfx[ik] = v));
        root.appendChild(wrap);
    });
}

function renderAll() {
    renderTabs();
    if (currentTab === 'props3d') { renderProps3D(); return; }
    if (currentTab === 'audio') { renderAudio(); return; }
    const addRow = document.getElementById('btn-add-field').parentElement; if (addRow) addRow.style.display = '';
    renderList(); renderForm();
}

document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { currentTab = b.dataset.tab; selected = 0; renderAll(); }));
document.getElementById('btn-add').addEventListener('click', addEntity);
document.getElementById('btn-dup').addEventListener('click', dupEntity);
document.getElementById('btn-delete').addEventListener('click', deleteEntity);
document.getElementById('btn-add-field').addEventListener('click', addField);
document.getElementById('btn-save').addEventListener('click', save);
document.getElementById('btn-play').addEventListener('click', () => { save(); window.location.href = 'index.html'; });
document.getElementById('btn-export-json').addEventListener('click', exportJSON);
document.getElementById('btn-export-data').addEventListener('click', exportDataJS);
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-import').click());
document.getElementById('file-import').addEventListener('change', e => { if (e.target.files[0]) importJSON(e.target.files[0]); });
document.getElementById('btn-new').addEventListener('click', () => { if (confirm('Nouveau projet vierge (basé sur les défauts) ?')) { project = clone(DEFAULT_GAME_DATA); selected = 0; save(); renderAll(); } });
document.getElementById('btn-reset').addEventListener('click', () => { if (confirm('Réinitialiser aux valeurs par défaut ? (efface ton projet sauvé - les fichiers d\'assets ne sont pas supprimés)')) { localStorage.removeItem(FORGE_KEY); project = clone(DEFAULT_GAME_DATA); selected = 0; save(); renderAll(); setStatus('Réinitialisé aux défauts'); } });

// Migration : déplace les gros base64 déjà en localStorage vers IndexedDB
// (libère le quota - évite le QuotaExceededError au prochain import).
async function migrateAssetsToIDB() {
    let changed = false;
    const move = async (getV, setV, key) => {
        const v = getV();
        if (Array.isArray(v)) {
            const next = [];
            for (let i = 0; i < v.length; i++) {
                const entry = v[i];
                if (typeof entry === 'string' && entry.startsWith('data:')) {
                    const k = `${key}:${i}`;
                    try { await idbPut(k, entry); next.push('idb:' + k); changed = true; } catch (e) { next.push(entry); }
                } else next.push(entry);
            }
            setV(next);
            return;
        }
        if (typeof v === 'string' && v.startsWith('data:')) {
            try { await idbPut(key, v); setV('idb:' + key); changed = true; } catch (e) { }
        }
    };
    if (project.propModels) for (const name in project.propModels) await move(() => project.propModels[name], v => project.propModels[name] = v, 'prop:' + name);
    if (project.propTextures) for (const name in project.propTextures) await move(() => project.propTextures[name], v => project.propTextures[name] = v, 'proptex:' + name);
    if (project.audio) {
        await move(() => project.audio.music, v => project.audio.music = v, 'music');
        const sfx = project.audio.sfx || {};
        for (const k in sfx) await move(() => sfx[k], v => sfx[k] = v, 'sfx:' + k);
    }
    if (changed) { save(); setStatus('Assets lourds déplacés en IndexedDB ✓'); }
}

// Migration d'un projet legacy (assets en idb:/base64) vers de vrais fichiers disque.
async function migrateProjectToDisk() {
    setStatus('Migration des assets vers le disque…');
    let n = 0;
    const migrate = async (ref, category, id, field) => {
        if (typeof ref !== 'string' || !(ref.startsWith('idb:') || ref.startsWith('data:'))) return ref;
        const dataURL = ref.startsWith('idb:') ? await idbGet(ref.slice(4)) : ref;
        if (!dataURL || typeof dataURL !== 'string' || !dataURL.startsWith('data:')) return ref;
        try {
            const ext = extFromDataURL(dataURL);
            const target = `assets/custom/${slugify(category)}/${slugify(id)}_${slugify(field)}_${n}.${ext}`;
            const written = await writeAssetToDisk(target, dataURL);
            n++; return written;
        } catch (e) { return ref; }
    };
    const migrateSpec = async (spec, category, id, field) => { if (spec && typeof spec === 'object' && typeof spec.src === 'string') spec.src = await migrate(spec.src, category, id, field); };
    for (const tab of ['monsters', 'items', 'spells', 'bosses', 'uniques', 'objects']) {
        for (const o of (project[tab] || [])) {
            const id = o.id || o.type || 'entry';
            await migrateSpec(o.sprite, tab, id, 'sprite');
            await migrateSpec(o.fx, tab, id, 'fx');
            await migrateSpec(o.projectileSprite, tab, id, 'projectileSprite');
        }
    }
    for (const b of (project.biomes || [])) { const id = b.id || 'biome'; for (const k of ['floorTex', 'wallTex', 'ceilTex']) if (b[k]) b[k] = await migrate(b[k], 'textures', id, k); }
    for (const name in (project.propModels || {})) project.propModels[name] = await migrate(project.propModels[name], 'models', 'prop_' + name, 'model');
    for (const name in (project.propTextures || {})) {
        const arr = Array.isArray(project.propTextures[name]) ? project.propTextures[name] : [project.propTextures[name]];
        const out = []; for (let i = 0; i < arr.length; i++) out.push(await migrate(arr[i], 'textures', 'prop_' + name, 'tex' + i));
        project.propTextures[name] = out.length === 1 ? out[0] : out;
    }
    if (project.audio) {
        const migAudio = async (v, field) => { const arr = Array.isArray(v) ? v : [v]; const out = []; for (let i = 0; i < arr.length; i++) out.push(await migrate(arr[i], 'audio', 'sfx', field + i)); return out.length === 1 ? out[0] : out; };
        if (project.audio.music) project.audio.music = await migAudio(project.audio.music, 'music');
        const sfx = project.audio.sfx || {}; for (const k in sfx) sfx[k] = await migAudio(sfx[k], slugify(k));
    }
    await saveProjectToDisk();
    setStatus(`Migration terminée : ${n} asset(s) écrit(s) sur disque ✓`);
    return n;
}

// Expose pour debug/tests
window.FORGE = { get project() { return project; }, save, cropImage, resizeImage, chromaKey, trimTransparent, idbPut, idbGet, migrateProjectToDisk };

// --- Boot : disque (serveur) prioritaire, sinon repli navigateur ---
async function boot() {
    await pingServer();
    if (serverAvailable) {
        // Bouton de migration manuelle dans la toolbar
        const bar = document.getElementById('forge-toolbar');
        if (bar && !document.getElementById('btn-migrate')) {
            const b = el('button', { id: 'btn-migrate', class: 'btn', title: 'Réécrit les assets navigateur (idb/base64) en fichiers disque', onclick: async () => { await migrateProjectToDisk(); renderAll(); } }, '⤓ Migrer vers disque');
            bar.insertBefore(b, document.getElementById('btn-save'));
        }
        try {
            const r = await fetch('/api/project');
            const disk = r.ok ? await r.json() : {};
            if (disk && Object.keys(disk).length) {
                project = normalizeProject(disk);
                setStatus('Projet chargé depuis le disque ✓');
            } else if (localStorage.getItem(FORGE_KEY)) {
                await migrateProjectToDisk();                 // legacy navigateur -> disque
            } else {
                await saveProjectToDisk();                    // cree project.json initial
            }
        } catch (e) { console.warn('[Forge] boot disque:', e); }
    } else {
        await migrateAssetsToIDB();
        setStatus('⚠ Hors serveur - modifications en navigateur. Lance node server.js pour écrire sur disque.');
    }
    renderAll();
}
boot();
