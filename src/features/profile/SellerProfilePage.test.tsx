// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SellerProfilePage } from './SellerProfilePage';

const repositories = vi.hoisted(() => ({
  getSellerProfile: vi.fn(),
  saveSellerProfile: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  user: { uid: 'seller-1', displayName: 'Google Seller' },
}));

vi.mock('../../data/firestore/repositories', () => repositories);
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: authState.user,
    isLoading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

afterEach(cleanup);

describe('SellerProfilePage contact fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositories.getSellerProfile.mockResolvedValue(null);
    repositories.saveSellerProfile.mockResolvedValue(undefined);
  });

  it('explains the initial LINE identifier field', async () => {
    render(<SellerProfilePage />);

    const input = await screen.findByLabelText('LINE ID');
    expect(input.getAttribute('placeholder')).toBe('例如：@conanmarket');
    expect(input.getAttribute('inputmode')).toBe('text');
    expect(screen.getByText('請填寫 LINE ID，不要貼網址。')).toBeTruthy();
  });

  it('updates guidance while preserving text when the contact type changes', async () => {
    render(<SellerProfilePage />);
    const lineInput = await screen.findByLabelText('LINE ID');
    fireEvent.change(lineInput, { target: { value: 'draft-contact' } });

    fireEvent.change(screen.getByLabelText('聯絡方式'), { target: { value: 'discord' } });

    const discordInput = screen.getByLabelText('Discord ID');
    expect((discordInput as HTMLInputElement).value).toBe('draft-contact');
    expect(discordInput.getAttribute('placeholder')).toBe('例如：conan_seller');
    expect(screen.getByText('只會顯示 ID 文字，不會建立連結。')).toBeTruthy();
  });

  it('uses URL input guidance for Facebook profiles', async () => {
    render(<SellerProfilePage />);
    await screen.findByLabelText('LINE ID');

    fireEvent.change(screen.getByLabelText('聯絡方式'), { target: { value: 'facebook' } });

    const input = screen.getByLabelText('Facebook 個人頁面連結');
    expect(input.getAttribute('inputmode')).toBe('url');
    expect(input.getAttribute('placeholder')).toBe('https://www.facebook.com/username');
    expect(screen.getByText('必須是 facebook.com 的個人頁面 HTTPS 連結。')).toBeTruthy();
  });

  it('announces an invalid Threads handle and never saves it', async () => {
    render(<SellerProfilePage />);
    await screen.findByLabelText('LINE ID');
    fireEvent.change(screen.getByLabelText('聯絡方式'), { target: { value: 'threads' } });
    fireEvent.change(screen.getByLabelText('Threads 個人頁面連結'), {
      target: { value: '@legacy' },
    });

    fireEvent.click(screen.getByRole('button', { name: '儲存個人檔案' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      '請填寫有效的 Threads 個人頁面 HTTPS 連結。',
    );
    expect(repositories.saveSellerProfile).not.toHaveBeenCalled();
  });

  it('canonicalizes a Facebook profile before saving', async () => {
    render(<SellerProfilePage />);
    await screen.findByLabelText('LINE ID');
    fireEvent.change(screen.getByLabelText('聯絡方式'), { target: { value: 'facebook' } });
    fireEvent.change(screen.getByLabelText('Facebook 個人頁面連結'), {
      target: { value: 'https://m.facebook.com/conan.seller/' },
    });

    fireEvent.click(screen.getByRole('button', { name: '儲存個人檔案' }));

    await waitFor(() => expect(repositories.saveSellerProfile).toHaveBeenCalledOnce());
    expect(repositories.saveSellerProfile).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'seller-1',
      displayName: 'Google Seller',
      contactType: 'facebook',
      contactValue: 'https://www.facebook.com/conan.seller',
    }));
    expect((await screen.findByRole('status')).textContent).toBe('已儲存個人檔案。');
  });
});
