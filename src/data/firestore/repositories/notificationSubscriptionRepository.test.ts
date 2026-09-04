import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  class Timestamp {
    private constructor(private readonly value: Date) {}

    static fromDate(value: Date) {
      return new Timestamp(new Date(value));
    }

    toDate() {
      return new Date(this.value);
    }
  }

  return {
    Timestamp,
    connectFirestoreEmulator: vi.fn(),
    deleteDoc: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getFirestore: vi.fn(() => ({ type: 'firestore' })),
    runTransaction: vi.fn(),
  };
});
const firebaseApp = vi.hoisted(() => ({
  firebaseApp: { name: 'test-app' },
  auth: { currentUser: { uid: 'buyer-1' as string | null } },
  firebaseEmulatorConfig: null,
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../../../lib/firebase/app', () => firebaseApp);

import {
  addNotificationCardName,
  addNotificationSeller,
  deleteNotificationSubscription,
  getNotificationSubscription,
  removeNotificationCardName,
  removeNotificationSeller,
  setNotificationEmailDailyEnabled,
} from './notificationSubscriptionRepository';
import { collections } from '../paths';

type StoredSubscription = Record<string, unknown>;

describe('notification subscription repository', () => {
  const rawDocument = { type: 'notification-subscription-document' };
  let serverData: StoredSubscription | undefined;

  const timestamp = (value = '2026-08-25T00:00:00.000Z') => firestore.Timestamp
    .fromDate(new Date(value));
  const currentData = (
    cardNames = ['鈴木園子'],
    emailDailyEnabled = true,
  ): StoredSubscription => ({
    cardNames,
    emailDailyEnabled,
    updatedAt: timestamp(),
  });
  const sellerData = (
    sellerSubscriptions: Array<{ sellerId: string; followedAt?: string }> = [],
    cardNames = ['鈴木園子'],
    emailDailyEnabled = true,
  ): StoredSubscription => ({
    cardNames,
    sellerSubscriptions: sellerSubscriptions.map(({ sellerId, followedAt }) => ({
      sellerId,
      followedAt: timestamp(followedAt),
    })),
    emailDailyEnabled,
    updatedAt: timestamp(),
  });
  const snapshot = () => ({
    exists: () => serverData !== undefined,
    data: () => serverData,
  });

  function installImmediateTransactions() {
    firestore.runTransaction.mockImplementation(async (
      _database: unknown,
      operation: (transaction: {
        get(reference: unknown): Promise<ReturnType<typeof snapshot>>;
        set(reference: unknown, data: StoredSubscription): void;
      }) => unknown,
    ) => operation({
      get: vi.fn(async () => snapshot()),
      set: vi.fn((_reference, data) => {
        serverData = data;
      }),
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    serverData = currentData();
    firestore.doc.mockReturnValue(rawDocument);
    firestore.getDoc.mockImplementation(async () => snapshot());
    firebaseApp.auth.currentUser = { uid: 'buyer-1' };
    installImmediateTransactions();
  });

  it('reads a strict current server document for the authenticated buyer', async () => {
    await expect(getNotificationSubscription('buyer-1')).resolves.toEqual({
      uid: 'buyer-1',
      cardNames: ['鈴木園子'],
      sellerSubscriptions: [],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    });
    expect(firestore.doc).toHaveBeenCalledWith(
      expect.anything(),
      collections.notificationSubscriptions,
      'buyer-1',
    );
  });

  it('returns null for a missing document or a specifically recognized legacy-only document', async () => {
    serverData = undefined;
    await expect(getNotificationSubscription('buyer-1')).resolves.toBeNull();

    serverData = {
      characterKeys: ['suzuki-sonoko'],
      emailDailyEnabled: true,
      updatedAt: timestamp(),
    };
    await expect(getNotificationSubscription('buyer-1')).resolves.toBeNull();
  });

  it('atomically adds one exact raw name and overwrites a recognized legacy-only document', async () => {
    serverData = {
      characterKeys: ['suzuki-sonoko'],
      emailDailyEnabled: false,
      updatedAt: timestamp(),
    };

    const saved = await addNotificationCardName('buyer-1', '江戶川柯南');

    expect(saved).toMatchObject({
      uid: 'buyer-1',
      cardNames: ['江戶川柯南'],
      sellerSubscriptions: [],
      emailDailyEnabled: true,
    });
    expect(serverData).toEqual({
      cardNames: ['江戶川柯南'],
      sellerSubscriptions: [],
      emailDailyEnabled: true,
      updatedAt: expect.any(firestore.Timestamp),
    });
  });

  it('rejects an invalid or 101st add without writing the server document', async () => {
    serverData = currentData(Array.from({ length: 100 }, (_, index) => `卡名-${index}`));
    const original = serverData;

    await expect(addNotificationCardName('buyer-1', ' 　 ')).rejects.toThrow();
    await expect(addNotificationCardName('buyer-1', '第一百零一張')).rejects.toThrow(/at most 100/);

    expect(serverData).toBe(original);
  });

  it('preserves reverse-order concurrent additions by reading current server state in each transaction', async () => {
    serverData = currentData([]);
    const deferredTransactions: Array<() => Promise<void>> = [];
    firestore.runTransaction.mockImplementation((
      _database: unknown,
      operation: (transaction: {
        get(reference: unknown): Promise<ReturnType<typeof snapshot>>;
        set(reference: unknown, data: StoredSubscription): void;
      }) => unknown,
    ) => new Promise((resolve, reject) => {
      deferredTransactions.push(async () => {
        try {
          const result = await operation({
            get: vi.fn(async () => snapshot()),
            set: vi.fn((_reference, data) => {
              serverData = data;
            }),
          });
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    }));

    const addConan = addNotificationCardName('buyer-1', '江戶川柯南');
    const addHaibara = addNotificationCardName('buyer-1', '灰原哀');
    await deferredTransactions[1]?.();
    await deferredTransactions[0]?.();
    await Promise.all([addConan, addHaibara]);

    expect(serverData?.cardNames).toEqual(['灰原哀', '江戶川柯南']);
  });

  it('does not lose a concurrent addition or resurrect an exact removal when operations finish in reverse', async () => {
    serverData = currentData(['江戶川柯南']);
    const deferredTransactions: Array<() => Promise<void>> = [];
    firestore.runTransaction.mockImplementation((
      _database: unknown,
      operation: (transaction: {
        get(reference: unknown): Promise<ReturnType<typeof snapshot>>;
        set(reference: unknown, data: StoredSubscription): void;
      }) => unknown,
    ) => new Promise((resolve, reject) => {
      deferredTransactions.push(async () => {
        try {
          const result = await operation({
            get: vi.fn(async () => snapshot()),
            set: vi.fn((_reference, data) => {
              serverData = data;
            }),
          });
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    }));

    const removeConan = removeNotificationCardName('buyer-1', '江戶川柯南');
    const addHaibara = addNotificationCardName('buyer-1', '灰原哀');
    await deferredTransactions[1]?.();
    await deferredTransactions[0]?.();
    await Promise.all([removeConan, addHaibara]);

    expect(serverData?.cardNames).toEqual(['灰原哀']);
  });

  it('atomically changes only the email preference while preserving every server name', async () => {
    serverData = currentData(['洗牌情緣', '江戶川柯南']);

    const saved = await setNotificationEmailDailyEnabled('buyer-1', false);

    expect(saved).toMatchObject({
      cardNames: ['洗牌情緣', '江戶川柯南'],
      emailDailyEnabled: false,
    });
    expect(serverData).toMatchObject({
      cardNames: ['洗牌情緣', '江戶川柯南'],
      emailDailyEnabled: false,
    });
  });

  it('adds a seller by UID with follow time, sorted identity, and preserved card criteria', async () => {
    serverData = sellerData(
      [{ sellerId: 'seller-z', followedAt: '2026-09-01T00:00:00.000Z' }],
      ['江戶川柯南'],
      false,
    );
    const followedAt = new Date('2026-09-04T03:00:00.000Z');

    const saved = await addNotificationSeller('buyer-1', 'seller-a', followedAt);

    expect(saved).toEqual({
      uid: 'buyer-1',
      cardNames: ['江戶川柯南'],
      sellerSubscriptions: [
        { sellerId: 'seller-a', followedAt },
        { sellerId: 'seller-z', followedAt: new Date('2026-09-01T00:00:00.000Z') },
      ],
      emailDailyEnabled: true,
      updatedAt: expect.any(Date),
    });
    expect(serverData).toEqual({
      cardNames: ['江戶川柯南'],
      sellerSubscriptions: [
        { sellerId: 'seller-a', followedAt: expect.any(firestore.Timestamp) },
        { sellerId: 'seller-z', followedAt: expect.any(firestore.Timestamp) },
      ],
      emailDailyEnabled: true,
      updatedAt: expect.any(firestore.Timestamp),
    });
  });

  it('re-adding a seller is idempotent and retains the original follow time', async () => {
    serverData = sellerData([{ sellerId: 'seller-a', followedAt: '2026-09-01T00:00:00.000Z' }]);

    const saved = await addNotificationSeller(
      'buyer-1',
      'seller-a',
      new Date('2026-09-04T00:00:00.000Z'),
    );

    expect(saved.sellerSubscriptions).toEqual([{
      sellerId: 'seller-a', followedAt: new Date('2026-09-01T00:00:00.000Z'),
    }]);
  });

  it('removes only one seller while preserving card names and preference', async () => {
    serverData = sellerData([
      { sellerId: 'seller-a', followedAt: '2026-09-01T00:00:00.000Z' },
      { sellerId: 'seller-b', followedAt: '2026-09-02T00:00:00.000Z' },
    ], ['灰原哀'], false);

    const saved = await removeNotificationSeller('buyer-1', 'seller-a');

    expect(saved).toMatchObject({
      cardNames: ['灰原哀'],
      sellerSubscriptions: [{
        sellerId: 'seller-b', followedAt: new Date('2026-09-02T00:00:00.000Z'),
      }],
      emailDailyEnabled: false,
    });
    await expect(removeNotificationSeller('buyer-1', 'seller-missing')).resolves.toMatchObject({
      sellerSubscriptions: [{ sellerId: 'seller-b' }],
    });
  });

  it('rejects malformed and over-limit seller additions without writing', async () => {
    serverData = sellerData(Array.from({ length: 100 }, (_, index) => ({
      sellerId: `seller-${String(index).padStart(3, '0')}`,
    })));
    const original = serverData;

    await expect(addNotificationSeller('buyer-1', ' seller-new', new Date())).rejects.toThrow();
    await expect(addNotificationSeller('buyer-1', 'seller-new', new Date('invalid'))).rejects.toThrow();
    await expect(addNotificationSeller('buyer-1', 'seller-new', new Date())).rejects.toThrow(/at most 100/);
    expect(serverData).toBe(original);
  });

  it('preserves a concurrent card add when a seller add transaction runs second', async () => {
    serverData = sellerData([], [], false);
    const deferredTransactions: Array<() => Promise<void>> = [];
    firestore.runTransaction.mockImplementation((
      _database: unknown,
      operation: (transaction: {
        get(reference: unknown): Promise<ReturnType<typeof snapshot>>;
        set(reference: unknown, data: StoredSubscription): void;
      }) => unknown,
    ) => new Promise((resolve, reject) => {
      deferredTransactions.push(async () => {
        try {
          const result = await operation({
            get: vi.fn(async () => snapshot()),
            set: vi.fn((_reference, data) => { serverData = data; }),
          });
          resolve(result);
        } catch (error) { reject(error); }
      });
    }));

    const addSeller = addNotificationSeller('buyer-1', 'seller-a', new Date());
    const addCard = addNotificationCardName('buyer-1', '灰原哀');
    await deferredTransactions[1]?.();
    await deferredTransactions[0]?.();
    await Promise.all([addSeller, addCard]);

    expect(serverData).toMatchObject({
      cardNames: ['灰原哀'],
      sellerSubscriptions: [{ sellerId: 'seller-a' }],
      emailDailyEnabled: true,
    });
  });

  it.each([
    ['mixed legacy/current fields', {
      ...currentData(),
      characterKeys: ['suzuki-sonoko'],
    }],
    ['extra current field', { ...currentData(), email: 'buyer@example.com' }],
    ['malformed current preference', { ...currentData(), emailDailyEnabled: 'true' }],
    ['malformed legacy fields', {
      characterKeys: 'suzuki-sonoko',
      emailDailyEnabled: true,
      updatedAt: timestamp(),
    }],
  ])('rejects $0 instead of treating it as absent', async (_label, malformed) => {
    serverData = malformed;

    await expect(getNotificationSubscription('buyer-1')).rejects.toThrow();
    await expect(addNotificationCardName('buyer-1', '江戶川柯南')).rejects.toThrow();
  });

  it('deletes only the authenticated buyer document', async () => {
    await deleteNotificationSubscription('buyer-1');

    expect(firestore.deleteDoc).toHaveBeenCalledWith(rawDocument);
  });

  it('rejects another buyer before reading, deleting, or starting an atomic mutation', async () => {
    firebaseApp.auth.currentUser = { uid: 'buyer-2' };

    await expect(getNotificationSubscription('buyer-1')).rejects.toThrow(
      'Notification subscription access requires the authenticated buyer.',
    );
    await expect(addNotificationCardName('buyer-1', '江戶川柯南')).rejects.toThrow(
      'Notification subscription access requires the authenticated buyer.',
    );
    await expect(removeNotificationCardName('buyer-1', '江戶川柯南')).rejects.toThrow(
      'Notification subscription access requires the authenticated buyer.',
    );
    await expect(addNotificationSeller('buyer-1', 'seller-a', new Date())).rejects.toThrow(
      'Notification subscription access requires the authenticated buyer.',
    );
    await expect(removeNotificationSeller('buyer-1', 'seller-a')).rejects.toThrow(
      'Notification subscription access requires the authenticated buyer.',
    );
    await expect(setNotificationEmailDailyEnabled('buyer-1', false)).rejects.toThrow(
      'Notification subscription access requires the authenticated buyer.',
    );
    await expect(deleteNotificationSubscription('buyer-1')).rejects.toThrow(
      'Notification subscription access requires the authenticated buyer.',
    );
    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
  });
});
