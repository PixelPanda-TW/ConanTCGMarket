import { expect, type Page } from '@playwright/test';
import type { ContactType } from '../../src/domain/models';

export interface SellerProfileValues {
  displayName: string;
  contactType: ContactType;
  contactValue: string;
}

export interface CardMetadataValues {
  cardType: string;
  cardName: string;
  rarity: string;
  cardId: string;
}

const contactValueLabels: Record<ContactType, string> = {
  line: 'LINE ID',
  discord: 'Discord ID',
  facebook: 'Facebook 個人頁面連結',
  threads: 'Threads 個人頁面連結',
};

export async function acknowledgeWelcome(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '網站使用與安全提醒' });
  if (await dialog.isVisible()) {
    await dialog.getByRole('button', { name: '我知道了' }).click();
  }
}

export async function createSellerProfile(
  page: Page,
  values: SellerProfileValues = {
    displayName: 'E2E 賣家',
    contactType: 'discord',
    contactValue: 'e2e-seller',
  },
): Promise<void> {
  await page.goto('#/profile');
  await page.getByLabel('顯示名稱').fill(values.displayName);
  await page.getByLabel('聯絡方式').selectOption(values.contactType);
  await page.getByLabel(contactValueLabels[values.contactType]).fill(values.contactValue);
  await page.getByRole('button', { name: '儲存個人檔案' }).click();
  await expect(page.getByRole('status')).toContainText('已儲存個人檔案');
}

export async function selectCardMetadata(
  page: Page,
  values: CardMetadataValues,
): Promise<void> {
  await page.getByLabel('卡片類型').selectOption(values.cardType);
  await page.getByLabel('卡片名稱').fill(values.cardName);
  await expect(page.getByLabel('稀有度')).toBeEnabled();
  await page.getByLabel('稀有度').selectOption(values.rarity);
  await expect(page.getByLabel('卡片 ID')).toBeEnabled();
  await page.getByLabel('卡片 ID').fill(values.cardId);
}

export async function createListingThroughUi(
  page: Page,
  imagePaths: string[],
): Promise<string> {
  await page.goto('#/sell');
  await selectCardMetadata(page, {
    cardType: 'character',
    cardName: '諸伏高明',
    rarity: 'D',
    cardId: '0501',
  });
  await page.getByLabel('商品圖片').setInputFiles(imagePaths);
  await page.getByLabel('價格').fill('500');
  await page.getByLabel('數量').fill('5');
  await page.getByLabel('包手').check();
  await page.getByLabel('包材費').fill('20');
  await page.getByLabel('支援賣貨便').check();
  await page.getByLabel('賣貨便加價').fill('10');
  await page.getByLabel('備註').fill('E2E 商品備註');
  await page.getByRole('button', { name: '建立刊登' }).click();
  await expect(page).toHaveURL(/#\/listing\/[^/]+$/);
  return new URL(page.url()).hash.split('/').at(-1)!;
}
