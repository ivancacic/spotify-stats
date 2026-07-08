const DB_NAME = 'spotify-stats-lifetime';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function set(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPlays() {
  return (await get('plays')) || [];
}

export function setPlays(plays) {
  return set('plays', plays);
}

export async function getMeta() {
  return (await get('meta')) || { trackingEnabled: false, lastSyncedAt: null };
}

export function setMeta(meta) {
  return set('meta', meta);
}

// Cache of track id -> album art URL, resolved via the batch /tracks API
// for history rows (the streaming export has no artwork).
export async function getTrackArtCache() {
  return (await get('trackArt')) || {};
}

export function setTrackArtCache(cache) {
  return set('trackArt', cache);
}

// Cache of artist name -> { genres, url } resolved via the Spotify search
// API, so lifetime genre stats don't re-query the same artists every visit.
export async function getArtistGenreCache() {
  return (await get('artistGenres')) || {};
}

export function setArtistGenreCache(cache) {
  return set('artistGenres', cache);
}

export async function clearAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
