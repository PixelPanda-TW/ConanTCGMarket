import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import {
  MODERATION_REPORT_CATEGORIES,
  parseCreateReportDraftRequest,
  parseSubmitReportRequest,
  projectReportListingSnapshot,
  readModerationReport,
} from './reportTickets.js';

const createdAt = Timestamp.fromDate(new Date('2026-09-04T00:00:00Z'));
const expiresAt = Timestamp.fromDate(new Date('2026-09-05T00:00:00Z'));
const requestKey = 'a'.repeat(64);

const snapshot = {
  listingId: 'listing-1', cardType: 'character' as const,
  cardName: '諸伏高明', cardId: '0501', rarity: 'D', listingPrice: 500, createdAt,
};

const draft = {
  status: 'draft' as const, requestKey, reporterId: 'buyer-1', targetSellerId: 'seller-1',
  listingSnapshot: snapshot, createdAt, expiresAt,
};

describe('report ticket contracts', () => {
  it('accepts only the approved categories and exact callable requests', () => {
    expect(MODERATION_REPORT_CATEGORIES).toEqual([
      'suspected_counterfeit', 'listing_mismatch', 'fraud_or_harassment',
      'prohibited_content', 'other',
    ]);
    expect(parseCreateReportDraftRequest({
      requestId: '550e8400-e29b-41d4-a716-446655440000', listingId: 'listing-1',
    })).toEqual({
      requestId: '550e8400-e29b-41d4-a716-446655440000', listingId: 'listing-1',
    });
    expect(parseSubmitReportRequest({
      reportId: 'report-1', category: 'other', description: '可疑的交易要求',
      evidencePaths: ['reportEvidence/buyer-1/report-1/0'],
    })).toEqual({
      reportId: 'report-1', category: 'other', description: '可疑的交易要求',
      evidencePaths: ['reportEvidence/buyer-1/report-1/0'],
    });
  });

  it.each([
    ['bad UUID', { requestId: 'request-1', listingId: 'listing-1' }],
    ['extra draft field', { requestId: '550e8400-e29b-41d4-a716-446655440000', listingId: 'listing-1', email: 'x@y.z' }],
  ])('rejects malformed draft request: %s', (_label, value) => {
    expect(() => parseCreateReportDraftRequest(value)).toThrow();
  });

  it.each([
    ['unknown category', { category: 'spam' }],
    ['blank description', { description: '' }],
    ['padded description', { description: ' 說明' }],
    ['long description', { description: '字'.repeat(101) }],
    ['too many evidence paths', { evidencePaths: ['a', 'b', 'c', 'd'] }],
    ['duplicate paths', { evidencePaths: ['a', 'a'] }],
    ['extra contact', { contactValue: 'private-contact' }],
  ])('rejects malformed submit request: %s', (_label, override) => {
    expect(() => parseSubmitReportRequest({
      reportId: 'report-1', category: 'other', description: '說明', evidencePaths: [],
      ...override,
    })).toThrow();
  });

  it('projects only the immutable safe Listing snapshot', () => {
    expect(projectReportListingSnapshot('listing-1', {
      status: 'active', sellerId: 'seller-1', cardType: 'character', cardName: '諸伏高明',
      cardId: '0501', rarity: 'D', listingPrice: 500, createdAt,
      contactValue: 'private-contact', imageUrls: ['https://example.test/private.jpg'],
    })).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toMatch(/contact|email|image/iu);
  });

  it('reads exact draft and submitted records with bounded evidence metadata', () => {
    expect(readModerationReport(draft)).toEqual(draft);
    const submitted = {
      ...draft, status: 'submitted' as const, category: 'listing_mismatch' as const,
      description: '稀有度不符', evidence: [{
        path: 'reportEvidence/buyer-1/report-1/0', contentType: 'image/png',
        size: 100, generation: '123', md5Hash: 'abc=',
      }], submittedAt: expiresAt,
    };
    expect(readModerationReport(submitted)).toEqual(submitted);
    expect(() => readModerationReport({ ...draft, reporterEmail: 'buyer@example.test' }))
      .toThrow('exact fields');
  });
});
