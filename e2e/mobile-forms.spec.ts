import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';

import { signInWithMockGoogle } from './support/auth';
import {
  listDocuments,
  listStorageObjects,
  readDocument,
  seedListingImage,
  seedScenario,
} from './support/emulator-state';
import { activeListing, sellerProfile, testCards } from './support/fixtures';
import { expect, test } from './support/test';
import { acknowledgeWelcome } from './support/ui';

const front = fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url));
const back = fileURLToPath(new URL('./fixtures/card-back.png', import.meta.url));
const seededAt = new Date('2026-08-27T00:00:00.000Z');

async function expectMobileTouch(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  expect(page.viewportSize()?.width).toBeLessThanOrEqual(390);
}

async function expectEditable(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await expect(control).toBeEditable();
  await control.tap();
  await expect(control).toBeFocused();
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect.poll(() => page.locator('body').evaluate(
    (body) => body.scrollWidth <= body.clientWidth,
  )).toBe(true);
}

async function expectListingImagesMatchStorage(
  sellerId: string,
  listingId: string,
  expectedCount: number,
): Promise<void> {
  await expect.poll(async () => {
    const listing = await readDocument('listings', listingId);
    const imageUrls = Array.isArray(listing?.imageUrls) ? listing.imageUrls as string[] : [];
    const objects = await listStorageObjects(`listings/${sellerId}/${listingId}/`);
    const objectPathsFromUrls = imageUrls.map((imageUrl) => {
      const encodedObjectPath = new URL(imageUrl).pathname.split('/o/').at(-1) ?? '';
      return decodeURIComponent(encodedObjectPath);
    });
    return {
      imageUrlCount: imageUrls.length,
      objectCount: objects.length,
      pathsMatch: objectPathsFromUrls.toSorted().join('\n') === objects.toSorted().join('\n'),
    };
  }).toEqual({
    imageUrlCount: expectedCount,
    objectCount: expectedCount,
    pathsMatch: true,
  });
}

async function signInMobile(
  page: Page,
  account: string,
): Promise<{ uid: string; email: string; displayName: string }> {
  await page.goto('./');
  await expectMobileTouch(page);
  await acknowledgeWelcome(page);
  return signInWithMockGoogle(page, {
    email: `mobile-${account}@example.test`,
    displayName: `Mobile ${account}`,
  });
}

