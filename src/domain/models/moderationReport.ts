export const MODERATION_REPORT_CATEGORIES = [
  'suspected_counterfeit',
  'listing_mismatch',
  'fraud_or_harassment',
  'prohibited_content',
  'other',
] as const;

export type ModerationReportCategory = typeof MODERATION_REPORT_CATEGORIES[number];

export interface ModerationReportEvidenceCandidate {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
}

export interface ModerationReportForm {
  category: ModerationReportCategory;
  description: string;
  evidence: ModerationReportEvidenceCandidate[];
}

export interface ModerationReportDraftReceipt {
  reportId: string;
  expiresAt: Date;
}

const categories = new Set<string>(MODERATION_REPORT_CATEGORIES);
const evidenceTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DESCRIPTION_LENGTH = 100;
const MAX_EVIDENCE_FILES = 3;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

function hasExactFields(value: object, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

export function normalizeModerationReportDescription(value: string): string {
  return value.trim();
}

export function validateModerationReportForm(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !hasExactFields(value, ['category', 'description', 'evidence'])) {
    throw new Error('Moderation report form requires exact fields.');
  }
  const form = value as ModerationReportForm;
  if (!categories.has(form.category)) {
    throw new Error('Moderation report category is invalid.');
  }
  if (typeof form.description !== 'string'
    || form.description.length < 1
    || form.description.length > MAX_DESCRIPTION_LENGTH
    || form.description !== form.description.trim()) {
    throw new Error('Moderation report description must contain 1 to 100 trimmed characters.');
  }
  if (!Array.isArray(form.evidence) || form.evidence.length > MAX_EVIDENCE_FILES) {
    throw new Error('Moderation report allows at most 3 evidence images.');
  }
  for (const evidence of form.evidence) {
    if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence)
      || !hasExactFields(evidence, ['contentType', 'size'])
      || !evidenceTypes.has(evidence.contentType)
      || !Number.isInteger(evidence.size)
      || evidence.size < 1
      || evidence.size > MAX_EVIDENCE_BYTES) {
      throw new Error('Moderation report evidence must be an approved image up to 5 MiB.');
    }
  }
}

export function validateModerationReportDraftReceipt(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !hasExactFields(value, ['reportId', 'expiresAt'])) {
    throw new Error('Moderation report draft receipt requires exact fields.');
  }
  const receipt = value as ModerationReportDraftReceipt;
  if (typeof receipt.reportId !== 'string'
    || receipt.reportId.length < 1
    || receipt.reportId.length > 200
    || receipt.reportId !== receipt.reportId.trim()
    || !(receipt.expiresAt instanceof Date)
    || Number.isNaN(receipt.expiresAt.valueOf())) {
    throw new Error('Moderation report draft receipt is invalid.');
  }
}
