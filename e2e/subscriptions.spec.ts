import { signInWithMockGoogle } from './support/auth';
import { readDocument, seedScenario } from './support/emulator-state';
import { activeListing, sellerProfile, testCards } from './support/fixtures';
import { expect, test } from './support/test';
import { acknowledgeWelcome } from './support/ui';
import { runFakeDailyDigest } from '../functions/src/fakes';

const seededAt = new Date('2026-08-27T00:00:00.000Z');

const coverageCards = [
  { key: 'coverage-character', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
  { key: 'coverage-event', cardId: '1100', cardType: 'event', cardName: '諸伏高明', rarities: ['C'] },
  { key: 'coverage-case', cardId: '0019', cardType: 'case', cardName: '諸伏高明', rarities: ['CP'] },
  { key: 'coverage-partner', cardId: 'P001', cardType: 'partner', cardName: '諸伏高明', rarities: ['P'] },
] as const;

test('subscribes to an exact name with explicit email consent and manages it', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  await page.getByLabel('卡片類型').selectOption('character');
  await page.getByLabel('卡片名稱').fill('諸伏高明');
  await page.getByRole('button', { name: '訂閱諸伏高明' }).click();
  const guidance = page.getByText('登入後即可訂閱卡名通知').locator('..');
  await expect(guidance).toBeVisible();
  await expect(page.getByRole('button', { name: '使用 Google 登入' })).toHaveCount(2);
  const buyer = await signInWithMockGoogle(page, {
    email: 'subscription-buyer@example.test',
    displayName: 'Subscription Buyer',
  }, guidance.getByRole('button', { name: '使用 Google 登入' }));

  await page.getByRole('button', { name: '訂閱諸伏高明' }).click();
  await expect(page.getByRole('button', { name: '確認訂閱' })).toBeDisabled();
  await page.getByLabel('以 Google 登入信箱接收每日摘要').check();
  await page.getByRole('button', { name: '確認訂閱' }).click();
  await expect(page.getByText('已訂閱「諸伏高明」的每日摘要通知。')).toBeVisible();
  await expect.poll(() => readDocument('notificationSubscriptions', buyer.uid)).toMatchObject({
    cardNames: ['諸伏高明'],
    emailDailyEnabled: true,
  });

  await page.goto('#/notifications');
  await expect(page.getByText('諸伏高明')).toBeVisible();
  await page.getByLabel('每日彙整 Email 通知').click();
  await expect.poll(() => readDocument('notificationSubscriptions', buyer.uid))
    .toMatchObject({ emailDailyEnabled: false });
  await page.reload();
  await expect(page.getByLabel('每日彙整 Email 通知')).not.toBeChecked();
  await page.getByRole('button', { name: '移除諸伏高明訂閱' }).click();
  await expect(page.getByText('尚未訂閱任何卡名。')).toBeVisible();
  await expect.poll(() => readDocument('notificationSubscriptions', buyer.uid))
    .toMatchObject({ cardNames: [], emailDailyEnabled: false });
});

test('cancels notification-method selection', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  const buyer = await signInWithMockGoogle(page, {
    email: 'subscription-cancel@example.test',
    displayName: 'Subscription Cancel Buyer',
  });
  await page.getByLabel('卡片類型').selectOption('character');
  await page.getByLabel('卡片名稱').fill('諸伏高明');

  await page.getByRole('button', { name: '訂閱諸伏高明' }).click();
  await expect(page.getByRole('heading', { name: '選擇通知方式' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();

  await expect(page.getByRole('heading', { name: '選擇通知方式' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '訂閱諸伏高明' })).toBeVisible();
  await expect.poll(() => readDocument('notificationSubscriptions', buyer.uid)).toBeNull();
});

test('subscribes from Listing details', async ({ page }) => {
  const listingId = 'subscription-listing';
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile('subscription-seller')],
    listings: [activeListing('subscription-seller', 'data:image/png;base64,iVBORw0KGgo=', {
      id: listingId,
    })],
  });
  await page.goto('./');
  await acknowledgeWelcome(page);
  const buyer = await signInWithMockGoogle(page, {
    email: 'subscription-listing@example.test',
    displayName: 'Subscription Listing Buyer',
  });
  await page.goto(`#/listing/${listingId}`);
  await expect(page.getByRole('heading', { name: '商品詳情', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: '訂閱諸伏高明' }).click();
  await page.getByLabel('以 Google 登入信箱接收每日摘要').check();
  await page.getByRole('button', { name: '確認訂閱' }).click();

  await expect(page.getByText('已訂閱「諸伏高明」的每日摘要通知。')).toBeVisible();
  await expect.poll(() => readDocument('notificationSubscriptions', buyer.uid)).toMatchObject({
    cardNames: ['諸伏高明'],
    emailDailyEnabled: true,
  });
});

