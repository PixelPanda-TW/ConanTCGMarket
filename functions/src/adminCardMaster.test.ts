import { describe, expect, it, vi } from 'vitest';
import {
  AdminCardMasterError,
  cardFingerprint,
  cardMasterKey,
  handleAddCardMasterEntry,
  handleDisableCardMasterEntry,
  handleEditCardMasterEntry,
  handleListCardMasterArchives,
  handleMergeCardMasterEntries,
  normalizeAdminCard,
  type AdminCardMasterDependencies,
  type AdminCardMasterTransaction,
  type ApprovedCard,
  type CardMasterArchivePageDependencies,
} from './adminCardMaster.js';

const NOW = new Date('2026-09-04T09:10:11.000Z');
const EARLIER = new Date('2026-09-01T00:00:00.000Z');

function activeAccess() {
  return { status: 'active', confirmedViolationCount: 0, updatedAt: EARLIER };
}

function archived(cardValue: ApprovedCard, overrides: Record<string, unknown> = {}) {
  return {
    ...cardValue,
    disposition: 'disabled',
    rationale: '錯誤卡片',
    actedBy: 'admin-1',
    actedAt: EARLIER,
    ...overrides,
  };
}

function card(overrides: Partial<ApprovedCard> = {}): ApprovedCard {
  return {
    cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'],
    ...overrides,
  };
}

interface State {
  access: Record<string, unknown | null>;
  cards: Record<string, Record<string, unknown> | null>;
  archives: Record<string, Record<string, unknown> | null>;
  operations: Array<{ type: string; key: string; data?: Record<string, unknown> }>;
}

function harness(initial: Partial<State> = {}) {
  const source = card();
  const sourceKey = cardMasterKey(source);
  const state: State = {
    access: { 'admin-1': activeAccess() },
    cards: { [sourceKey]: source },
    archives: {},
    operations: [],
    ...initial,
  };
  const transaction: AdminCardMasterTransaction = {
    getAccountAccess: vi.fn(async (uid) => state.access[uid] ?? null),
    getCard: vi.fn(async (key) => state.cards[key] ?? null),
    getArchive: vi.fn(async (key) => state.archives[key] ?? null),
    setCard: vi.fn((key, data) => state.operations.push({ type: 'set-card', key, data })),
    deleteCard: vi.fn((key) => state.operations.push({ type: 'delete-card', key })),
    createArchive: vi.fn((key, data) => state.operations.push({ type: 'archive', key, data })),
    createAudit: vi.fn((key, data) => state.operations.push({ type: 'audit', key, data })),
  };
  const dependencies: AdminCardMasterDependencies = {
    now: () => NOW,
    randomId: () => 'audit-1',
    runTransaction: async (operation) => operation(transaction),
  };
  return { source, sourceKey, state, transaction, dependencies };
}

function request(data: unknown, overrides: { authUid?: string | null; adminClaim?: unknown } = {}) {
  return {
    authUid: Object.hasOwn(overrides, 'authUid') ? overrides.authUid! : 'admin-1',
    adminClaim: Object.hasOwn(overrides, 'adminClaim') ? overrides.adminClaim : true,
    data,
  };
}

function addInput(overrides: Record<string, unknown> = {}) {
  return {
    cardId: ' p001 ', cardType: 'partner', cardName: ' 江戶川柯南\u0301 ',
    rarities: [' p ', 'P'], rationale: ' 新增缺漏卡片 ', ...overrides,
  };
}

function editInput(sourceKey: string, source: ApprovedCard, overrides: Record<string, unknown> = {}) {
  return {
    sourceCardKey: sourceKey,
    expectedFingerprint: cardFingerprint(source),
    cardId: source.cardId,
    cardType: source.cardType,
    cardName: source.cardName,
    rarities: source.rarities,
    rationale: '修正卡片資料',
    ...overrides,
  };
}

function expectCode(operation: Promise<unknown>, code: string) {
  return expect(operation).rejects.toMatchObject({ code });
}

