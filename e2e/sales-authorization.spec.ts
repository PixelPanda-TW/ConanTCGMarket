import { fileURLToPath } from 'node:url';
import { Timestamp } from 'firebase-admin/firestore';
import type { Page } from '@playwright/test';

import { signInWithMockGoogle } from './support/auth';
import {
  listDocuments,
  readDocument,
  seedListingImage,
  seedScenario,
  updateListingAvailability,
} from './support/emulator-state';
import { activeListing, sale, sellerProfile, testCards } from './support/fixtures';
import { expect, test } from './support/test';
import { acknowledgeWelcome } from './support/ui';

const fixturePath = fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url));
const seededAt = Timestamp.fromDate(new Date('2026-08-27T00:00:00.000Z'));

function projectSales(sales: Awaited<ReturnType<typeof listDocuments>>) {
  return sales
    .map(({ id, data }) => ({
      saleId: id,
      listingId: data.listingId,
      sellerId: data.sellerId,
      cardId: data.cardId,
      quantity: data.quantity,
      listingUnitPrice: data.listingUnitPrice,
      soldUnitPrice: data.soldUnitPrice,
      soldAt: data.soldAt,
    }))
    .sort((left, right) => (
      Number(left.quantity) - Number(right.quantity)
      || left.saleId.localeCompare(right.saleId)
    ));
}

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

async function snapshotCompleteListing(
  listingId: string,
  sellerId: string,
  imageUrl: string,
): Promise<{ id: string; data: Record<string, unknown> }> {
  const listing = await readDocument('listings', listingId);
  expect(listing).toEqual({
    sellerId,
    cardId: '0501',
    cardType: 'character',
    cardName: '諸伏高明',
    characterName: '諸伏高明',
    rarity: 'D',
    imageUrls: [imageUrl],
    listingPrice: 500,
    originalQuantity: 5,
    remainingQuantity: 5,
    hasSleeve: true,
    sleeveFee: 20,
    supportsMyShip: true,
    myShipFee: 10,
    note: 'E2E 商品備註',
    status: 'active',
    createdAt: seededAt,
    updatedAt: seededAt,
  });
  await expect.poll(() => listDocuments('sales')).toEqual([]);
  return { id: listingId, data: listing! };
}

