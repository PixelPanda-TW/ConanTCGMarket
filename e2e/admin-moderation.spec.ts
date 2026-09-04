import { fileURLToPath } from 'node:url';
import { Timestamp } from 'firebase-admin/firestore';

import { setEmulatorAdminClaim, signInWithMockGoogle } from './support/auth';
import { activeListing, sellerProfile, testCards } from './support/fixtures';
import {
  callEmulatorFunctionWithToken,
  firestoreDocumentRequestAsUser,
  getEmulatorUserIdToken,
  listDocuments,
  readDocument,
  readModerationStorageObjectAsUser,
  seedModerationEvidence,
  seedScenario,
  type ModerationCaseSeed,
  type ModerationEvidenceSeed,
  type ModerationReportSeed,
} from './support/emulator-state';
import { expect, test } from './support/test';
import { acknowledgeWelcome } from './support/ui';

const front = fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url));
const fixed = new Date('2026-09-04T03:00:00.000Z');

function report(
  id: string,
  targetSellerId: string,
  submittedAt: Date,
  evidence: readonly ModerationEvidenceSeed[] = [],
): ModerationReportSeed {
  return {
    id, status: 'submitted', requestKey: 'a'.repeat(64),
    reporterId: 'reporter-1', targetSellerId,
    listingSnapshot: {
      listingId: 'moderated-listing', cardType: 'character', cardName: '諸伏高明',
      cardId: '0501', rarity: 'D', listingPrice: 500, createdAt: fixed,
    },
    createdAt: new Date(submittedAt.valueOf() - 60_000),
    expiresAt: new Date(submittedAt.valueOf() + 86_400_000),
    category: 'listing_mismatch', description: `案件說明 ${id}`, evidence,
    submittedAt,
  };
}

function openCase(id: string, targetSellerId: string, openedAt: Date): ModerationCaseSeed {
  return { id, reportId: id, status: 'open', targetSellerId, openedAt };
}

async function promoteCurrentUserToAdmin(page: Parameters<typeof signInWithMockGoogle>[0]) {
  const admin = await signInWithMockGoogle(page, {
    email: 'moderation-admin@example.test', displayName: 'Moderation Admin',
  });
  await setEmulatorAdminClaim(admin.uid, true);
  await page.reload();
  await expect(page.getByRole('link', { name: '審查檢舉' })).toBeVisible();
  return admin;
}

test('signed-out, ordinary, suspended, and malformed admins cannot inspect moderation data', async ({ page }) => {
  test.setTimeout(120_000);
  const evidence = await seedModerationEvidence('reporter-1', 'denied-report', 0, front);
  await seedScenario({
    moderationReports: [report('denied-report', 'target-denied', fixed, [evidence])],
    moderationCases: [openCase('denied-report', 'target-denied', fixed)],
  });

  await page.goto('#/admin/moderation');
  await expect(page.getByText(/請先使用 Google 登入/u)).toBeVisible();
  const ordinary = await signInWithMockGoogle(
    page,
    { email: 'moderation-ordinary@example.test', displayName: 'Ordinary Reviewer' },
    page.getByRole('button', { name: '使用 Google 登入' }),
    page.getByText('無權限查看檢舉案件', { exact: true }),
  );
  await expect(page.getByRole('alert')).toHaveText('無權限查看檢舉案件');
  const ordinaryToken = await getEmulatorUserIdToken(ordinary.uid);
  expect((await callEmulatorFunctionWithToken(ordinaryToken, 'listModerationCases', {
    status: 'all', limit: 20, cursor: null,
  })).status).toBe(403);

  await page.goto('./');
  await acknowledgeWelcome(page);
  await page.getByRole('button', { name: '登出' }).click();
  const suspended = await signInWithMockGoogle(page, {
    email: 'moderation-suspended@example.test', displayName: 'Suspended Admin',
  });
  await setEmulatorAdminClaim(suspended.uid, true);
  await seedScenario({ accountAccess: [{
    uid: suspended.uid, status: 'suspended', confirmedViolationCount: 2,
    suspensionReason: 'E2E suspension', suspendedAt: fixed,
    suspendedBy: 'admin-other', updatedAt: fixed,
  }] });
  await page.goto('#/admin/moderation');
  await expect(page.getByRole('status')).toContainText('帳號目前已停權');
  const suspendedToken = await getEmulatorUserIdToken(suspended.uid);
  expect((await callEmulatorFunctionWithToken(suspendedToken, 'getModerationCase', {
    reportId: 'denied-report',
  })).status).toBe(403);

  await page.goto('./');
  await page.getByRole('button', { name: '登出' }).click();
  const malformed = await signInWithMockGoogle(page, {
    email: 'moderation-malformed@example.test', displayName: 'Malformed Admin',
  });
  await setEmulatorAdminClaim(malformed.uid, true);
  await seedScenario({ accountAccess: [{
    uid: malformed.uid, status: 'active', confirmedViolationCount: -1, updatedAt: fixed,
  }] });
  await page.goto('#/admin/moderation');
  await expect(page.getByText(/無法確認管理權限|無權限查看檢舉案件/u)).toBeVisible();
  const malformedToken = await getEmulatorUserIdToken(malformed.uid);
  expect((await callEmulatorFunctionWithToken(malformedToken, 'listModerationCases', {
    status: 'all', limit: 20, cursor: null,
  })).status).toBe(403);
});

