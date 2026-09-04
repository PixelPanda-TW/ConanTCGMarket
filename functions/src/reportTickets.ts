import { Timestamp } from 'firebase-admin/firestore';

export const MODERATION_REPORT_CATEGORIES = [
  'suspected_counterfeit',
  'listing_mismatch',
  'fraud_or_harassment',
  'prohibited_content',
  'other',
] as const;

export type ModerationReportCategory = typeof MODERATION_REPORT_CATEGORIES[number];
export type ReportTicketErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'not-found'
  | 'failed-precondition'
  | 'resource-exhausted'
  | 'aborted'
  | 'unavailable';

export class ReportTicketError extends Error {
  constructor(public readonly code: ReportTicketErrorCode, message: string) {
    super(message);
    this.name = 'ReportTicketError';
  }
}

export interface CreateReportDraftRequest {
  requestId: string;
  listingId: string;
}

export interface SubmitReportRequest {
  reportId: string;
  category: ModerationReportCategory;
  description: string;
  evidencePaths: string[];
}

export interface ReportListingSnapshot {
  listingId: string;
  cardType: 'character' | 'event' | 'case' | 'partner';
  cardName: string;
  cardId: string;
  rarity: string;
  listingPrice: number;
  createdAt: Timestamp;
}

export interface ReportEvidenceMetadata {
  path: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
  generation: string;
  md5Hash?: string;
}

export interface DraftModerationReport {
  status: 'draft';
  requestKey: string;
  reporterId: string;
  targetSellerId: string;
  listingSnapshot: ReportListingSnapshot;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

export interface SubmittedModerationReport extends Omit<DraftModerationReport, 'status'> {
  status: 'submitted';
  category: ModerationReportCategory;
  description: string;
  evidence: ReportEvidenceMetadata[];
  submittedAt: Timestamp;
}

export type ModerationReport = DraftModerationReport | SubmittedModerationReport;

const categories = new Set<string>(MODERATION_REPORT_CATEGORIES);
const evidenceTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

function invalid(message = '請檢查檢舉資料。'): never {
  throw new ReportTicketError('invalid-argument', message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function readId(value: unknown, name: string, maximum = 200): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || value !== value.trim()) {
    return invalid(`${name} 無效。`);
  }
  return value;
}

function readDescription(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100
    || value !== value.trim()) {
    return invalid('說明必須為 1 至 100 個已去除頭尾空白的字元。');
  }
  return value;
}

function readCategory(value: unknown): ModerationReportCategory {
  if (typeof value !== 'string' || !categories.has(value)) {
    return invalid('檢舉分類無效。');
  }
  return value as ModerationReportCategory;
}

export function parseCreateReportDraftRequest(value: unknown): CreateReportDraftRequest {
  if (!isObject(value) || !hasExactFields(value, ['requestId', 'listingId'])
    || typeof value.requestId !== 'string' || !UUID_V4_PATTERN.test(value.requestId)) {
    return invalid();
  }
  return { requestId: value.requestId, listingId: readId(value.listingId, 'Listing ID') };
}

export function parseSubmitReportRequest(value: unknown): SubmitReportRequest {
  if (!isObject(value)
    || !hasExactFields(value, ['reportId', 'category', 'description', 'evidencePaths'])
    || !Array.isArray(value.evidencePaths)
    || value.evidencePaths.length > 3) {
    return invalid();
  }
  const evidencePaths = value.evidencePaths.map((path) => readId(path, '證據路徑', 500));
  if (new Set(evidencePaths).size !== evidencePaths.length) return invalid('證據路徑不可重複。');
  return {
    reportId: readId(value.reportId, '檢舉編號'),
    category: readCategory(value.category),
    description: readDescription(value.description),
    evidencePaths,
  };
}

function readTimestamp(value: unknown, name: string): Timestamp {
  if (!(value instanceof Timestamp)) return invalid(`${name} 無效。`);
  return value;
}

function readBoundedString(value: unknown, name: string, maximum: number): string {
  return readId(value, name, maximum);
}

