import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

import { activeListing, sellerProfile, testCards } from './support/fixtures';
import {
  readDocument,
  seedListingImage,
  seedScenario,
  updateListingAvailability,
} from './support/emulator-state';
import { expect, test } from './support/test';

const frontImage = fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url));
const rugiaUrl = 'https://rugiacreation.com/conan/search';

async function seedPublicListing() {
  const image = await seedListingImage(
    'listings/seller-public/e2e-listing-active/front.png',
    frontImage,
  );
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile('seller-public', '公開賣家')],
    listings: [activeListing('seller-public', image)],
  });
}

async function acknowledgeNotice(page: Page): Promise<void> {
  const notice = page.getByRole('dialog', { name: '網站使用與安全提醒' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: '我知道了' }).click();
}

test('acknowledges the notice and filters an active public listing', async ({ page }) => {
  await seedPublicListing();
  await page.goto('./');

  const notice = page.getByRole('dialog', { name: '網站使用與安全提醒' });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('link', { name: 'rugiacreation.com' }).first())
    .toHaveAttribute('href', rugiaUrl);
  const footer = page.locator('footer');
  await expect(footer).toContainText('致謝與致敬路奇亞');
  await expect(footer.getByRole('link', { name: 'rugiacreation.com' }))
    .toHaveAttribute('href', rugiaUrl);

  await notice.getByRole('button', { name: '我知道了' }).click();
  await page.reload();
  await expect(notice).toBeHidden();

  await page.getByLabel('卡片類型').selectOption('character');
  await page.getByLabel('卡片名稱').fill('諸伏高明');
  await expect(page.getByLabel('稀有度')).toBeEnabled();
  await page.getByLabel('稀有度').selectOption('D');
  await page.getByLabel('搜尋卡片 ID').fill('0501');
  await page.getByLabel('包手').check();
  await page.getByLabel('賣貨便').check();

  const card = page.getByRole('link', { name: /諸伏高明/ });
  await expect(card).toContainText('ID 0501');
  await expect(card).toContainText('NT$500');
  await expect(card).toContainText('公開賣家');
  await card.click();

  await expect(page).toHaveURL(/#\/listing\/e2e-listing-active$/);
  await expect(page.getByRole('heading', { name: '商品詳情' })).toBeVisible();
  await expect(page.getByRole('img', { name: '諸伏高明 實卡照片' })).toBeVisible();
  await expect(page.getByText('公開賣家', { exact: true })).toBeVisible();
  await expect(page.getByText('e2e-line')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登入後查看聯絡方式' })).toBeVisible();
  await expect(page.getByText('包手（包材費 NT$20）')).toBeVisible();
  await expect(page.getByText('支援賣貨便（加價 NT$10）')).toBeVisible();
});

test('shows an empty public market', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');

  await expect(page.getByText('目前沒有符合條件的商品。')).toBeVisible();
});

test('never exposes sold-out Listings', async ({ page }) => {
  const image = await seedListingImage(
    'listings/seller-public/listing-filter/front.png',
    frontImage,
  );
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile('seller-public', '公開賣家')],
    listings: [
      activeListing('seller-public', image),
      activeListing('seller-public', image, {
        id: 'e2e-listing-sold-out',
        cardId: '1096',
        cardName: '諸伏景光',
        characterName: '諸伏景光',
        rarity: 'R',
      }),
    ],
  });
  await expect.poll(() => readDocument('listingEvents', 'e2e-listing-sold-out')).toMatchObject({
    listingId: 'e2e-listing-sold-out',
  });
  await updateListingAvailability('e2e-listing-sold-out', {
    remainingQuantity: 0,
    status: 'sold_out',
  });
  await expect.poll(() => readDocument('listings', 'e2e-listing-sold-out')).toMatchObject({
    remainingQuantity: 0,
    status: 'sold_out',
  });
  await page.goto('./');

  const listings = page.getByRole('region', { name: '商品列表' });
  await expect(listings.getByRole('link', { name: /諸伏高明/ })).toHaveCount(1);
  await expect(listings.getByText('諸伏景光', { exact: true })).toHaveCount(0);
  await expect(listings.getByText('ID 1096', { exact: true })).toHaveCount(0);
});

test('validates and clears independent ID search', async ({ page }) => {
  await seedPublicListing();
  await page.goto('./');
  await acknowledgeNotice(page);

  const idSearch = page.getByLabel('搜尋卡片 ID');
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toBeVisible();
  await idSearch.fill('B001');
  await expect(page.getByRole('alert')).toHaveText('卡片 ID 請輸入 4 位數字，或 P 加 3 位數字。');
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toHaveCount(0);

  await idSearch.clear();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toBeVisible();
});

test('renders loading until Firestore responds', async ({ page }) => {
  await seedPublicListing();
  let releaseRequest!: () => void;
  let markRequestHeld!: () => void;
  const release = new Promise<void>((resolve) => { releaseRequest = resolve; });
  const requestHeld = new Promise<void>((resolve) => { markRequestHeld = resolve; });
  let firstRequest = true;

  await page.route('http://127.0.0.1:8080/**', async (route) => {
    if (!firstRequest) {
      await route.continue();
      return;
    }
    firstRequest = false;
    markRequestHeld();
    await release;
    await route.continue();
  });

  await page.goto('./');
  await requestHeld;
  await expect(page.getByText('商品載入中')).toBeVisible();
  releaseRequest();
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toBeVisible();
});

test('renders the Firestore error state', async ({ page }) => {
  await page.route('http://127.0.0.1:8080/**', (route) => route.abort('failed'));

  await page.goto('./');

  await expect(page.getByRole('alert')).toHaveText('無法載入商品，請稍後再試。');
});
