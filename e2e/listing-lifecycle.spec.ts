import { fileURLToPath } from 'node:url';
import { Timestamp } from 'firebase-admin/firestore';

import { signInWithMockGoogle } from './support/auth';
import {
  E2E_BUCKET,
  listDocuments,
  listStorageObjects,
  readDocument,
  seedListingImage,
  seedScenario,
} from './support/emulator-state';
import { activeListing, sale, sellerProfile, testCards } from './support/fixtures';
import { expect, test } from './support/test';
import {
  acknowledgeWelcome,
  createSellerProfile,
  selectCardMetadata,
} from './support/ui';

const front = fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url));
const back = fileURLToPath(new URL('./fixtures/card-back.png', import.meta.url));

async function expectNoListingsOrImages(): Promise<void> {
  await expect.poll(() => listDocuments('listings')).toEqual([]);
  await expect.poll(() => listStorageObjects('listings/')).toEqual([]);
}

async function expectPersistedImagesMatchStorage(
  sellerId: string,
  listingId: string,
  expectedCount: number,
): Promise<void> {
  const prefix = `listings/${sellerId}/${listingId}/`;
  const bucketPathPrefix = `/v0/b/${E2E_BUCKET}/o/`;

  await expect(async () => {
    const listing = await readDocument('listings', listingId);
    const imageUrls = listing?.imageUrls;
    const objects = await listStorageObjects(prefix);
    expect(Array.isArray(imageUrls)).toBe(true);
    expect(imageUrls).toHaveLength(expectedCount);
    expect(objects).toHaveLength(expectedCount);
    expect(new Set(imageUrls as string[])).toHaveProperty('size', expectedCount);

    const decodedObjectPaths = (imageUrls as string[]).map((downloadUrl) => {
      const parsed = new URL(downloadUrl);
      expect(parsed.origin).toBe('http://127.0.0.1:9199');
      expect(parsed.pathname.startsWith(bucketPathPrefix)).toBe(true);
      expect(parsed.searchParams.get('alt')).toBe('media');
      const objectPath = decodeURIComponent(parsed.pathname.slice(bucketPathPrefix.length));
      expect(parsed.pathname).toBe(`${bucketPathPrefix}${encodeURIComponent(objectPath)}`);
      expect(objectPath.startsWith(prefix)).toBe(true);
      return objectPath;
    });

    expect(new Set(decodedObjectPaths)).toHaveProperty('size', expectedCount);
    expect(decodedObjectPaths.toSorted()).toEqual(objects.toSorted());
  }).toPass();
}

async function completeRequiredListingFields(page: import('@playwright/test').Page): Promise<void> {
  await selectCardMetadata(page, {
    cardType: 'character',
    cardName: '諸伏高明',
    rarity: 'D',
    cardId: '0501',
  });
  await page.getByLabel('商品圖片').setInputFiles(front);
  await page.getByLabel('價格').fill('500');
  await page.getByLabel('數量').fill('5');
}

test('requires login to sell', async ({ page }) => {
  await page.goto('#/sell');

  await expect(page.getByRole('heading', { name: '刊登商品' })).toBeVisible();
  await expect(page.getByText('請先使用 Google 登入，才能刊登商品。')).toBeVisible();
  await expectNoListingsOrImages();
});

test('requires a seller Profile', async ({ page }) => {
  await page.goto('./');
  await acknowledgeWelcome(page);
  await signInWithMockGoogle(page, {
    email: 'listing-no-profile@example.test',
    displayName: 'Listing Without Profile',
  });
  await page.goto('#/sell');

  await expect(page.getByRole('link', { name: '前往設定個人檔案' })).toBeVisible();
  await expectNoListingsOrImages();
});

test('rejects missing required Listing fields', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  await signInWithMockGoogle(page, {
    email: 'listing-required@example.test',
    displayName: 'Required Fields Seller',
  });
  await createSellerProfile(page);
  await page.goto('#/sell');
  await page.getByRole('button', { name: '建立刊登' }).click();

  const alerts = page.getByRole('alert');
  await expect(alerts.filter({ hasText: '請填寫卡片名稱。' })).toBeVisible();
  await expect(alerts.filter({ hasText: '請選擇 1 到 3 張商品圖片。' })).toBeVisible();
  await expect(alerts.filter({ hasText: '價格必須大於 0。' })).toBeVisible();
  await expect(alerts.filter({ hasText: '數量必須是大於 0 的整數。' })).toBeVisible();
  await expectNoListingsOrImages();
});

