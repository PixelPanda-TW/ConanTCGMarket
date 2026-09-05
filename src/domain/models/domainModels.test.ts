import { describe, expect, it } from 'vitest';
import {
  validateAccountAccess,
  validateAccountModerationAuditEvent,
  validateAccountModerationOperationSummary,
  validateCard,
  validateCardMasterArchive,
  validateListing,
  validateModerationCaseDetail,
  validateModerationCasePage,
  validateModerationDecisionResult,
  validateModerationReportDraftReceipt,
  validateModerationReportForm,
  validateNotificationSubscription,
  validatePublicSellerProfile,
  validateSale,
  validateSellerContact,
  validateSellerProfile,
  validateSellerProfileStructure,
  type Card,
  type CardMasterArchive,
  type AccountAccess,
  type AccountModerationAuditEvent,
  type AccountModerationOperationSummary,
  type Listing,
  type ModerationCaseDetail,
  type ModerationCasePage,
  type ModerationReportForm,
  type NotificationSubscription,
  type PublicSellerProfile,
  type Sale,
  type SellerContact,
  type SellerProfile,
} from './index';
import { CARD_TYPES, cardTypeLabel, isCardType } from '../cardType';
import {
  MODERATION_REPORT_CATEGORIES,
  normalizeModerationReportDescription,
} from './moderationReport';