test('mobile welcome, filters, result navigation, and footer remain interactive', async ({ page }) => {
  const image = await seedListingImage(
    'listings/mobile-seller/e2e-listing-active/front.png',
    front,
  );
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile('mobile-seller', 'Mobile Seller')],
    listings: [
      activeListing('mobile-seller', image),
      activeListing('mobile-seller', image, {
        id: 'mobile-listing-no-sleeve',
        cardId: '1096',
        cardName: '諸伏景光',
        characterName: '諸伏景光',
        rarity: 'R',
        hasSleeve: false,
        sleeveFee: undefined,
      }),
      activeListing('mobile-seller', image, {
        id: 'mobile-listing-no-myship',
        cardId: '1100',
        cardType: 'event',
        cardName: '追跡開始',
        characterName: undefined,
        rarity: 'C',
        supportsMyShip: false,
        myShipFee: undefined,
      }),
    ],
  });
  await page.goto('./');
  await expectMobileTouch(page);

  const welcome = page.getByRole('dialog', { name: '網站使用與安全提醒' });
  await expect(welcome).toBeVisible();
  const acknowledge = welcome.getByRole('button', { name: '我知道了' });
  await expect(acknowledge).toBeFocused();
  await acknowledge.tap();

  const footerLink = page.locator('footer').getByRole('link', { name: 'rugiacreation.com' });
  await expect(footerLink).toHaveAttribute('href', 'https://rugiacreation.com/conan/search');

  const sleeveFilter = page.getByLabel('包手');
  const myShipFilter = page.getByLabel('賣貨便');
  await sleeveFilter.check();
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /追跡開始/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /諸伏景光/ })).toHaveCount(0);
  await myShipFilter.check();
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /追跡開始/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /諸伏景光/ })).toHaveCount(0);

  const cardType = page.getByLabel('卡片類型');
  await expect(cardType).toBeEnabled();
  await cardType.selectOption('character');
  const cardName = page.getByLabel('卡片名稱');
  await expectEditable(cardName);
  await cardName.fill('諸伏');
  await expect(cardName).toHaveValue('諸伏');
  await cardName.fill('諸伏高明');
  const rarity = page.getByLabel('稀有度');
  await expect(rarity).toBeEnabled();
  await rarity.selectOption('D');
  const cardId = page.getByLabel('搜尋卡片 ID');
  await expectEditable(cardId);
  await cardId.fill('0501');
  await expect(cardId).toHaveValue('0501');

  await expectNoHorizontalScroll(page);
  await page.getByRole('link', { name: /諸伏高明/ }).tap();
  await expect(page.getByRole('heading', { name: '商品詳情' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('link', { name: '← 返回市集' }).tap();
  await expect(page.getByRole('heading', { name: '搜尋正在販售的柯南 TCG 卡牌' })).toBeVisible();

});

test('mobile Profile form', async ({ page }) => {
  const identity = await signInMobile(page, 'profile');
  await page.goto('#/profile');

  const displayName = page.getByLabel('顯示名稱');
  const contactType = page.getByLabel('聯絡方式');
  await expectEditable(displayName);
  await expect(contactType).toBeEnabled();
  await expectEditable(page.getByLabel('LINE ID'));
  await expect(contactType.locator('option')).toHaveText([
    'LINE',
    'Discord',
    'Threads',
    'Facebook',
  ]);
  const contactFields = [
    ['line', 'LINE ID', '請填寫 LINE ID，不要貼網址。'],
    ['discord', 'Discord ID', '只會顯示 ID 文字，不會建立連結。'],
    ['threads', 'Threads 個人頁面連結', '必須是 threads.net/@帳號 的個人頁面 HTTPS 連結。'],
    ['facebook', 'Facebook 個人頁面連結', '必須是 facebook.com 的個人頁面 HTTPS 連結。'],
  ] as const;
  for (const [option, label, helper] of contactFields) {
    await contactType.selectOption(option);
    await expect(contactType).toHaveValue(option);
    await expectEditable(page.getByLabel(label));
    await expect(page.getByText(helper)).toBeVisible();
  }

  await displayName.fill('   ');
  await page.getByLabel('Facebook 個人頁面連結').fill('   ');
  await page.getByRole('button', { name: '儲存個人檔案' }).tap();
  await expect(page.getByRole('alert').filter({ hasText: '請填寫顯示名稱。' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '請填寫聯絡方式。' })).toBeVisible();
  await expect.poll(() => readDocument('sellerProfiles', identity.uid)).toBeNull();

  await displayName.fill('行動版賣家');
  await contactType.selectOption('discord');
  await page.getByLabel('Discord ID').fill('mobile-profile');
  await page.getByRole('button', { name: '儲存個人檔案' }).tap();
  await expect.poll(() => readDocument('sellerProfiles', identity.uid)).toMatchObject({
    displayName: '行動版賣家',
    contactType: 'discord',
    contactValue: 'mobile-profile',
  });

  await displayName.fill('行動版更新賣家');
  await contactType.selectOption('threads');
  await page.getByLabel('Threads 個人頁面連結').fill('https://threads.net/@mobile-updated/');
  await page.getByRole('button', { name: '儲存個人檔案' }).tap();
  await expect.poll(() => readDocument('sellerProfiles', identity.uid)).toMatchObject({
    displayName: '行動版更新賣家',
    contactType: 'threads',
    contactValue: 'https://www.threads.net/@mobile-updated',
  });

  await page.reload();
  await expect(displayName).toHaveValue('行動版更新賣家');
  await expect(contactType).toHaveValue('threads');
  await expect(page.getByLabel('Threads 個人頁面連結'))
    .toHaveValue('https://www.threads.net/@mobile-updated');
  await expectNoHorizontalScroll(page);
});

test('mobile sell form', async ({ page }) => {
  const identity = await signInMobile(page, 'sell');
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile(identity.uid, 'Mobile Sell Seller')],
  });
  await page.goto('#/sell');

  await page.getByRole('button', { name: '建立刊登' }).tap();
  await expect(page.getByRole('alert').filter({ hasText: '請填寫卡片名稱。' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '請選擇 1 到 3 張商品圖片。' }))
    .toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '價格必須大於 0。' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '數量必須是大於 0 的整數。' }))
    .toBeVisible();
  await expect.poll(() => listDocuments('listings')).toEqual([]);

  const cardType = page.getByLabel('卡片類型');
  await expect(cardType).toBeEnabled();
  await cardType.selectOption('event');
  await expect(cardType).toHaveValue('event');
  await cardType.selectOption('character');
  const cardName = page.getByLabel('卡片名稱');
  await expectEditable(cardName);
  await cardName.fill('諸伏');
  await expect(cardName).toHaveValue('諸伏');
  await cardName.fill('諸伏高明');
  const rarity = page.getByLabel('稀有度');
  await expect(rarity).toBeEnabled();
  await rarity.selectOption('D');
  const cardId = page.getByLabel('卡片 ID');
  await expectEditable(cardId);
  await cardId.fill('0501');
  await expect(cardId).toHaveValue('0501');

  const images = page.getByLabel('商品圖片');
  await expect(images).toBeEnabled();
  await images.setInputFiles([front, back, front]);
  await expect.poll(() => images.evaluate(
    (input: HTMLInputElement) => input.files?.length ?? 0,
  )).toBe(3);
  const price = page.getByLabel('價格');
  const quantity = page.getByLabel('數量');
  await expectEditable(price);
  await price.fill('525');
  await expectEditable(quantity);
  await quantity.fill('4');
  const sleeve = page.getByLabel('包手');
  await sleeve.tap();
  await expect(sleeve).toBeChecked();
  const sleeveFee = page.getByLabel('包材費');
  await expectEditable(sleeveFee);
  await sleeveFee.fill('25');
  const myShip = page.getByLabel('支援賣貨便');
  await myShip.tap();
  await expect(myShip).toBeChecked();
  const myShipFee = page.getByLabel('賣貨便加價');
  await expectEditable(myShipFee);
  await myShipFee.fill('15');
  const note = page.getByLabel('備註');
  await expectEditable(note);
  await note.fill('iPhone 完整刊登備註');

  await page.getByRole('button', { name: '建立刊登' }).tap();
  await expect(page).toHaveURL(/#\/listing\/[^/]+$/);
  const listingId = new URL(page.url()).hash.split('/').at(-1)!;
  await expect.poll(() => readDocument('listings', listingId)).toMatchObject({
    sellerId: identity.uid,
    cardType: 'character',
    cardName: '諸伏高明',
    rarity: 'D',
    cardId: '0501',
    listingPrice: 525,
    originalQuantity: 4,
    remainingQuantity: 4,
    hasSleeve: true,
    sleeveFee: 25,
    supportsMyShip: true,
    myShipFee: 15,
    note: 'iPhone 完整刊登備註',
    imageUrls: expect.any(Array),
  });
  await expectListingImagesMatchStorage(identity.uid, listingId, 3);
  await expectNoHorizontalScroll(page);
});

