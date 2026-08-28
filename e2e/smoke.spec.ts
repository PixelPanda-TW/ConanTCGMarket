import { expect, test, type Page, type Request } from '@playwright/test';

const configurationErrorPattern = /Firebase|configuration-not-found|configuration\s+(?:error|missing|not found)|config\s+error/i;
const readMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const firestoreReadTransport = /(?:Firestore\/(?:Listen|RunQuery|BatchGetDocuments)\/channel|Firestore\/(?:Listen|RunQuery|BatchGetDocuments)|documents:(?:runQuery|batchGet))/i;
const authReadTransport = /accounts:lookup/i;

function readOnlyViolation(request: Request): string | null {
  const url = new URL(request.url());
  const method = request.method().toUpperCase();
  const endpoint = `${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}${url.search}`;
  const isAuth = url.port === '9099'
    || /(?:identitytoolkit|securetoken)\.googleapis\.com$/i.test(url.hostname);
  const isFirestore = url.port === '8080'
    || /firestore\.googleapis\.com$/i.test(url.hostname)
    || /google\.firestore\./i.test(url.pathname);
  const isStorage = url.port === '9199'
    || /(?:firebasestorage|storage)\.googleapis\.com$/i.test(url.hostname);
  const isFunctions = url.port === '5001'
    || /cloudfunctions\.net$/i.test(url.hostname);

  if (isFunctions) return `Functions request blocked: ${method} ${endpoint}`;
  if (/^(?:accounts\.google\.com|oauth2\.googleapis\.com)$/i.test(url.hostname) || /\/__\/auth\/handler/i.test(url.pathname)) {
    return `Auth sign-in blocked: ${method} ${endpoint}`;
  }
  if (isAuth && /accounts:(?:signIn|signUp|update|delete)|sendOobCode/i.test(endpoint)) {
    return `Auth mutation blocked: ${method} ${endpoint}`;
  }
  if (isFirestore && /Firestore\/Write\/channel|documents:(?:commit|batchWrite)/i.test(endpoint)) {
    return `Firestore write blocked: ${method} ${endpoint}`;
  }
  if (isStorage && !readMethods.has(method)) {
    return `Storage mutation blocked: ${method} ${endpoint}`;
  }
  if (readMethods.has(method)) return null;
  if (method === 'POST' && isFirestore && firestoreReadTransport.test(endpoint)) return null;
  if (method === 'POST' && isAuth && authReadTransport.test(endpoint)) return null;
  return `Mutating request blocked: ${method} ${endpoint}`;
}

async function expectNoConfigurationErrors(
  page: Page,
  errors: readonly string[],
  networkViolations: readonly string[],
) {
  await expect(page.locator('body')).not.toContainText(configurationErrorPattern);
  const renderedStates = await page.locator('[role="status"], [role="alert"]').allTextContents();
  expect(renderedStates.join('\n')).not.toMatch(configurationErrorPattern);
  expect(errors.filter((message) => configurationErrorPattern.test(message))).toEqual([]);
  expect(networkViolations).toEqual([]);
}

test('deployed public entry, assets, and hash routes load without configuration errors', async ({ page, request }) => {
  const errors: string[] = [];
  const networkViolations: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/*', async (route) => {
    const violation = readOnlyViolation(route.request());
    if (violation) {
      networkViolations.push(violation);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const response = await page.goto('./');
  expect(response?.ok()).toBe(true);
  expect(response?.headers()['content-type']).toContain('text/html');
  await expect(page.getByRole('heading', { name: '搜尋正在販售的柯南 TCG 卡牌' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '網站使用與安全提醒' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'rugiacreation.com' }).first())
    .toHaveAttribute('href', 'https://rugiacreation.com/conan/search');

  await expect(page.getByText('登入狀態確認中', { exact: true })).toBeHidden();
  await expect(page.getByText('買家可直接瀏覽；賣家上架需登入', { exact: true })).toBeVisible();
  await expect(page.locator('.auth-error')).toHaveCount(0);

  await expect(page.getByText('商品載入中', { exact: true })).toBeHidden();
  await expect(page.getByRole('alert').filter({ hasText: '無法載入商品，請稍後再試。' })).toHaveCount(0);
  await expect(
    page.locator('a.listing-card').first()
      .or(page.getByText('目前沒有符合條件的商品。', { exact: true })),
  ).toBeVisible();
  await expectNoConfigurationErrors(page, errors, networkViolations);

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
  await expectNoConfigurationErrors(page, errors, networkViolations);

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
    await expectNoConfigurationErrors(page, errors, networkViolations);
  }
});