describe('admin Card Master domain', () => {
  it('normalizes only approved card fields and creates stable full hashes', () => {
    const normalized = normalizeAdminCard({
      cardId: ' p001 ', cardType: 'partner', cardName: ' 江戶川柯南\u0301 ',
      rarities: [' sr ', 'R', 'SR'],
    });
    expect(normalized).toEqual({
      cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南́', rarities: ['R', 'SR'],
    });
    expect(normalized.cardName).toBe(normalized.cardName.normalize('NFC'));
    expect(cardMasterKey(normalized)).toMatch(/^card_[0-9a-f]{64}$/);
    expect(cardMasterKey(normalized)).toBe(cardMasterKey({ ...normalized }));
    expect(cardFingerprint(normalized)).toMatch(/^[0-9a-f]{64}$/);
    expect(cardFingerprint(normalized)).toBe(cardFingerprint({ ...normalized }));
  });

  it.each([
    ['extra card field', { cardId: '0501', cardType: 'character', cardName: 'A', rarities: ['R'], effect: 'forbidden' }],
    ['invalid ID', { cardId: 'B0982', cardType: 'character', cardName: 'A', rarities: ['R'] }],
    ['invalid type', { cardId: '0501', cardType: 'unknown', cardName: 'A', rarities: ['R'] }],
    ['empty name', { cardId: '0501', cardType: 'character', cardName: ' ', rarities: ['R'] }],
    ['empty rarity', { cardId: '0501', cardType: 'character', cardName: 'A', rarities: [] }],
    ['too many rarities', { cardId: '0501', cardType: 'character', cardName: 'A', rarities: Array.from({ length: 21 }, (_, index) => `R${index}`) }],
  ])('rejects malformed card input: %s', (_name, value) => {
    expect(() => normalizeAdminCard(value)).toThrow(AdminCardMasterError);
  });

  it.each([
    [null, true, 'unauthenticated'],
    ['admin-1', false, 'permission-denied'],
    ['admin-1', 'true', 'permission-denied'],
    ['admin-1', undefined, 'permission-denied'],
  ])('requires exact authenticated admin authorization %#', async (authUid, adminClaim, code) => {
    const { state, dependencies } = harness({ cards: {} });
    await expectCode(handleAddCardMasterEntry(
      request(addInput(), { authUid, adminClaim }), dependencies,
    ), code);
    expect(state.operations).toEqual([]);
  });

  it.each([
    ['suspended', { status: 'suspended', confirmedViolationCount: 2, suspensionReason: 'Reason', suspendedAt: EARLIER, suspendedBy: 'admin-2', updatedAt: EARLIER }],
    ['malformed active', { ...activeAccess(), extra: true }],
  ])('denies %s admin account access', async (_name, access) => {
    const { state, dependencies } = harness({ access: { 'admin-1': access }, cards: {} });
    await expectCode(handleAddCardMasterEntry(request(addInput()), dependencies), 'permission-denied');
    expect(state.operations).toEqual([]);
  });

  it('treats missing account access as active compatibility', async () => {
    const { dependencies } = harness({ access: {}, cards: {} });
    await expect(handleAddCardMasterEntry(request(addInput()), dependencies))
      .resolves.toMatchObject({ card: { cardId: 'P001' } });
  });

  it('adds one exact active card and one contact-free audit atomically', async () => {
    const { state, dependencies } = harness({ cards: {} });
    const canonical = normalizeAdminCard({
      cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南́', rarities: ['P'],
    });
    const key = cardMasterKey(canonical);

    await expect(handleAddCardMasterEntry(request(addInput()), dependencies)).resolves.toEqual({
      card: { key, ...canonical }, fingerprint: cardFingerprint(canonical),
    });
    expect(state.operations).toEqual([
      { type: 'set-card', key, data: canonical },
      {
        type: 'audit', key: 'audit-1', data: {
          action: 'add', targetCardKey: key, after: canonical,
          rationale: '新增缺漏卡片', actedBy: 'admin-1', actedAt: NOW,
        },
      },
    ]);
    expect(JSON.stringify(state.operations)).not.toMatch(/effect|image|contact|email|token/iu);
  });

  it('rejects add when the active or archived deterministic key already exists', async () => {
    const canonical = normalizeAdminCard({
      cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南́', rarities: ['P'],
    });
    const key = cardMasterKey(canonical);
    for (const initial of [
      { cards: { [key]: canonical } },
      { archives: { [key]: archived(canonical) } },
    ]) {
      const { state, dependencies } = harness({ cards: {}, ...initial });
      await expectCode(handleAddCardMasterEntry(request(addInput()), dependencies), 'already-exists');
      expect(state.operations).toEqual([]);
    }
  });

  it('fails closed for a malformed archive instead of treating it as a normal collision', async () => {
    const canonical = normalizeAdminCard({
      cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南́', rarities: ['P'],
    });
    const key = cardMasterKey(canonical);
    const { state, dependencies } = harness({
      cards: {}, archives: { [key]: { ...archived(canonical), rationale: ' ' } },
    });
    await expectCode(handleAddCardMasterEntry(request(addInput()), dependencies), 'failed-precondition');
    expect(state.operations).toEqual([]);
  });

  it('accepts canonical stored fields regardless of object insertion order', async () => {
    const source = card();
    const sourceKey = cardMasterKey(source);
    const reordered = {
      rarities: source.rarities,
      cardName: source.cardName,
      cardType: source.cardType,
      cardId: source.cardId,
    };
    const { dependencies } = harness({ cards: { [sourceKey]: reordered } });
    await expect(handleEditCardMasterEntry(request(editInput(sourceKey, source, {
      rarities: ['CP', 'D'],
    })), dependencies)).resolves.toMatchObject({ card: { key: sourceKey, rarities: ['CP', 'D'] } });
  });

  it('lists a bounded archive page after active-admin validation', async () => {
    const archivedCard = card();
    const key = cardMasterKey(archivedCard);
    const listArchives = vi.fn(async () => [{ key, data: archived(archivedCard) }]);
    const dependencies: CardMasterArchivePageDependencies = {
      runTransaction: async (operation) => operation({
        getAccountAccess: async () => activeAccess(),
        listArchives,
      }),
    };
    await expect(handleListCardMasterArchives(request({ limit: 1 }), dependencies))
      .resolves.toEqual({
        archives: [{ key, ...archived(archivedCard), actedAt: EARLIER.valueOf() }],
        nextCursor: { key, actedAt: EARLIER.valueOf() },
      });
    expect(listArchives).toHaveBeenCalledWith(null, 1);
  });

  it.each([
    [{ extra: true }],
    [{ limit: 101 }],
    [{ limit: 0 }],
    [{ cursor: { actedAt: -1, key: `card_${'0'.repeat(64)}` } }],
    [{ cursor: { actedAt: 1, key: 'bad' } }],
    [{ cursor: { actedAt: 1, key: `card_${'0'.repeat(64)}`, extra: true } }],
  ])('rejects malformed archive page request %#', async (data) => {
    const dependencies: CardMasterArchivePageDependencies = {
      runTransaction: vi.fn(),
    };
    await expectCode(handleListCardMasterArchives(request(data), dependencies), 'invalid-argument');
    expect(dependencies.runTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when an archive page contains malformed stored data', async () => {
    const archivedCard = card();
    const key = cardMasterKey(archivedCard);
    const dependencies: CardMasterArchivePageDependencies = {
      runTransaction: async (operation) => operation({
        getAccountAccess: async () => activeAccess(),
        listArchives: async () => [{ key, data: { ...archived(archivedCard), extra: true } }],
      }),
    };
    await expectCode(handleListCardMasterArchives(request({}), dependencies), 'failed-precondition');
  });

  it('edits rarities in place after checking the source fingerprint', async () => {
    const { source, sourceKey, state, dependencies } = harness();
    const after = card({ rarities: ['CP', 'D'] });
    await expect(handleEditCardMasterEntry(request(editInput(sourceKey, source, {
      rarities: [' CP ', 'D'],
    })), dependencies)).resolves.toEqual({
      card: { key: sourceKey, ...after }, fingerprint: cardFingerprint(after), retiredCardKey: null,
    });
    expect(state.operations).toEqual([
      { type: 'set-card', key: sourceKey, data: after },
      {
        type: 'audit', key: 'audit-1', data: {
          action: 'edit', sourceCardKey: sourceKey, targetCardKey: sourceKey,
          before: source, after, rationale: '修正卡片資料', actedBy: 'admin-1', actedAt: NOW,
        },
      },
    ]);
  });

  it('rekeys an identity edit by creating, archiving, then deleting the source atomically', async () => {
    const { source, sourceKey, state, dependencies } = harness();
    const after = card({ cardId: '0590', cardName: '諸伏景光', rarities: ['R'] });
    const targetKey = cardMasterKey(after);
    await expect(handleEditCardMasterEntry(request(editInput(sourceKey, source, after)), dependencies))
      .resolves.toEqual({
        card: { key: targetKey, ...after }, fingerprint: cardFingerprint(after), retiredCardKey: sourceKey,
      });
    expect(state.operations.map(({ type, key }) => [type, key])).toEqual([
      ['set-card', targetKey], ['archive', sourceKey], ['delete-card', sourceKey], ['audit', 'audit-1'],
    ]);
    expect(state.operations[1].data).toEqual({
      ...source, disposition: 'superseded', replacementCardKey: targetKey,
      rationale: '修正卡片資料', actedBy: 'admin-1', actedAt: NOW,
    });
  });

  it('disables a current card by preserving its full approved value in the archive', async () => {
    const { source, sourceKey, state, dependencies } = harness();
    await expect(handleDisableCardMasterEntry(request({
      sourceCardKey: sourceKey,
      expectedFingerprint: cardFingerprint(source),
      rationale: '錯誤卡片',
    }), dependencies)).resolves.toEqual({
      archived: {
        key: sourceKey, ...source, disposition: 'disabled', rationale: '錯誤卡片',
        actedBy: 'admin-1', actedAt: NOW.valueOf(),
      },
    });
    expect(state.operations.map(({ type, key }) => [type, key])).toEqual([
      ['archive', sourceKey], ['delete-card', sourceKey], ['audit', 'audit-1'],
    ]);
  });

  it('merges only source rarities into an unchanged canonical target identity', async () => {
    const source = card({ rarities: ['D', 'SR'] });
    const target = card({ cardId: '0590', cardName: '諸伏景光', rarities: ['CP', 'R'] });
    const sourceKey = cardMasterKey(source);
    const targetKey = cardMasterKey(target);
    const { state, dependencies } = harness({ cards: { [sourceKey]: source, [targetKey]: target } });
    const after = { ...target, rarities: ['CP', 'D', 'R', 'SR'] };

    await expect(handleMergeCardMasterEntries(request({
      sourceCardKey: sourceKey,
      sourceExpectedFingerprint: cardFingerprint(source),
      targetCardKey: targetKey,
      targetExpectedFingerprint: cardFingerprint(target),
      rationale: '合併重複資料',
    }), dependencies)).resolves.toEqual({
      card: { key: targetKey, ...after }, fingerprint: cardFingerprint(after),
      retiredCardKey: sourceKey,
    });
    expect(state.operations.map(({ type, key }) => [type, key])).toEqual([
      ['set-card', targetKey], ['archive', sourceKey], ['delete-card', sourceKey], ['audit', 'audit-1'],
    ]);
    expect(state.operations[1].data).toMatchObject({
      ...source, disposition: 'merged', replacementCardKey: targetKey,
    });
    expect(state.operations[3].data).toMatchObject({
      action: 'merge', sourceCardKey: sourceKey, targetCardKey: targetKey,
      before: source, targetBefore: target, after,
    });
  });

  it.each([
    ['missing stored Card', (sourceKey: string, source: ApprovedCard) => editInput(sourceKey, source), 'not-found', null],
    ['stale source', (sourceKey: string, source: ApprovedCard) => editInput(sourceKey, source, { expectedFingerprint: '0'.repeat(64) }), 'aborted'],
    ['partial stored Card', (sourceKey: string, source: ApprovedCard) => editInput(sourceKey, source), 'failed-precondition', { rarity: undefined }],
    ['extra edit input', (sourceKey: string, source: ApprovedCard) => ({ ...editInput(sourceKey, source), listingId: 'forbidden' }), 'invalid-argument'],
    ['empty rationale', (sourceKey: string, source: ApprovedCard) => editInput(sourceKey, source, { rationale: ' ' }), 'invalid-argument'],
  ])('fails closed without mutations for %s', async (_name, makeInput, code, storedOverride) => {
    const base = harness();
    const stored = storedOverride === null
      ? null
      : storedOverride ? { ...base.source, ...storedOverride } : base.source;
    const { state, dependencies } = harness({ cards: { [base.sourceKey]: stored } });
    await expectCode(handleEditCardMasterEntry(
      request(makeInput(base.sourceKey, base.source)), dependencies,
    ), code);
    expect(state.operations).toEqual([]);
  });

  it('rejects same-source merge, stale target, and target collision without partial writes', async () => {
    const source = card();
    const target = card({ cardId: '0590', cardName: '諸伏景光', rarities: ['R'] });
    const sourceKey = cardMasterKey(source);
    const targetKey = cardMasterKey(target);
    const baseInput = {
      sourceCardKey: sourceKey, sourceExpectedFingerprint: cardFingerprint(source),
      targetCardKey: targetKey, targetExpectedFingerprint: cardFingerprint(target),
      rationale: '合併重複資料',
    };
    for (const [input, code] of [
      [{ ...baseInput, targetCardKey: sourceKey, targetExpectedFingerprint: cardFingerprint(source) }, 'invalid-argument'],
      [{ ...baseInput, targetExpectedFingerprint: '0'.repeat(64) }, 'aborted'],
    ] as const) {
      const { state, dependencies } = harness({ cards: { [sourceKey]: source, [targetKey]: target } });
      await expectCode(handleMergeCardMasterEntries(request(input), dependencies), code);
      expect(state.operations).toEqual([]);
    }
  });

  it('uses stable domain error objects', () => {
    expect(new AdminCardMasterError('aborted', 'stale')).toMatchObject({
      name: 'AdminCardMasterError', code: 'aborted', message: 'stale',
    });
  });
});
