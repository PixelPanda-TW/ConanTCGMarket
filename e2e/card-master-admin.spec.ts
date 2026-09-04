import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

import type { Card, Listing, Sale } from '../src/domain/models';
import { signInWithMockGoogle, setEmulatorAdminClaim } from './support/auth';
import { sellerProfile } from './support/fixtures';
import {
  firestoreDocumentRequestAsUser,
  getEmulatorUserIdToken,
  listDocuments,
  readDocument,
  seedScenario,
} from './support/emulator-state';
import { acknowledgeWelcome } from './support/ui';
import { expect, test } from './support/test';

function cardKey(card: Pick<Card, 'cardId' | 'cardType' | 'cardName'>): string {
  const identity = JSON.stringify([card.cardType, card.cardName, card.cardId]);
  return `card_${createHash('sha256').update(identity, 'utf8').digest('hex')}`;
}

function canonicalCard(
  cardId: string,
  cardType: Card['cardType'],
  cardName: string,
  rarities: string[],
): Card {
  const card = { cardId, cardType, cardName, rarities };
  return { key: cardKey(card), ...card };
}

const fixedDate = new Date('2026-09-04T00:00:00.000Z');
const targetCard = canonicalCard('P001', 'partner', '江戶川柯南', ['P']);
const addedCard = canonicalCard('0590', 'character', '灰原哀', ['R']);
const editedCard = canonicalCard('0591', 'character', '宮野志保', ['R']);

const historicalListing: Listing = {
  id: 'card-master-history-listing',
  sellerId: 'historical-seller',
  cardId: targetCard.cardId,
  cardType: targetCard.cardType,
  cardName: targetCard.cardName,
  rarity: 'P',
  imageUrls: ['https://example.test/historical-card.png'],
  listingPrice: 900,
  originalQuantity: 2,
  remainingQuantity: 1,
  hasSleeve: false,
  supportsMyShip: false,
  note: 'Card Master 異動前的刊登快照',
  status: 'active',
  createdAt: fixedDate,
  updatedAt: fixedDate,
};

const historicalSale: Sale = {
  id: 'card-master-history-sale',
  listingId: historicalListing.id,
  sellerId: historicalListing.sellerId,
  cardId: targetCard.cardId,
  cardType: targetCard.cardType,
  cardName: targetCard.cardName,
  rarity: 'P',
  quantity: 1,
  listingUnitPrice: 900,
  soldUnitPrice: 850,
  soldAt: fixedDate,
};

function storedCard(card: Card): Omit<Card, 'key'> {
  return {
    cardId: card.cardId,
    cardType: card.cardType,
    cardName: card.cardName,
    rarities: card.rarities,
  };
}

function expectExactTimestampedDocument(
  actual: Record<string, unknown> | null,
  expected: Record<string, unknown>,
): void {
  expect(actual).not.toBeNull();
  expect(Object.keys(actual!).sort()).toEqual([...Object.keys(expected), 'actedAt'].sort());
  expect(actual).toMatchObject(expected);
  expect(actual!.actedAt).toBeInstanceOf(Timestamp);
}

async function expectExactAudits(expected: readonly Record<string, unknown>[]) {
  await expect.poll(async () => (await listDocuments('cardMasterAuditLogs')).length)
    .toBe(expected.length);
  const audits = await listDocuments('cardMasterAuditLogs');
  for (const expectedAudit of expected) {
    const actual = audits.find(({ data }) => data.action === expectedAudit.action)?.data ?? null;
    expectExactTimestampedDocument(actual, expectedAudit);
  }
}

function expectNoEffectOrImageFields(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/(?:effect|image)/iu);
}

test('ordinary signed-in users cannot reach or discover the Card Master console', async ({ page }) => {
  await page.goto('#/admin/cards');
  await signInWithMockGoogle(
    page,
    { email: 'ordinary@example.test', displayName: 'Ordinary User' },
    undefined,
    page.getByText('無權限使用管理工具', { exact: true }),
  );

  await expect(page.getByRole('alert')).toHaveText('無權限使用管理工具');
  await expect(page.getByRole('heading', { name: '新增卡片' })).toHaveCount(0);
  await page.goto('./');
  await acknowledgeWelcome(page);
  await expect(page.getByRole('link', { name: '管理卡片資料' })).toHaveCount(0);
});

