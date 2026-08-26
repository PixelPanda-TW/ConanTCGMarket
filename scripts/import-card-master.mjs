import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const allowed = new Set(['cardId', 'cardType', 'cardName', 'rarities']);
const cardTypes = new Set(['character', 'event', 'case', 'partner']);
const MAX_WRITES_PER_BATCH = 450;

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
  return Array.from(cardsById.values()).sort((left, right) => left.cardId.localeCompare(right.cardId));
}

export function planCardMasterImport(input) {
  const cards = validateCardMasterImport(input);
  return Array.from({ length: Math.ceil(cards.length / MAX_WRITES_PER_BATCH) }, (_, index) => (
    cards.slice(index * MAX_WRITES_PER_BATCH, (index + 1) * MAX_WRITES_PER_BATCH)
  ));
}

export async function executeCardMasterImport(input, { initializeFirestore = initializeAdminFirestore } = {}) {
  const plan = planCardMasterImport(input);
  const db = await initializeFirestore();

  for (const cards of plan) {
    const batch = db.batch();
    for (const { cardId, cardType, cardName, rarities } of cards) {
      batch.set(db.collection('cards').doc(cardId), { cardType, cardName, rarities });
    }
    await batch.commit();
  }
}

async function initializeAdminFirestore() {
  const [{ getApps, initializeApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ]);
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
  await executeCardMasterImport(input);
}
