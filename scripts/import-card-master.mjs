import { readFile } from 'node:fs/promises';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, writeBatch } from 'firebase/firestore';
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (!Array.isArray(input)) throw new Error('Expected a JSON array.');
const allowed = new Set(['cardId', 'nameZh', 'nameJa', 'rarity']); const ids = new Set();
for (const item of input) { if (!item || Object.keys(item).some((key) => !allowed.has(key)) || typeof item.cardId !== 'string' || !item.cardId || ids.has(item.cardId) || typeof item.rarity !== 'string' || !item.rarity || (!item.nameZh && !item.nameJa)) throw new Error('Invalid card master input.'); ids.add(item.cardId); }
const db = getFirestore(initializeApp(JSON.parse(process.env.FIREBASE_CONFIG ?? '{}'))); const batch = writeBatch(db);
for (const { cardId, nameZh, nameJa, rarity } of input) batch.set(doc(db, 'cards', cardId), { ...(nameZh ? { nameZh } : {}), ...(nameJa ? { nameJa } : {}), rarity });
await batch.commit();
