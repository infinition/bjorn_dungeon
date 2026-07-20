// =====================================================================
//  Bjorn Dungeon - serveur statique + persistance disque (Node, 0 dépendance)
//  Lancer :  node server.js   puis  http://localhost:8080
//  La Forge écrit directement dans le dossier du jeu :
//    - assets/...            : sprites/images/audio/modèles édités ou importés
//    - assets/_defaults/...  : snapshot du 1er état (pour "Restaurer par défaut")
//    - project.json + js/project.js : projet de la Forge (chargé par le jeu)
//    - saves/*.json          : sauvegardes de partie
//  (Sans ce serveur - ex: python http.server - la Forge retombe sur le navigateur.)
// =====================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const genManifest = require('./tools/gen-manifest.cjs');

const ROOT = __dirname;
const SAVES = path.join(ROOT, 'saves');
const ASSETS = path.join(ROOT, 'assets');
const DEFAULTS = path.join(ASSETS, '_defaults');
if (!fs.existsSync(SAVES)) fs.mkdirSync(SAVES);
// Régénère le manifeste des assets au démarrage (bibliothèque de la Forge)
try { genManifest.generate(); } catch (e) { console.warn('manifest:', e.message); }
const PORT = process.env.PORT || process.argv[2] || 8080;

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

// Extensions autorisées pour l'écriture d'assets
const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.wav', '.ogg', '.m4a', '.glb', '.gltf']);

function safeName(n) { return String(n || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'save'; }

// Résout un chemin d'asset relatif ("assets/mobs/x.png") en absolu, sous ASSETS,
// extension autorisée, sans traversal. Renvoie null si invalide.
function resolveAssetPath(rel) {
    if (typeof rel !== 'string' || !rel) return null;
    let r = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!r.startsWith('assets/')) return null;
    if (r.includes('..')) return null;
    if (r.startsWith('assets/_defaults/')) return null;   // dossier interne
    const ext = path.extname(r).toLowerCase();
    if (!ASSET_EXT.has(ext)) return null;
    const abs = path.normalize(path.join(ROOT, r));
    if (!abs.startsWith(ASSETS + path.sep)) return null;
    return { abs, rel: r, ext };
}
// Chemin miroir dans assets/_defaults/ pour un rel "assets/mobs/x.png"
function defaultPathFor(rel) { return path.join(DEFAULTS, rel.slice('assets/'.length)); }

function decodeDataURL(dataURL) {
    if (typeof dataURL !== 'string') return null;
    const m = /^data:[^;]*;base64,(.*)$/s.exec(dataURL);
    if (!m) return null;
    try { return Buffer.from(m[1], 'base64'); } catch (e) { return null; }
}

