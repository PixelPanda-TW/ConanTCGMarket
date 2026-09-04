import { expect, type Locator, type Page } from '@playwright/test';
import { getAuth } from 'firebase-admin/auth';

import { assertSafeEmulatorEnvironment, getEmulatorAdminApp } from './emulator-state';

export interface MockGoogleIdentity {
  email: string;
  displayName: string;
}

export async function lookupAuthEmulatorUid(email: string, required: true): Promise<string>;
export async function lookupAuthEmulatorUid(email: string, required: false): Promise<string | null>;
export async function lookupAuthEmulatorUid(
  email: string,
  required: boolean,
): Promise<string | null> {
  assertSafeEmulatorEnvironment();
  try {
    return (await getAuth(getEmulatorAdminApp()).getUserByEmail(email)).uid;
  } catch (error: unknown) {
    if (
      typeof error !== 'object'
      || error === null
      || !('code' in error)
      || error.code !== 'auth/user-not-found'
    ) {
      throw error;
    }
  }

  if (!required) return null;
  throw new Error(`Expected one Auth Emulator account for ${email}.`);
}

export async function signInWithMockGoogle(
  page: Page,
  identity: MockGoogleIdentity,
  trigger?: Locator,
  signedInIndicator?: Locator,
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
    const emailInput = popup.locator('#email-input');
    await expect(async () => {
      await popup.getByRole('button', { name: 'Add new account' }).click();
      await expect(emailInput).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await emailInput.fill(identity.email);
    await popup.locator('#display-name-input').fill(identity.displayName);
    await popup.locator('#sign-in').click();
  }

  await closePromise;
  await expect(signedInIndicator ?? page.getByText(`Google 帳號：${identity.displayName}`))
    .toBeVisible();
  const uid = await lookupAuthEmulatorUid(identity.email, true);
  return { uid, ...identity };
}
