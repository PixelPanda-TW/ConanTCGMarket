import { fileURLToPath } from 'node:url';

import { setEmulatorAdminClaim, signInWithMockGoogle } from './support/auth';
import { activeListing, sellerProfile, testCards } from './support/fixtures';
import {
  callEmulatorFunctionWithToken,
  firestoreDocumentRequestAsUser,
  getEmulatorUserIdToken,
  listDocuments,
  listStorageObjects,
  readAppealStorageObjectAsUser,
  readDocument,
  seedScenario,
  uploadAppealStorageObjectAsUser,
} from './support/emulator-state';
import { expect, test } from './support/test';
import { acknowledgeWelcome } from './support/ui';

const front = fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url));
const back = fileURLToPath(new URL('./fixtures/card-back.png', import.meta.url));
const fixed = new Date('2026-09-05T06:00:00.000Z');
const actionId = '7'.repeat(64);
const statement = '我認為這次停權所依據的資訊有誤，已重新核對商品內容與交易紀錄，以下提供完整事實供管理員重新審查。'.repeat(3);

test('suspended seller privately appeals with three images and admin approval preserves every hold', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('./');
  await acknowledgeWelcome(page);
  const seller = await signInWithMockGoogle(page, {
    email: 'appeal-seller@example.test', displayName: 'Appeal Seller',
  });
  const held = activeListing(seller.uid, 'data:image/png;base64,iVBORw0KGgo=', {
    id: 'appeal-held-listing', status: 'suspended', suspensionActionId: actionId,
    suspendedAt: fixed, updatedAt: fixed,
  });
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile(seller.uid, 'Appeal Seller')],
    accountAccess: [{
      uid: seller.uid, status: 'suspended', confirmedViolationCount: 4,
      suspensionReason: '等待申訴複核', suspendedAt: fixed, suspendedBy: 'appeal-admin-seed',
      suspensionActionId: actionId, updatedAt: fixed,
    }],
    listings: [held],
    accountModerationOperations: [{
      actionId, status: 'suspended', targetUid: seller.uid, sourceReportId: 'appeal-source-report',
      requestedBy: 'appeal-admin-seed', reason: '等待申訴複核', requestKey: actionId,
      confirmedViolationCount: 4, hiddenListingCount: 1, createdAt: fixed,
      updatedAt: fixed, completedAt: fixed,
    }],
    accountModerationAuditLogs: [{
      eventId: `${actionId}_completed`, type: 'suspension_completed', targetUid: seller.uid,
      suspensionActionId: actionId, sourceReportId: 'appeal-source-report',
      actorUid: 'appeal-admin-seed', at: fixed, hiddenListingCount: 1,
    }],
  });
  await page.reload();
  await page.goto('#/dashboard');
  await expect(page.getByRole('heading', { name: '申訴停權' })).toBeVisible();
  await page.getByLabel('申訴說明').fill(statement);
  await page.getByLabel('申訴證據').setInputFiles([front, back, front]);
  await expect(page.getByText('已選擇 3 張圖片')).toBeVisible();
  await page.getByRole('button', { name: '提交申訴' }).click();
  await expect(page.getByText('申訴已提交，等待管理員審核。')).toBeVisible();
  await page.reload();
  await expect(page.getByText('申訴已提交，等待管理員審核。')).toBeVisible();

  const appeals = await listDocuments('accountAppeals');
  expect(appeals).toHaveLength(1);
  const appealId = appeals[0].id;
  expect(appeals[0].data).toMatchObject({
    appealId, status: 'submitted', targetUid: seller.uid, suspensionActionId: actionId,
    statement, evidence: [{ slot: 0 }, { slot: 1 }, { slot: 2 }],
  });
  expect(JSON.stringify(appeals)).not.toMatch(/email|contact|displayName|https?:\/\//iu);
  const evidence = appeals[0].data.evidence as Array<{ slot: number }>;
  const draftId = appeals[0].data.draftId as string;
  const prefix = `account-appeal-evidence/${seller.uid}/${actionId}/${draftId}/`;
  expect(await listStorageObjects(prefix)).toEqual([`${prefix}0`, `${prefix}1`, `${prefix}2`]);

  await page.goto('./');
  await page.getByRole('button', { name: '登出' }).click();
  const sellerToken = await getEmulatorUserIdToken(seller.uid);
  expect((await firestoreDocumentRequestAsUser(sellerToken, 'GET', 'accountAppeals', appealId)).status)
    .toBe(403);
  expect((await readAppealStorageObjectAsUser(sellerToken, `${prefix}${evidence[0].slot}`)).status)
    .toBe(403);
  expect((await uploadAppealStorageObjectAsUser(
    sellerToken, `${prefix}${evidence[0].slot}`,
    new TextEncoder().encode('replacement'), 'image/png',
  )).status).toBe(403);
  const duplicate = await callEmulatorFunctionWithToken(sellerToken, 'submitAccountAppeal', {
    suspensionActionId: actionId,
    requestId: '550e8400-e29b-41d4-a716-446655440000',
    draftId: '550e8400-e29b-41d4-a716-446655440001',
    statement,
    evidence: [],
  });
  expect(duplicate.status).toBeGreaterThanOrEqual(400);
  expect(await listDocuments('accountAppeals')).toHaveLength(1);

  const admin = await signInWithMockGoogle(page, {
    email: 'appeal-admin@example.test', displayName: 'Appeal Admin',
  });
  await setEmulatorAdminClaim(admin.uid, true);
  await page.reload();
  await page.goto('#/admin/appeals');
  await expect(page.getByText(`帳號 ID：${seller.uid}`)).toBeVisible();
  await page.getByRole('link', { name: '查看申訴' }).click();
  await expect(page.getByText(statement)).toBeVisible();
  await page.getByRole('button', { name: '查看證據 1' }).click();
  await expect(page.getByRole('img', { name: '申訴證據預覽' })).toBeVisible();
  await page.getByRole('button', { name: '核准並恢復帳號' }).click();
  const dialog = page.getByRole('dialog', { name: '核准申訴' });
  await dialog.getByLabel('審核說明').fill('資料核對完成，申訴成立並恢復帳號。');
  await dialog.getByRole('button', { name: '確認審核' }).click();
  await expect(page.getByRole('status')).toContainText('申訴審核已完成');
  await expect(page.getByText('已核准')).toBeVisible();

  expect(await readDocument('accountAccess', seller.uid)).toMatchObject({
    status: 'active', confirmedViolationCount: 4,
  });
  expect(await readDocument('listings', held.id)).toMatchObject({
    status: 'suspended', remainingQuantity: 5, suspensionActionId: actionId,
  });
  expect(await readDocument('accountModerationOperations', actionId)).toMatchObject({
    status: 'restored', hiddenListingCount: 1, confirmedViolationCount: 4,
  });
  expect(await listDocuments('accountAppealAuditLogs')).toHaveLength(2);
  expect(await listDocuments('accountModerationAuditLogs')).toHaveLength(2);
  const appealAudits = await listDocuments('accountAppealAuditLogs');
  expect(JSON.stringify(appealAudits)).not.toMatch(/email|contact|statement|image|path|url/iu);
  expect((await firestoreDocumentRequestAsUser(
    await getEmulatorUserIdToken(admin.uid), 'GET', 'accountAppealAuditLogs', appealAudits[0].id,
  )).status).toBe(403);
});

