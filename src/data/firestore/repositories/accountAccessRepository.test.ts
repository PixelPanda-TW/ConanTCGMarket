import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  doc: vi.fn(),
  getFirestore: vi.fn(() => ({ type: 'firestore' })),
  onSnapshot: vi.fn(),
}));
const firebaseApp = vi.hoisted(() => ({
  firebaseApp: { name: 'test-app' },
  firebaseEmulatorConfig: null,
  auth: { currentUser: { uid: 'buyer-1' } as { uid: string } | null },
}));

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  ...firestore,
}));
vi.mock('../../../lib/firebase/app', () => firebaseApp);

import { subscribeAccountAccess } from './accountAccessRepository';
import { accountAccessConverter } from '../converters';
import { collections } from '../paths';

describe('account access repository', () => {
  const convertedReference = { type: 'converted-account-access-reference' };
  const rawReference = { withConverter: vi.fn(() => convertedReference) };
  const unsubscribe = vi.fn();
  let snapshotValue: ((snapshot: {
    exists(): boolean;
    data(): unknown;
  }) => void) | undefined;
  let snapshotError: ((error: Error) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    firebaseApp.auth.currentUser = { uid: 'buyer-1' };
    rawReference.withConverter.mockReturnValue(convertedReference);
    firestore.doc.mockReturnValue(rawReference);
    firestore.onSnapshot.mockImplementation((_reference, onValue, onError) => {
      snapshotValue = onValue;
      snapshotError = onError;
      return unsubscribe;
    });
  });

  it.each(['', '   '])('rejects empty UID %j before opening Firestore', (uid) => {
    expect(() => subscribeAccountAccess(uid, vi.fn(), vi.fn())).toThrow('authenticated account');
    expect(firestore.doc).not.toHaveBeenCalled();
    expect(firestore.onSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a signed-out request before opening Firestore', () => {
    firebaseApp.auth.currentUser = null;

    expect(() => subscribeAccountAccess('buyer-1', vi.fn(), vi.fn()))
      .toThrow('authenticated account');
    expect(firestore.doc).not.toHaveBeenCalled();
  });

  it('rejects a different UID before opening Firestore', () => {
    firebaseApp.auth.currentUser = { uid: 'buyer-2' };

    expect(() => subscribeAccountAccess('buyer-1', vi.fn(), vi.fn()))
      .toThrow('authenticated account');
    expect(firestore.doc).not.toHaveBeenCalled();
  });

  it('subscribes to the current UID with the strict converter and returns unsubscribe', () => {
    const result = subscribeAccountAccess('buyer-1', vi.fn(), vi.fn());

    expect(firestore.doc).toHaveBeenCalledWith(
      expect.anything(), collections.accountAccess, 'buyer-1',
    );
    expect(rawReference.withConverter).toHaveBeenCalledWith(accountAccessConverter);
    expect(firestore.onSnapshot).toHaveBeenCalledWith(
      convertedReference, expect.any(Function), expect.any(Function),
    );
    expect(result).toBe(unsubscribe);
  });

  it('emits null when the account document is missing', () => {
    const onValue = vi.fn();
    subscribeAccountAccess('buyer-1', onValue, vi.fn());

    snapshotValue?.({ exists: () => false, data: vi.fn() });

    expect(onValue).toHaveBeenCalledWith(null);
  });

  it.each(['active', 'suspended'] as const)('emits a converted %s document', (status) => {
    const access = status === 'active'
      ? {
          uid: 'buyer-1', status, confirmedViolationCount: 0,
          updatedAt: new Date('2026-09-03T00:00:00.000Z'),
        }
      : {
          uid: 'buyer-1', status, confirmedViolationCount: 1,
          suspensionReason: 'Reason', suspendedAt: new Date('2026-09-02T00:00:00.000Z'),
          suspendedBy: 'admin-1', updatedAt: new Date('2026-09-03T00:00:00.000Z'),
        };
    const onValue = vi.fn();
    subscribeAccountAccess('buyer-1', onValue, vi.fn());

    snapshotValue?.({ exists: () => true, data: () => access });

    expect(onValue).toHaveBeenCalledWith(access);
  });

  it('forwards listener errors unchanged', () => {
    const onError = vi.fn();
    const error = new Error('access read failed');
    subscribeAccountAccess('buyer-1', vi.fn(), onError);

    snapshotError?.(error);

    expect(onError).toHaveBeenCalledWith(error);
  });
});
