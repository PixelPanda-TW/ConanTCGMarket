import { httpsCallable } from 'firebase/functions';
import {
  validateAccountAppealDetail,
  validateAccountAppealPage,
  type AccountAppealDetail,
  type AccountAppealPage,
  type AccountAppealStatus,
} from '../../../domain/models';
import { functionsClient } from '../../../lib/firebase/app';

export interface AppealEvidenceData { contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number; dataBase64: string }
const idPattern = /^[A-Za-z0-9_-]{1,200}$/u;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, fields: readonly string[]) {
  const keys = Object.keys(value);
  if (keys.length !== fields.length || !fields.every((field) => keys.includes(field))) throw new Error();
}
function wireDate(value: unknown): Date {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error();
  return new Date(value as number);
}
function detail(value: unknown): AccountAppealDetail {
  if (!record(value)) throw new Error();
  const converted = { ...value, submittedAt: wireDate(value.submittedAt),
    updatedAt: wireDate(value.updatedAt),
    ...(value.status === 'submitted' ? {} : { decidedAt: wireDate(value.decidedAt) }) };
  validateAccountAppealDetail(converted); return converted as AccountAppealDetail;
}
async function service<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch { throw new Error('申訴審核服務目前無法使用，請稍後再試。'); }
}
export async function listAccountAppeals(input: {
  status: AccountAppealStatus; limit?: number;
  cursor?: { submittedAt: Date; key: string } | null;
}): Promise<AccountAppealPage> {
  if (!record(input) || !['submitted', 'dismissed', 'approved'].includes(input.status)) throw new Error('invalid');
  const limit = input.limit ?? 20; const cursor = input.cursor ?? null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50
    || (cursor !== null && (!(cursor.submittedAt instanceof Date) || !idPattern.test(cursor.key)))) throw new Error('invalid');
  const request = { status: input.status, limit, cursor: cursor && {
    submittedAt: cursor.submittedAt.valueOf(), key: cursor.key,
  } };
  const result = await service(() => httpsCallable(functionsClient, 'listAccountAppeals')(request));
  return service(async () => {
    if (!record(result.data)) throw new Error(); exact(result.data, ['appeals', 'nextCursor']);
    if (!Array.isArray(result.data.appeals)) throw new Error();
    const page = {
      appeals: result.data.appeals.map((item) => {
        if (!record(item)) throw new Error();
        return { ...item, submittedAt: wireDate(item.submittedAt), updatedAt: wireDate(item.updatedAt),
          ...(item.status === 'submitted' ? {} : { decidedAt: wireDate(item.decidedAt) }) };
      }),
      nextCursor: result.data.nextCursor === null ? null : (() => {
        if (!record(result.data.nextCursor)) throw new Error();
        return { submittedAt: wireDate(result.data.nextCursor.submittedAt), key: result.data.nextCursor.key };
      })(),
    };
    validateAccountAppealPage(page, limit); return page as AccountAppealPage;
  });
}
export async function getAccountAppeal(appealId: string) {
  if (!idPattern.test(appealId)) throw new Error('invalid');
  const result = await service(() => httpsCallable(functionsClient, 'getAccountAppeal')({ appealId }));
  return service(async () => detail(result.data));
}
export async function getAccountAppealEvidence(input: { appealId: string; slot: 0 | 1 | 2 }) {
  if (!record(input) || !idPattern.test(input.appealId) || !Number.isInteger(input.slot)
    || input.slot < 0 || input.slot > 2) throw new Error('invalid');
  const result = await service(() => httpsCallable(functionsClient, 'getAccountAppealEvidence')(input));
  return service(async () => {
    if (!record(result.data)) throw new Error(); exact(result.data, ['contentType', 'size', 'dataBase64']);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(result.data.contentType))
      || !Number.isSafeInteger(result.data.size) || (result.data.size as number) < 1
      || typeof result.data.dataBase64 !== 'string' || atob(result.data.dataBase64).length !== result.data.size) throw new Error();
    return result.data as unknown as AppealEvidenceData;
  });
}
export async function decideAccountAppeal(input: { appealId: string; requestId: string;
  decision: 'dismissed' | 'approved'; rationale: string }) {
  if (!record(input) || !idPattern.test(input.appealId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.requestId)
    || !['dismissed', 'approved'].includes(input.decision)
    || typeof input.rationale !== 'string' || input.rationale !== input.rationale.trim()
    || input.rationale.length < 1 || input.rationale.length > 1000) throw new Error('invalid');
  const result = await service(() => httpsCallable(functionsClient, 'decideAccountAppeal')({ ...input }));
  return service(async () => {
    if (!record(result.data)) throw new Error(); exact(result.data, ['appealId', 'status', 'decidedAt']);
    if (result.data.appealId !== input.appealId || result.data.status !== input.decision
      || !Number.isSafeInteger(result.data.decidedAt)) throw new Error();
    return { appealId: input.appealId, status: input.decision, decidedAt: new Date(result.data.decidedAt as number) };
  });
}