function readBody(req, cb, limit = 3e7) {
    let body = ''; let aborted = false;
    req.on('data', c => { body += c; if (body.length > limit) { aborted = true; req.destroy(); } });
    req.on('end', () => { if (!aborted) cb(body); });
}
function sendJSON(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');

    // --- Sauvegarde de partie ---
    if (u.pathname === '/api/save' && req.method === 'POST') {
        readBody(req, body => {
            try {
                const data = JSON.parse(body);
                fs.writeFileSync(path.join(SAVES, safeName(data.name) + '.json'), JSON.stringify(data));
                sendJSON(res, 200, { ok: true });
            } catch (e) { sendJSON(res, 400, { ok: false }); }
        }, 2e6);
        return;
    }
    if (u.pathname === '/api/load' && req.method === 'GET') {
        const f = path.join(SAVES, safeName(u.searchParams.get('name')) + '.json');
        if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(fs.readFileSync(f)); }
        else { res.writeHead(404); res.end('{}'); }
        return;
    }

    // --- Projet de la Forge (source de vérité sur disque) ---
    if (u.pathname === '/api/project' && req.method === 'POST') {
        readBody(req, body => {
            try {
                const proj = JSON.parse(body);
                const json = JSON.stringify(proj, null, 1);
                fs.writeFileSync(path.join(ROOT, 'project.json'), json);
                // Module importé statiquement par js/data.js -> chargé par le jeu
                fs.writeFileSync(path.join(ROOT, 'js', 'project.js'),
                    '// Généré par la Forge (server.js). Ne pas éditer à la main.\n' +
                    'export const ForgeProject = ' + json + ';\n');
                sendJSON(res, 200, { ok: true });
            } catch (e) { sendJSON(res, 400, { ok: false, error: e.message }); }
        });
        return;
    }
    if (u.pathname === '/api/project' && req.method === 'GET') {
        const f = path.join(ROOT, 'project.json');
        if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(fs.readFileSync(f)); }
        else sendJSON(res, 200, {});
        return;
    }

    // --- Écriture d'un asset sur disque (+ snapshot défaut) ---
    if (u.pathname === '/api/asset' && req.method === 'POST') {
        readBody(req, body => {
            let data;
            try { data = JSON.parse(body); } catch (e) { return sendJSON(res, 400, { ok: false, error: 'json' }); }
            const info = resolveAssetPath(data.path);
            if (!info) return sendJSON(res, 400, { ok: false, error: 'chemin invalide' });
            const buf = decodeDataURL(data.dataURL);
            if (!buf) return sendJSON(res, 400, { ok: false, error: 'dataURL invalide' });
            try {
                fs.mkdirSync(path.dirname(info.abs), { recursive: true });
                const def = defaultPathFor(info.rel);
                // Snapshot défaut = première image connue pour ce chemin
                if (!fs.existsSync(def)) {
                    fs.mkdirSync(path.dirname(def), { recursive: true });
                    if (fs.existsSync(info.abs)) fs.copyFileSync(info.abs, def); // original livré préservé
                }
                fs.writeFileSync(info.abs, buf);
                if (!fs.existsSync(def)) fs.copyFileSync(info.abs, def);          // entité neuve : 1re image = défaut
                try { genManifest.generate(); } catch (e) { }
                sendJSON(res, 200, { ok: true, path: info.rel });
            } catch (e) { sendJSON(res, 500, { ok: false, error: e.message }); }
        });
        return;
    }
    // --- Restaurer un asset à son défaut ---
    if (u.pathname === '/api/asset/restore' && req.method === 'POST') {
        readBody(req, body => {
            let data;
            try { data = JSON.parse(body); } catch (e) { return sendJSON(res, 400, { ok: false, error: 'json' }); }
            const info = resolveAssetPath(data.path);
            if (!info) return sendJSON(res, 400, { ok: false, error: 'chemin invalide' });
            const def = defaultPathFor(info.rel);
            if (!fs.existsSync(def)) return sendJSON(res, 404, { ok: false, error: 'aucun défaut' });
            try {
                fs.mkdirSync(path.dirname(info.abs), { recursive: true });
                fs.copyFileSync(def, info.abs);
                try { genManifest.generate(); } catch (e) { }
                sendJSON(res, 200, { ok: true, path: info.rel });
            } catch (e) { sendJSON(res, 500, { ok: false, error: e.message }); }
        });
        return;
    }
    // --- Un défaut existe-t-il pour ce chemin ? ---
    if (u.pathname === '/api/asset/has-default' && req.method === 'GET') {
        const info = resolveAssetPath(u.searchParams.get('path'));
        const has = !!(info && fs.existsSync(defaultPathFor(info.rel)));
        sendJSON(res, 200, { hasDefault: has });
        return;
    }

    // --- Fichiers statiques ---
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(file).toLowerCase();
        const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
        // Pas de cache sur le code ET les assets editables (js/html/css/images/modeles)
        // -> apres une edition/restauration, le jeu et la Forge voient la derniere version.
        const NO_CACHE = ['.js', '.html', '.css', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.glb', '.gltf'];
        if (NO_CACHE.includes(ext)) headers['Cache-Control'] = 'no-store, must-revalidate';
        res.writeHead(200, headers);
        res.end(data);
    });
});

server.listen(PORT, () => console.log('Bjorn Dungeon -> http://localhost:' + PORT + '  (persistance disque : assets/, project.json, saves/)'));
