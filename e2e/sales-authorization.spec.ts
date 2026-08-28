import { fileURLToPath } from 'node:url';
import { Timestamp } from 'firebase-admin/firestore';
import type { Page } from '@playwright/test';

import { signInWithMockGoogle } from './support/auth';
import {
  listDocuments,
  readDocument,
  seedListingImage,
  seedScenario,
} from './support/emulator-state';
import { activeListing, sale, sellerProfile, testCards } from './support/fixtures';
import { expect, test } from './support/test';
import { acknowledgeWelcome } from './support/ui';

const fixturePath = fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url));

async function seedOwnerListing(
  page: Page,
  email: string,
  listingId: string,
): Promise<{ uid: string; imageUrl: string }> {
  await page.goto('./');
  await acknowledgeWelcome(page);
  const owner = await signInWithMockGoogle(page, {
    email,
    displayName: 'Sales Owner',
  });
  const imageUrl = await seedListingImage(
    `listings/${owner.uid}/${listingId}/front.png`,
    fixturePath,
  );
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile(owner.uid, 'Sales Owner')],
    listings: [activeListing(owner.uid, imageUrl, { id: listingId })],
  });
  return { uid: owner.uid, imageUrl };
}

async function expectUnchangedListingWithoutSales(listingId: string): Promise<void> {
  await expect.poll(async () => {
    const [listing, sales] = await Promise.all([
      readDocument('listings', listingId),
      listDocuments('sales'),
    ]);
    return {
      remainingQuantity: listing?.remainingQuantity,
      status: listing?.status,
      sales,
    };
  }).toEqual({
    remainingQuantity: 5,
    status: 'active',
    sales: [],
  });
}

test('records partial and sold-out sales atomically and updates exact Dashboard totals', async ({ page }) => {
  const listingId = 'e2e-sale-listing';
  const owner = await seedOwnerListing(page, 'sales-owner@example.test', listingId);
  await page.goto('#/dashboard');

  await expect(page.getByText('販售中：1', { exact: true })).toBeVisible();
  await expect(page.getByText('已售張數：0', { exact: true })).toBeVisible();
  await expect(page.getByText('成交金額：NT$0', { exact: true })).toBeVisible();
  const activeSection = page.getByRole('heading', { name: '販售中' }).locator('..');
  const soldOutSection = page.getByRole('heading', { name: '已售罄' }).locator('..');
  await expect(activeSection).toContainText('諸伏高明');
  await expect(soldOutSection).not.toContainText('諸伏高明');

  await page.getByRole('button', { name: '登記成交' }).click();
  let dialog = page.getByRole('dialog', { name: '登記成交' });
  await expect(dialog.getByLabel('數量')).toHaveValue('1');
  await expect(dialog.getByLabel('實際單價')).toHaveValue('500');
  await dialog.getByLabel('數量').fill('2');
  await dialog.getByLabel('實際單價').fill('450');
  await dialog.getByRole('button', { name: '確認成交' }).click();

  await expect(page.getByText('販售中：1', { exact: true })).toBeVisible();
  await expect(page.getByText('已售張數：2', { exact: true })).toBeVisible();
  await expect(page.getByText('成交金額：NT$900', { exact: true })).toBeVisible();
  await expect(activeSection).toContainText('剩餘 3');
  await expect.poll(async () => {
    const [listing, sales] = await Promise.all([
      readDocument('listings', listingId),
      listDocuments('sales'),
    ]);
    const persistedSale = sales[0];
    return {
      listing: {
        remainingQuantity: listing?.remainingQuantity,
        status: listing?.status,
        updatedAtIsTimestamp: listing?.updatedAt instanceof Timestamp,
      },
      saleCount: sales.length,
      sale: persistedSale && {
        listingId: persistedSale.data.listingId,
        sellerId: persistedSale.data.sellerId,
        cardId: persistedSale.data.cardId,
        quantity: persistedSale.data.quantity,
        listingUnitPrice: persistedSale.data.listingUnitPrice,
        soldUnitPrice: persistedSale.data.soldUnitPrice,
        soldAtIsTimestamp: persistedSale.data.soldAt instanceof Timestamp,
      },
    };
  }).toEqual({
    listing: { remainingQuantity: 3, status: 'active', updatedAtIsTimestamp: true },
    saleCount: 1,
    sale: {
      listingId,
      sellerId: owner.uid,
      cardId: '0501',
      quantity: 2,
      listingUnitPrice: 500,
      soldUnitPrice: 450,
      soldAtIsTimestamp: true,
    },
  });

  await page.getByRole('button', { name: '登記成交' }).click();
  dialog = page.getByRole('dialog', { name: '登記成交' });
  await expect(dialog.getByLabel('數量')).toHaveValue('1');
  await expect(dialog.getByLabel('實際單價')).toHaveValue('500');
  await dialog.getByLabel('數量').fill('3');
  await dialog.getByRole('button', { name: '確認成交' }).click();

  await expect(page.getByText('販售中：0', { exact: true })).toBeVisible();
  await expect(page.getByText('已售張數：5', { exact: true })).toBeVisible();
  await expect(page.getByText('成交金額：NT$2,400', { exact: true })).toBeVisible();
  await expect(activeSection).not.toContainText('諸伏高明');
  await expect(soldOutSection).toContainText('諸伏高明');
  await expect.poll(async () => {
    const [listing, sales] = await Promise.all([
      readDocument('listings', listingId),
      listDocuments('sales'),
    ]);
    return {
      remainingQuantity: listing?.remainingQuantity,
      status: listing?.status,
      sales: sales
        .map(({ data }) => ({
          quantity: data.quantity,
          soldUnitPrice: data.soldUnitPrice,
          sellerId: data.sellerId,
        }))
        .sort((left, right) => Number(left.quantity) - Number(right.quantity)),
    };
  }).toEqual({
    remainingQuantity: 0,
    status: 'sold_out',
    sales: [
      { quantity: 2, soldUnitPrice: 450, sellerId: owner.uid },
      { quantity: 3, soldUnitPrice: 500, sellerId: owner.uid },
    ],
  });

  await page.goto('./');
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toHaveCount(0);
  await page.getByRole('button', { name: '登出' }).click();
  await page.goto('./');
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toHaveCount(0);
});

