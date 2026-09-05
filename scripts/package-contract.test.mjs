import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const rootUrl = new URL('../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, rootUrl), 'utf8'));
const root = await readJson('package.json');

test('pins local E2E tools and exposes the approved commands', async () => {
  const commands = {
    'test:scripts': 'node --test scripts/*.test.mjs',
    'build:e2e': 'tsc -b && vite build --mode e2e',
    'test:quality': 'npm test && npm run test:scripts && npm run test:functions && npm --prefix functions run lint && npm run build:functions && npm run build:e2e',
    'test:e2e': 'npm run build:functions && firebase emulators:exec --project demo-conan-tcg-e2e --only auth,firestore,storage,functions "playwright test --config playwright.config.ts"',
    'test:e2e:chromium': 'npm run build:functions && firebase emulators:exec --project demo-conan-tcg-e2e --only auth,firestore,storage,functions "playwright test --config playwright.config.ts --project chromium"',
    'test:e2e:webkit': 'npm run build:functions && firebase emulators:exec --project demo-conan-tcg-e2e --only auth,firestore,storage,functions "playwright test --config playwright.config.ts --project webkit-iphone"',
    'test:smoke': 'node scripts/run-smoke.mjs',
    'migrate:seller-contacts': 'node scripts/migrate-seller-contacts.mjs',
    'migrate:sale-snapshots': 'node scripts/migrate-sale-snapshots.mjs',
  };

  assert.deepEqual(Object.fromEntries(Object.keys(commands).map((name) => [name, root.scripts[name]])), commands);
  assert.ok(root.devDependencies['@playwright/test']);
  assert.ok(root.devDependencies['firebase-tools']);

  const lock = await readJson('package-lock.json');
  assert.equal(lock.packages[''].devDependencies['@playwright/test'], root.devDependencies['@playwright/test']);
  assert.equal(lock.packages[''].devDependencies['firebase-tools'], root.devDependencies['firebase-tools']);
  assert.match(lock.packages['node_modules/@playwright/test'].version, /^\d+\.\d+\.\d+$/);
  assert.match(lock.packages['node_modules/firebase-tools'].version, /^\d+\.\d+\.\d+$/);

  const functionsLock = await readJson('functions/package-lock.json');
  assert.equal(functionsLock.name, 'conan-tcg-market-functions');
  await Promise.all(['firebase', 'playwright'].map((binary) => (
    access(new URL(`node_modules/.bin/${binary}`, rootUrl), constants.X_OK)
  )));
});

test('keeps the Sale snapshot command dry-run by default and documents its apply gate', async () => {
  const [source, guide] = await Promise.all([
    readFile(new URL('scripts/migrate-sale-snapshots.mjs', rootUrl), 'utf8'),
    readFile(new URL('docs/firebase-setup.md', rootUrl), 'utf8'),
  ]);
  expectNoImplicitApply(source);
  assert.match(source, /options\.apply === true/u);
  assert.match(source, /Backup path already exists/u);
  assert.match(source, /Sale snapshot verification failed/u);
  assert.match(guide, /separate[^\n]+approval/iu);
});

test('documents Card Master as an internal admin-managed database with guarded operations', async () => {
  const [setupGuide, importGuide, milestones] = await Promise.all([
    readFile(new URL('docs/firebase-setup.md', rootUrl), 'utf8'),
    readFile(new URL('docs/card-master-import.md', rootUrl), 'utf8'),
    readFile(new URL('docs/milestones.md', rootUrl), 'utf8'),
  ]);

  assert.match(setupGuide, /#\/admin\/cards/u);
  assert.match(setupGuide, /no\s+standalone public Card Master page/iu);
  assert.match(setupGuide, /server-only\s+collection `cardMasterArchives`/iu);
  assert.match(setupGuide, /server-only\s+collection `cardMasterAuditLogs`/iu);
  assert.match(setupGuide, /claim inspection/iu);
  assert.match(setupGuide, /claim assignment/iu);
  assert.doesNotMatch(setupGuide, /admin@example|["']admin-\d+["']/iu);
  assert.match(importGuide, /disabled[^\n]+superseded[^\n]+merged/iu);
  assert.match(importGuide, /active `cards` records/iu);
  assert.match(milestones, /repository-ready, not production-live/iu);
});

test('documents the seller subscription compatibility and production safety contract', async () => {
  const [setupGuide, integrationGuide, milestones] = await Promise.all([
    readFile(new URL('docs/firebase-setup.md', rootUrl), 'utf8'),
    readFile(new URL('docs/integration-testing.md', rootUrl), 'utf8'),
    readFile(new URL('docs/milestones.md', rootUrl), 'utf8'),
  ]);

  assert.match(setupGuide, /daily digest only/iu);
  assert.match(setupGuide, /no immediate seller notification/iu);
  assert.match(setupGuide, /Seller UID is identity/iu);
  assert.match(setupGuide, /display name is presentation/iu);
  assert.match(setupGuide, /followedAt[\s\S]+pre-follow Listings never replay/iu);
  assert.match(setupGuide, /legacy card-name-only documents/iu);
  assert.match(setupGuide, /legacy Listing events without `sellerId`/iu);
  assert.match(setupGuide, /no migration/iu);
  assert.match(setupGuide, /Functions → Rules → frontend/u);
  assert.match(setupGuide, /must not create a production follow/iu);
  assert.match(setupGuide, /must not send a production email/iu);
  assert.match(setupGuide, /Contact data never enters subscriptions, Listing events, or digest email\./u);
  assert.match(setupGuide, /monitor/iu);
  assert.match(setupGuide, /rollback/iu);
  assert.match(integrationGuide, /pre-follow exclusion/iu);
  assert.match(integrationGuide, /dual card-and-seller match deduplication/iu);
  assert.match(integrationGuide, /no production follow, Listing, email, or data mutation/iu);
  assert.match(milestones, /Seller subscriptions are repository-ready, not production-live/iu);
});

test('documents the private moderation report lifecycle and production safety contract', async () => {
  const [setupGuide, integrationGuide, milestones] = await Promise.all([
    readFile(new URL('docs/firebase-setup.md', rootUrl), 'utf8'),
    readFile(new URL('docs/integration-testing.md', rootUrl), 'utf8'),
    readFile(new URL('docs/milestones.md', rootUrl), 'utf8'),
  ]);

  assert.match(setupGuide, /10 reports per reporter per UTC day/iu);
  assert.match(setupGuide, /24-hour draft expiry/iu);
  assert.match(setupGuide, /0–3 evidence images/iu);
  assert.match(setupGuide, /5 MiB per image/iu);
  assert.match(setupGuide, /moderationReports[\s\S]+server-only/iu);
  assert.match(setupGuide, /reportEvidence\/\{reporterId\}\/\{reportId\}\/\{slot\}/u);
  assert.match(setupGuide, /idempotent/iu);
  assert.match(setupGuide, /no reporter email/iu);
  assert.match(setupGuide, /no migration/iu);
  assert.match(setupGuide, /Functions → Rules → frontend/u);
  assert.match(setupGuide, /must not create a production report/iu);
  assert.match(setupGuide, /must not upload production evidence/iu);
  assert.match(setupGuide, /monitor/iu);
  assert.match(setupGuide, /rollback/iu);
  assert.match(integrationGuide, /ten moderation-report acceptance criteria/iu);
  assert.match(integrationGuide, /no production report, evidence, email, cleanup, or data mutation/iu);
  assert.match(milestones, /Moderation reports are repository-ready, not production-live/iu);
});

test('documents the private admin moderation workflow and production safety contract', async () => {
  const [setupGuide, integrationGuide, milestones] = await Promise.all([
    readFile(new URL('docs/firebase-setup.md', rootUrl), 'utf8'),
    readFile(new URL('docs/integration-testing.md', rootUrl), 'utf8'),
    readFile(new URL('docs/milestones.md', rootUrl), 'utf8'),
  ]);

  assert.match(setupGuide, /active account[\s\S]+exact `admin === true` custom claim/iu);
  assert.match(setupGuide, /private queue, case detail, and generation-pinned evidence/iu);
  assert.match(setupGuide, /decisions are immutable and idempotent/iu);
  assert.match(setupGuide, /confirmed decisions atomically increment/iu);
  assert.match(setupGuide, /does not automatically suspend/iu);
  assert.match(setupGuide, /no moderator email/iu);
  assert.match(setupGuide, /no migration/iu);
  assert.match(setupGuide, /Functions → indexes → Rules → frontend/u);
  assert.match(setupGuide, /must not read a production report/iu);
  assert.match(setupGuide, /must not download production evidence/iu);
  assert.match(setupGuide, /must not decide a production case/iu);
  assert.match(setupGuide, /must not change a production violation count/iu);
  assert.match(setupGuide, /monitor/iu);
  assert.match(setupGuide, /rollback/iu);
  assert.match(integrationGuide, /ten admin-moderation acceptance criteria/iu);
  assert.match(
    integrationGuide,
    /no production report read, evidence download, decision, violation-count change, email, or data mutation/iu,
  );
  assert.match(
    milestones,
    /Moderation review is repository-ready, not production-live/iu,
  );
});

test('documents the account moderation release and rollback contract', async () => {
  const [setupGuide, integrationGuide, milestones] = await Promise.all([
    readFile(new URL('docs/firebase-setup.md', rootUrl), 'utf8'),
    readFile(new URL('docs/integration-testing.md', rootUrl), 'utf8'),
    readFile(new URL('docs/milestones.md', rootUrl), 'utf8'),
  ]);
  assert.match(setupGuide, /manual threshold policy/iu);
  assert.match(setupGuide, /authenticated read-only suspension/iu);
  assert.match(setupGuide, /resumable Listing hiding/iu);
  assert.match(setupGuide, /selective republish/iu);
  assert.match(setupGuide, /private immutable audit/iu);
  assert.match(setupGuide, /Functions → indexes → Rules → frontend/u);
  assert.match(setupGuide, /never deletes audit records/iu);
  assert.match(setupGuide, /never decrements violation counts/iu);
  assert.match(setupGuide, /never bulk republishes Listings/iu);
  assert.match(setupGuide, /repository-ready, not production-live/iu);
  assert.match(integrationGuide, /ten account-moderation acceptance criteria/iu);
  assert.match(
    integrationGuide,
    /no production moderation read, suspension\/restoration, Listing hide\/republish, email, deployment, or data mutation/iu,
  );
  assert.match(milestones, /Account moderation is repository-ready, not production-live/iu);
});

function expectNoImplicitApply(source) {
  assert.doesNotMatch(root.scripts['migrate:sale-snapshots'], /--apply/u);
  assert.doesNotMatch(source, /apply:\s*true/u);
  assert.doesNotMatch(source, /\.delete\(/u);
}