test('active admin reviews evidence, dismisses and confirms durably without direct data access', async ({ page }) => {
  test.setTimeout(180_000);
  const targetSellerId = 'moderated-seller';
  const firstAt = new Date('2026-09-04T06:00:00.000Z');
  const secondAt = new Date('2026-09-04T05:00:00.000Z');
  const dismissAt = new Date('2026-09-04T04:00:00.000Z');
  const evidence = await seedModerationEvidence('reporter-1', 'confirm-one', 0, front);
  const listing = activeListing(targetSellerId, 'data:image/png;base64,iVBORw0KGgo=', {
    id: 'moderated-listing',
  });
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile(targetSellerId, '受檢舉賣家')],
    listings: [listing],
    moderationReports: [
      report('confirm-one', targetSellerId, firstAt, [evidence]),
      report('confirm-two', targetSellerId, secondAt),
      report('dismiss-one', targetSellerId, dismissAt),
    ],
    moderationCases: [
      openCase('confirm-one', targetSellerId, firstAt),
      openCase('confirm-two', targetSellerId, secondAt),
      openCase('dismiss-one', targetSellerId, dismissAt),
    ],
  });
  const listingBefore = await readDocument('listings', listing.id);
  const profileBefore = await readDocument('sellerProfiles', targetSellerId);
  const contactBefore = await readDocument('sellerContacts', targetSellerId);

  await page.goto('./');
  await acknowledgeWelcome(page);
  const admin = await promoteCurrentUserToAdmin(page);
  await page.getByRole('link', { name: '審查檢舉' }).click();
  await expect(page.getByRole('heading', { name: '檢舉案件' })).toBeVisible();
  await expect(page.getByRole('list', { name: '檢舉案件清單' }).getByRole('listitem'))
    .toHaveCount(3);
  await page.getByRole('tab', { name: '待審查' }).click();
  await expect(page.getByRole('link', { name: '查看 confirm-one' })).toBeVisible();

  await page.getByRole('link', { name: '查看 confirm-one' }).click();
  await expect(page.getByText('案件說明 confirm-one')).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(0);
  await page.getByRole('button', { name: '載入證據 1' }).click();
  await expect(page.getByRole('img', { name: '檢舉證據 1' })).toBeVisible();

  await page.getByRole('button', { name: '確認違規', exact: true }).click();
  await page.getByLabel(/裁決理由/u).fill('第一筆證據確認違規');
  await page.getByRole('button', { name: '確認違規裁決' }).click();
  await expect(page.getByRole('status')).toContainText('違規已確認，累計 1 次。');
  await expect.poll(() => readDocument('accountAccess', targetSellerId)).toMatchObject({
    status: 'active', confirmedViolationCount: 1,
  });
  await page.reload();
  await expect(page.getByText('第一筆證據確認違規')).toBeVisible();
  await expect(page.getByRole('button', { name: '確認違規', exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: '返回檢舉案件' }).click();
  await page.getByRole('tab', { name: '已確認違規' }).click();
  await expect(page.getByRole('link', { name: '查看 confirm-one' })).toBeVisible();
  await page.getByRole('tab', { name: '待審查' }).click();
  await page.getByRole('link', { name: '查看 confirm-two' }).click();
  await page.getByRole('button', { name: '確認違規', exact: true }).click();
  await page.getByLabel(/裁決理由/u).fill('第二筆證據確認違規');
  await page.getByRole('button', { name: '確認違規裁決' }).click();
  await expect(page.getByRole('status')).toContainText('違規已確認，累計 2 次。');
  await expect(page.getByText('此帳號符合人工停權條件；停權操作將在後續批次提供。'))
    .toBeVisible();
  await expect(page.getByRole('button', { name: /停權/u })).toHaveCount(0);

  await page.getByRole('link', { name: '返回檢舉案件' }).click();
  await page.getByRole('tab', { name: '待審查' }).click();
  await page.getByRole('link', { name: '查看 dismiss-one' }).click();
  await page.getByRole('button', { name: '駁回檢舉' }).click();
  await page.getByLabel(/裁決理由/u).fill('目前證據不足');
  await page.getByRole('button', { name: '確認駁回' }).click();
  await expect(page.getByRole('status')).toContainText('檢舉已駁回。');

  const access = await readDocument('accountAccess', targetSellerId);
  expect(access).toMatchObject({ status: 'active', confirmedViolationCount: 2 });
  expect(Object.keys(access!).toSorted()).toEqual(['confirmedViolationCount', 'status', 'updatedAt']);
  expect(await readDocument('moderationCases', 'confirm-one')).toMatchObject({
    status: 'confirmed', rationale: '第一筆證據確認違規',
    resultingConfirmedViolationCount: 1, decidedBy: admin.uid,
    decidedAt: expect.any(Timestamp),
  });
  expect(await readDocument('moderationCases', 'confirm-two')).toMatchObject({
    status: 'confirmed', resultingConfirmedViolationCount: 2,
  });
  expect(await readDocument('moderationCases', 'dismiss-one')).toMatchObject({
    status: 'dismissed', rationale: '目前證據不足',
  });
  expect(await readDocument('listings', listing.id)).toEqual(listingBefore);
  expect(await readDocument('sellerProfiles', targetSellerId)).toEqual(profileBefore);
  expect(await readDocument('sellerContacts', targetSellerId)).toEqual(contactBefore);
  expect(JSON.stringify(await listDocuments('moderationCases'))).not.toMatch(/email|contact|imageUrls/iu);

  const token = await getEmulatorUserIdToken(admin.uid);
  for (const collectionName of ['moderationCases', 'moderationReports']) {
    expect((await firestoreDocumentRequestAsUser(
      token, 'GET', collectionName, 'confirm-one',
    )).status).toBe(403);
  }
  expect((await readModerationStorageObjectAsUser(token, evidence.path)).status).toBe(403);

  const retry = await callEmulatorFunctionWithToken(token, 'decideModerationCase', {
    reportId: 'confirm-one', decision: 'confirmed', rationale: '第一筆證據確認違規',
  });
  expect(retry.status).toBe(200);
  expect((await readDocument('accountAccess', targetSellerId))?.confirmedViolationCount).toBe(2);
  const conflict = await callEmulatorFunctionWithToken(token, 'decideModerationCase', {
    reportId: 'confirm-one', decision: 'dismissed', rationale: '改變既有裁決',
  });
  expect(conflict.status).toBe(400);
});