test('mobile Listing edit form', async ({ page }) => {
  const identity = await signInMobile(page, 'listing-edit');
  const listingId = 'mobile-listing-edit';
  const oldPath = `listings/${identity.uid}/${listingId}/old-front.png`;
  const oldUrl = await seedListingImage(oldPath, front);
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile(identity.uid, 'Mobile Edit Seller')],
    listings: [activeListing(identity.uid, oldUrl, { id: listingId })],
  });
  await page.goto(`#/listing/${listingId}/edit`);

  const existingImages = page.locator('[aria-label="目前商品圖片"]');
  await expect(existingImages.getByRole('img', { name: '目前商品圖片' })).toHaveCount(1);
  const replacement = page.getByLabel('替換商品圖片');
  await expect(replacement).toBeEnabled();
  await replacement.setInputFiles(back);
  await expect(page.getByText('已選擇 1 張新圖片。')).toBeVisible();
  const price = page.getByLabel('價格');
  const remaining = page.getByLabel('剩餘數量');
  await expectEditable(price);
  await price.fill('475');
  await expectEditable(remaining);
  await remaining.fill('4');

  const sleeve = page.getByLabel('包手');
  await sleeve.tap();
  await expect(sleeve).not.toBeChecked();
  await expect(page.getByLabel('包材費')).toHaveCount(0);
  const myShip = page.getByLabel('支援賣貨便');
  await myShip.tap();
  await expect(myShip).not.toBeChecked();
  await expect(page.getByLabel('賣貨便加價')).toHaveCount(0);
  const note = page.getByLabel('備註');
  await expectEditable(note);
  await note.fill('iPhone 編輯後備註');

  await page.getByRole('button', { name: '儲存變更' }).tap();
  await expect(page.getByRole('status')).toHaveText('已更新商品');
  await expect.poll(async () => {
    const updated = await readDocument('listings', listingId);
    return {
      listingPrice: updated?.listingPrice,
      originalQuantity: updated?.originalQuantity,
      remainingQuantity: updated?.remainingQuantity,
      hasSleeve: updated?.hasSleeve,
      supportsMyShip: updated?.supportsMyShip,
      note: updated?.note,
      imageUrls: updated?.imageUrls,
      hasSleeveFee: Object.hasOwn(updated ?? {}, 'sleeveFee'),
      hasMyShipFee: Object.hasOwn(updated ?? {}, 'myShipFee'),
    };
  }).toMatchObject({
    listingPrice: 475,
    originalQuantity: 5,
    remainingQuantity: 4,
    hasSleeve: false,
    supportsMyShip: false,
    note: 'iPhone 編輯後備註',
    imageUrls: [expect.not.stringMatching(oldUrl)],
    hasSleeveFee: false,
    hasMyShipFee: false,
  });
  await expectListingImagesMatchStorage(identity.uid, listingId, 1);
  await expect.poll(() => listStorageObjects(`listings/${identity.uid}/${listingId}/`))
    .not.toContain(oldPath);

  const beforeCancel = await readDocument('listings', listingId);
  const replacementUrl = (beforeCancel?.imageUrls as string[])[0];
  const dialogPromise = page.waitForEvent('dialog');
  const deletePromise = page.getByRole('button', { name: '刪除商品' }).tap();
  const dialog = await dialogPromise;
  expect(dialog.message()).toBe('確定要刪除這筆商品嗎？此操作無法復原。');
  await dialog.dismiss();
  await deletePromise;
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#\/listing\/${listingId}\/edit$`));
  await expect(page.getByRole('heading', { name: '編輯商品' })).toBeVisible();
  await expect(page.getByRole('button', { name: '刪除商品' })).toBeVisible();
  await expect(page.locator('[aria-label="目前商品圖片"]')
    .getByRole('img', { name: '目前商品圖片' })).toHaveAttribute('src', replacementUrl);
  await expect.poll(() => readDocument('listings', listingId)).toEqual(beforeCancel);
  await expectListingImagesMatchStorage(identity.uid, listingId, 1);
  await expect.poll(() => listStorageObjects(`listings/${identity.uid}/${listingId}/`))
    .not.toContain(oldPath);
  await expectNoHorizontalScroll(page);
});

