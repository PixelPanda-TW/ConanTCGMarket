import { readFile } from 'node:fs/promises';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { describe, expect, it, vi } from 'vitest';
import * as deployedFunctions from './index.js';
import { cardMasterKey, normalizeAdminCard } from './adminCardMaster.js';
import { DEFAULT_DAILY_RECIPIENT_CAP } from './dailyDigest.js';

const {
  addCardMasterEntry,
  captureListingEvent,
  cleanupExpiredReportDrafts,
  createModerationReportDraft,
  dailyDigestOperator,
  disableCardMasterEntry,
  editCardMasterEntry,
  getOwnSellerProfile,
  getSellerContact,
  listCardMasterArchives,
  mergeCardMasterEntries,
  recordListingSale,
  saveSellerProfile,
  sendDailyDigest,
  submitModerationReport,
  updateSellerListing,
  deleteUnsoldListing,
} = deployedFunctions;

const functionsPackage = JSON.parse(await readFile(
  new URL('../package.json', import.meta.url),
  'utf8',
)) as { engines?: { node?: string } };

describe('notification Function deployment contract', () => {
  it('deploys only approved notification and protected seller-profile handlers', () => {
    expect(Object.keys(deployedFunctions).sort()).toStrictEqual([
      'addCardMasterEntry',
      'captureListingEvent',
      'cleanupExpiredReportDrafts',
      'createModerationReportDraft',
      'dailyDigestOperator',
      'deleteUnsoldListing',
      'disableCardMasterEntry',
      'editCardMasterEntry',
      'getOwnSellerProfile',
      'getSellerContact',
      'listCardMasterArchives',
      'mergeCardMasterEntries',
      'recordListingSale',
      'saveSellerProfile',
      'sendDailyDigest',
      'submitModerationReport',
      'updateSellerListing',
    ]);
  });

  it('exposes all Card Master Admin operations only as callable handlers', () => {
    for (const callable of [
      listCardMasterArchives,
      addCardMasterEntry,
      editCardMasterEntry,
      disableCardMasterEntry,
      mergeCardMasterEntries,
    ]) {
      expect(callable.__endpoint.callableTrigger).toEqual({});
      expect(callable.__endpoint.invoker).toBeUndefined();
      expect(callable.__endpoint.httpsTrigger).toBeUndefined();
    }
  });

  it('passes the exact admin custom claim into every Card Master handler', async () => {
    for (const callable of [
      listCardMasterArchives,
      addCardMasterEntry,
      editCardMasterEntry,
      disableCardMasterEntry,
      mergeCardMasterEntries,
    ]) {
      await expect(callable.run({
        auth: { uid: 'admin-1', token: { admin: 'true' } },
        data: {},
      } as never)).rejects.toMatchObject({ code: 'permission-denied' });
    }
  });

  it('preserves domain errors and sanitizes unexpected Admin SDK failures', async () => {
    await expect(addCardMasterEntry.run({
      auth: { uid: 'admin-1', token: { admin: true } },
      data: {},
    } as never)).rejects.toMatchObject({ code: 'invalid-argument' });

    const transaction = vi.spyOn(getFirestore(), 'runTransaction')
      .mockRejectedValueOnce(new Error('must not expose rationale=secret'));
    const failure = addCardMasterEntry.run({
      auth: { uid: 'admin-1', token: { admin: true } },
      data: {
        cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南',
        rarities: ['P'], rationale: 'secret',
      },
    } as never);
    await expect(failure).rejects.toMatchObject({
      code: 'unavailable', message: '服務目前無法使用，請稍後再試。',
    });
    transaction.mockRestore();
  });

  it('adapts a successful Card Master mutation to one exact Admin transaction', async () => {
    const canonical = normalizeAdminCard({
      cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'],
    });
    const key = cardMasterKey(canonical);
    const writes: Array<{ operation: string; path: string; data?: Record<string, unknown> }> = [];
    const reads: string[] = [];
    const fakeTransaction = {
      async get(reference: { path: string }) {
        reads.push(reference.path);
        if (reference.path === 'accountAccess/admin-1') {
          return {
            exists: true,
            data: () => ({
              status: 'active', confirmedViolationCount: 0,
              updatedAt: Timestamp.fromDate(new Date('2026-09-01T00:00:00Z')),
            }),
          };
        }
        return { exists: false, data: () => undefined };
      },
      set(reference: { path: string }, data: Record<string, unknown>) {
        writes.push({ operation: 'set', path: reference.path, data });
      },
      create(reference: { path: string }, data: Record<string, unknown>) {
        writes.push({ operation: 'create', path: reference.path, data });
      },
      delete(reference: { path: string }) {
        writes.push({ operation: 'delete', path: reference.path });
      },
    };
    const transaction = vi.spyOn(getFirestore(), 'runTransaction')
      .mockImplementationOnce(async (operation) => operation(fakeTransaction as never));

    await expect(addCardMasterEntry.run({
      auth: { uid: 'admin-1', token: { admin: true } },
      data: { ...canonical, rationale: '新增正式資料' },
    } as never)).resolves.toMatchObject({ card: { key, ...canonical } });

    expect(reads).toEqual([
      'accountAccess/admin-1',
      `cards/${key}`,
      `cardMasterArchives/${key}`,
    ]);
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual({ operation: 'set', path: `cards/${key}`, data: canonical });
    expect(writes[1]).toMatchObject({
      operation: 'create',
      path: expect.stringMatching(/^cardMasterAuditLogs\//u),
      data: { action: 'add', actedBy: 'admin-1', rationale: '新增正式資料' },
    });
    expect(writes[1].data?.actedAt).toBeInstanceOf(Timestamp);
    transaction.mockRestore();
  });

  it('keeps Card Master reads and writes in bounded Admin SDK operations', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain("firestore.collection('cardMasterArchives')");
    expect(source).toContain("firestore.collection('cardMasterAuditLogs')");
    expect(source).toContain("orderBy('actedAt', 'desc')");
    expect(source).toContain('orderBy(FieldPath.documentId())');
    expect(source).toContain('.limit(limit)');
    expect(source).toContain('request.auth?.token.admin');
    expect(source).not.toMatch(/logError\([^\n]*(request\.data|rationale|before|after)/u);
  });

  it('exposes trusted listing lifecycle operations only as callable handlers', () => {
    for (const callable of [recordListingSale, updateSellerListing, deleteUnsoldListing]) {
      expect(callable.__endpoint.callableTrigger).toEqual({});
      expect(callable.__endpoint.invoker).toBeUndefined();
      expect(callable.__endpoint.httpsTrigger).toBeUndefined();
    }
  });

  it('exposes report creation/submission only as callables and cleanup only as a schedule', () => {
    for (const callable of [createModerationReportDraft, submitModerationReport]) {
      expect(callable.__endpoint.callableTrigger).toEqual({});
      expect(callable.__endpoint.invoker).toBeUndefined();
      expect(callable.__endpoint.httpsTrigger).toBeUndefined();
    }
    expect(cleanupExpiredReportDrafts.__endpoint.callableTrigger).toBeUndefined();
    expect(cleanupExpiredReportDrafts.__endpoint.httpsTrigger).toBeUndefined();
    expect(cleanupExpiredReportDrafts.__endpoint.scheduleTrigger?.schedule).toBe('30 3 * * *');
    expect(cleanupExpiredReportDrafts.__endpoint.scheduleTrigger?.timeZone).toBe('Asia/Taipei');
    expect(cleanupExpiredReportDrafts.__endpoint.scheduleTrigger?.retryConfig?.retryCount).toBe(3);
  });

  it('preserves sanitized report domain errors at callable boundaries', async () => {
    await expect(createModerationReportDraft.run({
      auth: undefined,
      data: { requestId: '550e8400-e29b-41d4-a716-446655440000', listingId: 'listing-1' },
    } as never)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(submitModerationReport.run({
      auth: undefined,
      data: { reportId: 'report-1', category: 'other', description: '說明', evidencePaths: [] },
    } as never)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('keeps report data in bounded Admin transactions and server-side Storage operations', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toContain("firestore.collection('moderationReports')");
    expect(source).toContain("firestore.collection('moderationReportRequestKeys')");
    expect(source).toContain("firestore.collection('moderationReportLimits')");
    expect(source).toContain("firestore.collection('accountAccess')");
    expect(source).toContain("firestore.collection('listings')");
    expect(source).toContain('.getMetadata()');
    expect(source).toContain('.delete()');
    expect(source).toContain("where('status', '==', 'draft')");
    expect(source).toContain("where('expiresAt', '<=', before)");
    expect(source).toContain('.limit(limit)');
    expect(source).not.toMatch(/log(?:Error|Info)\([^\n]*(description|evidencePaths|request\.data|metadata)/u);
  });

  it('adapts report draft creation to exact private documents and an ISO receipt', async () => {
    const writes: Array<{ operation: string; path: string; data: Record<string, unknown> }> = [];
    const fakeTransaction = {
      async get(reference: { path: string }) {
        if (reference.path === 'listings/listing-1') {
          return { exists: true, data: () => ({
            status: 'active', sellerId: 'seller-1', cardType: 'character',
            cardName: '諸伏高明', cardId: '0501', rarity: 'D', listingPrice: 500,
            createdAt: Timestamp.fromDate(new Date('2026-09-01T00:00:00Z')),
            contactValue: 'must-not-copy', imageUrls: ['https://example.test/card.jpg'],
          }) };
        }
        return { exists: false, data: () => undefined };
      },
      create(reference: { path: string }, data: Record<string, unknown>) {
        writes.push({ operation: 'create', path: reference.path, data });
      },
      set(reference: { path: string }, data: Record<string, unknown>) {
        writes.push({ operation: 'set', path: reference.path, data });
      },
    };
    const transaction = vi.spyOn(getFirestore(), 'runTransaction')
      .mockImplementationOnce(async (operation) => operation(fakeTransaction as never));

    const result = await createModerationReportDraft.run({
      auth: { uid: 'buyer-1', token: {} },
      data: { requestId: '550e8400-e29b-41d4-a716-446655440000', listingId: 'listing-1' },
    } as never);

    expect(result.reportId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(new Date(result.expiresAt).toISOString()).toBe(result.expiresAt);
    expect(writes).toHaveLength(3);
    expect(writes[0].path).toBe(`moderationReports/${result.reportId}`);
    expect(writes[1].path).toMatch(/^moderationReportRequestKeys\/[0-9a-f]{64}$/u);
    expect(writes[2].path).toMatch(/^moderationReportLimits\/buyer-1_\d{4}-\d{2}-\d{2}$/u);
    expect(JSON.stringify(writes)).not.toMatch(/must-not-copy|contactValue|imageUrls/iu);
    transaction.mockRestore();
  });

  it('reads Storage metadata server-side and persists only its safe projection', async () => {
    const current = new Date();
    const report = {
      status: 'draft', requestKey: 'a'.repeat(64), reporterId: 'buyer-1',
      targetSellerId: 'seller-1',
      listingSnapshot: {
        listingId: 'listing-1', cardType: 'character', cardName: '諸伏高明',
        cardId: '0501', rarity: 'D', listingPrice: 500,
        createdAt: Timestamp.fromDate(new Date('2026-09-01T00:00:00Z')),
      },
      createdAt: Timestamp.fromDate(new Date(current.valueOf() - 60_000)),
      expiresAt: Timestamp.fromDate(new Date(current.valueOf() + 60_000)),
    };
    const writes: Record<string, unknown>[] = [];
    const fakeTransaction = {
      async get(reference: { path: string }) {
        if (reference.path === 'moderationReports/report-1') {
          return { exists: true, data: () => report };
        }
        return { exists: false, data: () => undefined };
      },
      set(_reference: unknown, data: Record<string, unknown>) { writes.push(data); },
    };
    const transaction = vi.spyOn(getFirestore(), 'runTransaction')
      .mockImplementation(async (operation) => operation(fakeTransaction as never));
    const getMetadata = vi.fn(async () => [{
      contentType: 'image/png', size: '100', generation: '123', md5Hash: 'abc=',
      downloadTokens: 'must-not-copy',
    }]);
    const bucket = vi.spyOn(getStorage(), 'bucket').mockReturnValue({
      file: () => ({ getMetadata }),
    } as never);

    await expect(submitModerationReport.run({
      auth: { uid: 'buyer-1', token: {} },
      data: {
        reportId: 'report-1', category: 'other', description: '說明',
        evidencePaths: ['reportEvidence/buyer-1/report-1/0'],
      },
    } as never)).resolves.toEqual({ reportId: 'report-1' });
    expect(getMetadata).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
    expect(writes[0].evidence).toEqual([{
      path: 'reportEvidence/buyer-1/report-1/0', contentType: 'image/png',
      size: 100, generation: '123', md5Hash: 'abc=',
    }]);
    expect(JSON.stringify(writes)).not.toMatch(/must-not-copy|downloadTokens/iu);
    bucket.mockRestore();
    transaction.mockRestore();
  });

  it('adapts lifecycle mutations to bounded Admin transactions without logging payloads', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain("firestore.collection('sales').where('listingId', '==', id).limit(1)");
    expect(source).toContain('transaction.create');
    expect(source).toContain('transaction.delete');
    expect(source).toContain('FieldValue.delete()');
    expect(source).not.toMatch(/logError\([^\n]*(request\.data|imageUrls|soldUnitPrice)/u);
  });

  it('exposes seller profile operations as callable handlers without public invoker overrides', () => {
    for (const callable of [saveSellerProfile, getOwnSellerProfile, getSellerContact]) {
      expect(callable.__endpoint.callableTrigger).toEqual({});
      expect(callable.__endpoint.invoker).toBeUndefined();
      expect(callable.__endpoint.httpsTrigger).toBeUndefined();
    }
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

  it('passes legacy and new seller subscription shapes to strict digest parsing unchanged', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    const adapterStart = source.indexOf('async listEmailDailyEnabled(afterUid, limit)');
    const adapterEnd = source.indexOf('\n  events:', adapterStart);
    const adapter = source.slice(adapterStart, adapterEnd);

    expect(adapter).toContain('sellerSubscriptions: data.sellerSubscriptions');
    expect(adapter).not.toContain('sellerSubscriptions: []');
    expect(adapter).not.toContain('sellerSubscriptions.toDate');
    expect(adapter).not.toMatch(/contact|profile|displayName|email\s*:/u);
    expect(adapter).toContain("where('emailDailyEnabled', '==', true)");
    expect(adapter).toContain('.limit(limit)');
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

  it('documents seller-follow compatibility, privacy, and release operations', async () => {
    const [setupGuide, integrationGuide, milestones] = await Promise.all([
      readFile(new URL('../../docs/firebase-setup.md', import.meta.url), 'utf8'),
      readFile(new URL('../../docs/integration-testing.md', import.meta.url), 'utf8'),
      readFile(new URL('../../docs/milestones.md', import.meta.url), 'utf8'),
    ]);

    for (const phrase of [
      'daily digest only',
      'no immediate seller notification',
      'Seller UID is identity',
      'display name is presentation',
      'followedAt',
      'pre-follow Listings never replay',
      'legacy card-name-only documents',
      'Legacy Listing events without `sellerId`',
      'no migration',
      'Functions → Rules → frontend',
      'must not create a production follow',
      'must not send a production email',
      'rollback',
      'monitor',
    ]) {
      expect(setupGuide).toContain(phrase);
    }
    expect(setupGuide).toContain(
      'Contact data never enters subscriptions, Listing events, or digest email.',
    );
    expect(integrationGuide).toContain('pre-follow exclusion');
    expect(integrationGuide).toContain('dual card-and-seller match deduplication');
    expect(integrationGuide).toContain('no production follow, Listing, email, or data mutation');
    expect(milestones).toContain(
      'Seller subscriptions are repository-ready, not production-live',
    );
  });

  it('documents the fixed release order and non-invasive deployment verification', async () => {
    const setupGuide = await readFile(
      new URL('../../docs/firebase-setup.md', import.meta.url),
      'utf8',
    );

    expect(setupGuide).toContain('Functions → Rules → frontend');
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

  it('documents the secure contact split rollout, limits, and non-invasive verification', async () => {
    const setupGuide = await readFile(
      new URL('../../docs/firebase-setup.md', import.meta.url),
      'utf8',
    );
    const lines = setupGuide.split(/\r?\n/);

    expect(lines).toContain('npm run migrate:seller-contacts -- --project conantcgmarket');
    expect(lines).toContain(
      'npm run migrate:seller-contacts -- --project conantcgmarket --backup ./backups/seller-contacts-YYYYMMDD.json --apply',
    );
    expect(setupGuide).toContain('Functions → migration → Rules → frontend');
    expect(setupGuide).toContain('60 reveals per requester per UTC hour');
    expect(setupGuide).toContain('300 reveals per seller per UTC hour');
    for (const collection of [
      'sellerContacts',
      'sellerContactAccessLogs',
      'sellerContactRequesterLimits',
      'sellerContactSellerLimits',
    ]) {
      expect(setupGuide).toContain(collection);
    }
    expect(setupGuide).toContain('does not authorize migration `--apply`');
    expect(setupGuide).toContain('must not reveal a real seller contact');
  });

  it('documents the trusted Listing lifecycle and separately authorized Sale rollout', async () => {
    const setupGuide = await readFile(
      new URL('../../docs/firebase-setup.md', import.meta.url),
      'utf8',
    );
    const milestones = await readFile(
      new URL('../../docs/milestones.md', import.meta.url),
      'utf8',
    );
    const lines = setupGuide.split(/\r?\n/);

    for (const callable of ['recordListingSale', 'updateSellerListing', 'deleteUnsoldListing']) {
      expect(setupGuide).toContain(callable);
    }
    expect(lines).toContain('npm run migrate:sale-snapshots -- --project conantcgmarket');
    expect(lines).toContain(
      'npm run migrate:sale-snapshots -- --project conantcgmarket --backup ./backups/sale-snapshots-YYYYMMDD.json --apply',
    );
    expect(setupGuide).toContain(
      'Functions → separately approved Sale audit/backfill → Rules → frontend',
    );
    expect(setupGuide).toContain('Legacy Sales remain readable');
    expect(setupGuide).toContain('does not authorize Sale migration `--apply`');
    expect(setupGuide).toContain('creates no production Listing or Sale');
    expect(setupGuide).toContain('rollback');
    expect(setupGuide).toContain('monitor');
    expect(milestones).toContain('repository-ready, not production-live');
  });

  it('documents the Card Master admin claim boundary and release runbook', async () => {
    const [setupGuide, importGuide, milestones] = await Promise.all([
      readFile(new URL('../../docs/firebase-setup.md', import.meta.url), 'utf8'),
      readFile(new URL('../../docs/card-master-import.md', import.meta.url), 'utf8'),
      readFile(new URL('../../docs/milestones.md', import.meta.url), 'utf8'),
    ]);

    for (const callable of [
      'listCardMasterArchives',
      'addCardMasterEntry',
      'editCardMasterEntry',
      'mergeCardMasterEntries',
      'disableCardMasterEntry',
    ]) {
      expect(setupGuide).toContain(callable);
    }
    for (const collection of ['cards', 'cardMasterArchives', 'cardMasterAuditLogs']) {
      expect(setupGuide).toContain(collection);
    }
    expect(setupGuide).toContain('admin === true');
    expect(setupGuide).toContain('Functions → Rules → frontend');
    expect(setupGuide).toContain('demo Emulator');
    expect(setupGuide).toContain('must not add, edit, merge, or disable a production Card');
    expect(setupGuide).toContain('prohibited until separate explicit approval');
    expect(setupGuide).toContain('rollback');
    expect(setupGuide).toContain('permission-denied');
    expect(setupGuide).toContain('aborted');
    expect(importGuide).toContain('archive suppression');
    expect(milestones).toContain('Card Master admin workflow is repository-ready, not production-live');
  });

  it('documents moderation report limits, privacy, cleanup, and release operations', async () => {
    const [setupGuide, integrationGuide, milestones] = await Promise.all([
      readFile(new URL('../../docs/firebase-setup.md', import.meta.url), 'utf8'),
      readFile(new URL('../../docs/integration-testing.md', import.meta.url), 'utf8'),
      readFile(new URL('../../docs/milestones.md', import.meta.url), 'utf8'),
    ]);

    for (const phrase of [
      '10 reports per reporter per UTC day',
      '24-hour draft expiry',
      '0–3 evidence images',
      '5 MiB per image',
      'reportEvidence/{reporterId}/{reportId}/{slot}',
      'idempotent',
      'no reporter email',
      'no migration',
      'Functions → Rules → frontend',
      'must not create a production report',
      'must not upload production evidence',
      'rollback',
      'monitor',
    ]) {
      expect(setupGuide).toContain(phrase);
    }
    expect(integrationGuide).toContain('ten moderation-report acceptance criteria');
    expect(integrationGuide).toContain(
      'no production report, evidence, email, cleanup, or data mutation',
    );
    expect(milestones).toContain(
      'Moderation reports are repository-ready, not production-live',
    );
  });
});
