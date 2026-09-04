// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../auth/AuthProvider';
import type { Card, CardMasterArchive, CardMasterMutationResult } from '../../domain/models';
import type {
  AddCardMasterEntryInput,
  EditCardMasterEntryInput,
} from '../../data/firestore/repositories';

const auth = vi.hoisted(() => ({ current: {} as AuthState }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth.current }));

import { CardMasterAdminPage } from './CardMasterAdminPage';

const KEY_A = `card_${'a'.repeat(64)}`;
const KEY_B = `card_${'b'.repeat(64)}`;
const cardA: Card = {
  key: KEY_A, cardId: '0501', cardType: 'character', cardName: '黑羽快斗', rarities: ['R', 'SR'],
};
const cardB: Card = {
  key: KEY_B, cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'],
};
const archive: CardMasterArchive = {
  ...cardA, disposition: 'disabled', rationale: '錯誤資料', actedBy: 'admin-1',
  actedAt: new Date('2026-09-04T00:00:00Z'),
};

function state(overrides: Partial<AuthState> = {}): AuthState {
  return {
    user: { uid: 'admin-1', displayName: 'Admin', photoURL: null },
    isLoading: false, error: null,
    accountAccessState: { state: 'active', access: null },
    isActiveAccount: true,
    adminAccessState: { state: 'admin' },
    signIn: vi.fn(), signOut: vi.fn(), ...overrides,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    loadCards: vi.fn(async () => [cardA, cardB]),
    loadArchives: vi.fn(async () => ({ archives: [archive], nextCursor: null })),
    addEntry: vi.fn(async (_input: AddCardMasterEntryInput): Promise<CardMasterMutationResult> => {
      throw new Error('addEntry is not configured');
    }),
    editEntry: vi.fn(async (_input: EditCardMasterEntryInput): Promise<CardMasterMutationResult> => {
      throw new Error('editEntry is not configured');
    }),
    ...overrides,
  };
}

afterEach(cleanup);