test('mobile sale dialog', async ({ page }) => {
  const identity = await signInMobile(page, 'sale');
  const listingId = 'mobile-sale-listing';
  const image = await seedListingImage(
    `listings/${identity.uid}/${listingId}/front.png`,
    front,
  );
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile(identity.uid, 'Mobile Sale Seller')],
    listings: [activeListing(identity.uid, image, { id: listingId })],
  });
  await page.goto('#/dashboard');
  const beforeInvalidSales = await readDocument('listings', listingId);

  await page.getByRole('button', { name: '登記成交' }).tap();
  let dialog = page.getByRole('dialog', { name: '登記成交' });
  const quantity = dialog.getByLabel('數量');
  const price = dialog.getByLabel('實際單價');
  await expect(quantity).toHaveValue('1');
  await expect(price).toHaveValue('500');
  await expectEditable(quantity);
  await expectEditable(price);
  await expectNoHorizontalScroll(page);
  await dialog.getByRole('button', { name: '取消' }).tap();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => listDocuments('sales')).toEqual([]);
  await expect.poll(() => readDocument('listings', listingId))
    .toMatchObject({ remainingQuantity: 5, status: 'active' });

  await page.getByRole('button', { name: '登記成交' }).tap();
  dialog = page.getByRole('dialog', { name: '登記成交' });
  await dialog.getByLabel('數量').fill('0');
  await dialog.getByRole('button', { name: '確認成交' }).tap();
  await expect(page.getByRole('alert')).toHaveText('成交數量或價格不正確。');
  await page.reload();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => ({
    listing: await readDocument('listings', listingId),
    sales: await listDocuments('sales'),
  })).toEqual({ listing: beforeInvalidSales, sales: [] });

  await page.getByRole('button', { name: '登記成交' }).tap();
  dialog = page.getByRole('dialog', { name: '登記成交' });
  await dialog.getByLabel('數量').fill('6');
  await dialog.getByRole('button', { name: '確認成交' }).tap();
  await expect(page.getByRole('alert')).toHaveText('成交數量或價格不正確。');
  await page.reload();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => ({
    listing: await readDocument('listings', listingId),
    sales: await listDocuments('sales'),
  })).toEqual({ listing: beforeInvalidSales, sales: [] });

  await page.getByRole('button', { name: '登記成交' }).tap();
  dialog = page.getByRole('dialog', { name: '登記成交' });
  await dialog.getByLabel('數量').fill('2');
  await dialog.getByLabel('實際單價').fill('450');
  await dialog.getByRole('button', { name: '確認成交' }).tap();
  await expect.poll(async () => {
    const listing = await readDocument('listings', listingId);
    const sales = await listDocuments('sales');
    return {
      remainingQuantity: listing?.remainingQuantity,
      status: listing?.status,
      saleCount: sales.length,
      sale: sales[0]?.data,
    };
  }).toMatchObject({
    remainingQuantity: 3,
    status: 'active',
    saleCount: 1,
    sale: {
      listingId,
      sellerId: identity.uid,
      cardId: '0501',
      quantity: 2,
      listingUnitPrice: 500,
      soldUnitPrice: 450,
      soldAt: expect.anything(),
    },
  });
});

