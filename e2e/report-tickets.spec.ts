import { fileURLToPath } from 'node:url';
import { Timestamp } from 'firebase-admin/firestore';
import { signInWithMockGoogle } from './support/auth';
import {
  callEmulatorFunctionWithToken,
  getEmulatorUserIdToken,
  listDocuments,
  listStorageObjects,
  readDocument,
  readStorageObjectMetadata,
  seedScenario,
  uploadStorageObjectAsUser,
} from './support/emulator-state';
import { activeListing, testCards } from './support/fixtures';
import { expect, test } from './support/test';
import { acknowledgeWelcome } from './support/ui';

const front = fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url));
const back = fileURLToPath(new URL('./fixtures/card-back.png', import.meta.url));

test('guest signs in and an active buyer without Seller Profile submits zero and three-image reports', async ({ page }) => {
  const sellerId = 'report-seller';
  await seedScenario({
    cards: testCards,
    listings: [
      activeListing(sellerId, 'data:image/png;base64,iVBORw0KGgo=', { id: 'report-zero' }),
      activeListing(sellerId, 'data:image/png;base64,iVBORw0KGgo=', { id: 'report-three' }),
    ],
  });
  await page.goto('#/listing/report-zero');
  await acknowledgeWelcome(page);
  await expect(page.getByRole('link', { name: '檢舉商品' })).toHaveAttribute(
    'href', '#/listing/report-zero/report',
  );
  await page.goto('#/listing/report-zero/report');
  await expect(page).toHaveURL(/#\/listing\/report-zero\/report$/u);
  const buyer = await signInWithMockGoogle(page, {
    email: 'report-buyer@example.test', displayName: 'Report Buyer',
  }, page.getByRole('button', { name: '使用 Google 登入' }), page.getByLabel('檢舉原因'));
  expect(await readDocument('sellerProfiles', buyer.uid)).toBeNull();

  await page.getByLabel('檢舉原因').selectOption('listing_mismatch');
  await page.getByLabel('說明').fill('商品資訊與實際卡片不符');
  await page.getByRole('button', { name: '送出檢舉' }).click();
  const firstStatus = page.getByRole('status').filter({ hasText: '檢舉編號' });
  await expect(firstStatus).toBeVisible();
  const firstReportId = (await firstStatus.locator('strong').textContent())!;
  await page.reload();
  await expect(page.getByText(`檢舉編號：${firstReportId}`)).toBeVisible();

  await page.goto('#/listing/report-three/report');
  await page.getByLabel('檢舉原因').selectOption('suspected_counterfeit');
  await page.getByLabel('說明').fill('卡面印刷與正版不同');
  await page.getByLabel('證據圖片（選填）').setInputFiles([front, back, front]);
  await page.getByRole('button', { name: '送出檢舉' }).click();
  const secondStatus = page.getByRole('status').filter({ hasText: '檢舉編號' });
  await expect(secondStatus).toBeVisible();
  const secondReportId = (await secondStatus.locator('strong').textContent())!;

  const reports = await listDocuments('moderationReports');
  expect(reports).toHaveLength(2);
  const first = reports.find(({ id }) => id === firstReportId)?.data;
  const second = reports.find(({ id }) => id === secondReportId)?.data;
  expect(Object.keys(first!).toSorted()).toEqual([
    'category', 'createdAt', 'description', 'evidence', 'expiresAt', 'listingSnapshot',
    'reporterId', 'requestKey', 'status', 'submittedAt', 'targetSellerId',
  ]);
  expect(first).toMatchObject({
    status: 'submitted', reporterId: buyer.uid, targetSellerId: sellerId,
    category: 'listing_mismatch', description: '商品資訊與實際卡片不符', evidence: [],
    listingSnapshot: {
      listingId: 'report-zero', cardType: 'character', cardName: '諸伏高明',
      cardId: '0501', rarity: 'D', listingPrice: 500, createdAt: expect.any(Timestamp),
    },
  });
  expect((second?.evidence as unknown[])).toHaveLength(3);
  expect(JSON.stringify(reports)).not.toMatch(/email|contact|displayName|imageUrls/iu);

  const cases = await listDocuments('moderationCases');
  expect(cases).toHaveLength(2);
  for (const reportId of [firstReportId, secondReportId]) {
    const moderationCase = cases.find(({ id }) => id === reportId);
    expect(moderationCase).toEqual({
      id: reportId,
      data: {
        status: 'open', reportId, targetSellerId: sellerId,
        openedAt: (reports.find(({ id }) => id === reportId)!.data.submittedAt),
      },
    });
  }

  const prefix = `reportEvidence/${buyer.uid}/${secondReportId}/`;
  expect(await listStorageObjects(prefix)).toEqual([`${prefix}0`, `${prefix}1`, `${prefix}2`]);
  expect(await readStorageObjectMetadata(`${prefix}0`)).toMatchObject({ contentType: 'image/png' });
  const token = await getEmulatorUserIdToken(buyer.uid);
  const immutable = await uploadStorageObjectAsUser(
    token, `${prefix}0`, new TextEncoder().encode('replacement'), 'image/png',
  );
  expect(immutable.status).toBe(403);
});

test('report UI denies invalid files, owners, sold Listings, and suspended accounts', async ({ page }) => {
  await page.goto('./');
  await acknowledgeWelcome(page);
  const buyer = await signInWithMockGoogle(page, {
    email: 'report-denial@example.test', displayName: 'Report Denial Buyer',
  });
  await seedScenario({
    cards: testCards,
    listings: [
      activeListing('other-seller', 'data:image/png;base64,iVBORw0KGgo=', { id: 'report-valid' }),
      activeListing(buyer.uid, 'data:image/png;base64,iVBORw0KGgo=', { id: 'report-owned' }),
      activeListing('other-seller', 'data:image/png;base64,iVBORw0KGgo=', {
        id: 'report-sold', status: 'sold_out', remainingQuantity: 0,
      }),
    ],
  });
  await page.goto('#/listing/report-valid/report');
  await page.getByLabel('檢舉原因').selectOption('other');
  await page.getByLabel('說明').fill('說明');
  await page.getByLabel('證據圖片（選填）').setInputFiles({
    name: 'evidence.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf'),
  });
  await page.getByRole('button', { name: '送出檢舉' }).click();
  await expect(page.getByText(/JPEG、PNG 或 WebP/u)).toBeVisible();
  expect(await listDocuments('moderationReports')).toEqual([]);

  for (const listingId of ['report-owned', 'report-sold']) {
    await page.goto(`#/listing/${listingId}/report`);
    await expect(page.getByRole('heading', { name: '無法檢舉商品' })).toBeVisible();
  }
  await seedScenario({ accountAccess: [{
    uid: buyer.uid, status: 'suspended', confirmedViolationCount: 1,
    suspensionReason: 'E2E confirmed report violation', suspendedAt: new Date(),
    suspendedBy: 'admin-e2e', updatedAt: new Date(),
  }] });
  await page.goto('#/listing/report-valid/report');
  await expect(page.getByRole('heading', { name: '無法檢舉商品' })).toBeVisible();
  await expect(page.getByRole('button', { name: '送出檢舉' })).toHaveCount(0);
});

