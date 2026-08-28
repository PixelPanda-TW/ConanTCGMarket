import { signInWithMockGoogle } from './support/auth';
import { readDocument, seedScenario } from './support/emulator-state';
import { activeListing, sellerProfile, testCards } from './support/fixtures';
import { expect, test } from './support/test';
import { acknowledgeWelcome } from './support/ui';

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
