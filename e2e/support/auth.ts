import { expect, type Locator, type Page } from '@playwright/test';

import { assertSafeEmulatorEnvironment, E2E_PROJECT_ID } from './emulator-state';

export interface MockGoogleIdentity {
  email: string;
  displayName: string;
}

const authAccountsUrl = `http://127.0.0.1:9099/emulator/v1/projects/${E2E_PROJECT_ID}/accounts`;

async function lookupAuthEmulatorUid(email: string, required: true): Promise<string>;
async function lookupAuthEmulatorUid(email: string, required: false): Promise<string | null>;
async function lookupAuthEmulatorUid(email: string, required: boolean): Promise<string | null> {
  assertSafeEmulatorEnvironment();
  const response = await fetch(authAccountsUrl);
  if (!response.ok) {
    throw new Error(`GET ${authAccountsUrl} failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json() as {
    users?: Array<{ localId: string; email?: string }>;
  };
  const matches = (body.users ?? []).filter((user) => user.email === email);
  if (matches.length === 0 && !required) return null;
  if (matches.length !== 1) {
    throw new Error(`Expected one Auth Emulator account for ${email}.`);
  }
  return matches[0].localId;
}

export async function signInWithMockGoogle(
  page: Page,
  identity: MockGoogleIdentity,
  trigger?: Locator,
): Promise<{ uid: string; email: string; displayName: string }> {
  const existingUid = await lookupAuthEmulatorUid(identity.email, false);
  const popupPromise = page.waitForEvent('popup');
  const signInTrigger = trigger
    ?? page.getByRole('button', { name: '使用 Google 登入' }).filter({ visible: true }).first();
  await signInTrigger.click();
  const popup = await popupPromise;
  const closePromise = popup.waitForEvent('close');

  if (existingUid) {
    await popup.locator('.js-reuse-account').filter({ hasText: identity.email }).click();
  } else {
    await popup.locator('#add-account-button').click();
    await popup.locator('#email-input').fill(identity.email);
    await popup.locator('#display-name-input').fill(identity.displayName);
    await popup.locator('#sign-in').click();
  }

  await closePromise;
  await expect(page.getByText(`賣家登入中：${identity.displayName}`)).toBeVisible();
  const uid = await lookupAuthEmulatorUid(identity.email, true);
  return { uid, ...identity };
}
