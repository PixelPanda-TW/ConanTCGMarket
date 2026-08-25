import { getAuth } from 'firebase-admin/auth';
import { defineSecret } from 'firebase-functions/params';
import { google } from 'googleapis';
import type { DigestEmail, GmailClient, RecipientDirectory } from './domain.js';

export const gmailOAuthClientId = defineSecret('GMAIL_OAUTH_CLIENT_ID');
export const gmailOAuthClientSecret = defineSecret('GMAIL_OAUTH_CLIENT_SECRET');
export const gmailOAuthRefreshToken = defineSecret('GMAIL_OAUTH_REFRESH_TOKEN');
export const gmailSenderAddress = defineSecret('GMAIL_SENDER_ADDRESS');

interface OAuthClient {
  setCredentials(credentials: { refresh_token: string }): void;
}

interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  senderAddress: string;
}

interface GmailClientDependencies {
  getOAuthConfig(): GmailOAuthConfig;
  createOAuthClient(clientId: string, clientSecret: string): OAuthClient;
  sendMessage(userId: string, requestBody: { raw: string }, oauthClient: OAuthClient): Promise<unknown>;
}

interface AuthUser {
  email?: string;
  emailVerified: boolean;
}

interface RecipientDirectoryDependencies {
  getUser(uid: string): Promise<AuthUser>;
}

function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function assertSafeHeader(value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error('Gmail message contains an invalid header value.');
  }
}

function buildRawMessage(message: DigestEmail, senderAddress: string): string {
  assertSafeHeader(senderAddress);
  assertSafeHeader(message.to);
  assertSafeHeader(message.subject);

  const boundary = 'conan-tcg-daily-digest';
  const mime = [
    `From: ${senderAddress}`,
    `To: ${message.to}`,
    `Subject: ${encodeSubject(message.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.html,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return Buffer.from(mime, 'utf8').toString('base64url');
}

const defaultDependencies: GmailClientDependencies = {
  getOAuthConfig: () => ({
    clientId: gmailOAuthClientId.value(),
    clientSecret: gmailOAuthClientSecret.value(),
    refreshToken: gmailOAuthRefreshToken.value(),
    senderAddress: gmailSenderAddress.value(),
  }),
  createOAuthClient: (clientId, clientSecret) => new google.auth.OAuth2(clientId, clientSecret),
  async sendMessage(userId, requestBody, oauthClient) {
    await google.gmail({
      version: 'v1',
      auth: oauthClient as InstanceType<typeof google.auth.OAuth2>,
    }).users.messages.send({ userId, requestBody });
  },
};

export async function sendGmailDigest(
  message: DigestEmail,
  dependencies: GmailClientDependencies = defaultDependencies,
): Promise<void> {
  const config = dependencies.getOAuthConfig();
  const oauthClient = dependencies.createOAuthClient(config.clientId, config.clientSecret);
  oauthClient.setCredentials({ refresh_token: config.refreshToken });

  await dependencies.sendMessage(
    'me',
    { raw: buildRawMessage(message, config.senderAddress) },
    oauthClient,
  );
}

export function createGmailClient(): GmailClient {
  return {
    sendDigest: (message) => sendGmailDigest(message),
  };
}

export function createRecipientDirectory(
  dependencies: RecipientDirectoryDependencies = {
    getUser: (uid) => getAuth().getUser(uid),
  },
): RecipientDirectory {
  return {
    async getVerifiedEmail(uid: string): Promise<string | null> {
      const user = await dependencies.getUser(uid);
      return user.emailVerified && user.email ? user.email : null;
    },
  };
}