test('rejects missing and negative optional-service fees', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  await signInWithMockGoogle(page, {
    email: 'listing-fees@example.test',
    displayName: 'Fee Validation Seller',
  });
  await createSellerProfile(page);
  await page.goto('#/sell');
  await completeRequiredListingFields(page);
  await page.getByLabel('包手').check();
  await page.getByLabel('支援賣貨便').check();
  await page.getByRole('button', { name: '建立刊登' }).click();

  await expect(page.getByRole('alert').filter({ hasText: '請填寫包材費。' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '請填寫賣貨便加價。' }))
    .toBeVisible();
  await page.getByLabel('包材費').fill('-1');
  await page.getByLabel('賣貨便加價').fill('-1');
  await page.getByRole('button', { name: '建立刊登' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '包材費不可小於 0。' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '賣貨便加價不可小於 0。' }))
    .toBeVisible();
  await expectNoListingsOrImages();
});

test('rejects unknown Card Master tuple', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  await signInWithMockGoogle(page, {
    email: 'listing-card-tuple@example.test',
    displayName: 'Card Tuple Seller',
  });
  await createSellerProfile(page);
  await page.goto('#/sell');
  await completeRequiredListingFields(page);
  await page.getByLabel('卡片 ID').fill('9999');
  await page.getByRole('button', { name: '建立刊登' }).click();

  await expect(page.getByRole('alert')).toContainText(
    '資料庫找不到這組卡片類型、卡片名稱、稀有度與 ID，請確認後再試。',
  );
  await expectNoListingsOrImages();
});

test('rejects more than three images', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  await signInWithMockGoogle(page, {
    email: 'listing-images@example.test',
    displayName: 'Image Validation Seller',
  });
  await createSellerProfile(page);
  await page.goto('#/sell');
  await completeRequiredListingFields(page);
  await page.getByLabel('商品圖片').setInputFiles([front, back, front, back]);
  await page.getByRole('button', { name: '建立刊登' }).click();

  await expect(page.getByRole('alert')).toContainText('請選擇 1 到 3 張商品圖片。');
  await expectNoListingsOrImages();
});

test('creates a complete Listing, uploads images, and captures its event', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  const seller = await signInWithMockGoogle(page, {
    email: 'listing-owner@example.test',
    displayName: 'Listing Owner',
  });
  await createSellerProfile(page);
  await page.goto('#/sell');
  await expect(page.getByText('同版本、相近卡況才合併刊登。')).toBeVisible();
  await selectCardMetadata(page, {
    cardType: 'character', cardName: '諸伏高明', rarity: 'D', cardId: '0501',
  });
  await page.getByLabel('商品圖片').setInputFiles([front, back]);
  await page.getByLabel('價格').fill('500');
  await page.getByLabel('數量').fill('5');
  await page.getByLabel('包手').check();
  await page.getByLabel('包材費').fill('20');
  await page.getByLabel('支援賣貨便').check();
  await page.getByLabel('賣貨便加價').fill('10');
  await page.getByLabel('備註').fill('E2E 商品備註');
  await expect(page.getByRole('complementary', { name: '其他交易需求提醒' }))
    .toContainText('若有其他交易需求，請在備註中說明');
  await page.getByRole('button', { name: '建立刊登' }).click();

  await expect(page).toHaveURL(/#\/listing\/[^/]+$/);
  const listingId = new URL(page.url()).hash.split('/').at(-1)!;
  await expect.poll(() => readDocument('listings', listingId)).toMatchObject({
    sellerId: seller.uid,
    cardType: 'character',
    cardName: '諸伏高明',
    characterName: '諸伏高明',
    rarity: 'D',
    cardId: '0501',
    listingPrice: 500,
    originalQuantity: 5,
    remainingQuantity: 5,
    hasSleeve: true,
    sleeveFee: 20,
    supportsMyShip: true,
    myShipFee: 10,
    status: 'active',
    note: 'E2E 商品備註',
  });
  const listing = await readDocument('listings', listingId);
  expect(listing?.createdAt).toBeInstanceOf(Timestamp);
  expect(listing?.updatedAt).toBeInstanceOf(Timestamp);
  expect((listing?.createdAt as Timestamp).toMillis())
    .toBe((listing?.updatedAt as Timestamp).toMillis());
  await expectPersistedImagesMatchStorage(seller.uid, listingId, 2);
  await expect.poll(() => readDocument('listingEvents', listingId)).toMatchObject({
    listingId,
    cardName: '諸伏高明',
    cardId: '0501',
    rarity: 'D',
    discordStatus: 'disabled',
  });
  const detailImages = page.getByRole('img', { name: '諸伏高明 實卡照片' });
  await expect(detailImages).toHaveCount(2);
  for (const image of await detailImages.all()) await expect(image).toBeVisible();
  await expect(page.getByText('角色卡', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '諸伏高明', level: 2 })).toBeVisible();
  await expect(page.getByText('D · ID 0501', { exact: true })).toBeVisible();
  await expect(page.getByText('NT$500')).toBeVisible();
  await expect(page.getByText('剩餘 5 張')).toBeVisible();
  await expect(page.getByText('包手（包材費 NT$20）')).toBeVisible();
  await expect(page.getByText('支援賣貨便（加價 NT$10）')).toBeVisible();
  await expect(page.getByText('E2E 商品備註')).toBeVisible();
  await expect(page.getByText('E2E 賣家', { exact: true })).toBeVisible();
  await expect(page.getByText('以 discord 聯絡：e2e-seller')).toBeVisible();
  const managementLink = page.getByRole('link', { name: '管理此商品' });
  await expect(managementLink).toBeVisible();
  await expect(managementLink).toHaveAttribute('href', `#/listing/${listingId}/edit`);
  await page.goto('./');
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toBeVisible();
});

