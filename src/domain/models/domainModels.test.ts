import { describe, expect, it } from 'vitest';
import {
  validateAccountAccess,
  validateCard,
  validateCardMasterArchive,
  validateListing,
  validateNotificationSubscription,
  validatePublicSellerProfile,
  validateSale,
  validateSellerContact,
  validateSellerProfile,
  validateSellerProfileStructure,
  type Card,
  type CardMasterArchive,
  type AccountAccess,
  type Listing,
  type NotificationSubscription,
  type PublicSellerProfile,
  type Sale,
  type SellerContact,
  type SellerProfile,
} from './index';
import { CARD_TYPES, cardTypeLabel, isCardType } from '../cardType';

describe('domain model validation', () => {
  const activeAccount: AccountAccess = {
    uid: 'buyer-1',
    status: 'active',
    confirmedViolationCount: 0,
    updatedAt: new Date('2026-09-03T00:00:00.000Z'),
  };

  it('accepts canonical active and suspended account access records', () => {
    expect(() => validateAccountAccess(activeAccount)).not.toThrow();
    expect(() => validateAccountAccess({
      ...activeAccount,
      status: 'suspended',
      confirmedViolationCount: 2,
      suspensionReason: 'Repeated marketplace policy violations.',
      suspendedAt: new Date('2026-09-02T00:00:00.000Z'),
      suspendedBy: 'admin-1',
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
    { suspensionReason: '', suspendedAt: new Date(), suspendedBy: 'admin-1' },
    { suspensionReason: ' reason', suspendedAt: new Date(), suspendedBy: 'admin-1' },
    { suspensionReason: 'Reason', suspendedBy: 'admin-1' },
    { suspensionReason: 'Reason', suspendedAt: new Date(), suspendedBy: '' },
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
    })).toThrow('1 to 1000');
    expect(() => validateAccountAccess({
      ...activeAccount,
      status: 'suspended',
      suspensionReason: 'Reason',
      suspendedAt: new Date(),
      suspendedBy: 'x'.repeat(129),
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
