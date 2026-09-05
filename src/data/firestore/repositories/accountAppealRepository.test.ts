import { beforeEach, describe, expect, it, vi } from 'vitest';

const functions = vi.hoisted(() => ({
  callableByName: new Map<string, ReturnType<typeof vi.fn>>(),
  httpsCallable: vi.fn((_client: unknown, name: string) => functions.callableByName.get(name)!),
}));
const firebaseApp = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'seller-1' } }, functionsClient: {},
}));
vi.mock('firebase/functions', () => functions);
vi.mock('../../../lib/firebase/app', () => firebaseApp);

import { getOwnAccountAppeal, submitAccountAppeal } from './accountAppealRepository';

const action = 'a'.repeat(64);
const requestId = '550e8400-e29b-41d4-a716-446655440000';
const statement = '請重新審查本次停權與相關證據。'.repeat(10);
const dto = {
  appealId: 'appeal-1', status: 'submitted', targetUid: 'seller-1',
  suspensionActionId: action, statement,
  evidence: [{ slot: 0, contentType: 'image/png', size: 100 }],
  submittedAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
};

describe('account appeal repository', () => {
  beforeEach(() => {
    vi.clearAllMocks(); functions.callableByName.clear();
    firebaseApp.auth.currentUser = { uid: 'seller-1' };
    functions.callableByName.set('getOwnAccountAppeal', vi.fn());
    functions.callableByName.set('submitAccountAppeal', vi.fn());
  });

  it('loads and strictly converts the current appeal DTO', async () => {
    functions.callableByName.get('getOwnAccountAppeal')!.mockResolvedValue({ data: { appeal: dto } });
    await expect(getOwnAccountAppeal({ uid: 'seller-1', suspensionActionId: action }))
      .resolves.toMatchObject({ submittedAt: new Date(dto.submittedAt), status: 'submitted' });
    expect(functions.callableByName.get('getOwnAccountAppeal')).toHaveBeenCalledWith({
      suspensionActionId: action,
    });
  });

  it('submits exact stable IDs, statement, and private evidence metadata', async () => {
    functions.callableByName.get('submitAccountAppeal')!.mockResolvedValue({ data: { appeal: dto } });
    const input = {
      uid: 'seller-1', suspensionActionId: action, requestId, draftId: requestId, statement,
      evidence: [{ slot: 0 as const, generation: '123', contentType: 'image/png' as const, size: 100 }],
    };
    await expect(submitAccountAppeal(input)).resolves.toMatchObject({ status: 'submitted' });
    expect(functions.callableByName.get('submitAccountAppeal')).toHaveBeenCalledWith({
      suspensionActionId: action, requestId, draftId: requestId,
      statement, evidence: input.evidence,
    });
  });

  it('rejects cross-account input and response internals before adoption', async () => {
    await expect(getOwnAccountAppeal({ uid: 'other', suspensionActionId: action })).rejects.toThrow();
    expect(functions.httpsCallable).not.toHaveBeenCalled();
    functions.callableByName.get('getOwnAccountAppeal')!
      .mockResolvedValue({ data: { appeal: { ...dto, requestKey: 'secret' } } });
    await expect(getOwnAccountAppeal({ uid: 'seller-1', suspensionActionId: action }))
      .rejects.toThrow('申訴服務目前無法使用');
  });
});