describe('domain model validation', () => {
  const activeAccount: AccountAccess = {
    uid: 'buyer-1',
    status: 'active',
    confirmedViolationCount: 0,
    updatedAt: new Date('2026-09-03T00:00:00.000Z'),
  };

  const moderationSnapshot = {
    listingId: 'listing-1', cardType: 'character' as const,
    cardName: '諸伏高明', cardId: '0501', rarity: 'D', listingPrice: 500,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };

  it('accepts exact account moderation operation summaries and audit variants', () => {
    const operation: AccountModerationOperationSummary = {
      actionId: 'action-1', status: 'suspended', targetUid: 'seller-1',
      sourceReportId: 'report-1', requestedBy: 'admin-1', reason: '重複違規',
      confirmedViolationCount: 2, hiddenListingCount: 3,
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
      updatedAt: new Date('2026-09-05T00:01:00.000Z'),
      completedAt: new Date('2026-09-05T00:01:00.000Z'),
    };
    expect(() => validateAccountModerationOperationSummary(operation)).not.toThrow();

    const common = {
      targetUid: 'seller-1', suspensionActionId: 'action-1',
      sourceReportId: 'report-1', actorUid: 'admin-1',
      at: new Date('2026-09-05T00:00:00.000Z'),
    };
    const events: AccountModerationAuditEvent[] = [
      {
        ...common, eventId: 'event-requested', type: 'suspension_requested',
        reason: '重複違規', confirmedViolationCount: 2,
      },
      {
        ...common, eventId: 'event-completed', type: 'suspension_completed',
        hiddenListingCount: 3,
      },
      {
        ...common, eventId: 'event-restored', type: 'restored', reason: '申訴確認',
      },
      {
        ...common, eventId: 'event-republished', type: 'listing_republished',
        actorUid: 'seller-1', listingId: 'listing-1',
      },
    ];
    for (const event of events) {
      expect(() => validateAccountModerationAuditEvent(event)).not.toThrow();
    }
  });

  it.each([
    ['operation request key', { requestKey: 'private' }],
    ['operation missing completion', { completedAt: undefined }],
    ['operation padded reason', { reason: ' 原因' }],
    ['operation invalid count', { hiddenListingCount: -1 }],
  ])('rejects malformed account moderation operation: %s', (_label, override) => {
    expect(() => validateAccountModerationOperationSummary({
      actionId: 'action-1', status: 'suspended', targetUid: 'seller-1',
      sourceReportId: 'report-1', requestedBy: 'admin-1', reason: '原因',
      confirmedViolationCount: 2, hiddenListingCount: 1,
      createdAt: new Date(), updatedAt: new Date(), completedAt: new Date(),
      ...override,
    })).toThrow();
  });

  it.each([
    ['private email', { email: 'private@example.test' }],
    ['private contact', { contactValue: 'private' }],
    ['report body', { description: 'private report' }],
    ['evidence', { evidence: [] }],
  ])('rejects private or extra account audit data: %s', (_label, extra) => {
    expect(() => validateAccountModerationAuditEvent({
      eventId: 'event-1', type: 'restored', targetUid: 'seller-1',
      suspensionActionId: 'action-1', sourceReportId: 'report-1',
      actorUid: 'admin-1', reason: '恢復原因', at: new Date(), ...extra,
    })).toThrow('exact fields');
  });

  it('accepts exact open, dismissed, and confirmed moderation summaries', () => {
    const page: ModerationCasePage = {
      cases: [
        {
          reportId: 'report-open', status: 'open', category: 'other',
          targetSellerId: 'seller-1', listingSnapshot: moderationSnapshot,
          openedAt: new Date('2026-09-04T01:00:00.000Z'),
        },
        {
          reportId: 'report-dismissed', status: 'dismissed', category: 'listing_mismatch',
          targetSellerId: 'seller-2', listingSnapshot: moderationSnapshot,
          openedAt: new Date('2026-09-04T00:00:00.000Z'),
          decidedAt: new Date('2026-09-04T02:00:00.000Z'),
        },
        {
          reportId: 'report-confirmed', status: 'confirmed', category: 'suspected_counterfeit',
          targetSellerId: 'seller-3', listingSnapshot: moderationSnapshot,
          openedAt: new Date('2026-09-03T00:00:00.000Z'),
          decidedAt: new Date('2026-09-04T03:00:00.000Z'),
          resultingConfirmedViolationCount: 2,
        },
      ],
      nextCursor: {
        openedAt: new Date('2026-09-03T00:00:00.000Z'), key: 'report-confirmed',
      },
    };
    expect(() => validateModerationCasePage(page, 3)).not.toThrow();
  });

  it('accepts exact private moderation detail without storage or contact fields', () => {
    const detail: ModerationCaseDetail = {
      reportId: 'report-1', status: 'confirmed', category: 'listing_mismatch',
      description: '照片與卡片資料不符', reporterId: 'buyer-1', targetSellerId: 'seller-1',
      listingSnapshot: moderationSnapshot,
      submittedAt: new Date('2026-09-04T00:00:00.000Z'),
      openedAt: new Date('2026-09-04T00:00:00.000Z'),
      evidence: [{ slot: 0, contentType: 'image/png', size: 100 }],
      account: { status: 'active', confirmedViolationCount: 2, suspensionEligible: true },
      rationale: '證據與刊登內容一致證明違規', decidedBy: 'admin-1',
      decidedAt: new Date('2026-09-04T01:00:00.000Z'),
      resultingConfirmedViolationCount: 1,
    };
    expect(() => validateModerationCaseDetail(detail)).not.toThrow();
    for (const extra of ['contactValue', 'email', 'path', 'md5Hash']) {
      expect(() => validateModerationCaseDetail({ ...detail, [extra]: 'private' }))
        .toThrow('exact fields');
    }
  });

  it.each([
    ['padded rationale', { rationale: ' 原因' }],
    ['long rationale', { rationale: '字'.repeat(1001) }],
    ['unsorted evidence', {
      evidence: [
        { slot: 2, contentType: 'image/png', size: 1 },
        { slot: 0, contentType: 'image/png', size: 1 },
      ],
    }],
    ['invalid account eligibility', {
      account: { status: 'active', confirmedViolationCount: 1, suspensionEligible: true },
    }],
  ])('rejects malformed moderation detail: %s', (_label, override) => {
    expect(() => validateModerationCaseDetail({
      reportId: 'report-1', status: 'dismissed', category: 'other', description: '說明',
      reporterId: 'buyer-1', targetSellerId: 'seller-1', listingSnapshot: moderationSnapshot,
      submittedAt: new Date(), openedAt: new Date(), evidence: [],
      account: { status: 'active', confirmedViolationCount: 0, suspensionEligible: false },
      rationale: '無法證實', decidedBy: 'admin-1', decidedAt: new Date(), ...override,
    })).toThrow();
  });

  it('requires exact trusted moderation decision results', () => {
    expect(() => validateModerationDecisionResult({
      reportId: 'report-1', status: 'confirmed',
      resultingConfirmedViolationCount: 2, suspensionEligible: true,
    })).not.toThrow();
    expect(() => validateModerationDecisionResult({
      reportId: 'report-1', status: 'dismissed',
      resultingConfirmedViolationCount: 0, suspensionEligible: false,
      email: 'private@example.test',
    })).toThrow('exact fields');
  });

  it('models the exact report categories and canonical form fields', () => {
    expect(MODERATION_REPORT_CATEGORIES).toEqual([
      'suspected_counterfeit',
      'listing_mismatch',
      'fraud_or_harassment',
      'prohibited_content',
      'other',
    ]);
    const form: ModerationReportForm = {
      category: 'listing_mismatch',
      description: '卡片稀有度與照片不符',
      evidence: [
        { contentType: 'image/jpeg', size: 5 * 1024 * 1024 },
        { contentType: 'image/png', size: 1 },
        { contentType: 'image/webp', size: 500 },
      ],
    };

    expect(() => validateModerationReportForm(form)).not.toThrow();
    expect(normalizeModerationReportDescription('  說明  ')).toBe('說明');
  });

  it.each([
    ['unknown category', { category: 'spam' }],
    ['blank description', { description: '' }],
    ['padded description', { description: ' 說明' }],
    ['long description', { description: '字'.repeat(101) }],
    ['too many files', { evidence: Array.from({ length: 4 }, () => ({ contentType: 'image/png', size: 1 })) }],
    ['wrong file type', { evidence: [{ contentType: 'application/pdf', size: 1 }] }],
    ['oversized file', { evidence: [{ contentType: 'image/png', size: 5 * 1024 * 1024 + 1 }] }],
    ['extra field', { email: 'reporter@example.test' }],
  ])('rejects malformed report form data: %s', (_label, override) => {
    expect(() => validateModerationReportForm({
      category: 'other', description: '說明', evidence: [], ...override,
    })).toThrow();
  });

  it('accepts only an exact opaque report draft receipt', () => {
    expect(() => validateModerationReportDraftReceipt({
      reportId: 'report-1', expiresAt: new Date('2026-09-05T00:00:00Z'),
    })).not.toThrow();
    expect(() => validateModerationReportDraftReceipt({
      reportId: 'report-1', expiresAt: new Date(), contactValue: 'private',
    })).toThrow('exact fields');
  });

  it('accepts canonical active and suspended account access records', () => {
    expect(() => validateAccountAccess(activeAccount)).not.toThrow();
    expect(() => validateAccountAccess({
      ...activeAccount,
      status: 'suspended',
      confirmedViolationCount: 2,
      suspensionReason: 'Repeated marketplace policy violations.',
      suspendedAt: new Date('2026-09-02T00:00:00.000Z'),
      suspendedBy: 'admin-1',
      suspensionActionId: 'action-1',
    })).not.toThrow();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid confirmed violation count %s',
    (confirmedViolationCount) => {
      expect(() => validateAccountAccess({
        ...activeAccount,
        confirmedViolationCount,
      })).toThrow('non-negative integer');
    },
  );

  it('rejects suspension fields on an active account', () => {
    expect(() => validateAccountAccess({
      ...activeAccount,
      suspensionReason: 'Should not exist.',
    } as unknown as AccountAccess)).toThrow('must omit suspension fields');
  });

  it.each([
    {},
    { suspensionReason: '', suspendedAt: new Date(), suspendedBy: 'admin-1', suspensionActionId: 'action-1' },
    { suspensionReason: ' reason', suspendedAt: new Date(), suspendedBy: 'admin-1', suspensionActionId: 'action-1' },
    { suspensionReason: 'Reason', suspendedBy: 'admin-1', suspensionActionId: 'action-1' },
    { suspensionReason: 'Reason', suspendedAt: new Date(), suspendedBy: '', suspensionActionId: 'action-1' },
    { suspensionReason: 'Reason', suspendedAt: new Date(), suspendedBy: 'admin-1' },
  ])('rejects incomplete or noncanonical suspended account fields %#', (fields) => {
    expect(() => validateAccountAccess({
      ...activeAccount,
      status: 'suspended',
      ...fields,
    } as AccountAccess)).toThrow();
  });

  it('enforces identifier and suspension reason bounds', () => {
    expect(() => validateAccountAccess({ ...activeAccount, uid: 'x'.repeat(129) }))
      .toThrow('1 to 128');
    expect(() => validateAccountAccess({ ...activeAccount, uid: ' buyer-1' }))
      .toThrow('trimmed');
    expect(() => validateAccountAccess({
      ...activeAccount,
      status: 'suspended',
      suspensionReason: 'x'.repeat(1001),
      suspendedAt: new Date(),
      suspendedBy: 'admin-1',
      suspensionActionId: 'action-1',
    })).toThrow('1 to 1000');
    expect(() => validateAccountAccess({
      ...activeAccount,
      status: 'suspended',
      suspensionReason: 'Reason',
      suspendedAt: new Date(),
      suspendedBy: 'x'.repeat(129),
      suspensionActionId: 'action-1',
    })).toThrow('1 to 128');
  });

  it('rejects unsupported status and invalid updatedAt values', () => {
    expect(() => validateAccountAccess({ ...activeAccount, status: 'pending' } as never))
      .toThrow('active or suspended');
    expect(() => validateAccountAccess({ ...activeAccount, updatedAt: new Date('invalid') }))
      .toThrow('valid updatedAt');
  });

  it('accepts notification subscriptions for complete raw Card Master names', () => {
    const subscription: NotificationSubscription = {
      uid: 'buyer-1',
      cardNames: ['江戶川柯南', '洗牌情緣'],
      sellerSubscriptions: [],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    };

    expect(() => validateNotificationSubscription(subscription)).not.toThrow();
    expect(() => validateNotificationSubscription({
      ...subscription,
      cardNames: [],
    })).not.toThrow();
  });

  it('rejects notification subscriptions with malformed card names', () => {
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: [''],
      sellerSubscriptions: [],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow();
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: ['江戶川柯南', '江戶川柯南'],
      sellerSubscriptions: [],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow('unique card names');
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: [' 江戶川柯南'],
      sellerSubscriptions: [],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow('trimmed card names');
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: [123],
      sellerSubscriptions: [],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow();
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: ['角'.repeat(101)],
      sellerSubscriptions: [],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow(/at most 100 characters/);
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: Array.from({ length: 101 }, (_, index) => `角色-${index}`),
      sellerSubscriptions: [],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow(/at most 100/);
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      sellerSubscriptions: [],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow('cardNames');
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      characterKeys: ['江戶川柯南'],
      sellerSubscriptions: [],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow();
  });

  it('rejects a non-boolean daily email preference', () => {
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: ['江戶川柯南'],
      sellerSubscriptions: [],
      emailDailyEnabled: 'true',
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow('boolean emailDailyEnabled');
  });

  it('accepts exact, unique, seller-ID-sorted subscription entries', () => {
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: [],
      sellerSubscriptions: [
        { sellerId: 'seller-a', followedAt: new Date('2026-09-04T00:00:00.000Z') },
        { sellerId: 'seller-b', followedAt: new Date('2026-09-04T01:00:00.000Z') },
      ],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-09-04T01:00:00.000Z'),
    })).not.toThrow();
  });

  it.each([
    ['missing list', undefined],
    ['not a list', {}],
    ['duplicate seller', [
      { sellerId: 'seller-a', followedAt: new Date() },
      { sellerId: 'seller-a', followedAt: new Date() },
    ]],
    ['unsorted seller', [
      { sellerId: 'seller-b', followedAt: new Date() },
      { sellerId: 'seller-a', followedAt: new Date() },
    ]],
    ['blank seller', [{ sellerId: '', followedAt: new Date() }]],
    ['untrimmed seller', [{ sellerId: ' seller-a', followedAt: new Date() }]],
    ['oversized seller', [{ sellerId: 's'.repeat(129), followedAt: new Date() }]],
    ['invalid date', [{ sellerId: 'seller-a', followedAt: new Date('invalid') }]],
    ['extra entry field', [{ sellerId: 'seller-a', followedAt: new Date(), contactValue: 'private' }]],
    ['over limit', Array.from({ length: 101 }, (_, index) => ({
      sellerId: `seller-${String(index).padStart(3, '0')}`,
      followedAt: new Date(),
    }))],
  ])('rejects malformed seller subscriptions: %s', (_name, sellerSubscriptions) => {
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1', cardNames: [], sellerSubscriptions,
      emailDailyEnabled: true, updatedAt: new Date(),
    })).toThrow('seller subscriptions');
  });

  it('accepts normalized promotional Card Master metadata with a stable key', () => {
    expect(() => validateCard({
      key: 'card_hash', cardId: 'P001', cardType: 'event', cardName: '追跡開始', rarities: ['C'],
    } as Card)).not.toThrow();
  });

  it('keeps legacy aliases out of the normalized Card Master shape', () => {
    const card: Card = {
      key: 'card_hash', cardId: 'P001', cardType: 'event', cardName: '追跡開始', rarities: ['C'],
      // @ts-expect-error Card Master records have no legacy character alias.
      characterName: '追跡開始',
    };

    expect(card.cardName).toBe('追跡開始');
  });

  it('accepts exact disabled, superseded, and merged Card Master archives', () => {
    const base = {
      key: `card_${'a'.repeat(64)}`,
      cardId: '0501', cardType: 'character' as const, cardName: '黑羽快斗',
      rarities: ['R', 'SR'], rationale: '修正重複資料', actedBy: 'admin-1',
      actedAt: new Date('2026-09-04T00:00:00Z'),
    };
    for (const archive of [
      { ...base, disposition: 'disabled' as const },
      { ...base, disposition: 'superseded' as const, replacementCardKey: `card_${'b'.repeat(64)}` },
      { ...base, disposition: 'merged' as const, replacementCardKey: `card_${'c'.repeat(64)}` },
    ]) {
      expect(() => validateCardMasterArchive(archive)).not.toThrow();
    }
  });

  it.each([
    ['extra field', { email: 'private@example.com' }],
    ['effect field', { effect: 'forbidden' }],
    ['bad key', { key: '0501' }],
    ['noncanonical rarity', { rarities: ['SR', 'R'] }],
    ['empty rationale', { rationale: ' ' }],
    ['invalid timestamp', { actedAt: new Date('invalid') }],
    ['missing replacement', { disposition: 'merged' }],
    ['replacement on disabled', { disposition: 'disabled', replacementCardKey: `card_${'b'.repeat(64)}` }],
  ])('rejects malformed Card Master archive: %s', (_name, overrides) => {
    const archive = {
      key: `card_${'a'.repeat(64)}`,
      cardId: '0501', cardType: 'character' as const, cardName: '黑羽快斗',
      rarities: ['R', 'SR'], disposition: 'disabled' as const,
      rationale: '錯誤卡片', actedBy: 'admin-1',
      actedAt: new Date('2026-09-04T00:00:00Z'),
      ...overrides,
    } as CardMasterArchive;
    expect(() => validateCardMasterArchive(archive)).toThrow('Card Master archive');
  });

  it.each(['P01', 'B0982', 'p001'])('rejects unnormalized or incomplete Card Master card ID %s', (cardId) => {
    expect(() => validateCard({
      key: 'card_hash', cardId, cardType: 'character', cardName: '鈴木園子', rarities: ['SR'],
    } as Card)).toThrow();
  });

  it('rejects cards with an unsupported card type', () => {
    expect(() => validateCard({
      key: 'card_hash', cardId: '1100', cardType: 'unknown', cardName: '追跡開始', rarities: ['C'],
    } as never)).toThrow('Card requires a supported cardType.');
  });

  it('requires each card to have a card name', () => {
    const card: Card = {
      key: 'card_hash',
      cardId: '0001',
      cardType: 'character',
      rarities: ['CP'],
    } as unknown as Card;

    expect(() => validateCard(card)).toThrow('Card requires cardName.');
  });

  it('exposes the supported card types with their UI labels', () => {
    expect(CARD_TYPES).toEqual(['character', 'event', 'case', 'partner']);
    expect(isCardType('event')).toBe(true);
    expect(isCardType('unknown')).toBe(false);
    expect(cardTypeLabel('case')).toBe('Case 卡（情境卡）');
  });

  it('accepts a valid active listing with a normalized promotional card ID snapshot', () => {
    const listing: Listing = {
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: 'P001',
      cardType: 'character',
      cardName: '諸伏景光',
      characterName: '諸伏景光',
      rarity: 'CP',
      imageUrls: ['https://example.com/card.jpg'],
      listingPrice: 500,
      originalQuantity: 5,
      remainingQuantity: 3,
      hasSleeve: true,
      supportsMyShip: true,
      status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateListing(listing)).not.toThrow();
  });

  it('accepts only the exact suspension-held Listing variant', () => {
    const held = {
      id: 'listing-held', sellerId: 'seller-1', cardId: '2200', cardType: 'case',
      cardName: '封鎖現場', rarity: 'SR', imageUrls: ['https://example.com/card.jpg'],
      listingPrice: 500, originalQuantity: 5, remainingQuantity: 5,
      hasSleeve: false, supportsMyShip: false, status: 'suspended',
      suspensionActionId: 'action-1',
      suspendedAt: new Date('2026-09-05T00:00:00.000Z'),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-05T00:00:00.000Z'),
    } as unknown as Listing;
    expect(() => validateListing(held)).not.toThrow();
    expect(() => validateListing({ ...held, suspensionActionId: undefined })).toThrow();
    expect(() => validateListing({ ...held, suspendedAt: undefined })).toThrow();
    expect(() => validateListing({ ...held, suspensionActionId: ' action-1' })).toThrow();
    expect(() => validateListing({ ...held, remainingQuantity: 0 })).toThrow();
  });

  it('rejects hold fields on active and sold-out Listings', () => {
    const common = {
      id: 'listing-1', sellerId: 'seller-1', cardId: '2200', cardType: 'case' as const,
      cardName: '封鎖現場', rarity: 'SR', imageUrls: ['https://example.com/card.jpg'],
      listingPrice: 500, originalQuantity: 5, remainingQuantity: 5,
      hasSleeve: false, supportsMyShip: false, status: 'active' as const,
      createdAt: new Date(), updatedAt: new Date(),
    };
    expect(() => validateListing({
      ...common, suspensionActionId: 'action-1', suspendedAt: new Date(),
    } as never)).toThrow();
    expect(() => validateListing({
      ...common, status: 'sold_out', remainingQuantity: 0,
      suspensionActionId: 'action-1', suspendedAt: new Date(),
    } as never)).toThrow();
  });

  it('accepts an event listing without a character snapshot', () => {
    const eventListing: Listing = {
      id: 'listing-event', sellerId: 'seller-1', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarity: 'C',
      imageUrls: ['https://example.com/card.jpg'], listingPrice: 500, originalQuantity: 1, remainingQuantity: 1,
      hasSleeve: false, supportsMyShip: false, status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'), updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateListing(eventListing)).not.toThrow();
    expect(eventListing.characterName).toBeUndefined();
    expect(() => validateListing({ ...eventListing, characterName: '偽角色' }))
      .toThrow('Non-character Listing cannot contain characterName.');
  });

  it.each(['P01', 'B0982', 'p001'])('rejects unnormalized or incomplete listing card ID %s', (cardId) => {
    const listing: Listing = {
      id: 'listing-1', sellerId: 'seller-1', cardId, cardType: 'character', cardName: '諸伏景光', characterName: '諸伏景光', rarity: 'CP',
      imageUrls: ['https://example.com/card.jpg'], listingPrice: 500, originalQuantity: 1, remainingQuantity: 1,
      hasSleeve: false, supportsMyShip: false, status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'), updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateListing(listing)).toThrow();
  });

  it('requires generic card metadata and rarity snapshots on a listing', () => {
    const listing = {
      id: 'listing-1', sellerId: 'seller-1', cardId: '1096', imageUrls: ['https://example.com/card.jpg'], listingPrice: 500,
      originalQuantity: 5, remainingQuantity: 5, hasSleeve: false, supportsMyShip: false, status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'), updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    } as Listing;

    expect(() => validateListing(listing)).toThrow('Listing requires cardType, cardName, and rarity snapshots.');
  });

  it('rejects listings without photos', () => {
    const listing: Listing = {
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: '0001',
      cardType: 'character',
      cardName: '諸伏景光',
      characterName: '諸伏景光',
      rarity: 'CP',
      imageUrls: [],
      listingPrice: 500,
      originalQuantity: 5,
      remainingQuantity: 5,
      hasSleeve: true,
      supportsMyShip: true,
      status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateListing(listing)).toThrow('Listing requires 1 to 3 image URLs.');
  });

  it('accepts canonical seller contacts for every supported service', () => {
    const baseProfile: SellerProfile = {
      uid: 'seller-1',
      displayName: 'Seller',
      contactType: 'line',
      contactValue: '@seller',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSellerProfile(baseProfile)).not.toThrow();
    expect(() => validateSellerProfile({
      ...baseProfile, contactType: 'discord', contactValue: 'seller_name',
    })).not.toThrow();
    expect(() => validateSellerProfile({
      ...baseProfile, contactType: 'facebook', contactValue: 'https://www.facebook.com/seller',
    })).not.toThrow();
    expect(() => validateSellerProfile({
      ...baseProfile, contactType: 'threads', contactValue: 'https://www.threads.net/@seller',
    })).not.toThrow();
  });

  it('validates a strict public seller profile independently from contact data', () => {
    const profile: PublicSellerProfile = {
      uid: 'seller-1',
      displayName: 'Seller',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T01:00:00.000Z'),
    };

    expect(() => validatePublicSellerProfile(profile)).not.toThrow();
    expect(() => validatePublicSellerProfile({ ...profile, displayName: '' })).toThrow('1 to 80');
    expect(() => validatePublicSellerProfile({ ...profile, displayName: ' Seller' })).toThrow('trimmed');
    expect(() => validatePublicSellerProfile({ ...profile, displayName: '名'.repeat(81) })).toThrow('1 to 80');
    expect(() => validatePublicSellerProfile({ ...profile, uid: '' })).toThrow('uid');
    expect(() => validatePublicSellerProfile({ ...profile, createdAt: new Date('invalid') }))
      .toThrow('valid createdAt');
  });

  it.each([
    ['line', '@seller'],
    ['discord', 'seller_name'],
    ['facebook', 'https://www.facebook.com/seller'],
    ['threads', 'https://www.threads.net/@seller'],
  ] as const)('validates a canonical private %s seller contact', (contactType, contactValue) => {
    const contact: SellerContact = {
      uid: 'seller-1', contactType, contactValue,
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T01:00:00.000Z'),
    };

    expect(() => validateSellerContact(contact)).not.toThrow();
  });

  it('rejects noncanonical private contacts and overlong composite display names', () => {
    const contact: SellerContact = {
      uid: 'seller-1', contactType: 'threads', contactValue: '@legacy',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T01:00:00.000Z'),
    };

    expect(() => validateSellerContact(contact)).toThrow('canonical contactValue');
    expect(() => validateSellerProfile({
      ...contact,
      displayName: '名'.repeat(81),
    })).toThrow('1 to 80');
  });

  it.each([
    ['threads', '@legacy'],
    ['facebook', 'https://www.facebook.com/groups/conan'],
    ['discord', 'https://discord.gg/conan'],
    ['facebook', 'https://m.facebook.com/seller'],
  ] as const)('rejects noncanonical %s seller contact writes', (contactType, contactValue) => {
    const profile: SellerProfile = {
      uid: 'seller-1',
      displayName: 'Seller',
      contactType,
      contactValue,
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSellerProfile(profile)).toThrow(
      'Seller profile requires a canonical contactValue for contactType.',
    );
  });

  it('keeps a non-empty legacy contact structurally readable for correction', () => {
    const profile: SellerProfile = {
      uid: 'seller-1',
      displayName: 'Seller',
      contactType: 'threads',
      contactValue: '@legacy',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSellerProfileStructure(profile)).not.toThrow();
  });

  it('rejects seller profiles without contact values structurally', () => {
    const profile: SellerProfile = {
      uid: 'seller-1',
      displayName: 'Seller',
      contactType: 'line',
      contactValue: '',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSellerProfileStructure(profile)).toThrow('Seller profile requires contactValue.');
  });

  it('rejects sale quantity above zero requirement', () => {
    const sale: Sale = {
      id: 'sale-1',
      listingId: 'listing-1',
      sellerId: 'seller-1',
      cardId: '0001',
      cardType: 'character',
      cardName: '江戶川柯南',
      rarity: 'R',
      quantity: 0,
      listingUnitPrice: 500,
      soldUnitPrice: 450,
      soldAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSale(sale)).toThrow('Sale quantity must be greater than 0.');
  });

  it('accepts only a complete canonical card snapshot for a current sale', () => {
    const sale: Sale = {
      id: 'sale-1', listingId: 'listing-1', sellerId: 'seller-1', cardId: '2200',
      cardType: 'case', cardName: '封鎖現場', rarity: 'SR', quantity: 2,
      listingUnitPrice: 500, soldUnitPrice: 450,
      soldAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSale(sale)).not.toThrow();
    expect(() => validateSale({ ...sale, cardName: ' 封鎖現場' })).toThrow('trimmed');
    expect(() => validateSale({ ...sale, rarity: '' })).toThrow('snapshot');
    expect(() => validateSale({ ...sale, cardType: undefined })).toThrow('snapshot');
    expect(() => validateSale({ ...sale, cardType: 'unknown' as never })).toThrow('snapshot');
  });

  it('allows snapshot omission only when explicitly validating a recognized legacy sale', () => {
    const legacy: Sale = {
      id: 'sale-legacy', listingId: 'listing-1', sellerId: 'seller-1', cardId: '2200',
      quantity: 1, listingUnitPrice: 500, soldUnitPrice: 450,
      soldAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSale(legacy)).toThrow('snapshot');
    expect(() => validateSale(legacy, true)).not.toThrow();
  });

  it('rejects non-finite listing prices and non-integer quantities', () => {
    const listing: Listing = {
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: 'CT-P01-001',
      imageUrls: ['https://example.com/card.jpg'],
      listingPrice: Number.POSITIVE_INFINITY,
      originalQuantity: 1.5,
      remainingQuantity: 1,
      hasSleeve: true,
      supportsMyShip: true,
      status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateListing(listing)).toThrow();
  });
});
