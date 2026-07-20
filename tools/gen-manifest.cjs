// Génère assets/manifest.json : liste les fichiers d'assets par catégorie.
// Lancer :  node tools/gen-manifest.cjs   (à relancer après ajout de fichiers)
// Réutilisable : require('./tools/gen-manifest.cjs').generate() régénère le manifeste.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');

const IMG = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const AUD = new Set(['.mp3', '.wav', '.ogg', '.m4a']);
const MOD = new Set(['.glb', '.gltf']);
// Dossiers internes non exposés dans la bibliothèque de la Forge
const SKIP_DIRS = new Set(['_defaults']);

function generate() {
    const out = { images: [], audio: [], models: [] };
    function walk(dir) {
        for (const name of fs.readdirSync(dir)) {
            if (SKIP_DIRS.has(name)) continue;
            const fp = path.join(dir, name);
            const st = fs.statSync(fp);
            if (st.isDirectory()) { walk(fp); continue; }
            const ext = path.extname(name).toLowerCase();
            const rel = path.relative(ROOT, fp).split(path.sep).join('/');
            if (IMG.has(ext)) out.images.push(rel);
            else if (AUD.has(ext)) out.audio.push(rel);
            else if (MOD.has(ext)) out.models.push(rel);
        }
    }
    if (fs.existsSync(ASSETS)) walk(ASSETS);
    for (const k in out) out[k].sort();
    fs.writeFileSync(path.join(ASSETS, 'manifest.json'), JSON.stringify(out, null, 1));
    return out;
}

// Exécution directe en CLI
if (require.main === module) {
    const out = generate();
    console.log(`manifest.json : ${out.images.length} images, ${out.audio.length} audio, ${out.models.length} modèles`);
}

module.exports = { generate };
