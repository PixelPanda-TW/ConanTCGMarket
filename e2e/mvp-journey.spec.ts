import { fileURLToPath } from 'node:url';
import { Timestamp } from 'firebase-admin/firestore';

import { signInWithMockGoogle } from './support/auth';
import {
  listDocuments,
  listStorageObjects,
  readDocument,
  seedScenario,
} from './support/emulator-state';
import { testCards } from './support/fixtures';
import { expect, test } from './support/test';
import {
  acknowledgeWelcome,
  createListingThroughUi,
  createSellerProfile,
} from './support/ui';

const front = fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url));

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

test('composes login, Profile, Listing, search, subscription, sales, and public sold-out removal', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  const owner = await signInWithMockGoogle(page, {
    email: 'mvp-owner@example.test',
    displayName: 'MVP Owner',
  });

  await createSellerProfile(page);
  await expect.poll(() => readDocument('sellerProfiles', owner.uid)).toMatchObject({
    displayName: 'E2E 賣家',
  });
  await expect.poll(() => readDocument('sellerContacts', owner.uid)).toMatchObject({
    contactType: 'discord',
    contactValue: 'e2e-seller',
  });
  const listingId = await createListingThroughUi(page, [front]);
  await expect.poll(() => readDocument('listings', listingId)).toMatchObject({
    sellerId: owner.uid,
    cardId: '0501',
    cardType: 'character',
    cardName: '諸伏高明',
    rarity: 'D',
    listingPrice: 500,
    originalQuantity: 5,
    remainingQuantity: 5,
    status: 'active',
  });
  await expect.poll(() => readDocument('listingEvents', listingId)).toMatchObject({
    listingId,
    cardId: '0501',
    cardName: '諸伏高明',
    rarity: 'D',
  });
  await expect.poll(() => listStorageObjects(`listings/${owner.uid}/${listingId}/`))
    .toHaveLength(1);

  await page.goto('./');
  await page.getByLabel('卡片類型').selectOption('character');
  await page.getByLabel('卡片名稱').fill('諸伏高明');
  await page.getByLabel('稀有度').selectOption('D');
  await page.getByLabel('搜尋卡片 ID').fill('0501');
  const marketplaceListing = page.getByRole('link', { name: /諸伏高明/ });
  await expect(marketplaceListing).toBeVisible();
  await marketplaceListing.click();
  await expect(page.getByText('NT$500')).toBeVisible();
  await expect(page.getByText('剩餘 5 張')).toBeVisible();
  await page.getByRole('button', { name: '訂閱諸伏高明' }).click();
  await page.getByLabel('以 Google 登入信箱接收每日摘要').check();
  await page.getByRole('button', { name: '確認訂閱' }).click();
  await expect(page.getByText('已訂閱「諸伏高明」的每日摘要通知。')).toBeVisible();
  await expect.poll(() => readDocument('notificationSubscriptions', owner.uid))
    .toMatchObject({ cardNames: ['諸伏高明'], emailDailyEnabled: true });

  await page.goto('#/dashboard');
  await expect(page.getByText('販售中：1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '登記成交' }).click();
  let dialog = page.getByRole('dialog', { name: '登記成交' });
  await dialog.getByLabel('數量').fill('2');
  await dialog.getByLabel('實際單價').fill('450');
  await dialog.getByRole('button', { name: '確認成交' }).click();
  await expect(page.getByText('已售張數：2', { exact: true })).toBeVisible();
  await expect(page.getByText('成交金額：NT$900', { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const [listing, sales] = await Promise.all([
      readDocument('listings', listingId),
      listDocuments('sales'),
    ]);
    return {
      remainingQuantity: listing?.remainingQuantity,
      status: listing?.status,
      sales: projectSales(sales),
    };
  }).toEqual({
    remainingQuantity: 3,
    status: 'active',
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
  await expect(dialog.getByLabel('實際單價')).toHaveValue('500');
  await dialog.getByLabel('數量').fill('3');
  await dialog.getByRole('button', { name: '確認成交' }).click();
  await expect(page.getByText('販售中：0', { exact: true })).toBeVisible();
  await expect(page.getByText('已售張數：5', { exact: true })).toBeVisible();
  await expect(page.getByText('成交金額：NT$2,400', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '已售罄' }).locator('..'))
    .toContainText('諸伏高明');
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
