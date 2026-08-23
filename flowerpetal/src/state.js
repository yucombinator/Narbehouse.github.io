// Save/load game progress. Pure — storage is injected so tests use a memory store.

import { MAX_SIZE } from './growth.js';

export const KEY = 'petalBloom.save';

export function createMemoryStore() {
  const data = new Map();
  return {
    data,
    getItem(k) {
      return data.has(k) ? data.get(k) : null;
    },
    setItem(k, v) {
      data.set(k, String(v));
    },
    removeItem(k) {
      data.delete(k);
    },
  };
}

function clean(raw) {
  const size = Number(raw.size);
  const totalBuds = Number(raw.totalBuds);
  const blooms = Number(raw.blooms);
  return {
    size: Number.isFinite(size) ? Math.min(MAX_SIZE, Math.max(1, size)) : 1,
    totalBuds: Number.isFinite(totalBuds) ? Math.max(0, Math.floor(totalBuds)) : 0,
    blooms: Number.isFinite(blooms) ? Math.max(0, Math.floor(blooms)) : 0,
  };
}

export function loadSave(storage) {
  const rawText = storage.getItem(KEY);
  if (rawText === null) return null;
  try {
    const raw = JSON.parse(rawText);
    if (raw === null || typeof raw !== 'object') return null;
    return clean(raw);
  } catch {
    return null;
  }
}

export function writeSave(storage, save) {
  storage.setItem(
    KEY,
    JSON.stringify({ size: save.size, totalBuds: save.totalBuds, blooms: save.blooms })
  );
}

export function resetSave(storage) {
  storage.removeItem(KEY);
}