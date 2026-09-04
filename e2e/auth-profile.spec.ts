import { signInWithMockGoogle } from './support/auth';
import { readDocument } from './support/emulator-state';
import { expect, test } from './support/test';
import { acknowledgeWelcome, createSellerProfile } from './support/ui';

test('shows Profile guidance while signed out', async ({ page }) => {
  await page.goto('#/profile');

  await expect(page.getByRole('heading', { name: '賣家個人檔案' })).toBeVisible();
  await expect(page.getByText('請先使用 Google 登入，才能設定你的賣家聯絡方式。'))
    .toBeVisible();
});

test('validates required Profile fields without persisting invalid data', async ({ page }) => {
  await page.goto('./');
  await acknowledgeWelcome(page);
  const identity = await signInWithMockGoogle(page, {
    email: 'profile-validation@example.test',
    displayName: 'Validation Seller',
  });
  await page.goto('#/profile');

  await page.getByLabel('顯示名稱').fill('   ');
  await page.getByLabel('LINE ID').fill('   ');
  await page.getByRole('button', { name: '儲存個人檔案' }).click();

  await expect(page.getByRole('alert').filter({ hasText: '請填寫顯示名稱。' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '請填寫聯絡方式。' })).toBeVisible();
  await expect.poll(() => readDocument('sellerProfiles', identity.uid)).toBeNull();
});

test('signs in, creates and edits a Profile, reloads, then signs out', async ({ page }) => {
  await page.goto('./');
  await acknowledgeWelcome(page);
  const identity = await signInWithMockGoogle(page, {
    email: 'seller-profile@example.test',
    displayName: 'Profile Seller',
  });

  await expect(page.getByRole('link', { name: '個人檔案' })).toBeVisible();
  await expect(page.getByRole('link', { name: '我要上架' })).toBeVisible();
  await expect(page.getByRole('link', { name: '賣家管理' })).toBeVisible();
  await createSellerProfile(page);
  await expect.poll(() => readDocument('sellerProfiles', identity.uid)).toMatchObject({
    displayName: 'E2E 賣家',
  });
  await expect.poll(() => readDocument('sellerContacts', identity.uid)).toMatchObject({
    contactType: 'discord',
    contactValue: 'e2e-seller',
  });

  await page.getByLabel('顯示名稱').fill('更新後賣家');
  await page.getByLabel('聯絡方式').selectOption('threads');
  await page.getByLabel('Threads 個人頁面連結').fill('https://threads.net/@updated/');
  await page.getByRole('button', { name: '儲存個人檔案' }).click();
  await expect(page.getByRole('status')).toContainText('已儲存個人檔案');
  await expect.poll(() => readDocument('sellerProfiles', identity.uid)).toMatchObject({
    displayName: '更新後賣家',
  });
  await expect.poll(() => readDocument('sellerContacts', identity.uid)).toMatchObject({
    contactType: 'threads',
    contactValue: 'https://www.threads.net/@updated',
  });

  await page.reload();
  await expect(page.getByLabel('顯示名稱')).toHaveValue('更新後賣家');
  await expect(page.getByLabel('聯絡方式')).toHaveValue('threads');
  await expect(page.getByLabel('Threads 個人頁面連結'))
    .toHaveValue('https://www.threads.net/@updated');

  await page.goto('./');
  await page.getByRole('button', { name: '登出' }).click();
  await expect(page.getByText('買家可直接瀏覽；賣家上架需登入')).toBeVisible();
  await page.goto('#/profile');
  await expect(page.getByText('請先使用 Google 登入，才能設定你的賣家聯絡方式。'))
    .toBeVisible();
});
