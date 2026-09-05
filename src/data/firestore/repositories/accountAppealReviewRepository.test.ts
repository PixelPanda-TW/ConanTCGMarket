import { beforeEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ calls: new Map<string, ReturnType<typeof vi.fn>>(),
  httpsCallable: vi.fn((_client: unknown, name: string) => sdk.calls.get(name)!) }));
vi.mock('firebase/functions', () => sdk);
vi.mock('../../../lib/firebase/app', () => ({ functionsClient: {} }));
import { decideAccountAppeal, getAccountAppeal, listAccountAppeals } from './accountAppealReviewRepository';
const action = 'a'.repeat(64);
const wire = { appealId: 'appeal-1', status: 'submitted', targetUid: 'seller-1',
  suspensionActionId: action, statement: '申訴內容。'.repeat(30), evidence: [],
  submittedAt: 1000, updatedAt: 1000 };
describe('account appeal review repository', () => {
  beforeEach(() => { vi.clearAllMocks(); sdk.calls.clear(); });
  it('strictly parses queue/detail and sends bounded cursor values', async () => {
    sdk.calls.set('listAccountAppeals', vi.fn(async () => ({ data: { appeals: [{
      appealId: 'appeal-1', status: 'submitted', targetUid: 'seller-1',
      suspensionActionId: action, evidenceCount: 0, submittedAt: 1000, updatedAt: 1000,
    }], nextCursor: null } })));
    await expect(listAccountAppeals({ status: 'submitted' })).resolves.toMatchObject({
      appeals: [{ submittedAt: new Date(1000) }],
    });
    sdk.calls.set('getAccountAppeal', vi.fn(async () => ({ data: wire })));
    await expect(getAccountAppeal('appeal-1')).resolves.toMatchObject({ statement: wire.statement });
  });
  it('uses stable exact decision input and rejects internal detail fields', async () => {
    const callable = vi.fn(async () => ({ data: { appealId: 'appeal-1', status: 'approved', decidedAt: 2000 } }));
    sdk.calls.set('decideAccountAppeal', callable);
    const input = { appealId: 'appeal-1', requestId: '550e8400-e29b-41d4-a716-446655440000',
      decision: 'approved' as const, rationale: '人工複核完成。' };
    await decideAccountAppeal(input); expect(callable).toHaveBeenCalledWith(input);
    sdk.calls.set('getAccountAppeal', vi.fn(async () => ({ data: { ...wire, requestKey: 'secret' } })));
    await expect(getAccountAppeal('appeal-1')).rejects.toThrow('申訴審核服務目前無法使用');
  });
});
