import { signInWithMockGoogle } from './support/auth';
import { seedScenario } from './support/emulator-state';
import { activeListing, sale, sellerProfile, testCards } from './support/fixtures';
import { expect, test } from './support/test';
import { acknowledgeWelcome } from './support/ui';

test('keeps suspension-held listings private while preserving seller history', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  const identity = await signInWithMockGoogle(page, {
    email: 'suspended-seller@example.test',
    displayName: 'Suspended Seller',
  });

  await expect(page.getByRole('link', { name: '個人檔案' })).toBeVisible();
  await expect(page.getByRole('link', { name: '我要上架' })).toBeVisible();

  const actionId = 'a'.repeat(64);
  const suspendedAt = new Date('2026-09-02T00:00:00.000Z');
  const held = activeListing(identity.uid, 'https://example.test/active.png', {
    id: 'suspended-active-listing',
    status: 'suspended',
    suspensionActionId: actionId,
    suspendedAt,
    updatedAt: suspendedAt,
  });
  const soldOut = activeListing(identity.uid, 'https://example.test/sold.png', {
    id: 'suspended-sold-listing',
    status: 'sold_out',
    remainingQuantity: 0,
  });
  await seedScenario({
    accountAccess: [{
      uid: identity.uid,
      status: 'suspended',
      confirmedViolationCount: 1,
      suspensionReason: 'E2E confirmed reason',
      suspendedAt: new Date('2026-09-02T00:00:00.000Z'),
      suspendedBy: 'admin-e2e',
      suspensionActionId: actionId,
      updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    }],
    sellerProfiles: [sellerProfile(identity.uid, 'Suspended Seller')],
    listings: [held, soldOut],
    sales: [sale(identity.uid, soldOut.id)],
  });

  await expect(page.getByText('帳號目前已停權，仍可瀏覽公開市集。').first()).toBeVisible();
  await expect(page.getByText('停權原因：E2E confirmed reason').first()).toBeVisible();
  await expect(page.getByRole('link', { name: '個人檔案' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '我要上架' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '賣家管理' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '我的訂閱' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('帳號目前已停權，仍可瀏覽公開市集。').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toHaveCount(0);
  await page.goto('#/listing/suspended-active-listing');
  await expect(page.getByRole('heading', { name: '商品詳情' })).toBeVisible();
  await expect(page.getByRole('link', { name: '管理此商品' })).toHaveCount(0);
  await expect(page.getByText('此商品目前只供賣家本人查看。')).toBeVisible();

  for (const route of ['#/profile', '#/sell', '#/listing/suspended-active-listing/edit', '#/notifications']) {
    await page.goto(route);
    await expect(page.getByRole('status').filter({ hasText: /停權/ }).first()).toBeVisible();
  }

  await page.goto('#/dashboard');
  await expect(page.getByRole('status').filter({ hasText: 'E2E confirmed reason' }).first())
    .toBeVisible();
  await expect(page.getByText('販售中：0', { exact: true })).toBeVisible();
  await expect(page.getByText('停權保留：1', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '因停權隱藏' })).toContainText('諸伏高明');
  await expect(page.getByText('已售張數：2', { exact: true })).toBeVisible();
  await expect(page.getByText('成交金額：NT$900', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '已售罄' }).locator('..'))
    .toContainText('諸伏高明');
  await expect(page.getByRole('link', { name: '編輯' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登記成交' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '登記成交' })).toHaveCount(0);
});
