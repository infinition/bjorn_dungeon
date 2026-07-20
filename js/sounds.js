// =====================================================================
//  SONS - synthese WebAudio (aucun fichier requis)
// =====================================================================
let ctx = null;
let masterGain = null;
let muted = false;
let _vol = 0.5;

function getCtx() {
    if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        masterGain = ctx.createGain();
        masterGain.gain.value = _vol;
        masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

export function setMuted(v) { muted = v; if (_musicEl) _musicEl.muted = v; }
export function toggleMute() { muted = !muted; if (_musicEl) _musicEl.muted = muted; return muted; }
export function setVolume(v) { _vol = Math.max(0, Math.min(1, v)); if (masterGain) masterGain.gain.value = _vol; if (_musicEl) _musicEl.volume = _vol * 0.6; }
export function getVolume() { return _vol; }

// Bip generique : type d'onde, frequence de depart -> arrivee, duree, volume
function blip(type, f0, f1, dur, vol = 0.2, when = 0) {
    if (muted) return;
    const c = getCtx();
    if (!c) return;
    const t = c.currentTime + when;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain); gain.connect(masterGain);
    osc.start(t); osc.stop(t + dur);
}

function noise(dur, vol = 0.2, when = 0, filterFreq = 1000) {
    if (muted) return;
    const c = getCtx();
    if (!c) return;
    const t = c.currentTime + when;
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = filterFreq;
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(gain); gain.connect(masterGain);
    src.start(t); src.stop(t + dur);
}

// Tir : la sonorite depend du type de sort
export function playShootSound(spellType = 'bolt') {
    switch (spellType) {
        case 'pierce': blip('square', 320, 80, 0.18, 0.18); break;
        case 'aoe':    blip('sawtooth', 180, 40, 0.22, 0.2); blip('square', 90, 30, 0.25, 0.12); break;
        case 'nova':   blip('sine', 600, 1200, 0.3, 0.18); noise(0.3, 0.12, 0, 2000); break;
        default:       blip('sawtooth', 220, 50, 0.1, 0.16);
    }
}

export function playHitSound()    { blip('square', 160, 60, 0.07, 0.15); }
export function playCritSound()   { blip('square', 500, 120, 0.12, 0.22); blip('sawtooth', 300, 80, 0.12, 0.12); }
export function playDeathSound()  { blip('sawtooth', 200, 30, 0.35, 0.2); noise(0.3, 0.15, 0, 800); }
export function playPickupSound() { blip('sine', 700, 1100, 0.08, 0.18); blip('sine', 1100, 1500, 0.08, 0.14, 0.06); }
export function playCoinSound()   { blip('square', 988, 1319, 0.07, 0.15); blip('square', 1319, 1568, 0.07, 0.12, 0.05); }
export function playLevelUpSound(){ [523, 659, 784, 1047].forEach((f, i) => blip('square', f, f, 0.12, 0.18, i * 0.09)); }
export function playHurtSound()   { blip('sawtooth', 180, 90, 0.18, 0.22); noise(0.15, 0.12, 0, 500); }
export function playChestSound()  { blip('sine', 300, 600, 0.15, 0.18); blip('sine', 600, 900, 0.12, 0.14, 0.1); }
export function playBossRoar()    { blip('sawtooth', 90, 50, 0.6, 0.28); noise(0.6, 0.2, 0, 400); }
export function playGameOver()    { [392, 349, 294, 196].forEach((f, i) => blip('sawtooth', f, f, 0.3, 0.2, i * 0.22)); }
export function playVictory()     { [523, 659, 784, 1047, 1319].forEach((f, i) => blip('square', f, f, 0.18, 0.2, i * 0.13)); }

// --- SFX d'action ---
export function playSwingSound()  { noise(0.13, 0.10, 0, 1700); blip('sine', 300, 120, 0.08, 0.05); }   // whoosh d'arme
export function playBlockSound()  { blip('square', 360, 150, 0.09, 0.16); noise(0.08, 0.12, 0, 3200); }  // clang bouclier
// Pas : timbre différent joueur / monstre
export function playFootstep(kind = 'player') {
    if (playSample('step.' + kind, 0.6)) return;     // échantillon assigné (sinon synthèse)
    const f = kind === 'player' ? 240 : (kind === 'heavy' ? 120 : 180);
    const v = kind === 'player' ? 0.07 : 0.05;
    noise(0.06, v, 0, f + Math.random() * 40);
    blip('sine', kind === 'heavy' ? 70 : 95, 48, 0.05, v * 0.7);
}