test('active admin completes canonical Card Master lifecycle without rewriting history', async ({ page }) => {
  test.setTimeout(120_000);
  const adminIdentity = { email: 'admin@example.test', displayName: 'Card Admin' };
  await seedScenario({
    cards: [targetCard],
    sellerProfiles: [sellerProfile(historicalListing.sellerId, '歷史賣家')],
    listings: [historicalListing],
    sales: [historicalSale],
  });
  const listingBefore = await readDocument('listings', historicalListing.id);
  const saleBefore = await readDocument('sales', historicalSale.id);

  await page.goto('#/admin/cards');
  const admin = await signInWithMockGoogle(
    page,
    adminIdentity,
    undefined,
    page.getByText('無權限使用管理工具', { exact: true }),
  );
  await setEmulatorAdminClaim(admin.uid, true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '新增卡片' })).toBeVisible();
  await expect(page.getByLabel(/牌效|圖片/u)).toHaveCount(0);

  await page.getByLabel('卡片類型').selectOption(addedCard.cardType);
  await page.getByLabel('卡片名稱').fill(addedCard.cardName);
  await page.getByLabel('卡片 ID').fill(addedCard.cardId);
  await page.getByLabel('稀有度 1').fill('r');
  await page.getByLabel('異動原因').fill('新增正式卡片');
  await page.getByRole('button', { name: '新增卡片', exact: true }).click();
  await expect(page.getByTestId('admin-card-feedback')).toHaveText('新增完成');
  await expect.poll(() => readDocument('cards', addedCard.key)).toEqual({
    ...storedCard(addedCard),
    rarities: ['R'],
  });
  const addAudit = {
    action: 'add', targetCardKey: addedCard.key, after: storedCard(addedCard),
    rationale: '新增正式卡片', actedBy: admin.uid,
  };
  await expectExactAudits([addAudit]);

  await page.getByRole('button', { name: `編輯${addedCard.cardName}` }).click();
  let dialog = page.getByRole('dialog', { name: '編輯卡片' });
  await dialog.getByLabel('卡片名稱').fill(editedCard.cardName);
  await dialog.getByLabel('卡片 ID').fill(editedCard.cardId);
  await dialog.getByLabel('異動原因').fill('修正正式名稱與 ID');
  await dialog.getByRole('button', { name: '儲存修改' }).click();
  await expect(page.getByTestId('admin-card-feedback')).toHaveText('修改完成');
  await expect.poll(() => readDocument('cards', addedCard.key)).toBeNull();
  await expect.poll(() => readDocument('cards', editedCard.key)).toEqual(storedCard(editedCard));
  await expect.poll(() => readDocument('cardMasterArchives', addedCard.key)).toMatchObject({
    cardId: addedCard.cardId,
    cardType: addedCard.cardType,
    cardName: addedCard.cardName,
    rarities: ['R'],
    disposition: 'superseded',
    replacementCardKey: editedCard.key,
    rationale: '修正正式名稱與 ID',
    actedBy: admin.uid,
  });
  expectExactTimestampedDocument(
    await readDocument('cardMasterArchives', addedCard.key),
    {
      ...storedCard(addedCard), disposition: 'superseded', replacementCardKey: editedCard.key,
      rationale: '修正正式名稱與 ID', actedBy: admin.uid,
    },
  );
  const editAudit = {
    action: 'edit', sourceCardKey: addedCard.key, targetCardKey: editedCard.key,
    before: storedCard(addedCard), after: storedCard(editedCard),
    rationale: '修正正式名稱與 ID', actedBy: admin.uid,
  };
  await expectExactAudits([addAudit, editAudit]);

  await page.getByRole('button', { name: `編輯${editedCard.cardName}` }).click();
  dialog = page.getByRole('dialog', { name: '編輯卡片' });
  await seedScenario({ cards: [{ ...editedCard, rarities: ['CP', 'R'] }] });
  await dialog.getByLabel('卡片名稱').fill('宮野志保（修訂）');
  await dialog.getByLabel('異動原因').fill('模擬同時編輯');
  await dialog.getByRole('button', { name: '儲存修改' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('卡片已被其他操作更新，請重新載入後再試。');
  await expect(readDocument('cards', cardKey({ ...editedCard, cardName: '宮野志保（修訂）' })))
    .resolves.toBeNull();
  await expect(readDocument('cards', editedCard.key)).resolves.toEqual({
    cardId: editedCard.cardId,
    cardType: editedCard.cardType,
    cardName: editedCard.cardName,
    rarities: ['CP', 'R'],
  });
  await expectExactAudits([addAudit, editAudit]);
  await dialog.getByRole('button', { name: '取消' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: '新增卡片' })).toBeVisible();

  await page.getByRole('button', { name: `合併${editedCard.cardName}` }).click();
  dialog = page.getByRole('dialog', { name: '合併卡片' });
  await dialog.getByLabel('搜尋合併目標').fill('P00');
  await dialog.getByRole('button', { name: `選擇${targetCard.cardName}作為合併目標` }).click();
  await expect(dialog).toContainText('合併後稀有度：CP / P / R');
  await dialog.getByLabel('異動原因').fill('合併重複卡片');
  await dialog.getByRole('checkbox', { name: /我確認合併/u }).check();
  await dialog.getByRole('button', { name: '確認合併' }).click();
  await expect(page.getByTestId('admin-card-feedback')).toHaveText('合併完成');
  await expect.poll(() => readDocument('cards', editedCard.key)).toBeNull();
  await expect.poll(() => readDocument('cards', targetCard.key)).toEqual({
    cardId: targetCard.cardId,
    cardType: targetCard.cardType,
    cardName: targetCard.cardName,
    rarities: ['CP', 'P', 'R'],
  });
  await expect.poll(() => readDocument('cardMasterArchives', editedCard.key)).toMatchObject({
    disposition: 'merged',
    replacementCardKey: targetCard.key,
    rationale: '合併重複卡片',
    actedBy: admin.uid,
  });
  expectExactTimestampedDocument(
    await readDocument('cardMasterArchives', editedCard.key),
    {
      ...storedCard(editedCard), rarities: ['CP', 'R'], disposition: 'merged',
      replacementCardKey: targetCard.key, rationale: '合併重複卡片', actedBy: admin.uid,
    },
  );
  const mergedTarget = { ...storedCard(targetCard), rarities: ['CP', 'P', 'R'] };
  const mergeAudit = {
    action: 'merge', sourceCardKey: editedCard.key, targetCardKey: targetCard.key,
    before: { ...storedCard(editedCard), rarities: ['CP', 'R'] },
    targetBefore: storedCard(targetCard), after: mergedTarget,
    rationale: '合併重複卡片', actedBy: admin.uid,
  };
  await expectExactAudits([addAudit, editAudit, mergeAudit]);

  await page.getByRole('button', { name: `停用${targetCard.cardName}` }).click();
  dialog = page.getByRole('dialog', { name: '停用卡片' });
  await dialog.getByLabel('異動原因').fill('停用錯誤卡片');
  await dialog.getByRole('checkbox', { name: /我確認停用/u }).check();
  await dialog.getByRole('button', { name: '確認停用' }).click();
  await expect(page.getByTestId('admin-card-feedback')).toHaveText('停用完成');
  await expect.poll(() => readDocument('cards', targetCard.key)).toBeNull();
  await expect.poll(() => readDocument('cardMasterArchives', targetCard.key)).toMatchObject({
    disposition: 'disabled',
    rationale: '停用錯誤卡片',
    actedBy: admin.uid,
  });
  expectExactTimestampedDocument(
    await readDocument('cardMasterArchives', targetCard.key),
    {
      ...storedCard(targetCard), rarities: ['CP', 'P', 'R'], disposition: 'disabled',
      rationale: '停用錯誤卡片', actedBy: admin.uid,
    },
  );
  const disableAudit = {
    action: 'disable', sourceCardKey: targetCard.key, before: mergedTarget,
    rationale: '停用錯誤卡片', actedBy: admin.uid,
  };
  await expectExactAudits([addAudit, editAudit, mergeAudit, disableAudit]);

  expect(await readDocument('listings', historicalListing.id)).toEqual(listingBefore);
  expect(await readDocument('sales', historicalSale.id)).toEqual(saleBefore);
  expectNoEffectOrImageFields(await listDocuments('cards'));
  expectNoEffectOrImageFields(await listDocuments('cardMasterArchives'));
  expectNoEffectOrImageFields(await listDocuments('cardMasterAuditLogs'));

  await page.goto('./');
  await acknowledgeWelcome(page);
  await expect(page.getByRole('link', { name: '管理卡片資料' })).toBeVisible();
  await page.getByLabel('卡片類型', { exact: true }).selectOption(targetCard.cardType);
  await page.getByLabel('卡片名稱', { exact: true }).fill('江戶');
  await expect(page.locator('#card-metadata-name-options option', { hasText: targetCard.cardName }))
    .toHaveCount(0);
  await expect(page.getByRole('link', { name: new RegExp(targetCard.cardName, 'u') })).toBeVisible();

  const idToken = await getEmulatorUserIdToken(admin.uid);
  for (const [collectionName, documentId] of [
    ['cards', targetCard.key],
    ['cardMasterArchives', targetCard.key],
    ['cardMasterAuditLogs', 'browser-attempt'],
  ] as const) {
    const result = await firestoreDocumentRequestAsUser(
      idToken,
      'PATCH',
      collectionName,
      documentId,
      { forbidden: true },
    );
    expect(result.status).toBe(403);
  }
});
