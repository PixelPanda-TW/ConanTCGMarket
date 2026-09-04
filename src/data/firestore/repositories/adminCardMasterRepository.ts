import { httpsCallable } from 'firebase/functions';
import {
  CARD_MASTER_FINGERPRINT_PATTERN,
  CARD_MASTER_KEY_PATTERN,
  isCardMasterArchiveCursor,
  validateCardMasterArchive,
  validateCardMasterCard,
  type CardMasterArchive,
  type CardMasterArchiveCursor,
  type CardMasterArchivePage,
  type CardMasterEditableFields,
  type CardMasterMutationResult,
} from '../../../domain/models';
import { functionsClient } from '../../../lib/firebase/app';

export type AddCardMasterEntryInput = CardMasterEditableFields & { rationale: string };
export type EditCardMasterEntryInput = AddCardMasterEntryInput & {
  sourceCardKey: string;
  expectedFingerprint: string;
};
export interface DisableCardMasterEntryInput {
  sourceCardKey: string;
  expectedFingerprint: string;
  rationale: string;
}
export interface MergeCardMasterEntriesInput {
  sourceCardKey: string;
  sourceExpectedFingerprint: string;
  targetCardKey: string;
  targetExpectedFingerprint: string;
  rationale: string;
}
export interface ListCardMasterArchivesInput {
  cursor?: CardMasterArchiveCursor | null;
  limit?: number;
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function readMutationResult(
  value: unknown,
  retired: 'omitted' | 'nullable' | 'required',
): CardMasterMutationResult {
  const fields = retired !== 'omitted'
    ? ['card', 'fingerprint', 'retiredCardKey']
    : ['card', 'fingerprint'];
  if (!isExactRecord(value, fields)
    || typeof value.fingerprint !== 'string'
    || !CARD_MASTER_FINGERPRINT_PATTERN.test(value.fingerprint)) {
    throw new Error('Received an invalid Card Master mutation response.');
  }
  try {
    validateCardMasterCard(value.card);
  } catch {
    throw new Error('Received an invalid Card Master mutation response.');
  }
  if (retired !== 'omitted'
    && ((retired === 'required' && value.retiredCardKey === null)
      || (value.retiredCardKey !== null
        && (typeof value.retiredCardKey !== 'string'
          || !CARD_MASTER_KEY_PATTERN.test(value.retiredCardKey))))) {
    throw new Error('Received an invalid Card Master mutation response.');
  }
  return value as unknown as CardMasterMutationResult;
}

function readWireArchive(value: unknown): CardMasterArchive {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Received an invalid Card Master archive page.');
  }
  const actedAt = (value as Record<string, unknown>).actedAt;
  if (!Number.isSafeInteger(actedAt) || (actedAt as number) < 0) {
    throw new Error('Received an invalid Card Master archive page.');
  }
  const archive = { ...(value as Record<string, unknown>), actedAt: new Date(actedAt as number) };
  try {
    validateCardMasterArchive(archive);
  } catch {
    throw new Error('Received an invalid Card Master archive page.');
  }
  return archive as unknown as CardMasterArchive;
}

function readArchivePage(value: unknown, requestedLimit: number): CardMasterArchivePage {
  if (!isExactRecord(value, ['archives', 'nextCursor'])
    || !Array.isArray(value.archives)
    || value.archives.length > requestedLimit
    || (value.nextCursor !== null && !isCardMasterArchiveCursor(value.nextCursor))) {
    throw new Error('Received an invalid Card Master archive page.');
  }
  const archives = value.archives.map(readWireArchive);
  const nextCursor = value.nextCursor as CardMasterArchiveCursor | null;
  const last = archives.at(-1);
  if (nextCursor !== null
    && (archives.length !== requestedLimit || !last
      || nextCursor.key !== last.key || nextCursor.actedAt !== last.actedAt.valueOf())) {
    throw new Error('Received an invalid Card Master archive page.');
  }
  return { archives, nextCursor };
}

function validateListInput(input: ListCardMasterArchivesInput): number {
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || Object.keys(input).some((key) => key !== 'cursor' && key !== 'limit')
    || (input.cursor !== undefined && input.cursor !== null
      && !isCardMasterArchiveCursor(input.cursor))) {
    throw new Error('Card Master archive request is invalid.');
  }
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Card Master archive request is invalid.');
  }
  return limit;
}

export async function listCardMasterArchives(
  input: ListCardMasterArchivesInput,
): Promise<CardMasterArchivePage> {
  const limit = validateListInput(input);
  const callable = httpsCallable<ListCardMasterArchivesInput, unknown>(
    functionsClient,
    'listCardMasterArchives',
  );
  const result = await callable(input);
  return readArchivePage(result.data, limit);
}

export async function addCardMasterEntry(
  input: AddCardMasterEntryInput,
): Promise<CardMasterMutationResult> {
  const callable = httpsCallable<AddCardMasterEntryInput, unknown>(functionsClient, 'addCardMasterEntry');
  return readMutationResult((await callable(input)).data, 'omitted');
}

export async function editCardMasterEntry(
  input: EditCardMasterEntryInput,
): Promise<CardMasterMutationResult> {
  const callable = httpsCallable<EditCardMasterEntryInput, unknown>(functionsClient, 'editCardMasterEntry');
  const result = readMutationResult((await callable(input)).data, 'nullable');
  if ((result.retiredCardKey === null && result.card.key !== input.sourceCardKey)
    || (result.retiredCardKey !== null
      && (result.retiredCardKey !== input.sourceCardKey
        || result.card.key === input.sourceCardKey))) {
    throw new Error('Received an invalid Card Master mutation response.');
  }
  return result;
}

export async function disableCardMasterEntry(
  input: DisableCardMasterEntryInput,
): Promise<CardMasterArchive> {
  const callable = httpsCallable<DisableCardMasterEntryInput, unknown>(
    functionsClient,
    'disableCardMasterEntry',
  );
  const data = (await callable(input)).data;
  if (!isExactRecord(data, ['archived'])) {
    throw new Error('Received an invalid Card Master disable response.');
  }
  try {
    const archived = readWireArchive(data.archived);
    if (archived.disposition !== 'disabled' || archived.key !== input.sourceCardKey) {
      throw new Error('Received an invalid Card Master disable response.');
    }
    return archived;
  } catch {
    throw new Error('Received an invalid Card Master disable response.');
  }
}

export async function mergeCardMasterEntries(
  input: MergeCardMasterEntriesInput,
): Promise<CardMasterMutationResult> {
  const callable = httpsCallable<MergeCardMasterEntriesInput, unknown>(
    functionsClient,
    'mergeCardMasterEntries',
  );
  const result = readMutationResult((await callable(input)).data, 'required');
  if (result.retiredCardKey !== input.sourceCardKey || result.card.key !== input.targetCardKey) {
    throw new Error('Received an invalid Card Master mutation response.');
  }
  return result;
}
