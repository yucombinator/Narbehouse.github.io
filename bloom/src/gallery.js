// Completed-bouquet gallery persistence. Pure — storage is injected so tests
// use a memory store. Kept separate from state.js so the core save contract
// never changes. No three.js, DOM, or WebAudio.

export const GALLERY_KEY = 'petalBloom.bouquets';
export const GALLERY_CAP = 24; // newest kept, oldest dropped

function isBouquetLike(b) {
  return (
    b !== null &&
    typeof b === 'object' &&
    Array.isArray(b.picks) &&
    b.picks.length > 0 &&
    b.picks.every((p) => typeof p === 'string')
  );
}

export function loadBouquets(storage) {
  const rawText = storage.getItem(GALLERY_KEY);
  if (rawText === null) return [];
  try {
    const raw = JSON.parse(rawText);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isBouquetLike);
  } catch {
    return [];
  }
}

// Newest first. Returns the stored list after the write.
export function addBouquet(storage, bouquet) {
  if (!isBouquetLike(bouquet)) throw new Error('not a valid bouquet record');
  const list = [bouquet, ...loadBouquets(storage)].slice(0, GALLERY_CAP);
  storage.setItem(GALLERY_KEY, JSON.stringify(list));
  return list;
}

export function resetBouquets(storage) {
  storage.removeItem(GALLERY_KEY);
}
