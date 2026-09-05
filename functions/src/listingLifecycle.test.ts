import { describe, expect, it, vi } from 'vitest';
import {
  ListingLifecycleError,
  handleDeleteUnsoldListing,
  handleRecordListingSale,
  handleUpdateSellerListing,
  type ListingLifecycleDependencies,
  type ListingLifecycleTransaction,
} from './listingLifecycle.js';

const NOW = new Date('2026-09-04T08:30:00.000Z');
const EARLIER = new Date('2026-09-01T00:00:00.000Z');

function activeAccess() {
  return { status: 'active', confirmedViolationCount: 0, updatedAt: EARLIER };
}

function listing(overrides: Record<string, unknown> = {}) {
  return {
    sellerId: 'seller-1', cardId: '2200', cardType: 'case', cardName: '封鎖現場',
    rarity: 'SR', imageUrls: ['https://example.com/card.jpg'], listingPrice: 500,
    originalQuantity: 5, remainingQuantity: 5, hasSleeve: false,
    supportsMyShip: false, status: 'active', createdAt: EARLIER, updatedAt: EARLIER,
    ...overrides,
  };
}

interface State {
  access: Record<string, unknown | null>;
  listings: Record<string, Record<string, unknown> | null>;
  saleListingIds: Set<string>;
  createdSale?: { id: string; data: Record<string, unknown> };
  updatedListing?: { id: string; patch: Record<string, unknown> };
  deletedListingId?: string;
}

function harness(initial: Partial<State> = {}) {
  const state: State = {
    access: { 'seller-1': activeAccess() },
    listings: { 'listing-1': listing() },
    saleListingIds: new Set(),
    ...initial,
  };
  const transaction: ListingLifecycleTransaction = {
    getAccountAccess: vi.fn(async (uid) => state.access[uid] ?? null),
    getListing: vi.fn(async (id) => state.listings[id] ?? null),
    hasSaleForListing: vi.fn(async (id) => state.saleListingIds.has(id)),
    createSale: vi.fn((id, data) => { state.createdSale = { id, data }; }),
    updateListing: vi.fn((id, patch) => {
      state.updatedListing = { id, patch: patch as unknown as Record<string, unknown> };
    }),
    deleteListing: vi.fn((id) => { state.deletedListingId = id; }),
  };
  const dependencies: ListingLifecycleDependencies = {
    now: () => NOW,
    randomId: () => 'sale-1',
    runTransaction: async (operation) => operation(transaction),
  };
  return { state, transaction, dependencies };
}

function expectCode(operation: Promise<unknown>, code: string) {
  return expect(operation).rejects.toMatchObject({ code });
}

