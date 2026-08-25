import { readFile } from 'node:fs/promises';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, writeBatch } from 'firebase/firestore';
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (!Array.isArray(input)) throw new Error('Expected a JSON array.');
const allowed = new Set(['cardId', 'characterName', 'rarities']); const ids = new Set();
for (const item of input) { if (!item || Object.keys(item).some((key) => !allowed.has(key)) || typeof item.cardId !== 'string' || !/^\d{4}$/.test(item.cardId) || ids.has(item.cardId) || typeof item.characterName !== 'string' || !item.characterName.trim() || !Array.isArray(item.rarities) || item.rarities.length === 0 || item.rarities.some((rarity) => typeof rarity !== 'string' || !rarity.trim())) throw new Error('Invalid card master input.'); ids.add(item.cardId); }
const db = getFirestore(initializeApp(JSON.parse(process.env.FIREBASE_CONFIG ?? '{}'))); const batch = writeBatch(db);
for (const { cardId, characterName, rarities } of input) batch.set(doc(db, 'cards', cardId), { characterName: characterName.trim(), rarities: Array.from(new Set(rarities.map((rarity) => rarity.trim()))).sort() });
await batch.commit();
