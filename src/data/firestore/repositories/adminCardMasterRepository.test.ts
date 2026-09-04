import { beforeEach, describe, expect, it, vi } from 'vitest';

const functions = vi.hoisted(() => ({
  callableByName: new Map<string, ReturnType<typeof vi.fn>>(),
  httpsCallable: vi.fn((_client: unknown, name: string) => (
    functions.callableByName.get(name) ?? vi.fn()
  )),
}));
const firebaseApp = vi.hoisted(() => ({ functionsClient: { type: 'functions' } }));

vi.mock('firebase/functions', () => functions);
vi.mock('../../../lib/firebase/app', () => firebaseApp);

import {
  addCardMasterEntry,
  disableCardMasterEntry,
  editCardMasterEntry,
  listCardMasterArchives,
  mergeCardMasterEntries,
} from './adminCardMasterRepository';

const KEY_A = `card_${'a'.repeat(64)}`;
const KEY_B = `card_${'b'.repeat(64)}`;
const FINGERPRINT_A = '1'.repeat(64);
const FINGERPRINT_B = '2'.repeat(64);
const card = {
  key: KEY_A, cardId: '0501', cardType: 'character' as const,
  cardName: '黑羽快斗', rarities: ['R', 'SR'],
};

describe('admin Card Master repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    functions.callableByName.clear();
    for (const name of [
      'listCardMasterArchives', 'addCardMasterEntry', 'editCardMasterEntry',
      'disableCardMasterEntry', 'mergeCardMasterEntries',
    ]) functions.callableByName.set(name, vi.fn());
  });

  it('calls the archive endpoint with an exact bounded cursor and reads canonical dates', async () => {
    const callable = functions.callableByName.get('listCardMasterArchives')!;
    callable.mockResolvedValue({ data: {
      archives: [{
        ...card, disposition: 'merged', replacementCardKey: KEY_B,
        rationale: '合併重複資料', actedBy: 'admin-1', actedAt: 1788451200000,
      }],
      nextCursor: null,
    } });
    await expect(listCardMasterArchives({
      limit: 25, cursor: { actedAt: 1788451200000, key: KEY_A },
    })).resolves.toEqual({
      archives: [{
        ...card, disposition: 'merged', replacementCardKey: KEY_B,
        rationale: '合併重複資料', actedBy: 'admin-1',
        actedAt: new Date(1788451200000),
      }],
      nextCursor: null,
    });
    expect(callable).toHaveBeenCalledWith({
      limit: 25, cursor: { actedAt: 1788451200000, key: KEY_A },
    });
  });

  it('uses the exact callable names and mutation payloads', async () => {
    const add = functions.callableByName.get('addCardMasterEntry')!;
    const edit = functions.callableByName.get('editCardMasterEntry')!;
    const disable = functions.callableByName.get('disableCardMasterEntry')!;
    const merge = functions.callableByName.get('mergeCardMasterEntries')!;
    add.mockResolvedValue({ data: { card, fingerprint: FINGERPRINT_A } });
    edit.mockResolvedValue({ data: { card, fingerprint: FINGERPRINT_A, retiredCardKey: null } });
    disable.mockResolvedValue({ data: { archived: {
      ...card, disposition: 'disabled', rationale: '錯誤卡片', actedBy: 'admin-1', actedAt: 1788451200000,
    } } });
    merge.mockResolvedValue({ data: { card: { ...card, key: KEY_B }, fingerprint: FINGERPRINT_B, retiredCardKey: KEY_A } });

    const fields = { cardId: '0501', cardType: 'character' as const, cardName: '黑羽快斗', rarities: ['R', 'SR'] };
    await addCardMasterEntry({ ...fields, rationale: '新增缺漏' });
    await editCardMasterEntry({ sourceCardKey: KEY_A, expectedFingerprint: FINGERPRINT_A, ...fields, rationale: '修正資料' });
    await disableCardMasterEntry({ sourceCardKey: KEY_A, expectedFingerprint: FINGERPRINT_A, rationale: '錯誤卡片' });
    await mergeCardMasterEntries({
      sourceCardKey: KEY_A, sourceExpectedFingerprint: FINGERPRINT_A,
      targetCardKey: KEY_B, targetExpectedFingerprint: FINGERPRINT_B,
      rationale: '合併重複',
    });

    expect(add).toHaveBeenCalledWith({ ...fields, rationale: '新增缺漏' });
    expect(edit).toHaveBeenCalledWith({ sourceCardKey: KEY_A, expectedFingerprint: FINGERPRINT_A, ...fields, rationale: '修正資料' });
    expect(disable).toHaveBeenCalledWith({ sourceCardKey: KEY_A, expectedFingerprint: FINGERPRINT_A, rationale: '錯誤卡片' });
    expect(merge).toHaveBeenCalledWith({
      sourceCardKey: KEY_A, sourceExpectedFingerprint: FINGERPRINT_A,
      targetCardKey: KEY_B, targetExpectedFingerprint: FINGERPRINT_B,
      rationale: '合併重複',
    });
  });

  it.each([
    ['extra result field', { card, fingerprint: FINGERPRINT_A, token: 'secret' }],
    ['missing fingerprint', { card }],
    ['invalid fingerprint', { card, fingerprint: 'short' }],
    ['extra card field', { card: { ...card, effect: 'forbidden' }, fingerprint: FINGERPRINT_A }],
    ['invalid card key', { card: { ...card, key: '0501' }, fingerprint: FINGERPRINT_A }],
  ])('rejects malformed mutation response: %s', async (_name, data) => {
    functions.callableByName.get('addCardMasterEntry')!.mockResolvedValue({ data });
    await expect(addCardMasterEntry({
      cardId: '0501', cardType: 'character', cardName: '黑羽快斗',
      rarities: ['R'], rationale: '新增缺漏',
    })).rejects.toThrow('invalid Card Master mutation response');
  });

  it.each([
    ['oversized page', { archives: Array.from({ length: 101 }, () => ({
      ...card, disposition: 'disabled', rationale: '錯誤', actedBy: 'admin-1', actedAt: 1,
    })), nextCursor: null }],
    ['unsafe cursor', { archives: [], nextCursor: { actedAt: Number.MAX_SAFE_INTEGER + 1, key: KEY_A } }],
    ['partial merged archive', { archives: [{
      ...card, disposition: 'merged', rationale: '錯誤', actedBy: 'admin-1', actedAt: 1,
    }], nextCursor: null }],
    ['private archive field', { archives: [{
      ...card, disposition: 'disabled', rationale: '錯誤', actedBy: 'admin-1', actedAt: 1,
      contact: 'private',
    }], nextCursor: null }],
    ['invalid archive timestamp', { archives: [{
      ...card, disposition: 'disabled', rationale: '錯誤', actedBy: 'admin-1', actedAt: Number.NaN,
    }], nextCursor: null }],
  ])('rejects malformed archive page: %s', async (_name, data) => {
    functions.callableByName.get('listCardMasterArchives')!.mockResolvedValue({ data });
    await expect(listCardMasterArchives({})).rejects.toThrow('invalid Card Master archive page');
  });

  it('rejects archive cursors and mutation results that are individually valid but inconsistent', async () => {
    const list = functions.callableByName.get('listCardMasterArchives')!;
    list.mockResolvedValueOnce({ data: {
      archives: [{
        ...card, disposition: 'disabled', rationale: '錯誤', actedBy: 'admin-1', actedAt: 1,
      }],
      nextCursor: { actedAt: 2, key: KEY_B },
    } });
    await expect(listCardMasterArchives({ limit: 1 }))
      .rejects.toThrow('invalid Card Master archive page');

    functions.callableByName.get('disableCardMasterEntry')!.mockResolvedValueOnce({ data: {
      archived: {
        ...card, disposition: 'merged', replacementCardKey: KEY_B,
        rationale: '合併', actedBy: 'admin-1', actedAt: 1,
      },
    } });
    await expect(disableCardMasterEntry({
      sourceCardKey: KEY_A, expectedFingerprint: FINGERPRINT_A, rationale: '錯誤',
    })).rejects.toThrow('invalid Card Master disable response');

    functions.callableByName.get('mergeCardMasterEntries')!.mockResolvedValueOnce({ data: {
      card: { ...card, key: KEY_B }, fingerprint: FINGERPRINT_B, retiredCardKey: null,
    } });
    await expect(mergeCardMasterEntries({
      sourceCardKey: KEY_A, sourceExpectedFingerprint: FINGERPRINT_A,
      targetCardKey: KEY_B, targetExpectedFingerprint: FINGERPRINT_B, rationale: '合併',
    })).rejects.toThrow('invalid Card Master mutation response');
  });

  it('does not import browser Firestore mutation APIs', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) => (
      readFile(new URL('./adminCardMasterRepository.ts', import.meta.url), 'utf8')
    ));
    expect(source).not.toMatch(/from ['"]firebase\/firestore['"]/u);
    expect(source).not.toMatch(/\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\b/u);
  });
});