test('rejects sold inventory and replaces images after a successful owner edit', async ({ page }) => {
  await page.goto('./');
  await acknowledgeWelcome(page);
  const owner = await signInWithMockGoogle(page, {
    email: 'listing-edit-owner@example.test',
    displayName: 'Listing Edit Owner',
  });
  const listingId = 'e2e-listing-edit';
  const oldPath = `listings/${owner.uid}/${listingId}/old-front.png`;
  const oldUrl = await seedListingImage(oldPath, front);
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile(owner.uid)],
    listings: [activeListing(owner.uid, oldUrl, {
      id: listingId,
      originalQuantity: 5,
      remainingQuantity: 3,
    })],
    sales: [sale(owner.uid, listingId)],
  });
  await page.goto(`#/listing/${listingId}/edit`);

  await expect(page.getByRole('heading', { name: '編輯商品' })).toBeVisible();
  await expect(page.getByText('角色卡', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '諸伏高明', level: 2 })).toBeVisible();
  await expect(page.getByText('D · ID 0501', { exact: true })).toBeVisible();
  await expect(page.getByLabel('卡片類型')).toHaveCount(0);
  await expect(page.getByLabel('卡片名稱')).toHaveCount(0);
  await expect(page.getByLabel('稀有度')).toHaveCount(0);
  await expect(page.getByLabel('卡片 ID')).toHaveCount(0);
  const existingImages = page.locator('[aria-label="目前商品圖片"]');
  await expect(existingImages).toBeVisible();
  await expect(existingImages.getByRole('img', { name: '目前商品圖片' })).toHaveCount(1);
  await page.getByLabel('價格').fill('450');
  await page.getByLabel('剩餘數量').fill('1');
  await page.getByRole('button', { name: '儲存變更' }).click();
  await expect(page.getByRole('alert')).toContainText('價格、庫存或圖片不正確');
  await expect.poll(async () => {
    const unchanged = await readDocument('listings', listingId);
    const seededSale = await readDocument('sales', 'e2e-sale-1');
    return {
      listingPrice: unchanged?.listingPrice,
      remainingQuantity: unchanged?.remainingQuantity,
      imageUrls: unchanged?.imageUrls,
      saleQuantity: seededSale?.quantity,
    };
  }).toEqual({
    listingPrice: 500,
    remainingQuantity: 3,
    imageUrls: [oldUrl],
    saleQuantity: 2,
  });
  await expect.poll(() => listStorageObjects(`listings/${owner.uid}/${listingId}/`))
    .toEqual([oldPath]);

  await page.getByLabel('剩餘數量').fill('3');
  await page.getByLabel('替換商品圖片').setInputFiles(back);
  await page.getByRole('button', { name: '儲存變更' }).click();
  await expect(page.getByRole('status')).toHaveText('已更新商品');

  await expect.poll(async () => {
    const updated = await readDocument('listings', listingId);
    return {
      sellerId: updated?.sellerId,
      cardId: updated?.cardId,
      cardType: updated?.cardType,
      cardName: updated?.cardName,
      rarity: updated?.rarity,
      originalQuantity: updated?.originalQuantity,
      remainingQuantity: updated?.remainingQuantity,
      listingPrice: updated?.listingPrice,
      imageUrls: updated?.imageUrls,
    };
  }).toMatchObject({
    sellerId: owner.uid,
    cardId: '0501',
    cardType: 'character',
    cardName: '諸伏高明',
    rarity: 'D',
    originalQuantity: 5,
    remainingQuantity: 3,
    listingPrice: 450,
    imageUrls: [expect.not.stringMatching(oldUrl)],
  });
  await expectPersistedImagesMatchStorage(owner.uid, listingId, 1);
  await expect.poll(() => listStorageObjects(`listings/${owner.uid}/${listingId}/`))
    .not.toContain(oldPath);
});

