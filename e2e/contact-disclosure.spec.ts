import { fileURLToPath } from 'node:url';

import { signInWithMockGoogle } from './support/auth';
import { activeListing, sellerProfile, testCards } from './support/fixtures';
import { listDocuments, seedListingImage, seedScenario } from './support/emulator-state';
import { expect, test } from './support/test';
import { acknowledgeWelcome } from './support/ui';

const front = fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url));

test('keeps public contact absent and reveals it only after contact-triggered active Google sign-in', async ({ page }) => {
  const image = await seedListingImage('listings/private-seller/contact/front.png', front);
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile('private-seller', 'Private Seller')],
    listings: [activeListing('private-seller', image, { id: 'contact-listing' })],
  });
  await page.goto('./');
  await acknowledgeWelcome(page);
  await page.getByRole('link', { name: /諸伏高明/ }).click();

  await expect(page).toHaveURL(/#\/listing\/contact-listing$/);
  await expect(page.getByText('Private Seller', { exact: true })).toBeVisible();
  await expect(page.getByText('e2e-line')).toHaveCount(0);
  expect(await page.content()).not.toContain('e2e-line');
  const directContactStatus = await page.evaluate(async () => (
    await fetch('http://127.0.0.1:8080/v1/projects/demo-conan-tcg-e2e/databases/(default)/documents/sellerContacts/private-seller')
  ).status);
  expect(directContactStatus).toBe(403);
  const trigger = page.getByRole('button', { name: '登入後查看聯絡方式' });
  await signInWithMockGoogle(page, {
    email: 'contact-buyer@example.test', displayName: 'Contact Buyer',
  }, trigger, page.getByRole('button', { name: '查看聯絡方式' }));
  await expect(page).toHaveURL(/#\/listing\/contact-listing$/);
  await expect(page.getByText('e2e-line')).toHaveCount(0);

  await page.getByRole('button', { name: '查看聯絡方式' }).click();
  await expect(page.getByRole('link', { name: 'LINE ID：e2e-line' }))
    .toHaveAttribute('href', 'https://line.me/ti/p/~e2e-line');
  await expect.poll(() => listDocuments('sellerContactAccessLogs')).toHaveLength(1);
  const [audit] = await listDocuments('sellerContactAccessLogs');
  expect(audit.data).toMatchObject({
    requesterUid: expect.any(String), sellerUid: 'private-seller',
    listingId: 'contact-listing', outcome: 'revealed',
  });
  expect(audit.data).not.toHaveProperty('contactValue');
});

test('renders text and personal-profile link semantics only after each protected reveal', async ({ page }) => {
  const image = await seedListingImage('listings/contacts/shared/front.png', front);
  const createdAt = new Date('2026-08-27T00:00:00.000Z');
  await seedScenario({
    cards: testCards,
    sellerProfiles: [
      { uid: 'discord-seller', displayName: 'Discord Seller', contactType: 'discord', contactValue: 'discord.name', createdAt, updatedAt: createdAt },
      { uid: 'facebook-seller', displayName: 'Facebook Seller', contactType: 'facebook', contactValue: 'https://www.facebook.com/conan.seller', createdAt, updatedAt: createdAt },
      { uid: 'threads-seller', displayName: 'Threads Seller', contactType: 'threads', contactValue: 'https://www.threads.net/@conan.seller', createdAt, updatedAt: createdAt },
    ],
    listings: [
      activeListing('discord-seller', image, { id: 'discord-listing' }),
      activeListing('facebook-seller', image, { id: 'facebook-listing' }),
      activeListing('threads-seller', image, { id: 'threads-listing' }),
    ],
  });
  await page.goto('./');
  await acknowledgeWelcome(page);
  await signInWithMockGoogle(page, { email: 'contact-types@example.test', displayName: 'Contact Types' });

  for (const [id, label, href] of [
    ['discord-listing', 'Discord ID：discord.name', null],
    ['facebook-listing', 'Facebook 個人頁面', 'https://www.facebook.com/conan.seller'],
    ['threads-listing', 'Threads 個人頁面', 'https://www.threads.net/@conan.seller'],
  ]) {
    await page.goto(`#/listing/${id}`);
    await page.getByRole('button', { name: '查看聯絡方式' }).click();
    if (href) await expect(page.getByRole('link', { name: label })).toHaveAttribute('href', href);
    else {
      await expect(page.getByText(label)).toBeVisible();
      await expect(page.getByRole('link', { name: label })).toHaveCount(0);
    }
  }
});

test('a suspended account cannot trigger or recover seller contact', async ({ page }) => {
  const image = await seedListingImage('listings/suspended-contact/contact/front.png', front);
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile('suspended-contact', 'Protected Seller')],
    listings: [activeListing('suspended-contact', image, { id: 'suspended-contact-listing' })],
  });
  await page.goto('./');
  await acknowledgeWelcome(page);
  const identity = await signInWithMockGoogle(page, {
    email: 'suspended-contact-viewer@example.test', displayName: 'Suspended Contact Viewer',
  });
  await seedScenario({
    accountAccess: [{
      uid: identity.uid, status: 'suspended', confirmedViolationCount: 1,
      suspensionReason: 'Contact access suspended', suspendedAt: new Date(),
      suspendedBy: 'admin-e2e', suspensionActionId: 'a'.repeat(64), updatedAt: new Date(),
    }],
  });
  await page.goto('#/listing/suspended-contact-listing');

  await expect(page.getByText('帳號目前已停權，無法查看聯絡方式。')).toBeVisible();
  await expect(page.getByRole('button', { name: /查看聯絡方式/ })).toHaveCount(0);
  await expect(page.getByText('e2e-line')).toHaveCount(0);
});