test('draft callable is retry-idempotent, enforces the UTC daily limit, and rejects another user', async ({ page }) => {
  await seedScenario({
    cards: testCards,
    listings: [activeListing('rate-seller', 'data:image/png;base64,iVBORw0KGgo=', { id: 'report-rate' })],
  });
  await page.goto('./');
  await acknowledgeWelcome(page);
  const buyer = await signInWithMockGoogle(page, {
    email: 'report-rate@example.test', displayName: 'Report Rate Buyer',
  });
  const token = await getEmulatorUserIdToken(buyer.uid);
  const input = {
    requestId: '550e8400-e29b-41d4-a716-446655440000', listingId: 'report-rate',
  };
  const first = await callEmulatorFunctionWithToken(token, 'createModerationReportDraft', input);
  const retry = await callEmulatorFunctionWithToken(token, 'createModerationReportDraft', input);
  expect(first.status).toBe(200);
  expect(retry).toEqual(first);
  expect(await listDocuments('moderationReports')).toHaveLength(1);
  const reportId = ((first.body as { result: { reportId: string } }).result.reportId);

  await page.getByRole('button', { name: '登出' }).click();
  const other = await signInWithMockGoogle(page, {
    email: 'report-other@example.test', displayName: 'Report Other Buyer',
  });
  const otherToken = await getEmulatorUserIdToken(other.uid);
  const forbidden = await callEmulatorFunctionWithToken(otherToken, 'submitModerationReport', {
    reportId, category: 'other', description: '另一位使用者', evidencePaths: [],
  });
  expect(forbidden.status).toBe(403);

  const utcDate = new Date().toISOString().slice(0, 10);
  await seedScenario({ moderationReportLimits: [{
    id: `${buyer.uid}_${utcDate}`, reporterId: buyer.uid, utcDate, count: 10,
    createdAt: new Date(), updatedAt: new Date(),
  }] });
  const limited = await callEmulatorFunctionWithToken(token, 'createModerationReportDraft', {
    requestId: '550e8400-e29b-41d4-a716-446655440001', listingId: 'report-rate',
  });
  expect(limited.status).toBe(429);
  expect(await listDocuments('moderationReports')).toHaveLength(1);
});