test('follows a Listing seller, survives reload, and removes only that seller in settings', async ({ page }) => {
  const listingId = 'seller-follow-listing';
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile('followed-seller', '追蹤賣家')],
    listings: [activeListing('followed-seller', 'data:image/png;base64,iVBORw0KGgo=', { id: listingId })],
  });
  await page.goto('./');
  await acknowledgeWelcome(page);
  const buyer = await signInWithMockGoogle(page, {
    email: 'seller-follow-buyer@example.test', displayName: 'Seller Follow Buyer',
  });
  await seedScenario({ notificationSubscriptions: [{
    uid: buyer.uid,
    cardNames: ['諸伏景光'],
    sellerSubscriptions: [],
    emailDailyEnabled: true,
    updatedAt: seededAt,
  }] });

  await page.goto(`#/listing/${listingId}`);
  await page.getByRole('button', { name: '訂閱賣家 追蹤賣家' }).click();
  await page.getByLabel('以 Google 登入信箱接收每日摘要').check();
  await page.getByRole('button', { name: '確認訂閱' }).click();
  await expect(page.getByRole('button', { name: '取消訂閱賣家 追蹤賣家' })).toBeVisible();

  await expect.poll(() => readDocument('notificationSubscriptions', buyer.uid)).toMatchObject({
    cardNames: ['諸伏景光'], emailDailyEnabled: true,
    sellerSubscriptions: [{ sellerId: 'followed-seller' }],
  });
  const persisted = await readDocument('notificationSubscriptions', buyer.uid);
  const followedAt = (persisted?.sellerSubscriptions as Array<Record<string, unknown>>)[0]
    ?.followedAt as { toDate?: unknown } | undefined;
  expect(typeof followedAt?.toDate).toBe('function');

  await page.reload();
  await expect(page.getByRole('button', { name: '取消訂閱賣家 追蹤賣家' })).toBeVisible();
  await page.goto('#/notifications');
  await page.getByRole('button', { name: '移除賣家 追蹤賣家（followed-seller）訂閱' }).click();
  await expect(page.getByText('尚未訂閱任何賣家。')).toBeVisible();
  await expect.poll(() => readDocument('notificationSubscriptions', buyer.uid)).toMatchObject({
    cardNames: ['諸伏景光'], sellerSubscriptions: [], emailDailyEnabled: true,
  });
});

test('never offers seller mutation to the owner, a sold-out view, or a suspended buyer', async ({ page }) => {
  await page.goto('./');
  await acknowledgeWelcome(page);
  const identity = await signInWithMockGoogle(page, {
    email: 'seller-follow-gates@example.test', displayName: 'Seller Follow Gates',
  });
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile(identity.uid, 'Owner'), sellerProfile('other-seller', 'Other Seller')],
    listings: [
      activeListing(identity.uid, 'data:image/png;base64,iVBORw0KGgo=', { id: 'owner-active' }),
      activeListing(identity.uid, 'data:image/png;base64,iVBORw0KGgo=', {
        id: 'owner-sold', status: 'sold_out', remainingQuantity: 0,
      }),
      activeListing('other-seller', 'data:image/png;base64,iVBORw0KGgo=', { id: 'suspended-view' }),
    ],
  });

  await page.goto('#/listing/owner-active');
  await expect(page.getByRole('button', { name: /訂閱賣家/u })).toHaveCount(0);
  await page.goto('#/listing/owner-sold');
  await expect(page.getByText('已售罄', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /訂閱賣家/u })).toHaveCount(0);

  await seedScenario({ accountAccess: [{
    uid: identity.uid, status: 'suspended', confirmedViolationCount: 1,
    suspensionReason: 'E2E suspension', suspendedAt: seededAt,
    suspendedBy: 'admin-1', updatedAt: seededAt,
  }] });
  await page.goto('#/listing/suspended-view');
  await expect(page.getByText('帳號停權期間無法管理賣家通知。')).toBeVisible();
  await expect(page.getByRole('button', { name: /訂閱賣家/u })).toHaveCount(0);
  await expect.poll(() => readDocument('notificationSubscriptions', identity.uid)).toBeNull();
});

