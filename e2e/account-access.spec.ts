import { signInWithMockGoogle } from './support/auth';
import { seedScenario } from './support/emulator-state';
import { activeListing, sale, sellerProfile, testCards } from './support/fixtures';
import { expect, test } from './support/test';
import { acknowledgeWelcome } from './support/ui';

test('applies a live suspension while preserving public browsing and seller history', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  const identity = await signInWithMockGoogle(page, {
    email: 'suspended-seller@example.test',
    displayName: 'Suspended Seller',
  });

  await expect(page.getByRole('link', { name: '個人檔案' })).toBeVisible();
  await expect(page.getByRole('link', { name: '我要上架' })).toBeVisible();

  const active = activeListing(identity.uid, 'https://example.test/active.png', {
    id: 'suspended-active-listing',
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
      updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    }],
    sellerProfiles: [sellerProfile(identity.uid, 'Suspended Seller')],
    listings: [active, soldOut],
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
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toBeVisible();
  await page.getByRole('link', { name: /諸伏高明/ }).click();
  await expect(page.getByRole('heading', { name: '商品詳情' })).toBeVisible();
  await expect(page.getByRole('link', { name: '管理此商品' })).toHaveCount(0);
  await expect(page.getByText('帳號停權期間無法管理卡名通知。')).toBeVisible();

  for (const route of ['#/profile', '#/sell', '#/listing/suspended-active-listing/edit', '#/notifications']) {
    await page.goto(route);
    await expect(page.getByRole('status').filter({ hasText: /停權/ }).first()).toBeVisible();
  }

  await page.goto('#/dashboard');
  await expect(page.getByRole('status').filter({ hasText: 'E2E confirmed reason' }).first())
    .toBeVisible();
  await expect(page.getByText('販售中：1', { exact: true })).toBeVisible();
  await expect(page.getByText('已售張數：2', { exact: true })).toBeVisible();
  await expect(page.getByText('成交金額：NT$900', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '已售罄' }).locator('..'))
    .toContainText('諸伏高明');
  await expect(page.getByRole('link', { name: '編輯' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登記成交' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '登記成交' })).toHaveCount(0);
});
