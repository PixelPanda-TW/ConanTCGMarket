import { describe, expect, it, vi } from 'vitest';
import type { DigestEmail } from './domain.js';
import { createRecipientDirectory, sendGmailDigest } from './gmailClient.js';

const message: DigestEmail = {
  to: 'buyer@example.com',
  subject: '柯南 TCG 新上架摘要',
  groups: [],
  text: '新上架摘要\nhttps://market.example/#/listing/listing-1',
  html: '<h1>新上架摘要</h1><a href="https://market.example/#/listing/listing-1">查看商品</a>',
};

function decodeRawMessage(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

describe('sendGmailDigest', () => {
  it('builds a Gmail API request from dedicated OAuth sender secrets', async () => {
    const setCredentials = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const createOAuthClient = vi.fn().mockReturnValue({ setCredentials });

    await sendGmailDigest(message, {
      getOAuthConfig: () => ({
        clientId: 'oauth-client-id',
        clientSecret: 'oauth-client-secret',
        refreshToken: 'oauth-refresh-token',
        senderAddress: 'digest-sender@example.com',
      }),
      createOAuthClient,
      sendMessage,
    });

    expect(createOAuthClient).toHaveBeenCalledWith('oauth-client-id', 'oauth-client-secret');
    expect(setCredentials).toHaveBeenCalledWith({ refresh_token: 'oauth-refresh-token' });
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const request = sendMessage.mock.calls[0]?.[1] as { raw: string };
    const mime = decodeRawMessage(request.raw);
    expect(sendMessage.mock.calls[0]?.[0]).toBe('me');
    expect(mime).toContain('From: digest-sender@example.com');
    expect(mime).toContain('To: buyer@example.com');
    expect(mime).toContain('Content-Type: multipart/alternative');
    expect(mime).toContain(message.text);
    expect(mime).toContain(message.html);
    expect(mime).not.toMatch(/<img|imageUrl|firebasestorage/i);
  });
});

describe('createRecipientDirectory', () => {
  it('resolves a verified Firebase Auth email only at send time', async () => {
    const getUser = vi.fn().mockResolvedValue({
      uid: 'buyer-1',
      email: 'buyer@example.com',
      emailVerified: true,
    });
    const directory = createRecipientDirectory({ getUser });

    await expect(directory.getVerifiedEmail('buyer-1')).resolves.toBe('buyer@example.com');
    expect(getUser).toHaveBeenCalledWith('buyer-1');
  });

  it.each([
    { uid: 'unverified', email: 'unverified@example.com', emailVerified: false },
    { uid: 'missing-email', emailVerified: true },
  ])('returns no recipient for $uid', async (user) => {
    const directory = createRecipientDirectory({
      getUser: vi.fn().mockResolvedValue(user),
    });

    await expect(directory.getVerifiedEmail(user.uid)).resolves.toBeNull();
  });

  it('treats a deleted Firebase Auth user as no recipient', async () => {
    const directory = createRecipientDirectory({
      getUser: vi.fn().mockRejectedValue(
        Object.assign(new Error('No user record'), { code: 'auth/user-not-found' }),
      ),
    });

    await expect(directory.getVerifiedEmail('deleted-user')).resolves.toBeNull();
  });

  it('does not hide unexpected Firebase Auth failures', async () => {
    const directory = createRecipientDirectory({
      getUser: vi.fn().mockRejectedValue(
        Object.assign(new Error('Auth unavailable'), { code: 'auth/internal-error' }),
      ),
    });

    await expect(directory.getVerifiedEmail('buyer-1')).rejects.toThrow('Auth unavailable');
  });
});
