import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, writeBatch } from 'firebase/firestore';

const allowed = new Set(['cardId', 'cardType', 'cardName', 'rarities']);
const cardTypes = new Set(['character', 'event', 'case', 'partner']);

export function validateCardMasterImport(input) {
  if (!Array.isArray(input)) throw new Error('Expected a JSON array.');
  const cardsById = new Map();
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !allowed.has(key)) || typeof item.cardId !== 'string' || !/^\d{4}$/.test(item.cardId) || !cardTypes.has(item.cardType) || typeof item.cardName !== 'string' || !item.cardName.trim() || !Array.isArray(item.rarities) || item.rarities.length === 0 || item.rarities.some((rarity) => typeof rarity !== 'string' || !rarity.trim())) throw new Error('Invalid card master input.');

    const cardName = item.cardName.trim();
    const previous = cardsById.get(item.cardId);
    if (previous && (previous.cardType !== item.cardType || previous.cardName !== cardName)) throw new Error('Invalid card master input.');
    const rarities = Array.from(new Set(item.rarities.map((rarity) => rarity.trim()))).sort();
    if (previous) previous.rarities = Array.from(new Set([...previous.rarities, ...rarities])).sort();
    else cardsById.set(item.cardId, { cardId: item.cardId, cardType: item.cardType, cardName, rarities });
  }
  return Array.from(cardsById.values());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const cards = validateCardMasterImport(input);
  const db = getFirestore(initializeApp(JSON.parse(process.env.FIREBASE_CONFIG ?? '{}')));
  const batch = writeBatch(db);
  for (const { cardId, cardType, cardName, rarities } of cards) batch.set(doc(db, 'cards', cardId), { cardType, cardName, rarities });
  await batch.commit();
}