test('local fake digest excludes pre-follow, includes post-follow, and deduplicates dual matches', async () => {
  const followedAt = new Date('2026-08-27T01:00:00.000Z');
  const result = await runFakeDailyDigest({
    subscription: {
      uid: 'buyer-1', cardNames: ['諸伏高明'],
      sellerSubscriptions: [{ sellerId: 'seller-1', followedAt }],
      emailDailyEnabled: true, updatedAt: new Date(),
    },
    events: [
      {
        id: 'pre-follow', sellerId: 'seller-1', cardName: '灰原哀',
        capturedAt: new Date(followedAt.getTime() - 1),
      },
      {
        id: 'post-follow', sellerId: 'seller-1', cardName: '灰原哀',
        capturedAt: new Date(followedAt.getTime() + 1),
      },
      { id: 'dual-match', sellerId: 'seller-1', cardName: '諸伏高明', capturedAt: followedAt },
    ],
  });

  expect(result.listingIds).toEqual(['dual-match', 'post-follow']);
  expect(new Set(result.listingIds).size).toBe(2);
  expect(JSON.stringify(result)).not.toContain('private-contact');
  expect(JSON.stringify(result)).not.toMatch(/contactValue|seller@example/u);
});

test('shows raw-substring coverage', async ({ page }) => {
  await seedScenario({ cards: coverageCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  const buyer = await signInWithMockGoogle(page, {
    email: 'subscription-coverage@example.test',
    displayName: 'Subscription Coverage Buyer',
  });
  await seedScenario({
    notificationSubscriptions: [{
      uid: buyer.uid,
      cardNames: ['諸伏'],
      emailDailyEnabled: true,
      updatedAt: seededAt,
    }],
  });

  for (const card of coverageCards) {
    await page.getByLabel('卡片類型').selectOption(card.cardType);
    await page.getByLabel('卡片名稱').fill(card.cardName);
    await page.getByLabel('稀有度').selectOption(card.rarities[0]);
    await page.getByLabel('搜尋卡片 ID').fill(card.cardId);
    await expect(page.getByText('已由「諸伏」訂閱涵蓋')).toBeVisible();
    await expect(page.getByRole('link', { name: '管理我的訂閱' }))
      .toHaveAttribute('href', '#/notifications');
  }

  await page.getByRole('link', { name: '管理我的訂閱' }).click();
  await expect(page).toHaveURL(/#\/notifications$/);
  await expect(page.getByRole('heading', { name: '我的訂閱' })).toBeVisible();
  await expect(page.getByText('諸伏', { exact: true })).toBeVisible();
  await expect.poll(() => readDocument('notificationSubscriptions', buyer.uid)).toMatchObject({
    cardNames: ['諸伏'],
    emailDailyEnabled: true,
  });
});

test('removes only the selected exact name', async ({ page }) => {
  await page.goto('./');
  await acknowledgeWelcome(page);
  const buyer = await signInWithMockGoogle(page, {
    email: 'subscription-remove@example.test',
    displayName: 'Subscription Remove Buyer',
  });
  await seedScenario({
    notificationSubscriptions: [{
      uid: buyer.uid,
      cardNames: ['諸伏高明', '諸伏景光'],
      emailDailyEnabled: true,
      updatedAt: seededAt,
    }],
  });
  await page.goto('#/notifications');

  await page.getByRole('button', { name: '移除諸伏高明訂閱' }).click();
  await expect.poll(() => readDocument('notificationSubscriptions', buyer.uid)).toMatchObject({
    cardNames: ['諸伏景光'],
    emailDailyEnabled: true,
  });
  await page.reload();
  await expect(page.getByText('諸伏景光', { exact: true })).toBeVisible();
  await expect(page.getByText('諸伏高明', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('每日彙整 Email 通知')).toBeChecked();
});

test('toggles an exact active subscription off', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  const buyer = await signInWithMockGoogle(page, {
    email: 'subscription-toggle@example.test',
    displayName: 'Subscription Toggle Buyer',
  });
  await seedScenario({
    notificationSubscriptions: [{
      uid: buyer.uid,
      cardNames: ['諸伏高明', '諸伏景光'],
      emailDailyEnabled: true,
      updatedAt: seededAt,
    }],
  });
  await page.getByLabel('卡片類型').selectOption('character');
  await page.getByLabel('卡片名稱').fill('諸伏高明');

  await page.getByRole('button', { name: '取消訂閱諸伏高明' }).click();
  await expect(page.getByText('已取消訂閱「諸伏高明」。')).toBeVisible();
  await expect.poll(() => readDocument('notificationSubscriptions', buyer.uid)).toMatchObject({
    cardNames: ['諸伏景光'],
    emailDailyEnabled: true,
  });

  await page.reload();
  await page.getByLabel('卡片類型').selectOption('character');
  await page.getByLabel('卡片名稱').fill('諸伏高明');
  await expect(page.getByRole('button', { name: '訂閱諸伏高明' })).toBeVisible();
  await page.goto('#/notifications');
  await expect(page.getByText('諸伏景光', { exact: true })).toBeVisible();
  await expect(page.getByLabel('每日彙整 Email 通知')).toBeChecked();
});
