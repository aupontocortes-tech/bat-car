import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { PlateRecord } from '../../utils/plate';

interface BatDB extends DBSchema {
  plates: {
    key: string; // plate
    value: PlateRecord;
    indexes: { 'by-timestamp': number };
  };
}

let dbPromise: Promise<IDBPDatabase<BatDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<BatDB>('bat-app-db', 1, {
      upgrade(db) {
        const store = db.createObjectStore('plates');
        store.createIndex('by-timestamp', 'timestamp');
      },
    });
  }
  return dbPromise;
}

export async function addPlateIfNew(plate: string): Promise<boolean> {
  const db = await getDB();
  const existing = await db.get('plates', plate);
  if (existing) return false;
  const rec: PlateRecord = { plate, timestamp: Date.now() };
  await db.put('plates', rec, plate);
  return true;
}

export async function getAllPlates(): Promise<PlateRecord[]> {
  const db = await getDB();
  const tx = db.transaction('plates');
  const store = tx.store;
  const all: PlateRecord[] = [];
  let cursor = await store.openCursor();
  while (cursor) {
    all.push(cursor.value as PlateRecord);
    cursor = await cursor.continue();
  }
  return all.sort((a, b) => a.timestamp - b.timestamp);
}

export async function clearPlates(): Promise<void> {
  const db = await getDB();
  await db.clear('plates');
}

export async function getCount(): Promise<number> {
  const db = await getDB();
  return db.count('plates');
}