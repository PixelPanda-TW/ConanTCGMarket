import { setEmulatorAdminClaim, signInWithMockGoogle } from './support/auth';
import { activeListing, sale, sellerProfile, testCards } from './support/fixtures';
import {
  firestoreDocumentRequestAsUser,
  getEmulatorUserIdToken,
  invokeAccountModerationReconciler,
  listDocuments,
  readDocument,
  seedScenario,
} from './support/emulator-state';
import { expect, test } from './support/test';
import { acknowledgeWelcome } from './support/ui';

const reportId = 'account-suspension-report';
const fixed = new Date('2026-09-04T06:00:00.000Z');

test('admin suspension, seller hold, restoration, and selective republish are durable', async ({ page }) => {
  test.setTimeout(180_000);
  const seller = await signInWithMockGoogleAfterWelcome(page, {
    email: 'account-moderation-seller@example.test', displayName: 'Moderated Seller',
  });
  await page.getByRole('button', { name: '登出' }).click();
  const heldCandidate = activeListing(seller.uid, 'https://example.test/held.png', {
    id: 'moderation-held-listing',
  });
  const soldOut = activeListing(seller.uid, 'https://example.test/sold.png', {
    id: 'moderation-sold-listing', status: 'sold_out', remainingQuantity: 0,
  });
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile(seller.uid, 'Moderated Seller')],
    accountAccess: [{
      uid: seller.uid, status: 'active', confirmedViolationCount: 2, updatedAt: fixed,
    }],
    listings: [heldCandidate, soldOut],
    sales: [sale(seller.uid, soldOut.id)],
    moderationReports: [{
      id: reportId, status: 'submitted', requestKey: 'c'.repeat(64), reporterId: 'reporter-1',
      targetSellerId: seller.uid,
      listingSnapshot: {
        listingId: heldCandidate.id, cardType: 'character', cardName: '諸伏高明',
        cardId: '0501', rarity: 'D', listingPrice: 500, createdAt: fixed,
      },
      createdAt: fixed, expiresAt: new Date(fixed.valueOf() + 86_400_000),
      category: 'listing_mismatch', description: '已確認的商品資訊不符', evidence: [],
      submittedAt: fixed,
    }],
    moderationCases: [{
      id: reportId, reportId, status: 'confirmed', targetSellerId: seller.uid, openedAt: fixed,
      rationale: '兩次確認違規', decidedBy: 'previous-admin', decidedAt: fixed,
      resultingConfirmedViolationCount: 2,
    }],
  });

  const admin = await signInWithMockGoogle(page, {
    email: 'account-moderation-admin@example.test', displayName: 'Account Moderator',
  });
  await setEmulatorAdminClaim(admin.uid, true);
  await page.reload();
  await page.goto(`#/admin/moderation/${reportId}`);
  await expect(page.getByRole('button', { name: '停權帳號' })).toBeVisible();
  await page.getByRole('button', { name: '停權帳號' }).click();
  const suspensionDialog = page.getByRole('dialog', { name: '停權帳號' });
  await suspensionDialog.getByLabel('處理理由').fill('確認多次違規，暫停賣家權限');
  await suspensionDialog.getByRole('button', { name: '確認停權' }).click();
  await expect.poll(() => listDocuments('accountModerationOperations')).toHaveLength(1);
  await expect(page.getByRole('status')).toContainText('停權請求已送出');
  await expect(page.getByText('停權完成，共隱藏 1 筆商品。')).toBeVisible();
  await expect(page.getByRole('list', { name: '帳號管理歷史' })).toContainText('提出停權');
  await expect(page.getByRole('list', { name: '帳號管理歷史' })).toContainText('停權完成');

  const [operation] = await listDocuments('accountModerationOperations');
  expect(operation.data).toMatchObject({
    status: 'suspended', targetUid: seller.uid, hiddenListingCount: 1,
  });
  const actionId = operation.id;
  expect(await readDocument('listings', heldCandidate.id)).toMatchObject({
    status: 'suspended', suspensionActionId: actionId, remainingQuantity: 5,
  });
  expect(await readDocument('listings', soldOut.id)).toMatchObject({
    status: 'sold_out', remainingQuantity: 0,
  });
  expect(await readDocument('sales', 'e2e-sale-1')).not.toBeNull();
  expect(await listDocuments('accountModerationAuditLogs')).toHaveLength(2);

  await page.goto('./');
  await expect(page.getByRole('link', { name: /諸伏高明/u })).toHaveCount(0);
  await page.getByRole('button', { name: '登出' }).click();
  await signInWithMockGoogle(page, {
    email: seller.email, displayName: seller.displayName,
  });
  await page.goto('#/dashboard');
  await expect(page.getByText('停權保留：1', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '因停權隱藏' })).toContainText('僅供查看');
  await expect(page.getByText('已售張數：2', { exact: true })).toBeVisible();
  await page.goto(`#/listing/${heldCandidate.id}`);
  await expect(page.getByText('因帳號停權暫停顯示')).toBeVisible();
  await expect(page.getByRole('button', { name: '重新上架商品' })).toHaveCount(0);

  await page.goto('./');
  await page.getByRole('button', { name: '登出' }).click();
  await signInWithMockGoogle(page, {
    email: admin.email, displayName: admin.displayName,
  });
  await page.goto(`#/admin/moderation/${reportId}`);
  await page.getByRole('button', { name: '恢復帳號' }).click();
  const restoreDialog = page.getByRole('dialog', { name: '恢復帳號' });
  await restoreDialog.getByLabel('處理理由').fill('人工複核完成，恢復帳號');
  await restoreDialog.getByRole('button', { name: '確認恢復' }).click();
  await expect(page.getByRole('status')).toContainText('帳號已恢復');
  await expect(page.getByText('帳號已恢復；先前隱藏的商品不會自動重新上架。')).toBeVisible();
  expect(await readDocument('accountAccess', seller.uid)).toMatchObject({
    status: 'active', confirmedViolationCount: 2,
  });
  expect(await readDocument('listings', heldCandidate.id)).toMatchObject({ status: 'suspended' });

  await page.goto('./');
  await page.getByRole('button', { name: '登出' }).click();
  await signInWithMockGoogle(page, {
    email: seller.email, displayName: seller.displayName,
  });
  await page.goto(`#/listing/${heldCandidate.id}`);
  await expect(page.getByRole('button', { name: '重新上架商品' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重新上架商品' }).click();
  await expect(page.getByRole('status')).toContainText('商品已重新上架');
  expect(await readDocument('listings', heldCandidate.id)).toMatchObject({ status: 'active' });
  expect(await listDocuments('accountModerationAuditLogs')).toHaveLength(4);
  await page.reload();
  await expect(page.getByText('剩餘 5 張')).toBeVisible();
  await page.goto('./');
  await expect(page.getByRole('link', { name: /諸伏高明/u })).toBeVisible();
  const adminToken = await getEmulatorUserIdToken(admin.uid);
  for (const collection of ['accountModerationOperations', 'accountModerationAuditLogs']) {
    expect((await firestoreDocumentRequestAsUser(adminToken, 'GET', collection,
      collection === 'accountModerationOperations' ? actionId : `${actionId}_requested`)).status)
      .toBe(403);
  }
});

async function signInWithMockGoogleAfterWelcome(
  page: Parameters<typeof signInWithMockGoogle>[0],
  identity: Parameters<typeof signInWithMockGoogle>[1],
) {
  await page.goto('./');
  await acknowledgeWelcome(page);
  return signInWithMockGoogle(page, identity);
}

test('scheduled reconciliation recovers a persisted partial suspension', async () => {
  const actionId = '9'.repeat(64);
  await seedScenario({
    accountAccess: [{
      uid: 'reconcile-seller', status: 'suspended', confirmedViolationCount: 2,
      suspensionReason: '等待背景隱藏商品', suspendedAt: fixed,
      suspendedBy: 'reconcile-admin', suspensionActionId: actionId, updatedAt: fixed,
    }],
    listings: [activeListing('reconcile-seller', 'https://example.test/reconcile.png', {
      id: 'reconcile-listing',
    })],
    accountModerationOperations: [{
      actionId, status: 'hiding', targetUid: 'reconcile-seller',
      sourceReportId: 'reconcile-report', requestedBy: 'reconcile-admin',
      reason: '等待背景隱藏商品', requestKey: actionId, confirmedViolationCount: 2,
      hiddenListingCount: 0, createdAt: fixed, updatedAt: fixed,
    }],
    accountModerationAuditLogs: [{
      eventId: `${actionId}_requested`, type: 'suspension_requested',
      targetUid: 'reconcile-seller', suspensionActionId: actionId,
      sourceReportId: 'reconcile-report', actorUid: 'reconcile-admin', at: fixed,
      reason: '等待背景隱藏商品', confirmedViolationCount: 2,
    }],
  });

  const response = await invokeAccountModerationReconciler();
  expect(response.status).toBeLessThan(300);
  await expect.poll(() => readDocument('accountModerationOperations', actionId)).toMatchObject({
    status: 'suspended', hiddenListingCount: 1,
  });
  expect(await readDocument('listings', 'reconcile-listing')).toMatchObject({
    status: 'suspended', suspensionActionId: actionId,
  });
  expect(await listDocuments('accountModerationAuditLogs')).toHaveLength(2);
});
