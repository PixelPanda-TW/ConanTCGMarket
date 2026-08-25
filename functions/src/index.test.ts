import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  captureListingEvent,
  deliverDiscordEvent,
  retryFailedDiscordEvents,
  sendDailyDigest,
} from './index.js';

describe('notification Function deployment contract', () => {
  it('exports every notification handler for Firebase deployment', () => {
    expect(captureListingEvent).toBeDefined();
    expect(deliverDiscordEvent).toBeDefined();
    expect(retryFailedDiscordEvents).toBeDefined();
    expect(sendDailyDigest).toBeDefined();
  });

  it('documents an exact Firebase CLI command for every required secret', async () => {
    const setupGuide = await readFile(
      new URL('../../docs/firebase-setup.md', import.meta.url),
      'utf8',
    );
    const setupGuideLines = setupGuide.split(/\r?\n/);

    const secretCommands = [
      'firebase functions:secrets:set DISCORD_LISTINGS_WEBHOOK_URL',
      'firebase functions:secrets:set GMAIL_OAUTH_CLIENT_ID',
      'firebase functions:secrets:set GMAIL_OAUTH_CLIENT_SECRET',
      'firebase functions:secrets:set GMAIL_OAUTH_REFRESH_TOKEN',
      'firebase functions:secrets:set GMAIL_SENDER_ADDRESS',
    ];

    for (const command of secretCommands) {
      expect(setupGuideLines).toContain(command);
    }
  });

  it('documents billing, schedule, deployment, and pre-deployment safeguards', async () => {
    const setupGuide = await readFile(
      new URL('../../docs/firebase-setup.md', import.meta.url),
      'utf8',
    );
    const setupGuideLines = setupGuide.split(/\r?\n/);

    expect(setupGuide).toContain('Blaze');
    expect(setupGuide).toContain('Asia/Taipei');
    expect(setupGuide).toMatch(/budget alert/i);
    expect(setupGuide).toMatch(/Cloud Run Functions spend cap/i);
    expect(setupGuideLines).toContain('firebase deploy --only functions,firestore');
    expect(setupGuide).toContain('GitHub Pages deployment is web-only');

    for (const command of [
      'npm test',
      'npm run build',
      'npm run test:rules',
      'npm run test:functions',
      'npm run build:functions',
    ]) {
      expect(setupGuideLines).toContain(command);
    }
  });

  it('documents a non-production Listing check with one test subscriber', async () => {
    const setupGuide = await readFile(
      new URL('../../docs/firebase-setup.md', import.meta.url),
      'utf8',
    );

    expect(setupGuide).toContain('non-production Listing');
    expect(setupGuide).toContain('one test subscriber');
  });
});