async function expectUnchangedListingWithoutSales(
  listingId: string,
  listingSnapshot: { id: string; data: Record<string, unknown> },
): Promise<void> {
  await expect.poll(async () => {
    const [listing, sales] = await Promise.all([
      readDocument('listings', listingId),
      listDocuments('sales'),
    ]);
    return { listing: { id: listingId, data: listing }, sales };
  }).toEqual({
    listing: listingSnapshot,
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
    return {
      listing: {
        remainingQuantity: listing?.remainingQuantity,
        status: listing?.status,
        updatedAtIsTimestamp: listing?.updatedAt instanceof Timestamp,
      },
      sales: projectSales(sales),
    };
  }).toEqual({
    listing: { remainingQuantity: 3, status: 'active', updatedAtIsTimestamp: true },
    sales: [{
      saleId: expect.stringMatching(/^[A-Za-z0-9]{20}$/),
      listingId,
      sellerId: owner.uid,
      cardId: '0501',
      quantity: 2,
      listingUnitPrice: 500,
      soldUnitPrice: 450,
      soldAt: expect.any(Timestamp),
    }],
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
      uniqueSaleIds: new Set(sales.map(({ id }) => id)).size,
      sales: projectSales(sales),
    };
  }).toEqual({
    remainingQuantity: 0,
    status: 'sold_out',
    uniqueSaleIds: 2,
    sales: [
      {
        saleId: expect.stringMatching(/^[A-Za-z0-9]{20}$/),
        listingId,
        sellerId: owner.uid,
        cardId: '0501',
        quantity: 2,
        listingUnitPrice: 500,
        soldUnitPrice: 450,
        soldAt: expect.any(Timestamp),
      },
      {
        saleId: expect.stringMatching(/^[A-Za-z0-9]{20}$/),
        listingId,
        sellerId: owner.uid,
        cardId: '0501',
        quantity: 3,
        listingUnitPrice: 500,
        soldUnitPrice: 500,
        soldAt: expect.any(Timestamp),
      },
    ],
  });

  await page.goto('./');
  await expect(page.getByText('目前沒有符合條件的商品。', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toHaveCount(0);
  await page.getByRole('button', { name: '登出' }).click();
  await page.goto('./');
  await expect(page.getByText('目前沒有符合條件的商品。', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toHaveCount(0);
});

test('cancels a sale modal with defaults without changing inventory', async ({ page }) => {
  const listingId = 'e2e-sale-cancel';
  const owner = await seedOwnerListing(page, 'sales-cancel@example.test', listingId);
  await page.goto('#/dashboard');
  const listingSnapshot = await snapshotCompleteListing(listingId, owner.uid, owner.imageUrl);

  await page.getByRole('button', { name: '登記成交' }).click();
  const dialog = page.getByRole('dialog', { name: '登記成交' });
  await expect(dialog.getByLabel('數量')).toHaveValue('1');
  await expect(dialog.getByLabel('實際單價')).toHaveValue('500');
  await dialog.getByRole('button', { name: '取消' }).click();

  await expect(dialog).toHaveCount(0);
  await expectUnchangedListingWithoutSales(listingId, listingSnapshot);
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
    const owner = await seedOwnerListing(
      page,
      `sales-${invalidSale.name.replaceAll(' ', '-')}@example.test`,
      listingId,
    );
    await page.goto('#/dashboard');
    const listingSnapshot = await snapshotCompleteListing(listingId, owner.uid, owner.imageUrl);
    await page.getByRole('button', { name: '登記成交' }).click();
    const dialog = page.getByRole('dialog', { name: '登記成交' });
    const field = invalidSale.field === 'quantity' ? '數量' : '實際單價';
    await dialog.getByLabel(field).fill(invalidSale.value);
    await dialog.getByRole('button', { name: '確認成交' }).click();

    await expect(dialog).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText('成交數量或價格不正確。');
    await expectUnchangedListingWithoutSales(listingId, listingSnapshot);
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
  const activeListingId = 'e2e-authorization-active';
  const soldOutListingId = 'e2e-authorization-sold-out';
  const activeImageUrl = await seedListingImage(
    `listings/${owner.uid}/${activeListingId}/front.png`,
    fixturePath,
  );
  const soldOutImageUrl = await seedListingImage(
    `listings/${owner.uid}/${soldOutListingId}/front.png`,
    fixturePath,
  );
  await seedScenario({
    cards: testCards,
    sellerProfiles: [
      sellerProfile(owner.uid, 'Authorization Owner'),
      sellerProfile(other.uid, 'Authorization Other'),
    ],
    listings: [
      activeListing(owner.uid, activeImageUrl, { id: activeListingId }),
      activeListing(owner.uid, soldOutImageUrl, {
        id: soldOutListingId,
        cardId: '1096',
        cardName: '諸伏景光',
        characterName: '諸伏景光',
        rarity: 'R',
        originalQuantity: 2,
        remainingQuantity: 2,
      }),
    ],
    sales: [sale(owner.uid, soldOutListingId, {
      id: 'e2e-authorization-sale',
      cardId: '1096',
      quantity: 2,
    })],
  });
  await expect.poll(() => readDocument('listingEvents', soldOutListingId)).not.toBeNull();
  await updateListingAvailability(soldOutListingId, {
    remainingQuantity: 0,
    status: 'sold_out',
  });

  await page.goto(`#/listing/${activeListingId}`);
  await expect(page.getByRole('heading', { name: '商品詳情', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: '管理此商品' })).toHaveCount(0);
  await page.goto(`#/listing/${activeListingId}/edit`);
  await expect(page.getByRole('heading', { name: '無法編輯商品' })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '儲存變更' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刪除商品' })).toHaveCount(0);

  await page.goto('#/dashboard');
  await expect(page.getByText('販售中：0', { exact: true })).toBeVisible();
  await expect(page.getByText('已售張數：0', { exact: true })).toBeVisible();
  await expect(page.getByText('成交金額：NT$0', { exact: true })).toBeVisible();
  const activeSection = page.getByRole('heading', { name: '販售中' }).locator('..');
  const soldOutSection = page.getByRole('heading', { name: '已售罄' }).locator('..');
  await expect(activeSection).not.toContainText('諸伏高明');
  await expect(activeSection).not.toContainText('諸伏景光');
  await expect(soldOutSection).not.toContainText('諸伏高明');
  await expect(soldOutSection).not.toContainText('諸伏景光');
  await expect(activeSection.locator('.listing-card')).toHaveCount(0);
  await expect(soldOutSection.locator('.dashboard-sold-out-listing')).toHaveCount(0);
  await expect.poll(async () => {
    const [activeOwnerListing, soldOutOwnerListing, seededSale] = await Promise.all([
      readDocument('listings', activeListingId),
      readDocument('listings', soldOutListingId),
      readDocument('sales', 'e2e-authorization-sale'),
    ]);
    return {
      activeListing: {
        sellerId: activeOwnerListing?.sellerId,
        remainingQuantity: activeOwnerListing?.remainingQuantity,
        status: activeOwnerListing?.status,
      },
      soldOutListing: {
        sellerId: soldOutOwnerListing?.sellerId,
        remainingQuantity: soldOutOwnerListing?.remainingQuantity,
        status: soldOutOwnerListing?.status,
      },
      saleSellerId: seededSale?.sellerId,
      saleQuantity: seededSale?.quantity,
    };
  }).toEqual({
    activeListing: { sellerId: owner.uid, remainingQuantity: 5, status: 'active' },
    soldOutListing: { sellerId: owner.uid, remainingQuantity: 0, status: 'sold_out' },
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