test('cancels a sale modal with defaults without changing inventory', async ({ page }) => {
  const listingId = 'e2e-sale-cancel';
  await seedOwnerListing(page, 'sales-cancel@example.test', listingId);
  await page.goto('#/dashboard');

  await page.getByRole('button', { name: '登記成交' }).click();
  const dialog = page.getByRole('dialog', { name: '登記成交' });
  await expect(dialog.getByLabel('數量')).toHaveValue('1');
  await expect(dialog.getByLabel('實際單價')).toHaveValue('500');
  await dialog.getByRole('button', { name: '取消' }).click();

  await expect(dialog).toHaveCount(0);
  await expectUnchangedListingWithoutSales(listingId);
});

const invalidSales = [
  { name: 'zero quantity', field: 'quantity', value: '0' },
  { name: 'decimal quantity', field: 'quantity', value: '1.5' },
  { name: 'oversold quantity', field: 'quantity', value: '6' },
  { name: 'zero price', field: 'price', value: '0' },
] as const;

for (const invalidSale of invalidSales) {
  test(`rejects ${invalidSale.name} and leaves Listing and Sales unchanged`, async ({ page }) => {
    const listingId = `e2e-sale-invalid-${invalidSale.name.replaceAll(' ', '-')}`;
    await seedOwnerListing(
      page,
      `sales-${invalidSale.name.replaceAll(' ', '-')}@example.test`,
      listingId,
    );
    await page.goto('#/dashboard');
    await page.getByRole('button', { name: '登記成交' }).click();
    const dialog = page.getByRole('dialog', { name: '登記成交' });
    const field = invalidSale.field === 'quantity' ? '數量' : '實際單價';
    await dialog.getByLabel(field).fill(invalidSale.value);
    await dialog.getByRole('button', { name: '確認成交' }).click();

    await expect(dialog).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText('成交數量或價格不正確。');
    await expectUnchangedListingWithoutSales(listingId);
  });
}

test('hides owner controls and data from another signed-in seller', async ({ page }) => {
  await page.goto('./');
  await acknowledgeWelcome(page);
  const ownerIdentity = {
    email: 'authorization-owner@example.test',
    displayName: 'Authorization Owner',
  };
  const owner = await signInWithMockGoogle(page, ownerIdentity);
  await page.getByRole('button', { name: '登出' }).click();
  const other = await signInWithMockGoogle(page, {
    email: 'authorization-other@example.test',
    displayName: 'Authorization Other',
  });
  const listingId = 'e2e-authorization-listing';
  const imageUrl = await seedListingImage(
    `listings/${owner.uid}/${listingId}/front.png`,
    fixturePath,
  );
  await seedScenario({
    cards: testCards,
    sellerProfiles: [
      sellerProfile(owner.uid, 'Authorization Owner'),
      sellerProfile(other.uid, 'Authorization Other'),
    ],
    listings: [activeListing(owner.uid, imageUrl, { id: listingId })],
    sales: [sale(owner.uid, listingId, { id: 'e2e-authorization-sale' })],
  });

  await page.goto(`#/listing/${listingId}`);
  await expect(page.getByRole('heading', { name: '商品詳情', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: '管理此商品' })).toHaveCount(0);
  await page.goto(`#/listing/${listingId}/edit`);
  await expect(page.getByRole('heading', { name: '無法編輯商品' })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '儲存變更' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刪除商品' })).toHaveCount(0);

  await page.goto('#/dashboard');
  await expect(page.getByText('販售中：0', { exact: true })).toBeVisible();
  await expect(page.getByText('已售張數：0', { exact: true })).toBeVisible();
  await expect(page.getByText('成交金額：NT$0', { exact: true })).toBeVisible();
  await expect(page.getByText('諸伏高明', { exact: true })).toHaveCount(0);
  await expect.poll(async () => {
    const [listing, seededSale] = await Promise.all([
      readDocument('listings', listingId),
      readDocument('sales', 'e2e-authorization-sale'),
    ]);
    return {
      listingSellerId: listing?.sellerId,
      listingRemainingQuantity: listing?.remainingQuantity,
      listingStatus: listing?.status,
      saleSellerId: seededSale?.sellerId,
      saleQuantity: seededSale?.quantity,
    };
  }).toEqual({
    listingSellerId: owner.uid,
    listingRemainingQuantity: 5,
    listingStatus: 'active',
    saleSellerId: owner.uid,
    saleQuantity: 2,
  });
});

test('shows signed-out guidance on every private route', async ({ page }) => {
  const routes = [
    {
      hash: '#/profile',
      heading: '賣家個人檔案',
      guidance: '請先使用 Google 登入，才能設定你的賣家聯絡方式。',
    },
    {
      hash: '#/sell',
      heading: '刊登商品',
      guidance: '請先使用 Google 登入，才能刊登商品。',
    },
    {
      hash: '#/dashboard',
      heading: '賣家管理',
      guidance: '請先登入才能管理商品。',
    },
    {
      hash: '#/notifications',
      heading: '我的訂閱',
      guidance: '請先使用 Google 登入，才能管理卡名訂閱。',
    },
  ] as const;

  for (const route of routes) {
    await page.goto(route.hash);
    await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
    await expect(page.getByText(route.guidance, { exact: true })).toBeVisible();
  }
});