test('malformed pairs fail closed and simultaneous conflicting decisions produce one terminal result', async ({ page }) => {
  test.setTimeout(120_000);
  await seedScenario({
    moderationReports: [
      report('malformed-pair', 'report-target', fixed),
      report('race-case', 'race-target', new Date(fixed.valueOf() + 60_000)),
    ],
    moderationCases: [
      openCase('malformed-pair', 'different-target', fixed),
      openCase('race-case', 'race-target', new Date(fixed.valueOf() + 60_000)),
    ],
  });
  await page.goto('./');
  await acknowledgeWelcome(page);
  const admin = await promoteCurrentUserToAdmin(page);
  const token = await getEmulatorUserIdToken(admin.uid);

  const malformed = await callEmulatorFunctionWithToken(token, 'getModerationCase', {
    reportId: 'malformed-pair',
  });
  expect(malformed.status).toBe(400);

  const outcomes = await Promise.all([
    callEmulatorFunctionWithToken(token, 'decideModerationCase', {
      reportId: 'race-case', decision: 'confirmed', rationale: '並行確認',
    }),
    callEmulatorFunctionWithToken(token, 'decideModerationCase', {
      reportId: 'race-case', decision: 'dismissed', rationale: '並行駁回',
    }),
  ]);
  expect(outcomes.map(({ status }) => status).toSorted()).toEqual([200, 400]);
  const terminal = await readDocument('moderationCases', 'race-case');
  expect(['confirmed', 'dismissed']).toContain(terminal?.status);
  if (terminal?.status === 'confirmed') {
    expect((await readDocument('accountAccess', 'race-target'))?.confirmedViolationCount).toBe(1);
  } else {
    expect(await readDocument('accountAccess', 'race-target')).toBeNull();
  }
});
