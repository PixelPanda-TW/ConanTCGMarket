import { readFile } from 'node:fs/promises';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, writeBatch } from 'firebase/firestore';
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (!Array.isArray(input)) throw new Error('Expected a JSON array.');
const allowed = new Set(['cardId', 'cardType', 'cardName', 'rarities']);
const cardTypes = new Set(['character', 'event', 'case', 'partner']);
const identitiesById = new Map();
const cards = input.map((item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !allowed.has(key)) || typeof item.cardId !== 'string' || !/^\d{4}$/.test(item.cardId) || !cardTypes.has(item.cardType) || typeof item.cardName !== 'string' || !item.cardName.trim() || !Array.isArray(item.rarities) || item.rarities.length === 0 || item.rarities.some((rarity) => typeof rarity !== 'string' || !rarity.trim())) throw new Error('Invalid card master input.');

  const cardName = item.cardName.trim();
  const previous = identitiesById.get(item.cardId);
  if (previous && (previous.cardType !== item.cardType || previous.cardName !== cardName)) throw new Error('Invalid card master input.');
  if (previous) throw new Error('Invalid card master input.');
  identitiesById.set(item.cardId, { cardType: item.cardType, cardName });
  return { cardId: item.cardId, cardType: item.cardType, cardName, rarities: Array.from(new Set(item.rarities.map((rarity) => rarity.trim()))).sort() };
});
const db = getFirestore(initializeApp(JSON.parse(process.env.FIREBASE_CONFIG ?? '{}'))); const batch = writeBatch(db);
for (const { cardId, cardType, cardName, rarities } of cards) batch.set(doc(db, 'cards', cardId), { cardType, cardName, rarities });
await batch.commit();
