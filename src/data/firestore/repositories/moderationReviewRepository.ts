import { httpsCallable } from 'firebase/functions';
import {
  MODERATION_CASE_FILTERS,
  validateModerationCaseDetail,
  validateModerationCasePage,
  validateModerationDecisionResult,
  type ModerationCaseCursor,
  type ModerationCaseDetail,
  type ModerationCaseFilter,
  type ModerationCasePage,
  type ModerationDecision,
  type ModerationDecisionResult,
} from '../../../domain/models';
import { functionsClient } from '../../../lib/firebase/app';

export interface ListModerationCasesInput {
  status: ModerationCaseFilter;
  limit?: number;
  cursor?: ModerationCaseCursor | null;
}

export interface GetModerationEvidenceInput {
  reportId: string;
  slot: 0 | 1 | 2;
}

export interface ModerationEvidenceData {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
  dataBase64: string;
}

export interface DecideModerationCaseInput {
  reportId: string;
  decision: ModerationDecision;
  rationale: string;
}

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const idPattern = /^[A-Za-z0-9_-]{1,200}$/u;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const filters = new Set<string>(MODERATION_CASE_FILTERS);
const evidenceTypes = new Set<string>(['image/jpeg', 'image/png', 'image/webp']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value);
}

function readWireDate(value: unknown): Date {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error();
  return new Date(value as number);
}

function readWireSnapshot(value: unknown): unknown {
  if (!isRecord(value)) throw new Error();
  return { ...value, createdAt: readWireDate(value.createdAt) };
}

function readWireSummary(value: unknown): unknown {
  if (!isRecord(value)) throw new Error();
  const result: Record<string, unknown> = {
    ...value,
    listingSnapshot: readWireSnapshot(value.listingSnapshot),
    openedAt: readWireDate(value.openedAt),
  };
  if ('decidedAt' in value) result.decidedAt = readWireDate(value.decidedAt);
  return result;
}

function readCasePage(value: unknown, requestedLimit: number): ModerationCasePage {
  try {
    if (!isRecord(value) || !exact(value, ['cases', 'nextCursor']) || !Array.isArray(value.cases)) {
      throw new Error();
    }
    const page: unknown = {
      cases: value.cases.map(readWireSummary),
      nextCursor: value.nextCursor === null ? null : (() => {
        if (!isRecord(value.nextCursor)) throw new Error();
        return { ...value.nextCursor, openedAt: readWireDate(value.nextCursor.openedAt) };
      })(),
    };
    validateModerationCasePage(page, requestedLimit);
    return page as ModerationCasePage;
  } catch {
    throw new Error('Received an invalid moderation case page.');
  }
}

function readCaseDetail(value: unknown): ModerationCaseDetail {
  try {
    if (!isRecord(value)) throw new Error();
    const detail: unknown = {
      ...value,
      listingSnapshot: readWireSnapshot(value.listingSnapshot),
      submittedAt: readWireDate(value.submittedAt),
      openedAt: readWireDate(value.openedAt),
      ...('decidedAt' in value ? { decidedAt: readWireDate(value.decidedAt) } : {}),
    };
    validateModerationCaseDetail(detail);
    return detail as ModerationCaseDetail;
  } catch {
    throw new Error('Received an invalid moderation case detail.');
  }
}

function readDecisionResult(value: unknown): ModerationDecisionResult {
  try {
    validateModerationDecisionResult(value);
    return value as ModerationDecisionResult;
  } catch {
    throw new Error('Received an invalid moderation decision response.');
  }
}

function readEvidence(value: unknown): ModerationEvidenceData {
  try {
    if (!isRecord(value) || !exact(value, ['contentType', 'size', 'dataBase64'])
      || !evidenceTypes.has(value.contentType as string)
      || !Number.isSafeInteger(value.size) || (value.size as number) < 1
      || (value.size as number) > MAX_EVIDENCE_BYTES
      || typeof value.dataBase64 !== 'string' || value.dataBase64.length === 0
      || !base64Pattern.test(value.dataBase64)) throw new Error();
    const bytes = atob(value.dataBase64);
    if (bytes.length !== value.size) throw new Error();
    return value as unknown as ModerationEvidenceData;
  } catch {
    throw new Error('Received an invalid moderation evidence response.');
  }
}