describe('CardMasterAdminPage', () => {
  beforeEach(() => { auth.current = state(); });

  it.each([
    ['signed out', state({ user: null, isActiveAccount: false, accountAccessState: { state: 'signed-out' }, adminAccessState: { state: 'not-admin' } }), '請先使用 Google 登入'],
    ['loading', state({ adminAccessState: { state: 'loading' } }), '管理權限確認中'],
    ['not admin', state({ adminAccessState: { state: 'not-admin' } }), '無權限使用管理工具'],
    ['unavailable', state({ adminAccessState: { state: 'unavailable' } }), '無法確認管理權限'],
    ['suspended', state({
      isActiveAccount: false, adminAccessState: { state: 'not-admin' },
      accountAccessState: { state: 'suspended', access: {
        uid: 'admin-1', status: 'suspended', confirmedViolationCount: 1,
        suspensionReason: 'Reason', suspendedAt: new Date(), suspendedBy: 'admin-2', updatedAt: new Date(),
      } },
    }), '帳號目前已停權'],
  ])('renders the protected %s state without loading data', async (_name, authState, text) => {
    auth.current = authState;
    const deps = dependencies();
    render(<CardMasterAdminPage {...deps} />);
    expect(await screen.findByText(new RegExp(text))).toBeTruthy();
    expect(deps.loadCards).not.toHaveBeenCalled();
    expect(deps.loadArchives).not.toHaveBeenCalled();
  });

  it('loads active and archived data into separate sections and prefix-filters every field', async () => {
    const deps = dependencies();
    render(<CardMasterAdminPage {...deps} />);
    expect(await screen.findByRole('heading', { name: '現行卡片' })).toBeTruthy();
    expect(within(screen.getByLabelText('現行卡片清單')).getByText('黑羽快斗')).toBeTruthy();
    expect(within(screen.getByLabelText('封存卡片清單')).getByText('錯誤資料')).toBeTruthy();

    const search = screen.getByRole('searchbox', { name: '搜尋卡片資料' });
    for (const query of ['cha', '黑羽', '050', 'S']) {
      await userEvent.clear(search);
      await userEvent.type(search, query);
      expect(screen.getAllByText('黑羽快斗').length).toBeGreaterThan(0);
    }
    await userEvent.clear(search);
    await userEvent.type(search, 'part');
    expect(screen.getByText('江戶川柯南')).toBeTruthy();
    expect(screen.queryByText('黑羽快斗')).toBeNull();
  });

  it('binds add fields, repeatable rarities, rationale, pending guard, and adopts canonical response', async () => {
    const added: Card = { ...cardB, key: `card_${'c'.repeat(64)}`, cardId: 'P002', cardName: '灰原哀' };
    let resolveAdd: ((result: CardMasterMutationResult) => void) | undefined;
    const addEntry = vi.fn(() => new Promise<CardMasterMutationResult>((resolve) => { resolveAdd = resolve; }));
    const deps = dependencies({ addEntry });
    render(<CardMasterAdminPage {...deps} />);
    await screen.findByRole('heading', { name: '新增卡片' });

    await userEvent.selectOptions(screen.getByLabelText(/卡片類型/), 'partner');
    await userEvent.type(screen.getByLabelText(/卡片名稱/), '灰原哀');
    await userEvent.type(screen.getByLabelText(/卡片 ID/), 'p002');
    await userEvent.type(screen.getByLabelText('稀有度 1'), 'p');
    await userEvent.click(screen.getByRole('button', { name: '新增另一個稀有度' }));
    await userEvent.type(screen.getByLabelText('稀有度 2'), 'sr');
    await userEvent.type(screen.getByLabelText(/異動原因/), '新增缺漏卡片');
    await userEvent.click(screen.getByRole('button', { name: '新增卡片' }));
    await userEvent.click(screen.getByRole('button', { name: '新增中' }));

    expect(addEntry).toHaveBeenCalledTimes(1);
    expect(addEntry).toHaveBeenCalledWith({
      cardId: 'P002', cardType: 'partner', cardName: '灰原哀',
      rarities: ['P', 'SR'], rationale: '新增缺漏卡片',
    });
    resolveAdd?.({ card: added, fingerprint: '3'.repeat(64) });
    await waitFor(() => expect(screen.getByText('灰原哀')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toContain('新增完成');
  });

  it('requires rationale and edits from a keyboard-dismissible dialog with focus return', async () => {
    const editEntry = vi.fn(async () => ({
      card: { ...cardA, rarities: ['CP', 'R'] }, fingerprint: '4'.repeat(64), retiredCardKey: null,
    }));
    const deps = dependencies({ editEntry });
    render(<CardMasterAdminPage {...deps} />);
    const editButton = await screen.findByRole('button', { name: '編輯黑羽快斗' });
    editButton.focus();
    await userEvent.click(editButton);
    const dialog = screen.getByRole('dialog', { name: '編輯卡片' });
    expect((within(dialog).getByLabelText(/卡片名稱/) as HTMLInputElement).value).toBe('黑羽快斗');
    await userEvent.clear(within(dialog).getByLabelText(/異動原因/));
    await userEvent.click(within(dialog).getByRole('button', { name: '儲存修改' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('異動原因');
    expect(editEntry).not.toHaveBeenCalled();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(editButton));
  });

  it('keeps a stale edit open and provides explicit reload guidance', async () => {
    const error = Object.assign(new Error('stale'), { code: 'functions/aborted' });
    const deps = dependencies({ editEntry: vi.fn(async () => { throw error; }) });
    render(<CardMasterAdminPage {...deps} />);
    await userEvent.click(await screen.findByRole('button', { name: '編輯黑羽快斗' }));
    const dialog = screen.getByRole('dialog', { name: '編輯卡片' });
    await userEvent.type(within(dialog).getByLabelText(/異動原因/), '修正資料');
    await userEvent.click(within(dialog).getByRole('button', { name: '儲存修改' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('請重新載入');
    expect(deps.editEntry).toHaveBeenCalledWith({
      sourceCardKey: KEY_A,
      expectedFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      cardId: '0501', cardType: 'character', cardName: '黑羽快斗',
      rarities: ['R', 'SR'], rationale: '修正資料',
    });
    expect(within(dialog).getByRole('button', { name: '重新載入卡片資料' })).toBeTruthy();
  });

  it('provides labelled controls, live feedback, focus styles, and a narrow layout rule', async () => {
    render(<CardMasterAdminPage {...dependencies()} />);
    await screen.findByRole('heading', { name: '新增卡片' });
    expect(screen.getByLabelText(/卡片類型/)).toBeTruthy();
    expect(screen.getByLabelText(/卡片名稱/)).toBeTruthy();
    expect(screen.getByLabelText(/卡片 ID/)).toBeTruthy();
    expect(screen.getByLabelText(/異動原因/)).toBeTruthy();
    expect(screen.getByTestId('admin-card-feedback').getAttribute('aria-live')).toBe('polite');

    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    expect(css).toMatch(/\.admin-card[^}]*:focus-visible|\.admin-card[\s\S]*:focus-visible/u);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*admin-card/u);
  });
});