// --- AMBIANCE sombre en boucle (drones bas + respiration du filtre) ---
let ambientNodes = null;
export function startAmbient() {
    const c = getCtx(); if (!c || ambientNodes) return;
    const out = c.createGain(); out.gain.value = 0; out.connect(masterGain);
    out.gain.linearRampToValueAtTime(0.13, c.currentTime + 4);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 4; lp.connect(out);
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;            // bourdon grave
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 82.41;              // quinte
    const o3 = c.createOscillator(); o3.type = 'triangle'; o3.frequency.value = 36.71;          // sub
    const g1 = c.createGain(); g1.gain.value = 0.5; const g2 = c.createGain(); g2.gain.value = 0.3; const g3 = c.createGain(); g3.gain.value = 0.6;
    o1.connect(g1); o2.connect(g2); o3.connect(g3); g1.connect(lp); g2.connect(lp); g3.connect(lp);
    const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.05;            // respiration lente
    const lfoG = c.createGain(); lfoG.gain.value = 130; lfo.connect(lfoG); lfoG.connect(lp.frequency);
    o1.start(); o2.start(); o3.start(); lfo.start();
    ambientNodes = { out, nodes: [o1, o2, o3, lfo] };
}
export function stopAmbient() {
    if (!ambientNodes) return; const c = getCtx();
    try { ambientNodes.out.gain.linearRampToValueAtTime(0, c.currentTime + 1); ambientNodes.nodes.forEach(n => n.stop(c.currentTime + 1.2)); } catch (e) { }
    ambientNodes = null;
}

// =====================================================================
//  ÉCHANTILLONS AUDIO IMPORTÉS (Forge) - sons assignés par catégorie
//  + MUSIQUE d'ambiance en boucle. Repli sur la synthèse si non assigné.
// =====================================================================
const _sampleUrls = {};       // key -> url/dataURI
const _bufCache = {};         // url -> AudioBuffer (decodé)
let _musicEl = null;

export function registerSamples(map) {
    if (!map) return;
    for (const k in map) { if (map[k] && String(map[k]).trim()) _sampleUrls[k] = map[k]; else delete _sampleUrls[k]; }
}
export function hasSample(key) { return !!_sampleUrls[key]; }

async function _getBuffer(url) {
    if (_bufCache[url]) return _bufCache[url];
    const c = getCtx(); if (!c) return null;
    const resp = await fetch(url); const arr = await resp.arrayBuffer();
    const buf = await c.decodeAudioData(arr);
    _bufCache[url] = buf; return buf;
}
// Joue un clip depuis une URL/dataURI. Retourne true si un clip était dispo.
function _playUrl(url, vol = 1) {
    if (muted || !url) return false;
    const c = getCtx(); if (!c) return false;
    _getBuffer(url).then(buf => {
        if (!buf || muted) return;
        const src = c.createBufferSource(); src.buffer = buf;
        const g = c.createGain(); g.gain.value = vol;
        src.connect(g); g.connect(masterGain); src.start();
    }).catch(() => { });
    return true;
}
// Plusieurs valeurs pour un même son -> on en choisit une au hasard (variété).
const _pickOne = v => Array.isArray(v) ? v[Math.floor(Math.random() * v.length)] : v;
// Joue l'échantillon d'une catégorie si assigné. Retourne true si joué.
export function playSample(key, vol = 1) { const u = _pickOne(_sampleUrls[key]); return u ? _playUrl(u, vol) : false; }
// Joue un son direct (url ou tableau d'urls -> aléatoire). Pour les sons par entité.
export function playClip(v, vol = 1) { const u = _pickOne(v); return u ? _playUrl(u, vol) : false; }

// Musique d'ambiance importée (boucle). Remplace le drone synthétique.
export function preloadRegisteredSamples() {
    const urls = new Set();
    Object.values(_sampleUrls).forEach(v => {
        if (Array.isArray(v)) v.forEach(u => { if (u) urls.add(u); });
        else if (v) urls.add(v);
    });
    urls.forEach(u => _getBuffer(u).catch(() => { }));
}

export function startMusicTrack(url) {
    url = _pickOne(url);
    if (!url) return false;
    stopMusicTrack();
    _musicEl = new Audio(url); _musicEl.loop = true; _musicEl.volume = _vol * 0.6;
    _musicEl.play().catch(() => { });
    return true;
}
export function stopMusicTrack() { if (_musicEl) { try { _musicEl.pause(); } catch (e) { } _musicEl = null; } }

// --- Helpers d'événement : échantillon assigné sinon synthèse ---
export function playWeaponSwing(weaponClass) {
    if (playSample('weapon.' + weaponClass) || playSample('weapon')) return;
    playSwingSound();
}
export function playArrowShot(weapon) {
    if (weapon && _playUrl(weapon.castSound)) return;
    if (playSample('arrow') || playSample('bow')) return;
    playShootSound('pierce');
}
// Son d'impact d'une arme a distance (facultatif, en plus du son de touche generique).
export function playArrowImpact(weapon) { return !!(weapon && _playUrl(weapon.impactSound)); }
export function playBlockHit() { if (playSample('block')) return; playBlockSound(); }
export function playSpellCast(spell) {
    if (spell && _playUrl(spell.castSound)) return;
    if (playSample('spell.' + (spell && spell.id) + '.cast') || playSample('spell_cast')) return;
    playShootSound(spell ? spell.type : 'bolt');
}
export function playSpellImpact(spell) {
    if (spell && _playUrl(spell.impactSound)) return;
    if (playSample('spell.' + (spell && spell.id) + '.impact') || playSample('spell_impact')) return;
    // pas de repli synthé dédié (l'éclat visuel + hit suffisent)
}
