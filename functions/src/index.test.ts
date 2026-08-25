import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  captureListingEvent,
  dailyDigestOperator,
  deliverDiscordEvent,
  retryFailedDiscordEvents,
  sendDailyDigest,
} from './index.js';
import { DEFAULT_DAILY_RECIPIENT_CAP } from './dailyDigest.js';

describe('notification Function deployment contract', () => {
  it('exports every notification handler for Firebase deployment', () => {
    expect(captureListingEvent).toBeDefined();
    expect(dailyDigestOperator).toBeDefined();
    expect(deliverDiscordEvent).toBeDefined();
    expect(retryFailedDiscordEvents).toBeDefined();
    expect(sendDailyDigest).toBeDefined();
  });

  it('keeps the operator workflow behind Cloud IAM', () => {
    expect(dailyDigestOperator.__endpoint.httpsTrigger?.invoker).toEqual(['private']);
  });

  it('enables platform retries for transient Firestore event failures', () => {
    expect(captureListingEvent.__endpoint.eventTrigger?.retry).toBe(true);
    expect(deliverDiscordEvent.__endpoint.eventTrigger?.retry).toBe(true);
  });

  it('allocates nine minutes and scheduler retries to the sequential 100-recipient batch', () => {
    expect(DEFAULT_DAILY_RECIPIENT_CAP).toBe(100);
    expect(retryFailedDiscordEvents.__endpoint.timeoutSeconds).toBe(540);
    expect(retryFailedDiscordEvents.__endpoint.scheduleTrigger?.retryConfig?.retryCount).toBe(3);
    expect(sendDailyDigest.__endpoint.timeoutSeconds).toBe(540);
    expect(sendDailyDigest.__endpoint.scheduleTrigger?.retryConfig?.retryCount).toBe(3);
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

  it('documents the private operator monitoring and explicit recovery workflow', async () => {
    const setupGuide = await readFile(
      new URL('../../docs/firebase-setup.md', import.meta.url),
      'utf8',
    );

    expect(setupGuide).toContain(
      'gcloud functions add-invoker-policy-binding dailyDigestOperator',
    );
    expect(setupGuide).toContain(
      `gcloud functions call dailyDigestOperator --region=us-central1 --data='{"action":"list","limit":50}'`,
    );
    expect(setupGuide).toContain('"decision":"definitely-unsent"');
    expect(setupGuide).toContain('"decision":"sent-or-ambiguous"');
    expect(setupGuide).toContain('sending');
    expect(setupGuide).toContain('at-most-once');
  });
});
