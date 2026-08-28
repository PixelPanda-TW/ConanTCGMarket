import { expect, test } from '@playwright/test';

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

  for (const hash of ['#/cards', '#/profile', '#/sell', '#/dashboard', '#/notifications']) {
    await page.goto(hash);
    await expect(page.locator('main')).toBeVisible();
  }

  expect(errors.filter((message) => /Firebase|configuration-not-found/i.test(message))).toEqual([]);
});