test('mobile subscription confirmation', async ({ page }) => {
  await seedScenario({ cards: testCards });
  const identity = await signInMobile(page, 'subscription');
  const cardType = page.getByLabel('卡片類型');
  await cardType.selectOption('character');
  const cardName = page.getByLabel('卡片名稱');
  await expectEditable(cardName);
  await cardName.fill('諸伏');
  await expect(cardName).toHaveValue('諸伏');
  await cardName.fill('諸伏高明');

  await page.getByRole('button', { name: '訂閱諸伏高明' }).tap();
  let confirmation = page.getByRole('heading', { name: '選擇通知方式' }).locator('..');
  await expect(confirmation.getByRole('button', { name: '確認訂閱' })).toBeDisabled();
  const emailDelivery = confirmation.getByLabel('以 Google 登入信箱接收每日摘要');
  await expect(emailDelivery).toBeEnabled();
  await emailDelivery.tap();
  await expect(emailDelivery).toBeChecked();
  await confirmation.getByRole('button', { name: '取消', exact: true }).tap();
  await expect.poll(() => readDocument('notificationSubscriptions', identity.uid)).toBeNull();

  await page.reload();
  await cardType.selectOption('character');
  await cardName.fill('諸伏高明');
  await expect(page.getByRole('button', { name: '訂閱諸伏高明' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '選擇通知方式' })).toHaveCount(0);
  await expect.poll(() => readDocument('notificationSubscriptions', identity.uid)).toBeNull();

  await page.getByRole('button', { name: '訂閱諸伏高明' }).tap();
  confirmation = page.getByRole('heading', { name: '選擇通知方式' }).locator('..');
  await expect(confirmation.getByRole('button', { name: '確認訂閱' })).toBeDisabled();
  await confirmation.getByLabel('以 Google 登入信箱接收每日摘要').tap();
  await confirmation.getByRole('button', { name: '確認訂閱' }).tap();
  await expect.poll(() => readDocument('notificationSubscriptions', identity.uid)).toMatchObject({
    cardNames: ['諸伏高明'],
    emailDailyEnabled: true,
  });
  await expect.poll(() => listDocuments('notificationSubscriptions')).toHaveLength(1);
  await expectNoHorizontalScroll(page);
});

test('mobile notification settings', async ({ page }) => {
  const identity = await signInMobile(page, 'notifications');
  await seedScenario({
    notificationSubscriptions: [{
      uid: identity.uid,
      cardNames: ['諸伏高明', '諸伏景光'],
      emailDailyEnabled: true,
      updatedAt: seededAt,
    }],
  });
  await page.goto('#/notifications');

  await expect(page.getByText('諸伏高明', { exact: true })).toBeVisible();
  await expect(page.getByText('諸伏景光', { exact: true })).toBeVisible();
  const dailyEmail = page.getByLabel('每日彙整 Email 通知');
  await expect(dailyEmail).toBeEnabled();
  await expect(dailyEmail).toBeChecked();
  await dailyEmail.focus();
  await expect(dailyEmail).toBeFocused();
  await dailyEmail.tap();
  await expect.poll(() => readDocument('notificationSubscriptions', identity.uid)).toMatchObject({
    cardNames: ['諸伏高明', '諸伏景光'],
    emailDailyEnabled: false,
  });

  await page.getByRole('button', { name: '移除諸伏高明訂閱' }).tap();
  await expect.poll(() => readDocument('notificationSubscriptions', identity.uid)).toMatchObject({
    cardNames: ['諸伏景光'],
    emailDailyEnabled: false,
  });
  await page.reload();
  await expect(page.getByText('諸伏景光', { exact: true })).toBeVisible();
  await expect(page.getByText('諸伏高明', { exact: true })).toHaveCount(0);
  await expect(dailyEmail).not.toBeChecked();
  await expectNoHorizontalScroll(page);
});