async function callService<T>(operation: () => Promise<T>, allowNotFound = false): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (allowNotFound && isRecord(error) && typeof error.code === 'string'
      && error.code.replace(/^functions\//u, '') === 'not-found') {
      throw Object.assign(new Error('找不到檢舉案件。'), { code: 'not-found' as const });
    }
    throw new Error('審查服務目前無法使用，請稍後再試。');
  }
}

function readReportId(value: unknown): string {
  if (!validId(value)) throw new Error('Moderation review request is invalid.');
  return value;
}

function readListInput(input: ListModerationCasesInput): {
  status: ModerationCaseFilter;
  limit: number;
  cursor: { openedAt: number; key: string } | null;
} {
  if (!isRecord(input) || Object.keys(input).some(
    (key) => !['status', 'limit', 'cursor'].includes(key),
  ) || typeof input.status !== 'string' || !filters.has(input.status)) {
    throw new Error('Moderation review request is invalid.');
  }
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Moderation review request is invalid.');
  }
  const cursor = input.cursor ?? null;
  if (cursor !== null && (!isRecord(cursor) || !exact(cursor, ['openedAt', 'key'])
    || !(cursor.openedAt instanceof Date) || Number.isNaN(cursor.openedAt.valueOf())
    || cursor.openedAt.valueOf() < 0 || !validId(cursor.key))) {
    throw new Error('Moderation review request is invalid.');
  }
  return {
    status: input.status,
    limit,
    cursor: cursor === null ? null : { openedAt: cursor.openedAt.valueOf(), key: cursor.key },
  };
}

export async function listModerationCases(
  input: ListModerationCasesInput,
): Promise<ModerationCasePage> {
  const request = readListInput(input);
  const callable = httpsCallable<typeof request, unknown>(functionsClient, 'listModerationCases');
  const result = await callService(() => callable(request));
  return readCasePage(result.data, request.limit);
}

export async function getModerationCase(reportId: string): Promise<ModerationCaseDetail> {
  const request = { reportId: readReportId(reportId) };
  const callable = httpsCallable<typeof request, unknown>(functionsClient, 'getModerationCase');
  const result = await callService(() => callable(request), true);
  return readCaseDetail(result.data);
}

export async function getModerationEvidence(
  input: GetModerationEvidenceInput,
): Promise<ModerationEvidenceData> {
  if (!isRecord(input) || !exact(input, ['reportId', 'slot']) || !validId(input.reportId)
    || !Number.isInteger(input.slot) || input.slot < 0 || input.slot > 2) {
    throw new Error('Moderation review request is invalid.');
  }
  const request = { reportId: input.reportId, slot: input.slot };
  const callable = httpsCallable<typeof request, unknown>(functionsClient, 'getModerationEvidence');
  const result = await callService(() => callable(request));
  return readEvidence(result.data);
}

export async function decideModerationCase(
  input: DecideModerationCaseInput,
): Promise<ModerationDecisionResult> {
  if (!isRecord(input) || !exact(input, ['reportId', 'decision', 'rationale'])
    || !validId(input.reportId)
    || (input.decision !== 'dismissed' && input.decision !== 'confirmed')
    || typeof input.rationale !== 'string' || input.rationale.length < 1
    || input.rationale.length > 1000 || input.rationale !== input.rationale.trim()) {
    throw new Error('Moderation review request is invalid.');
  }
  const request = { ...input };
  const callable = httpsCallable<typeof request, unknown>(functionsClient, 'decideModerationCase');
  const result = await callService(() => callable(request));
  return readDecisionResult(result.data);
}
