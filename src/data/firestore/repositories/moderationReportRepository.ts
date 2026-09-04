import { httpsCallable } from 'firebase/functions';
import {
  validateModerationReportDraftReceipt,
  validateModerationReportForm,
  type ModerationReportCategory,
  type ModerationReportDraftReceipt,
} from '../../../domain/models';
import { auth, functionsClient } from '../../../lib/firebase/app';

export interface CreateModerationReportDraftInput {
  uid: string;
  requestId: string;
  listingId: string;
}

export interface SubmitModerationReportInput {
  uid: string;
  reportId: string;
  category: ModerationReportCategory;
  description: string;
  evidencePaths: string[];
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function assertReporter(uid: unknown): asserts uid is string {
  if (typeof uid !== 'string' || uid.length < 1 || uid.length > 128
    || uid !== uid.trim() || auth.currentUser?.uid !== uid) {
    throw new Error('Moderation report access requires the authenticated reporter.');
  }
}

function assertId(value: unknown, name: string, maximum = 200): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || value !== value.trim()) {
    throw new Error(`Moderation report ${name} is invalid.`);
  }
}

function readDraftResponse(value: unknown): ModerationReportDraftReceipt {
  if (!isExactRecord(value, ['reportId', 'expiresAt'])
    || typeof value.reportId !== 'string'
    || typeof value.expiresAt !== 'string') {
    throw new Error('Received an invalid report draft response.');
  }
  const expiresAt = new Date(value.expiresAt);
  const receipt = { reportId: value.reportId, expiresAt };
  try {
    if (expiresAt.toISOString() !== value.expiresAt) throw new Error();
    validateModerationReportDraftReceipt(receipt);
  } catch {
    throw new Error('Received an invalid report draft response.');
  }
  return receipt;
}

function readSubmitResponse(value: unknown): { reportId: string } {
  if (!isExactRecord(value, ['reportId'])) {
    throw new Error('Received an invalid report submission response.');
  }
  try {
    assertId(value.reportId, 'response ID');
  } catch {
    throw new Error('Received an invalid report submission response.');
  }
  return { reportId: value.reportId };
}

function validateCreateInput(input: CreateModerationReportDraftInput): void {
  if (!isExactRecord(input, ['uid', 'requestId', 'listingId'])) {
    throw new Error('Moderation report draft request is invalid.');
  }
  assertReporter(input.uid);
  if (typeof input.requestId !== 'string' || !UUID_V4_PATTERN.test(input.requestId)) {
    throw new Error('Moderation report request ID is invalid.');
  }
  assertId(input.listingId, 'Listing ID');
}

function validateSubmitInput(input: SubmitModerationReportInput): void {
  if (!isExactRecord(input, ['uid', 'reportId', 'category', 'description', 'evidencePaths'])) {
    throw new Error('Moderation report submission is invalid.');
  }
  assertReporter(input.uid);
  assertId(input.reportId, 'ID');
  validateModerationReportForm({
    category: input.category,
    description: input.description,
    evidence: [],
  });
  if (!Array.isArray(input.evidencePaths) || input.evidencePaths.length > 3) {
    throw new Error('Moderation report evidence paths are invalid.');
  }
  const prefix = `reportEvidence/${input.uid}/${input.reportId}/`;
  let previousSlot = -1;
  for (const path of input.evidencePaths) {
    if (typeof path !== 'string' || !path.startsWith(prefix)) {
      throw new Error('Moderation report evidence paths are invalid.');
    }
    const slotText = path.slice(prefix.length);
    if (!/^[0-2]$/u.test(slotText) || Number(slotText) <= previousSlot) {
      throw new Error('Moderation report evidence paths are invalid.');
    }
    previousSlot = Number(slotText);
  }
}

async function callService<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error('檢舉服務目前無法使用，請稍後再試。');
  }
}

export async function createModerationReportDraft(
  input: CreateModerationReportDraftInput,
): Promise<ModerationReportDraftReceipt> {
  validateCreateInput(input);
  const callable = httpsCallable<{ requestId: string; listingId: string }, unknown>(
    functionsClient,
    'createModerationReportDraft',
  );
  const result = await callService(() => callable({
    requestId: input.requestId,
    listingId: input.listingId,
  }));
  return readDraftResponse(result.data);
}

export async function submitModerationReport(
  input: SubmitModerationReportInput,
): Promise<{ reportId: string }> {
  validateSubmitInput(input);
  const callable = httpsCallable<Omit<SubmitModerationReportInput, 'uid'>, unknown>(
    functionsClient,
    'submitModerationReport',
  );
  const result = await callService(() => callable({
    reportId: input.reportId,
    category: input.category,
    description: input.description,
    evidencePaths: [...input.evidencePaths],
  }));
  return readSubmitResponse(result.data);
}