test('enforces ownership and cancel-or-confirm deletion', async ({ page }) => {
  await page.goto('./');
  await acknowledgeWelcome(page);
  const ownerIdentity = {
    email: 'listing-delete-owner@example.test',
    displayName: 'Listing Delete Owner',
  };
  const owner = await signInWithMockGoogle(page, ownerIdentity);
  await page.getByRole('button', { name: '登出' }).click();
  const other = await signInWithMockGoogle(page, {
    email: 'listing-other-seller@example.test',
    displayName: 'Other Listing Seller',
  });
  const listingId = 'e2e-listing-delete';
  const frontPath = `listings/${owner.uid}/${listingId}/front.png`;
  const backPath = `listings/${owner.uid}/${listingId}/back.png`;
  const frontUrl = await seedListingImage(frontPath, front);
  const backUrl = await seedListingImage(backPath, back);
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile(owner.uid), sellerProfile(other.uid, '其他賣家')],
    listings: [activeListing(owner.uid, frontUrl, {
      id: listingId,
      imageUrls: [frontUrl, backUrl],
    })],
  });
  await page.goto(`#/listing/${listingId}/edit`);

  await expect(page.getByRole('heading', { name: '無法編輯商品' })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '儲存變更' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刪除商品' })).toHaveCount(0);
  await expect(page.getByLabel('價格')).toHaveCount(0);
  await expect(page.getByLabel('剩餘數量')).toHaveCount(0);
  await expect(page.getByLabel('替換商品圖片')).toHaveCount(0);
  await expect.poll(() => readDocument('listings', listingId)).toMatchObject({
    sellerId: owner.uid,
    listingPrice: 500,
    originalQuantity: 5,
    remainingQuantity: 5,
    imageUrls: [frontUrl, backUrl],
    status: 'active',
  });
  await expect.poll(() => listStorageObjects(`listings/${owner.uid}/${listingId}/`))
    .toEqual([backPath, frontPath]);
  await page.goto('./');
  await page.getByRole('button', { name: '登出' }).click();
  await signInWithMockGoogle(page, ownerIdentity);
  await page.goto(`#/listing/${listingId}/edit`);
  await expect(page.getByRole('heading', { name: '編輯商品' })).toBeVisible();

  const cancelDialogPromise = page.waitForEvent('dialog');
  const cancelClickPromise = page.getByRole('button', { name: '刪除商品' }).click();
  const cancelDialog = await cancelDialogPromise;
  expect(cancelDialog.type()).toBe('confirm');
  expect(cancelDialog.message()).toBe('確定要刪除這筆商品嗎？此操作無法復原。');
  await cancelDialog.dismiss();
  await cancelClickPromise;
  await expect.poll(() => readDocument('listings', listingId)).not.toBeNull();
  await expect.poll(() => listStorageObjects(`listings/${owner.uid}/${listingId}/`))
    .toEqual([backPath, frontPath]);

  const confirmDialogPromise = page.waitForEvent('dialog');
  const confirmClickPromise = page.getByRole('button', { name: '刪除商品' }).click();
  const confirmDialog = await confirmDialogPromise;
  expect(confirmDialog.type()).toBe('confirm');
  expect(confirmDialog.message()).toBe('確定要刪除這筆商品嗎？此操作無法復原。');
  await confirmDialog.accept();
  await confirmClickPromise;
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect.poll(() => readDocument('listings', listingId)).toBeNull();
  await expect.poll(() => listStorageObjects(`listings/${owner.uid}/${listingId}/`))
    .toEqual([]);
  await expect(page.getByRole('heading', { name: '賣家管理' })).toBeVisible();
});
