import { httpsCallable } from 'firebase/functions';
import {
  validateAccountAppealDetail,
  type AccountAppealDetail,
  type AccountAppealEvidenceType,
} from '../../../domain/models';
import { auth, functionsClient } from '../../../lib/firebase/app';

const actionPattern = /^[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}
function owner(uid: unknown): asserts uid is string {
  if (typeof uid !== 'string' || uid.length < 1 || uid.length > 128
    || uid !== uid.trim() || auth.currentUser?.uid !== uid) {
    throw new Error('Account appeal access requires the authenticated owner.');
  }
}
function action(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !actionPattern.test(value)) {
    throw new Error('Account appeal action is invalid.');
  }
}
function iso(value: unknown): Date {
  if (typeof value !== 'string') throw new Error('invalid date');
  const result = new Date(value);
  if (Number.isNaN(result.valueOf()) || result.toISOString() !== value) throw new Error('invalid date');
  return result;
}
function readAppeal(value: unknown): AccountAppealDetail | null {
  if (!record(value) || !exact(value, ['appeal'])) throw new Error('invalid response');
  if (value.appeal === null) return null;
  if (!record(value.appeal)) throw new Error('invalid response');
  const appeal = value.appeal;
  const fields = ['appealId', 'status', 'targetUid', 'suspensionActionId', 'statement',
    'evidence', 'submittedAt', 'updatedAt'];
  const expected = appeal.status === 'submitted' ? fields
    : [...fields, 'decidedAt', 'decidedBy', 'decisionRationale'];
  if (!exact(appeal, expected)) throw new Error('invalid response');
  const converted = {
    ...appeal,
    submittedAt: iso(appeal.submittedAt),
    updatedAt: iso(appeal.updatedAt),
    ...(appeal.status === 'submitted' ? {} : { decidedAt: iso(appeal.decidedAt) }),
  };
  validateAccountAppealDetail(converted);
  return converted as AccountAppealDetail;
}
async function service<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch { throw new Error('申訴服務目前無法使用，請稍後再試。'); }
}
export interface GetOwnAccountAppealInput { uid: string; suspensionActionId: string }
export async function getOwnAccountAppeal(input: GetOwnAccountAppealInput) {
  if (!record(input) || !exact(input, ['uid', 'suspensionActionId'])) throw new Error('invalid input');
  owner(input.uid); action(input.suspensionActionId);
  const callable = httpsCallable(functionsClient, 'getOwnAccountAppeal');
  const result = await service(() => callable({ suspensionActionId: input.suspensionActionId }));
  return service(async () => readAppeal(result.data));
}
export interface SubmitAccountAppealInput extends GetOwnAccountAppealInput {
  requestId: string; draftId: string; statement: string;
  evidence: Array<{ slot: 0 | 1 | 2; generation: string;
    contentType: AccountAppealEvidenceType; size: number }>;
}
export async function submitAccountAppeal(input: SubmitAccountAppealInput) {
  if (!record(input) || !exact(input, [
    'uid', 'suspensionActionId', 'requestId', 'draftId', 'statement', 'evidence',
  ])) throw new Error('invalid input');
  owner(input.uid); action(input.suspensionActionId);
  if (!uuidPattern.test(input.requestId) || !uuidPattern.test(input.draftId)
    || typeof input.statement !== 'string' || input.statement !== input.statement.trim()
    || input.statement.length < 100 || input.statement.length > 2000
    || !Array.isArray(input.evidence) || input.evidence.length > 3) throw new Error('invalid input');
  let previous = -1;
  for (const item of input.evidence) {
    if (!record(item) || !exact(item, ['slot', 'generation', 'contentType', 'size'])
      || !Number.isInteger(item.slot) || (item.slot as number) <= previous || (item.slot as number) > 2
      || !/^[1-9][0-9]{0,30}$/u.test(String(item.generation))
      || !['image/jpeg', 'image/png', 'image/webp'].includes(String(item.contentType))
      || !Number.isSafeInteger(item.size) || (item.size as number) < 1
      || (item.size as number) > 5 * 1024 * 1024) throw new Error('invalid input');
    previous = item.slot as number;
  }
  const callable = httpsCallable(functionsClient, 'submitAccountAppeal');
  const result = await service(() => callable({
    suspensionActionId: input.suspensionActionId, requestId: input.requestId,
    draftId: input.draftId, statement: input.statement, evidence: input.evidence.map((item) => ({ ...item })),
  }));
  return service(async () => {
    const appeal = readAppeal(result.data);
    if (!appeal) throw new Error('invalid response');
    return appeal;
  });
}
