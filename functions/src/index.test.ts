import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as deployedFunctions from './index.js';
import { DEFAULT_DAILY_RECIPIENT_CAP } from './dailyDigest.js';

const { captureListingEvent, dailyDigestOperator, sendDailyDigest } = deployedFunctions;

const functionsPackage = JSON.parse(await readFile(
  new URL('../package.json', import.meta.url),
  'utf8',
)) as { engines?: { node?: string } };

describe('notification Function deployment contract', () => {
  it('deploys only email notification handlers while Discord is disabled', () => {
    expect(Object.keys(deployedFunctions).sort()).toStrictEqual([
      'captureListingEvent',
      'dailyDigestOperator',
      'sendDailyDigest',
    ]);
  });

  it('targets the supported Node.js 22 Functions runtime', () => {
    expect(functionsPackage.engines?.node).toBe('22');
  });

  it('keeps the operator workflow behind Cloud IAM', () => {
    expect(dailyDigestOperator.__endpoint.httpsTrigger?.invoker).toEqual(['private']);
  });

  it('enables platform retries for transient Firestore event failures', () => {
    expect(captureListingEvent.__endpoint.eventTrigger?.retry).toBe(true);
  });

  it('allocates nine minutes and scheduler retries to the sequential 100-recipient batch', () => {
    expect(DEFAULT_DAILY_RECIPIENT_CAP).toBe(100);
    expect(sendDailyDigest.__endpoint.timeoutSeconds).toBe(540);
    expect(sendDailyDigest.__endpoint.scheduleTrigger?.retryConfig?.retryCount).toBe(3);
  });

  it('documents an exact Firebase CLI command for every required email secret', async () => {
    const setupGuide = await readFile(
      new URL('../../docs/firebase-setup.md', import.meta.url),
      'utf8',
    );
    const setupGuideLines = setupGuide.split(/\r?\n/);

    const secretCommands = [
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
    expect(setupGuideLines).toContain(
      'firebase deploy --only firestore --project conantcgmarket',
    );
    expect(setupGuideLines).toContain(
      'firebase deploy --only functions --project conantcgmarket',
    );
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

  it('documents the complete card-name matching and no-match delivery contract', async () => {
    const setupGuide = await readFile(
      new URL('../../docs/firebase-setup.md', import.meta.url),
      'utf8',
    );

    expect(setupGuide).toContain('Node.js 22');
    expect(setupGuide).toContain('cardNames');
    expect(setupGuide).toContain('raw substring');
    expect(setupGuide).toContain('case-sensitive');
    expect(setupGuide).toContain('all card types, IDs, and rarities');
    expect(setupGuide).toContain('no matching new Listings');
  });

  it('documents the fixed release order and non-invasive deployment verification', async () => {
    const setupGuide = await readFile(
      new URL('../../docs/firebase-setup.md', import.meta.url),
      'utf8',
    );

    expect(setupGuide).toContain(
      'Rules first, Functions second, and frontend third',
    );
    expect(setupGuide).toContain('explicit operator approval');
    expect(setupGuide).toContain('no production Listing');
    expect(setupGuide).toContain('no live email');
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