test('zero-image appeal can be dismissed without changing suspension state', async ({ page }) => {
  const dismissalActionId = '8'.repeat(64);
  await page.goto('./');
  await acknowledgeWelcome(page);
  const seller = await signInWithMockGoogle(page, {
    email: 'appeal-dismissed@example.test', displayName: 'Dismissed Appeal Seller',
  });
  await seedScenario({
    accountAccess: [{
      uid: seller.uid, status: 'suspended', confirmedViolationCount: 3,
      suspensionReason: '等待申訴', suspendedAt: fixed, suspendedBy: 'dismiss-seed-admin',
      suspensionActionId: dismissalActionId, updatedAt: fixed,
    }],
    accountModerationOperations: [{
      actionId: dismissalActionId, status: 'suspended', targetUid: seller.uid,
      sourceReportId: 'dismiss-source-report', requestedBy: 'dismiss-seed-admin',
      reason: '等待申訴', requestKey: dismissalActionId, confirmedViolationCount: 3,
      hiddenListingCount: 0, createdAt: fixed, updatedAt: fixed, completedAt: fixed,
    }],
  });
  await page.reload();
  await page.goto('#/dashboard');
  await page.getByLabel('申訴說明').fill(statement);
  await page.getByRole('button', { name: '提交申訴' }).click();
  await expect(page.getByText('申訴已提交，等待管理員審核。')).toBeVisible();
  const [appeal] = await listDocuments('accountAppeals');
  expect(appeal.data.evidence).toEqual([]);
  await page.goto('./');
  await page.getByRole('button', { name: '登出' }).click();
  const sellerToken = await getEmulatorUserIdToken(seller.uid);
  expect((await callEmulatorFunctionWithToken(sellerToken, 'listAccountAppeals', {
    status: 'submitted', limit: 20, cursor: null,
  })).status).toBeGreaterThanOrEqual(400);
  const admin = await signInWithMockGoogle(page, {
    email: 'appeal-dismiss-admin@example.test', displayName: 'Appeal Dismiss Admin',
  });
  await setEmulatorAdminClaim(admin.uid, true);
  await page.reload();
  await page.goto(`#/admin/appeals/${appeal.id}`);
  await expect(page.getByText('未附證據。')).toBeVisible();
  await page.getByRole('button', { name: '駁回申訴' }).click();
  const dialog = page.getByRole('dialog', { name: '駁回申訴' });
  await dialog.getByLabel('審核說明').fill('現有資料不足以推翻原停權決定。');
  await dialog.getByRole('button', { name: '確認審核' }).click();
  await expect(page.getByText('已駁回')).toBeVisible();
  expect(await readDocument('accountAccess', seller.uid)).toMatchObject({
    status: 'suspended', confirmedViolationCount: 3, suspensionActionId: dismissalActionId,
  });
  expect(await readDocument('accountModerationOperations', dismissalActionId)).toMatchObject({
    status: 'suspended', confirmedViolationCount: 3,
  });
  expect(await listDocuments('accountAppealAuditLogs')).toHaveLength(2);
  expect(await listDocuments('accountModerationAuditLogs')).toHaveLength(0);
});
