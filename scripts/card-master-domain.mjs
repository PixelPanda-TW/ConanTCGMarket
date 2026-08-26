import { createHash } from 'node:crypto';

export const CARD_ID_PATTERN = /^(?:\d{4}|P\d{3})$/;
export const SOURCE_CARD_ID_CORRECTIONS = new Map([['B0982', '0982']]);

const approvedCardTypes = new Set(['character', 'event', 'case', 'partner']);
const artifactFields = new Set(['cardId', 'cardType', 'cardName', 'rarities']);
const occurrenceFields = new Set(['cardId', 'cardType', 'cardName', 'rarity']);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateObjectFields(record, fields, label) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`Invalid ${label}.`);
  }
  if (Object.keys(record).some((field) => !fields.has(field))) {
    throw new Error(`Invalid ${label}: unapproved field.`);
  }
}

function normalizeIdentityFields(record) {
  if (!approvedCardTypes.has(record.cardType)) throw new Error('Invalid card type.');
  if (typeof record.cardName !== 'string' || !record.cardName.trim()) throw new Error('Empty card name.');
  if (typeof record.cardId !== 'string') throw new Error('Invalid card ID.');

  const cardName = record.cardName.trim().normalize('NFC');
  const cardId = record.cardId.trim().toUpperCase();
  if (!CARD_ID_PATTERN.test(cardId)) throw new Error(`Invalid card ID ${record.cardId}.`);
  return { cardId, cardType: record.cardType, cardName };
}

function normalizeRarity(rarity) {
  if (typeof rarity !== 'string' || !rarity.trim()) throw new Error('Empty rarity.');
  return rarity.trim().toUpperCase();
}

function normalizeArtifactRecord(record) {
  validateObjectFields(record, artifactFields, 'card artifact record');
  const identity = normalizeIdentityFields(record);
  if (!Array.isArray(record.rarities) || record.rarities.length === 0) throw new Error('Empty rarities.');
  return {
    ...identity,
    rarities: Array.from(new Set(record.rarities.map(normalizeRarity))).sort(compareText),
  };
}

function normalizeOccurrence(record) {
  validateObjectFields(record, occurrenceFields, 'card occurrence');
  return { ...normalizeIdentityFields(record), rarity: normalizeRarity(record.rarity) };
}

export function normalizeSourceCardId(value) {
  if (typeof value !== 'string') throw new Error('Invalid card ID.');
  const sourceCardId = value.trim().toUpperCase();
  const correctedCardId = SOURCE_CARD_ID_CORRECTIONS.get(sourceCardId);
  const cardId = correctedCardId ?? sourceCardId;
  if (!CARD_ID_PATTERN.test(cardId)) throw new Error(`Invalid card ID ${sourceCardId || '(empty)'}.`);
  return {
    cardId,
    correction: correctedCardId ? { from: sourceCardId, to: correctedCardId } : null,
  };
}

export function canonicalCardTuple({ cardType, cardName, cardId }) {
  return [cardType, cardName.trim().normalize('NFC'), cardId.trim().toUpperCase()];
}

export function canonicalCardIdentity(record) {
  return JSON.stringify(canonicalCardTuple(record));
}

export function createCardKey(record) {
  const digest = createHash('sha256')
    .update(JSON.stringify(canonicalCardTuple(record)), 'utf8')
    .digest('hex');
  return `card_${digest}`;
}

export function aggregateCardMasterRecords(records) {
  if (!Array.isArray(records)) throw new Error('Invalid card artifact records.');
  const normalizedRecords = records.map(normalizeArtifactRecord);
  const cardsByIdentity = new Map();

  for (const record of normalizedRecords) {
    const identity = canonicalCardIdentity(record);
    const existing = cardsByIdentity.get(identity);
    if (existing) {
      existing.rarities = Array.from(new Set([...existing.rarities, ...record.rarities])).sort(compareText);
    } else {
      cardsByIdentity.set(identity, record);
    }
  }

  return Array.from(cardsByIdentity.values()).sort((left, right) => (
    compareText(left.cardId, right.cardId)
    || compareText(left.cardType, right.cardType)
    || compareText(left.cardName, right.cardName)
  ));
}

export function buildSyncResult(
  occurrences,
  corrections,
  { createKey = createCardKey, versionCount = 0 } = {},
) {
  if (!Array.isArray(occurrences)) throw new Error('Invalid card occurrences.');
  if (!Array.isArray(corrections)) throw new Error('Invalid card ID corrections.');

  const normalizedOccurrences = occurrences.map(normalizeOccurrence);
  const occurrenceIdentities = new Set();
  let duplicateOccurrenceCount = 0;
  for (const occurrence of normalizedOccurrences) {
    const identity = JSON.stringify([...canonicalCardTuple(occurrence), occurrence.rarity]);
    if (occurrenceIdentities.has(identity)) duplicateOccurrenceCount += 1;
    else occurrenceIdentities.add(identity);
  }

  const cards = aggregateCardMasterRecords(normalizedOccurrences.map((occurrence) => ({
    cardId: occurrence.cardId,
    cardType: occurrence.cardType,
    cardName: occurrence.cardName,
    rarities: [occurrence.rarity],
  })));

  const cardTypeCounts = { character: 0, event: 0, case: 0, partner: 0 };
  const idFormatCounts = { numeric: 0, prefixedP: 0 };
  const cardIdCounts = new Map();
  const tupleByKey = new Map();
  const collidedKeys = new Set();
  for (const card of cards) {
    cardTypeCounts[card.cardType] += 1;
    idFormatCounts[card.cardId.startsWith('P') ? 'prefixedP' : 'numeric'] += 1;
    cardIdCounts.set(card.cardId, (cardIdCounts.get(card.cardId) ?? 0) + 1);

    const key = createKey(card);
    const tuple = canonicalCardIdentity(card);
    const previousTuple = tupleByKey.get(key);
    if (previousTuple !== undefined && previousTuple !== tuple) collidedKeys.add(key);
    else tupleByKey.set(key, tuple);
  }

  const correctionCounts = new Map();
  for (const correction of corrections) {
    if (!correction || typeof correction.from !== 'string' || typeof correction.to !== 'string') {
      throw new Error('Invalid card ID correction.');
    }
    const identity = JSON.stringify([correction.from, correction.to]);
    correctionCounts.set(identity, (correctionCounts.get(identity) ?? 0) + 1);
  }
  const correctionReport = Array.from(correctionCounts, ([identity, count]) => {
    const [from, to] = JSON.parse(identity);
    return { from, to, count };
  }).sort((left, right) => compareText(left.from, right.from) || compareText(left.to, right.to));

  return {
    cards,
    report: {
      versionCount,
      occurrenceCount: occurrences.length,
      canonicalCardCount: cards.length,
      cardTypeCounts,
      idFormatCounts,
      sharedCardIdCount: Array.from(cardIdCounts.values()).filter((count) => count > 1).length,
      duplicateOccurrenceCount,
      corrections: correctionReport,
      keyCollisionCount: collidedKeys.size,
    },
  };
}
