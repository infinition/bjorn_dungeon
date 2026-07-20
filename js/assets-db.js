// =====================================================================
//  STOCKAGE D'ASSETS LOURDS - IndexedDB (clé -> dataURI)
//  localStorage est limité (~5 Mo) : les GLB/audio importés y dépassent
//  le quota. On les met ici ; le projet ne garde qu'un marqueur "idb:<clé>".
// =====================================================================
const DB_NAME = 'bjorn_assets', STORE = 'kv', VERSION = 1;
let _dbp = null;

function db() {
    if (_dbp) return _dbp;
    _dbp = new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, VERSION);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
    return _dbp;
}

export async function idbPut(key, val) {
    const d = await db();
    return new Promise((res, rej) => {
        const t = d.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put(val, key);
        t.oncomplete = () => res(); t.onerror = () => rej(t.error);
    });
}
export async function idbGet(key) {
    const d = await db();
    return new Promise((res, rej) => {
        const t = d.transaction(STORE, 'readonly');
        const rq = t.objectStore(STORE).get(key);
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
}
export async function idbDelete(key) {
    const d = await db();
    return new Promise((res, rej) => {
        const t = d.transaction(STORE, 'readwrite');
        t.objectStore(STORE).delete(key);
        t.oncomplete = () => res(); t.onerror = () => rej(t.error);
    });
}