export function projectReportListingSnapshot(
  listingId: string,
  value: unknown,
): ReportListingSnapshot {
  if (!isObject(value) || value.status !== 'active') return invalid('Listing 不可檢舉。');
  if (value.cardType !== 'character' && value.cardType !== 'event'
    && value.cardType !== 'case' && value.cardType !== 'partner') {
    return invalid('Listing 卡片類型無效。');
  }
  const createdAt = value.createdAt instanceof Date
    ? Timestamp.fromDate(value.createdAt)
    : readTimestamp(value.createdAt, 'Listing 建立時間');
  if (typeof value.listingPrice !== 'number' || !Number.isFinite(value.listingPrice)
    || value.listingPrice <= 0 || value.listingPrice > 10_000_000) {
    return invalid('Listing 價格無效。');
  }
  return {
    listingId: readId(listingId, 'Listing ID'),
    cardType: value.cardType,
    cardName: readBoundedString(value.cardName, '卡片名稱', 200),
    cardId: readBoundedString(value.cardId, '卡片 ID', 100),
    rarity: readBoundedString(value.rarity, '稀有度', 100),
    listingPrice: value.listingPrice,
    createdAt,
  };
}

function readListingSnapshot(value: unknown): ReportListingSnapshot {
  if (!isObject(value) || !hasExactFields(value, [
    'listingId', 'cardType', 'cardName', 'cardId', 'rarity',
    'listingPrice', 'createdAt',
  ])) return invalid('Listing 快照必須使用完整欄位。');
  return projectReportListingSnapshot(value.listingId as string, { ...value, status: 'active' });
}

function readEvidence(value: unknown): ReportEvidenceMetadata {
  if (!isObject(value)
    || (!hasExactFields(value, ['path', 'contentType', 'size', 'generation'])
      && !hasExactFields(value, ['path', 'contentType', 'size', 'generation', 'md5Hash']))
    || typeof value.contentType !== 'string' || !evidenceTypes.has(value.contentType)
    || typeof value.size !== 'number' || !Number.isSafeInteger(value.size)
    || value.size < 1 || value.size > MAX_EVIDENCE_BYTES) {
    return invalid('證據 metadata 無效。');
  }
  return {
    path: readId(value.path, '證據路徑', 500),
    contentType: value.contentType as ReportEvidenceMetadata['contentType'],
    size: value.size,
    generation: readId(value.generation, '證據 generation', 100),
    ...(value.md5Hash === undefined
      ? {}
      : { md5Hash: readId(value.md5Hash, '證據 MD5', 200) }),
  };
}

export function readModerationReport(value: unknown): ModerationReport {
  if (!isObject(value)) return invalid('檢舉記錄無效。');
  const common = [
    'status', 'requestKey', 'reporterId', 'targetSellerId', 'listingSnapshot',
    'createdAt', 'expiresAt',
  ];
  const submittedFields = [...common, 'category', 'description', 'evidence', 'submittedAt'];
  const expected = value.status === 'draft' ? common
    : value.status === 'submitted' ? submittedFields : [];
  if (expected.length === 0 || !hasExactFields(value, expected)) {
    return invalid('檢舉記錄必須使用 exact fields。');
  }
  if (typeof value.requestKey !== 'string' || !SHA256_PATTERN.test(value.requestKey)) {
    return invalid('檢舉 request key 無效。');
  }
  const base = {
    requestKey: value.requestKey,
    reporterId: readBoundedString(value.reporterId, '檢舉人 ID', 128),
    targetSellerId: readBoundedString(value.targetSellerId, '目標賣家 ID', 128),
    listingSnapshot: readListingSnapshot(value.listingSnapshot),
    createdAt: readTimestamp(value.createdAt, '檢舉建立時間'),
    expiresAt: readTimestamp(value.expiresAt, '檢舉到期時間'),
  };
  if (value.status === 'draft') return { status: 'draft', ...base };
  if (!Array.isArray(value.evidence) || value.evidence.length > 3) return invalid();
  const evidence = value.evidence.map(readEvidence);
  if (new Set(evidence.map((item) => item.path)).size !== evidence.length) return invalid();
  return {
    status: 'submitted',
    ...base,
    category: readCategory(value.category),
    description: readDescription(value.description),
    evidence,
    submittedAt: readTimestamp(value.submittedAt, '檢舉送出時間'),
  };
}
