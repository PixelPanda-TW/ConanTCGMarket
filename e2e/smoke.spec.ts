import { expect, test, type Page } from '@playwright/test';

const configurationErrorPattern = /Firebase|configuration-not-found|configuration\s+(?:error|missing|not found)|config\s+error/i;

async function expectNoConfigurationErrors(page: Page, errors: readonly string[]) {
  await expect(page.locator('body')).not.toContainText(configurationErrorPattern);
  const renderedStates = await page.locator('[role="status"], [role="alert"]').allTextContents();
  expect(renderedStates.join('\n')).not.toMatch(configurationErrorPattern);
  expect(errors.filter((message) => configurationErrorPattern.test(message))).toEqual([]);
}

test('deployed public entry, assets, and hash routes load without configuration errors', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const response = await page.goto('./');
  expect(response?.ok()).toBe(true);
  expect(response?.headers()['content-type']).toContain('text/html');
  await expect(page.getByRole('heading', { name: '搜尋正在販售的柯南 TCG 卡牌' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '網站使用與安全提醒' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'rugiacreation.com' }).first())
    .toHaveAttribute('href', 'https://rugiacreation.com/conan/search');

  await expect(page.getByText('商品載入中', { exact: true })).toBeHidden();
  await expect(page.getByRole('alert').filter({ hasText: '無法載入商品，請稍後再試。' })).toHaveCount(0);
  await expect(
    page.locator('a.listing-card').first()
      .or(page.getByText('目前沒有符合條件的商品。', { exact: true })),
  ).toBeVisible();
  await expectNoConfigurationErrors(page, errors);

  const assetUrls = await page.locator('script[src], link[rel="stylesheet"][href]').evaluateAll((elements) => (
    elements.map((element) => new URL(
      element.getAttribute('src') ?? element.getAttribute('href') ?? '',
      document.baseURI,
    ).href)
  ));
  expect(assetUrls.length).toBeGreaterThan(0);
  for (const assetUrl of new Set(assetUrls)) {
    const assetResponse = await request.get(assetUrl);
    expect(assetResponse.ok(), `public asset failed to load: ${assetUrl}`).toBe(true);
  }

  await page.goto('#/cards');
  await expect(page.getByRole('heading', { name: '卡牌資料庫', level: 1 })).toBeVisible();
  await expect(page.getByText('載入卡牌資料中', { exact: true })).toBeHidden();
  await expect(page.locator('.card-master-state[role="alert"]')).toHaveCount(0);
  await expect(
    page.getByLabel('搜尋卡牌')
      .or(page.getByRole('status').filter({ hasText: '目前沒有可顯示的卡牌資料。' })),
  ).toBeVisible();
  await expectNoConfigurationErrors(page, errors);

  const privateRoutes = [
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

  for (const route of privateRoutes) {
    await page.goto(route.hash);
    await expect(page.getByRole('heading', { name: route.heading, level: 1 })).toBeVisible();
    await expect(page.getByText(route.guidance, { exact: true })).toBeVisible();
    await expectNoConfigurationErrors(page, errors);
  }
});
