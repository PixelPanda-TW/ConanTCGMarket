import { seedScenario } from './support/emulator-state';
import { testCards } from './support/fixtures';
import { expect, test } from './support/test';

test('searches, selects, summarizes, and clears a Card Master result', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('#/cards');

  await page.getByLabel('搜尋卡牌').fill('諸伏');
  await page.getByRole('button', { name: /角色卡 · 諸伏高明 · ID 0501 · D/ }).click();
  const summary = page.getByRole('heading', { name: '已選擇卡牌' }).locator('..');
  await expect(summary).toContainText('0501');
  await expect(summary).toContainText('角色卡');
  await expect(summary).toContainText('諸伏高明');
  await expect(summary).toContainText('D');

  await page.getByRole('button', { name: '清除已選擇的卡牌' }).click();
  await expect(page.getByRole('heading', { name: '已選擇卡牌' })).toBeHidden();
  await page.getByLabel('搜尋卡牌').fill('不存在卡片');
  await expect(page.getByRole('status')).toHaveText('找不到符合的卡牌。');
});

test('shows an empty Card Master after a clean reset', async ({ page }) => {
  await page.goto('#/cards');

  await expect(page.getByRole('status')).toHaveText('目前沒有可顯示的卡牌資料。');
});

test('renders Card Master loading until Firestore responds', async ({ page }) => {
  await seedScenario({ cards: testCards });
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

  await page.goto('#/cards');
  await requestHeld;
  await expect(page.getByText('載入卡牌資料中')).toBeVisible();
  releaseRequest();
  await expect(page.getByLabel('搜尋卡牌')).toBeVisible();
});

test('renders the Card Master Firestore error state', async ({ page }) => {
  await page.route('http://127.0.0.1:8080/**', (route) => route.abort('failed'));

  await page.goto('#/cards');

  await expect(page.getByRole('alert')).toHaveText(
    'Failed to get documents from server. (However, these documents may exist in the local cache. Run again without setting source to "server" to retrieve the cached documents.)',
  );
  await expect(page.getByText('載入卡牌資料中')).toBeHidden();
});