describe('trusted listing lifecycle', () => {
  it('records a normalized partial Sale and availability atomically', async () => {
    const { state, dependencies } = harness();

    await expect(handleRecordListingSale({
      authUid: 'seller-1', data: { listingId: 'listing-1', quantity: 2, soldUnitPrice: 450 },
    }, dependencies)).resolves.toEqual({
      sale: {
        id: 'sale-1', listingId: 'listing-1', sellerId: 'seller-1', cardId: '2200',
        cardType: 'case', cardName: '封鎖現場', rarity: 'SR', quantity: 2,
        listingUnitPrice: 500, soldUnitPrice: 450, soldAt: NOW.valueOf(),
      },
      listing: { remainingQuantity: 3, status: 'active', updatedAt: NOW.valueOf() },
    });
    expect(state.createdSale).toEqual({
      id: 'sale-1',
      data: {
        listingId: 'listing-1', sellerId: 'seller-1', cardId: '2200',
        cardType: 'case', cardName: '封鎖現場', rarity: 'SR', quantity: 2,
        listingUnitPrice: 500, soldUnitPrice: 450, soldAt: NOW,
      },
    });
    expect(state.updatedListing).toEqual({
      id: 'listing-1',
      patch: { remainingQuantity: 3, status: 'active', updatedAt: NOW },
    });
    expect(JSON.stringify(state.createdSale)).not.toContain('contact');
  });

  it('derives sold_out exactly when the final unit is sold', async () => {
    const { dependencies } = harness({ listings: { 'listing-1': listing({ remainingQuantity: 2 }) } });
    await expect(handleRecordListingSale({
      authUid: 'seller-1', data: { listingId: 'listing-1', quantity: 2, soldUnitPrice: 500 },
    }, dependencies)).resolves.toMatchObject({
      listing: { remainingQuantity: 0, status: 'sold_out', updatedAt: NOW.valueOf() },
    });
  });

  it('accepts optional enabled-service fees and loopback Emulator image URLs', async () => {
    const { dependencies } = harness({
      listings: {
        'listing-1': listing({
          hasSleeve: true,
          imageUrls: ['http://127.0.0.1:9199/v0/b/demo/o/listings%2Fcard.jpg?alt=media'],
        }),
      },
    });

    await expect(handleRecordListingSale({
      authUid: 'seller-1', data: { listingId: 'listing-1', quantity: 1, soldUnitPrice: 500 },
    }, dependencies)).resolves.toMatchObject({ sale: { id: 'sale-1' } });
  });

  it.each([
    [null, { listingId: 'listing-1', quantity: 1, soldUnitPrice: 500 }, 'unauthenticated'],
    ['seller-1', { listingId: 'listing-1', quantity: 0, soldUnitPrice: 500 }, 'invalid-argument'],
    ['seller-1', { listingId: 'listing-1', quantity: 1.5, soldUnitPrice: 500 }, 'invalid-argument'],
    ['seller-1', { listingId: 'listing-1', quantity: 1, soldUnitPrice: 0 }, 'invalid-argument'],
    ['seller-1', { listingId: 'listing-1', quantity: 1, soldUnitPrice: Number.NaN }, 'invalid-argument'],
    ['seller-1', { listingId: 'listing-1', quantity: 1, soldUnitPrice: 500, sellerId: 'seller-1' }, 'invalid-argument'],
  ])('rejects malformed Sale request %#', async (authUid, data, code) => {
    const { dependencies } = harness();
    await expectCode(handleRecordListingSale({ authUid, data }, dependencies), code);
  });

  it.each([
    ['oversell', listing({ remainingQuantity: 1 }), 'failed-precondition'],
    ['sold-out', listing({ remainingQuantity: 0, status: 'sold_out' }), 'failed-precondition'],
    ['wrong owner', listing({ sellerId: 'seller-2' }), 'permission-denied'],
    ['malformed snapshot', listing({ rarity: undefined }), 'failed-precondition'],
  ])('makes no mutation for %s', async (_name, storedListing, code) => {
    const { state, dependencies } = harness({ listings: { 'listing-1': storedListing } });
    await expectCode(handleRecordListingSale({
      authUid: 'seller-1', data: { listingId: 'listing-1', quantity: 2, soldUnitPrice: 500 },
    }, dependencies), code);
    expect(state.createdSale).toBeUndefined();
    expect(state.updatedListing).toBeUndefined();
  });

  it.each([
    ['suspended', { status: 'suspended', confirmedViolationCount: 1, suspensionReason: 'Reason', suspendedAt: EARLIER, suspendedBy: 'admin-1', updatedAt: EARLIER }],
    ['malformed active', { ...activeAccess(), extra: true }],
  ])('denies every mutation for %s access', async (_name, access) => {
    const { dependencies } = harness({ access: { 'seller-1': access } });
    await expectCode(handleRecordListingSale({
      authUid: 'seller-1', data: { listingId: 'listing-1', quantity: 1, soldUnitPrice: 500 },
    }, dependencies), 'permission-denied');
    await expectCode(handleUpdateSellerListing({
      authUid: 'seller-1', data: updateInput(),
    }, dependencies), 'permission-denied');
    await expectCode(handleDeleteUnsoldListing({
      authUid: 'seller-1', data: { listingId: 'listing-1', expectedUpdatedAt: EARLIER.valueOf() },
    }, dependencies), 'permission-denied');
  });

  it('treats a missing account-access document as active', async () => {
    const { dependencies } = harness({ access: {} });
    await expect(handleRecordListingSale({
      authUid: 'seller-1', data: { listingId: 'listing-1', quantity: 1, soldUnitPrice: 500 },
    }, dependencies)).resolves.toMatchObject({ sale: { id: 'sale-1' } });
  });

  it('rejects concurrent overselling through the current transactional snapshot', async () => {
    const { state, dependencies } = harness({
      listings: { 'listing-1': listing({ remainingQuantity: 1 }) },
    });
    await expectCode(handleRecordListingSale({
      authUid: 'seller-1', data: { listingId: 'listing-1', quantity: 2, soldUnitPrice: 500 },
    }, dependencies), 'failed-precondition');
    expect(state.createdSale).toBeUndefined();
  });

  it('updates only editable fields and returns the canonical updated Listing', async () => {
    const { state, dependencies } = harness();
    await expect(handleUpdateSellerListing({
      authUid: 'seller-1', data: updateInput({ listingPrice: 475, note: '  保存盒裝  ' }),
    }, dependencies)).resolves.toEqual({
      id: 'listing-1', ...listing({
        imageUrls: ['https://example.com/new.jpg'], listingPrice: 475,
        hasSleeve: true, sleeveFee: 10, note: '保存盒裝', updatedAt: NOW,
      }),
      createdAt: EARLIER.valueOf(), updatedAt: NOW.valueOf(),
    });
    expect(state.updatedListing).toEqual({
      id: 'listing-1',
      patch: {
        imageUrls: ['https://example.com/new.jpg'], listingPrice: 475,
        hasSleeve: true, sleeveFee: 10, supportsMyShip: false,
        myShipFee: null, note: '保存盒裝', updatedAt: NOW,
      },
    });
    expect(state.updatedListing?.patch).not.toHaveProperty('remainingQuantity');
    expect(state.updatedListing?.patch).not.toHaveProperty('status');
  });

  it('edits a held Listing without making it active or changing its hold', async () => {
    const held = listing({
      status: 'suspended', suspensionActionId: 'action-1', suspendedAt: EARLIER,
    });
    const { state, dependencies } = harness({ listings: { 'listing-1': held } });
    await expect(handleUpdateSellerListing({
      authUid: 'seller-1', data: updateInput({ listingPrice: 475 }),
    }, dependencies)).resolves.toMatchObject({
      status: 'suspended', suspensionActionId: 'action-1', suspendedAt: EARLIER.valueOf(),
      listingPrice: 475,
    });
    expect(state.updatedListing?.patch).not.toHaveProperty('status');
    expect(state.updatedListing?.patch).not.toHaveProperty('suspensionActionId');
    expect(state.updatedListing?.patch).not.toHaveProperty('suspendedAt');
  });

  it('never records a Sale for a held Listing', async () => {
    const { state, dependencies } = harness({ listings: { 'listing-1': listing({
      status: 'suspended', suspensionActionId: 'action-1', suspendedAt: EARLIER,
    }) } });
    await expectCode(handleRecordListingSale({
      authUid: 'seller-1', data: { listingId: 'listing-1', quantity: 1, soldUnitPrice: 500 },
    }, dependencies), 'failed-precondition');
    expect(state.createdSale).toBeUndefined();
    expect(state.updatedListing).toBeUndefined();
  });

  it('updates mutable fields on a recognized legacy Listing without persisting guessed identity', async () => {
    const legacy = listing({
      cardType: undefined, cardName: undefined, rarity: undefined,
      characterName: undefined,
    });
    delete legacy.cardType;
    delete legacy.cardName;
    delete legacy.rarity;
    delete legacy.characterName;
    const { state, dependencies } = harness({ listings: { 'listing-1': legacy } });

    await expect(handleUpdateSellerListing({
      authUid: 'seller-1', data: updateInput({ listingPrice: 475 }),
    }, dependencies)).resolves.toEqual({
      id: 'listing-1', ...legacy, imageUrls: ['https://example.com/new.jpg'],
      listingPrice: 475, hasSleeve: true, sleeveFee: 10,
      createdAt: EARLIER.valueOf(), updatedAt: NOW.valueOf(),
    });
    expect(state.updatedListing?.patch).not.toHaveProperty('cardType');
    expect(state.updatedListing?.patch).not.toHaveProperty('cardName');
    expect(state.updatedListing?.patch).not.toHaveProperty('rarity');
  });

  it('does not create a new Sale when a legacy Listing lacks immutable snapshots', async () => {
    const legacy = listing({ cardType: undefined, cardName: undefined });
    delete legacy.cardType;
    delete legacy.cardName;
    const { state, dependencies } = harness({ listings: { 'listing-1': legacy } });
    await expectCode(handleRecordListingSale({
      authUid: 'seller-1', data: { listingId: 'listing-1', quantity: 1, soldUnitPrice: 450 },
    }, dependencies), 'failed-precondition');
    expect(state.createdSale).toBeUndefined();
  });

  it.each([
    ['stale version', updateInput({ expectedUpdatedAt: NOW.valueOf() }), 'aborted'],
    ['sold-out listing', updateInput(), 'failed-precondition', listing({ remainingQuantity: 0, status: 'sold_out' })],
    ['inventory injection', { ...updateInput(), remainingQuantity: 4 }, 'invalid-argument'],
    ['unknown field', { ...updateInput(), cardId: '9999' }, 'invalid-argument'],
  ])('rejects %s updates', async (_name, data, code, storedListing = listing()) => {
    const { state, dependencies } = harness({ listings: { 'listing-1': storedListing } });
    await expectCode(handleUpdateSellerListing({ authUid: 'seller-1', data }, dependencies), code);
    expect(state.updatedListing).toBeUndefined();
  });

  it('deletes only an unsold active Listing and returns stored image URLs', async () => {
    const { state, transaction, dependencies } = harness();
    await expect(handleDeleteUnsoldListing({
      authUid: 'seller-1',
      data: { listingId: 'listing-1', expectedUpdatedAt: EARLIER.valueOf() },
    }, dependencies)).resolves.toEqual({ imageUrls: ['https://example.com/card.jpg'] });
    expect(transaction.hasSaleForListing).toHaveBeenCalledWith('listing-1');
    expect(state.deletedListingId).toBe('listing-1');
  });

  it('deletes an unsold held Listing only while its owner account is active', async () => {
    const { state, dependencies } = harness({ listings: { 'listing-1': listing({
      status: 'suspended', suspensionActionId: 'action-1', suspendedAt: EARLIER,
    }) } });
    await expect(handleDeleteUnsoldListing({
      authUid: 'seller-1',
      data: { listingId: 'listing-1', expectedUpdatedAt: EARLIER.valueOf() },
    }, dependencies)).resolves.toEqual({ imageUrls: ['https://example.com/card.jpg'] });
    expect(state.deletedListingId).toBe('listing-1');
  });

  it.each([
    ['missing action', { status: 'suspended', suspendedAt: EARLIER }],
    ['missing time', { status: 'suspended', suspensionActionId: 'action-1' }],
    ['hold on active', { status: 'active', suspensionActionId: 'action-1', suspendedAt: EARLIER }],
  ])('rejects malformed Listing hold: %s', async (_label, override) => {
    const { state, dependencies } = harness({
      listings: { 'listing-1': listing(override) },
    });
    await expectCode(handleUpdateSellerListing({
      authUid: 'seller-1', data: updateInput(),
    }, dependencies), 'failed-precondition');
    expect(state.updatedListing).toBeUndefined();
  });

  it('allows an unsold recognized legacy Listing to be deleted without identity migration', async () => {
    const legacy = listing({ cardType: undefined, cardName: undefined, rarity: undefined });
    delete legacy.cardType;
    delete legacy.cardName;
    delete legacy.rarity;
    const { state, dependencies } = harness({ listings: { 'listing-1': legacy } });
    await expect(handleDeleteUnsoldListing({
      authUid: 'seller-1',
      data: { listingId: 'listing-1', expectedUpdatedAt: EARLIER.valueOf() },
    }, dependencies)).resolves.toEqual({ imageUrls: ['https://example.com/card.jpg'] });
    expect(state.deletedListingId).toBe('listing-1');
  });

  it.each([
    ['history exists', new Set(['listing-1']), listing(), 'failed-precondition'],
    ['inventory was sold', new Set<string>(), listing({ remainingQuantity: 4 }), 'failed-precondition'],
    ['sold-out', new Set(['listing-1']), listing({ remainingQuantity: 0, status: 'sold_out' }), 'failed-precondition'],
  ])('does not delete when %s', async (_name, saleListingIds, storedListing, code) => {
    const { state, dependencies } = harness({
      saleListingIds, listings: { 'listing-1': storedListing },
    });
    await expectCode(handleDeleteUnsoldListing({
      authUid: 'seller-1',
      data: { listingId: 'listing-1', expectedUpdatedAt: EARLIER.valueOf() },
    }, dependencies), code);
    expect(state.deletedListingId).toBeUndefined();
  });

  it('uses stable lifecycle error objects', () => {
    expect(new ListingLifecycleError('aborted', 'stale')).toMatchObject({
      name: 'ListingLifecycleError', code: 'aborted', message: 'stale',
    });
  });
});

function updateInput(overrides: Record<string, unknown> = {}) {
  return {
    listingId: 'listing-1', expectedUpdatedAt: EARLIER.valueOf(),
    imageUrls: ['https://example.com/new.jpg'], listingPrice: 450,
    hasSleeve: true, sleeveFee: 10, supportsMyShip: false, myShipFee: null,
    note: null, ...overrides,
  };
}
