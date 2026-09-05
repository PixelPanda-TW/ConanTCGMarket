import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  accountAccessConverter,
  cardConverter,
  listingConverter,
  publicSellerProfileConverter,
  saleConverter,
  notificationSubscriptionConverter,
} from './converters';
import { collections } from './paths';

describe('Firestore converters', () => {
  it('exposes the account access collection path', () => {
    expect(collections.accountAccess).toBe('accountAccess');
  });

  it('exposes private seller contact and access-control collection paths', () => {
    expect(collections.sellerContacts).toBe('sellerContacts');
    expect(collections.sellerContactAccessLogs).toBe('sellerContactAccessLogs');
    expect(collections.sellerContactRequesterLimits).toBe('sellerContactRequesterLimits');
    expect(collections.sellerContactSellerLimits).toBe('sellerContactSellerLimits');
  });

  it('converts canonical active and suspended account access documents', () => {
    const updatedAt = Timestamp.fromDate(new Date('2026-09-03T00:00:00.000Z'));
    expect(accountAccessConverter.fromFirestore({
      id: 'buyer-1',
      data: () => ({ status: 'active', confirmedViolationCount: 0, updatedAt }),
    } as never)).toEqual({
      uid: 'buyer-1', status: 'active', confirmedViolationCount: 0, updatedAt: updatedAt.toDate(),
    });

    const suspendedAt = Timestamp.fromDate(new Date('2026-09-02T00:00:00.000Z'));
    expect(accountAccessConverter.fromFirestore({
      id: 'seller-1',
      data: () => ({
        status: 'suspended', confirmedViolationCount: 2, suspensionReason: 'Reason',
        suspendedAt, suspendedBy: 'admin-1', suspensionActionId: 'action-1', updatedAt,
      }),
    } as never)).toEqual({
      uid: 'seller-1', status: 'suspended', confirmedViolationCount: 2,
      suspensionReason: 'Reason', suspendedAt: suspendedAt.toDate(), suspendedBy: 'admin-1',
      suspensionActionId: 'action-1',
      updatedAt: updatedAt.toDate(),
    });
  });

  it('writes only canonical account access fields and converts timestamps', () => {
    expect(accountAccessConverter.toFirestore({
      uid: 'seller-1', status: 'suspended', confirmedViolationCount: 2,
      suspensionReason: 'Reason', suspendedAt: new Date('2026-09-02T00:00:00.000Z'),
      suspendedBy: 'admin-1', suspensionActionId: 'action-1',
      updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    })).toEqual({
      status: 'suspended', confirmedViolationCount: 2, suspensionReason: 'Reason',
      suspendedAt: Timestamp.fromDate(new Date('2026-09-02T00:00:00.000Z')),
      suspendedBy: 'admin-1',
      suspensionActionId: 'action-1',
      updatedAt: Timestamp.fromDate(new Date('2026-09-03T00:00:00.000Z')),
    });
    expect(() => accountAccessConverter.toFirestore({
      uid: 'seller-1', status: 'suspended', confirmedViolationCount: 2,
      suspensionReason: 'Reason', suspendedAt: new Date(), suspendedBy: 'admin-1',
      suspensionActionId: 'action-1', updatedAt: new Date(), unknown: 'private',
    } as never)).toThrow('exact fields');
  });

  it.each([
    ['extra active field', { status: 'active', confirmedViolationCount: 0, updatedAt: Timestamp.now(), extra: true }],
    ['missing active field', { status: 'active', updatedAt: Timestamp.now() }],
    ['active suspension field', { status: 'active', confirmedViolationCount: 0, suspensionReason: 'No', updatedAt: Timestamp.now() }],
    ['missing suspended field', { status: 'suspended', confirmedViolationCount: 1, suspensionReason: 'Reason', updatedAt: Timestamp.now() }],
    ['malformed timestamp', { status: 'active', confirmedViolationCount: 0, updatedAt: new Date() }],
    ['unsupported status', { status: 'pending', confirmedViolationCount: 0, updatedAt: Timestamp.now() }],
  ])('rejects malformed account access data: %s', (_name, data) => {
    expect(() => accountAccessConverter.fromFirestore({ id: 'buyer-1', data: () => data } as never))
      .toThrow();
  });

  it('converts Firestore listing timestamps to Date values', () => {
    const snapshot = {
      id: 'listing-1',
      data: () => ({
        sellerId: 'seller-1',
        cardId: '1096',
        cardType: 'character',
        cardName: '鈴木園子',
        characterName: '鈴木園子',
        rarity: 'SR',
        imageUrls: ['https://example.com/card.jpg'],
        listingPrice: 500,
        originalQuantity: 5,
        remainingQuantity: 3,
        hasSleeve: true,
        supportsMyShip: true,
        status: 'active',
        createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
      }),
    };

    expect(listingConverter.fromFirestore(snapshot as never)).toMatchObject({
      id: 'listing-1',
      cardType: 'character',
      cardName: '鈴木園子',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T01:00:00.000Z'),
    });
  });

  it('round-trips only the exact suspension-held Listing fields', () => {
    const suspendedAt = Timestamp.fromDate(new Date('2026-09-05T00:00:00.000Z'));
    const createdAt = Timestamp.fromDate(new Date('2026-09-01T00:00:00.000Z'));
    const raw = {
      sellerId: 'seller-1', cardId: '2200', cardType: 'case', cardName: '封鎖現場',
      rarity: 'SR', imageUrls: ['https://example.com/card.jpg'], listingPrice: 500,
      originalQuantity: 5, remainingQuantity: 5, hasSleeve: false,
      supportsMyShip: false, status: 'suspended', suspensionActionId: 'action-1',
      suspendedAt, createdAt, updatedAt: suspendedAt,
    };
    const listing = listingConverter.fromFirestore({
      id: 'listing-held', data: () => raw,
    } as never);
    expect(listing).toMatchObject({
      id: 'listing-held', status: 'suspended', suspensionActionId: 'action-1',
      suspendedAt: suspendedAt.toDate(),
    });
    expect(listingConverter.toFirestore(listing)).toEqual(raw);
    expect(() => listingConverter.fromFirestore({
      id: 'listing-held', data: () => ({ ...raw, email: 'private@example.test' }),
    } as never)).toThrow();
  });

  it('converts a composite-key Card Master document to the normalized shape', () => {
    const snapshot = {
      id: 'card_abc',
      data: () => ({
        cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'],
      }),
    };

    expect(cardConverter.fromFirestore(snapshot as never)).toEqual({
      key: 'card_abc', cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'],
    });
  });

  it.each([
    ['document-ID cardId fallback', '0501', { characterName: '諸伏高明', rarities: ['D'] }],
    ['legacy nameZh', '0502', { nameZh: '毛利蘭', rarities: ['SR'] }],
    ['legacy nameJa', '0503', { nameJa: '江戸川コナン', rarities: ['R'] }],
    ['scalar rarity', 'card_scalar', {
      cardId: '0504', cardType: 'character', cardName: '灰原哀', rarity: 'R',
    }],
    ['an extra field', 'card_extra', {
      cardId: '0505', cardType: 'character', cardName: '工藤新一', rarities: ['R'], effect: 'forbidden',
    }],
  ] as const)('rejects non-canonical Card Master data: %s', (_name, id, data) => {
    const snapshot = { id, data: () => data };

    expect(() => cardConverter.fromFirestore(snapshot as never)).toThrow(
      'Card Master document requires exactly cardId, cardType, cardName, and rarities.',
    );
  });

  it('writes cardId with the allowlisted Card Master fields', () => {
    expect(cardConverter.toFirestore({
      key: 'card_abc', cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'],
      officialImageUrl: 'https://example.com/official.jpg', effectText: 'private card text', unknown: 'unknown',
    } as never)).toEqual({
      cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'],
    });
  });

  it('writes only allowlisted listing fields and omits an undefined note', () => {
    const result = listingConverter.toFirestore({
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: '1096',
      cardType: 'character',
      cardName: '鈴木園子',
      characterName: '鈴木園子',
      rarity: 'SR',
      imageUrls: ['https://example.com/card.jpg'],
      listingPrice: 500,
      originalQuantity: 2,
      remainingQuantity: 2,
      hasSleeve: true,
      supportsMyShip: false,
      note: undefined,
      status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T01:00:00.000Z'),
      email: 'seller@example.com',
      unknown: 'unknown',
    } as never);

    expect(result).toEqual({
      sellerId: 'seller-1',
      cardId: '1096',
      cardType: 'character',
      cardName: '鈴木園子',
      characterName: '鈴木園子',
      rarity: 'SR',
      imageUrls: ['https://example.com/card.jpg'],
      listingPrice: 500,
      originalQuantity: 2,
      remainingQuantity: 2,
      hasSleeve: true,
      supportsMyShip: false,
      status: 'active',
      createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
      updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
    });
  });

  it('writes generic event listing metadata without a characterName field', () => {
    const result = listingConverter.toFirestore({
      id: 'listing-event', sellerId: 'seller-1', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarity: 'C',
      imageUrls: ['https://example.com/card.jpg'], listingPrice: 500, originalQuantity: 1, remainingQuantity: 1,
      hasSleeve: false, supportsMyShip: false, status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'), updatedAt: new Date('2026-08-17T01:00:00.000Z'),
    });

    expect(result).toMatchObject({
      sellerId: 'seller-1', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarity: 'C',
    });
    expect(result).not.toHaveProperty('characterName');
  });

  it('maps a legacy characterName-only Listing to a character snapshot', () => {
    const snapshot = {
      id: 'legacy-listing',
      data: () => ({
        sellerId: 'seller-1', cardId: 'CT-P01-001', characterName: '鈴木園子', rarity: 'SR', imageUrls: ['https://example.com/card.jpg'],
        listingPrice: 500, originalQuantity: 1, remainingQuantity: 1, hasSleeve: false, supportsMyShip: false, status: 'active',
        createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
      }),
    };

    expect(listingConverter.fromFirestore(snapshot as never)).toMatchObject({
      cardType: 'character', cardName: '鈴木園子', characterName: '鈴木園子',
    });
  });

  it('rejects a partial normalized event Listing that contains characterName', () => {
    const snapshot = {
      id: 'partial-event-listing',
      data: () => ({
        sellerId: 'seller-1', cardId: '1100', cardType: 'event', characterName: '偽角色', rarity: 'C', imageUrls: ['https://example.com/card.jpg'],
        listingPrice: 500, originalQuantity: 1, remainingQuantity: 1, hasSleeve: false, supportsMyShip: false, status: 'active',
        createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
      }),
    };

    expect(() => listingConverter.fromFirestore(snapshot as never))
      .toThrow('Non-character Listing cannot contain characterName.');
  });

  it('does not map characterName to cardName when a normalized Listing field is present', () => {
    const snapshot = {
      id: 'partial-character-listing',
      data: () => ({
        sellerId: 'seller-1', cardId: '1096', cardType: 'character', characterName: '鈴木園子', rarity: 'SR', imageUrls: ['https://example.com/card.jpg'],
        listingPrice: 500, originalQuantity: 1, remainingQuantity: 1, hasSleeve: false, supportsMyShip: false, status: 'active',
        createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
      }),
    };

    expect(() => listingConverter.fromFirestore(snapshot as never))
      .toThrow('Listing requires cardType, cardName, and rarity snapshots.');
  });

  it('converts only a strict public seller profile to Date values', () => {
    const snapshot = {
      id: 'seller-1',
      data: () => ({
        displayName: 'Seller',
        createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
      }),
    };

    expect(publicSellerProfileConverter.fromFirestore(snapshot as never)).toEqual({
      uid: 'seller-1',
      displayName: 'Seller',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T01:00:00.000Z'),
    });
  });

  it('writes only allowlisted public seller profile fields', () => {
    expect(
      publicSellerProfileConverter.toFirestore({
        uid: 'seller-1',
        displayName: 'Seller',
        createdAt: new Date('2026-08-17T00:00:00.000Z'),
        updatedAt: new Date('2026-08-17T01:00:00.000Z'),
        contactType: 'line',
        contactValue: 'must-not-be-public',
        email: 'seller@example.com',
        unknown: 'unknown',
      } as never),
    ).toEqual({
      displayName: 'Seller',
      createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
      updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
    });
  });

  it.each([
    ['legacy contact fields', {
      displayName: 'Seller', contactType: 'line', contactValue: 'seller-line',
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }],
    ['an unknown field', {
      displayName: 'Seller', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), extra: true,
    }],
    ['a noncanonical display name', {
      displayName: ' Seller', createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }],
  ])('rejects non-public seller profile data: %s', (_name, data) => {
    expect(() => publicSellerProfileConverter.fromFirestore({
      id: 'seller-1', data: () => data,
    } as never)).toThrow();
  });

  it('converts sale timestamps to Date values', () => {
    const snapshot = {
      id: 'sale-1',
      data: () => ({
        listingId: 'listing-1',
        sellerId: 'seller-1',
        cardId: '1096',
        quantity: 2,
        listingUnitPrice: 500,
        soldUnitPrice: 450,
        soldAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
      }),
    };

    expect(saleConverter.fromFirestore(snapshot as never)).toMatchObject({
      id: 'sale-1',
      soldAt: new Date('2026-08-17T00:00:00.000Z'),
    });
  });

  it('writes the exact current sale snapshot fields', () => {
    expect(
      saleConverter.toFirestore({
        id: 'sale-1',
        listingId: 'listing-1',
        sellerId: 'seller-1',
        cardId: 'CT-P01-001',
        cardType: 'event',
        cardName: '追跡開始',
        rarity: 'C',
        quantity: 2,
        listingUnitPrice: 500,
        soldUnitPrice: 450,
        soldAt: new Date('2026-08-17T00:00:00.000Z'),
      }),
    ).toEqual({
      listingId: 'listing-1',
      sellerId: 'seller-1',
      cardId: 'CT-P01-001',
      cardType: 'event',
      cardName: '追跡開始',
      rarity: 'C',
      quantity: 2,
      listingUnitPrice: 500,
      soldUnitPrice: 450,
      soldAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
    });
  });

  it('rejects partial, unknown-field, and malformed persisted sale shapes', () => {

    const current = {
      listingId: 'listing-1', sellerId: 'seller-1', cardId: '2200',
      cardType: 'case', cardName: '封鎖現場', rarity: 'SR', quantity: 2,
      listingUnitPrice: 500, soldUnitPrice: 450,
      soldAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
    };

    expect(() => saleConverter.fromFirestore({
      id: 'sale-1', data: () => ({ ...current, rarity: undefined }),
    } as never)).toThrow();
    expect(() => saleConverter.fromFirestore({
      id: 'sale-1', data: () => ({ ...current, contactValue: 'private' }),
    } as never)).toThrow('fields');
    expect(() => saleConverter.fromFirestore({
      id: 'sale-1', data: () => ({ ...current, soldAt: new Date() }),
    } as never)).toThrow();
    expect(() => saleConverter.toFirestore({ ...current, id: 'sale-1', unknown: true } as never))
      .toThrow('fields');
  });

  it('writes canonical card-name and seller subscription fields with Timestamps', () => {
    expect(
      notificationSubscriptionConverter.toFirestore({
        uid: 'buyer-1',
        cardNames: ['江戶川柯南', '洗牌情緣'],
        sellerSubscriptions: [{
          sellerId: 'seller-a',
          followedAt: new Date('2026-08-24T00:00:00.000Z'),
        }],
        emailDailyEnabled: true,
        updatedAt: new Date('2026-08-25T00:00:00.000Z'),
        email: 'buyer@example.com',
        unknown: 'unknown',
      } as never),
    ).toEqual({
      cardNames: ['江戶川柯南', '洗牌情緣'],
      sellerSubscriptions: [{ sellerId: 'seller-a', followedAt: expect.any(Timestamp) }],
      emailDailyEnabled: true,
      updatedAt: expect.any(Timestamp),
    });
  });

  it('reads the previous card-name-only shape as an empty seller list', () => {
    const snapshot = {
      id: 'buyer-1',
      data: () => ({
        cardNames: ['江戶川柯南'],
        emailDailyEnabled: false,
        updatedAt: Timestamp.fromDate(new Date('2026-08-25T00:00:00.000Z')),
      }),
    };

    expect(notificationSubscriptionConverter.fromFirestore(snapshot as never)).toEqual({
      uid: 'buyer-1',
      cardNames: ['江戶川柯南'],
      sellerSubscriptions: [],
      emailDailyEnabled: false,
      updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    });
  });

  it('converts canonical seller subscription Timestamps to Date values', () => {
    const followedAt = Timestamp.fromDate(new Date('2026-08-24T00:00:00.000Z'));
    const updatedAt = Timestamp.fromDate(new Date('2026-08-25T00:00:00.000Z'));
    const snapshot = {
      id: 'buyer-1',
      data: () => ({
        cardNames: [],
        sellerSubscriptions: [{ sellerId: 'seller-a', followedAt }],
        emailDailyEnabled: true,
        updatedAt,
      }),
    };

    expect(notificationSubscriptionConverter.fromFirestore(snapshot as never)).toEqual({
      uid: 'buyer-1',
      cardNames: [],
      sellerSubscriptions: [{ sellerId: 'seller-a', followedAt: followedAt.toDate() }],
      emailDailyEnabled: true,
      updatedAt: updatedAt.toDate(),
    });
  });

  it.each([
    ['partial seller entry', [{ sellerId: 'seller-a' }]],
    ['extra seller entry field', [{
      sellerId: 'seller-a', followedAt: Timestamp.now(), contactValue: 'private',
    }]],
    ['non-Timestamp follow date', [{ sellerId: 'seller-a', followedAt: new Date() }]],
  ])('rejects malformed persisted seller subscriptions: %s', (_name, sellerSubscriptions) => {
    expect(() => notificationSubscriptionConverter.fromFirestore({
      id: 'buyer-1',
      data: () => ({
        cardNames: [], sellerSubscriptions, emailDailyEnabled: true, updatedAt: Timestamp.now(),
      }),
    } as never)).toThrow('seller subscriptions');
  });

  it('rejects a legacy character-key subscription document', () => {
    const snapshot = {
      id: 'buyer-1',
      data: () => ({
        characterKeys: ['suzuki-sonoko'],
        emailDailyEnabled: true,
        updatedAt: Timestamp.fromDate(new Date('2026-08-25T00:00:00.000Z')),
      }),
    };

    expect(() => notificationSubscriptionConverter.fromFirestore(snapshot as never)).toThrow('cardNames');
  });

  it('rejects malformed Firestore listing data', () => {
    const snapshot = {
      id: 'listing-1',
      data: () => ({
        sellerId: 'seller-1',
        cardId: 'CT-P01-001',
        imageUrls: [123],
        listingPrice: Number.POSITIVE_INFINITY,
        originalQuantity: 1.5,
        remainingQuantity: 1,
        hasSleeve: 'true',
        supportsMyShip: true,
        status: 'invalid',
        createdAt: new Date(),
        updatedAt: Timestamp.now(),
      }),
    };

    expect(() => listingConverter.fromFirestore(snapshot as never)).toThrow();
  });

  it('rejects malformed Firestore card optional fields', () => {
    const snapshot = {
      id: '1096',
      data: () => ({ cardType: 'character', cardName: 123, rarities: ['CP'] }),
    };

    expect(() => cardConverter.fromFirestore(snapshot as never)).toThrow();
  });
});
