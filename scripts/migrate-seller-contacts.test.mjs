import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import {
  MigrationValidationError,
  planSellerContactMigration,
  runSellerContactMigration,
} from './migrate-seller-contacts.mjs';

const createdAt = new Date('2026-08-01T00:00:00.000Z');
const updatedAt = new Date('2026-09-01T00:00:00.000Z');
const temporaryDirectories = [];

function legacyProfile(id = 'seller-1', overrides = {}) {
  return {
    id,
    data: {
      displayName: '阿明', contactType: 'line', contactValue: 'aming',
      createdAt, updatedAt, ...overrides,
    },
  };
}

function privateContact(id = 'seller-1', overrides = {}) {
  return {
    id,
    data: { contactType: 'line', contactValue: 'aming', createdAt, updatedAt, ...overrides },
  };
}

function memoryDependencies({ profiles = [legacyProfile()], contacts = [], verifyOverride } = {}) {
  const state = { profiles: structuredClone(profiles), contacts: structuredClone(contacts) };
  const events = [];
  return {
    state,
    events,
    dependencies: {
      listProfiles: async () => structuredClone(state.profiles),
      listContacts: async () => structuredClone(state.contacts),
      backupExists: async () => false,
      writeBackup: async (_path, payload) => { events.push(['backup', structuredClone(payload)]); },
      writeContactBatch: async (records) => {
        events.push(['contacts', records.map((record) => record.id)]);
        for (const record of records) {
          state.contacts = state.contacts.filter((current) => current.id !== record.id);
          state.contacts.push(structuredClone(record));
        }
      },
      readContacts: async (ids) => verifyOverride ?? structuredClone(
        state.contacts.filter((record) => ids.includes(record.id)),
      ),
      writePublicProfileBatch: async (records) => {
        events.push(['profiles', records.map((record) => record.id)]);
        for (const record of records) {
          state.profiles = state.profiles.filter((current) => current.id !== record.id);
          state.profiles.push(structuredClone(record));
        }
      },
    },
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('plans an exact private contact write followed by a contact-free public rewrite', () => {
  assert.deepEqual(planSellerContactMigration([legacyProfile()], []), {
    sourceCount: 1,
    legacyCount: 1,
    contactWrites: [privateContact()],
    publicProfileWrites: [{
      id: 'seller-1', data: { displayName: '阿明', createdAt, updatedAt },
    }],
  });
});

test('default dry-run reads and validates but performs no backup or writes', async () => {
  const { dependencies, events } = memoryDependencies();
  const result = await runSellerContactMigration({ projectId: 'demo-project' }, dependencies);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.legacyCount, 1);
  assert.deepEqual(events, []);
});

test('apply requires an explicit project and a non-existing backup path', async () => {
  const { dependencies } = memoryDependencies();
  await assert.rejects(
    runSellerContactMigration({ apply: true, backupPath: '/tmp/backup.json' }, dependencies),
    /explicit project ID/,
  );
  await assert.rejects(
    runSellerContactMigration({ apply: true, projectId: 'production' }, dependencies),
    /backup path/,
  );
  await assert.rejects(
    runSellerContactMigration({ apply: true, projectId: 'production', backupPath: '/tmp/backup.json' }, {
      ...dependencies,
      backupExists: async () => true,
    }),
    /already exists/,
  );
});

test('malformed, extra-field, and noncanonical legacy profiles abort before writes', async () => {
  for (const profile of [
    legacyProfile('missing-contact', { contactValue: undefined }),
    legacyProfile('extra', { email: 'private@example.com' }),
    legacyProfile('legacy-threads', { contactType: 'threads', contactValue: '@legacy' }),
  ]) {
    const { dependencies, events } = memoryDependencies({ profiles: [profile] });
    await assert.rejects(
      runSellerContactMigration({ projectId: 'demo-project' }, dependencies),
      MigrationValidationError,
    );
    assert.deepEqual(events, []);
  }
});

test('a matching existing contact is idempotent while a conflict aborts', () => {
  const matching = planSellerContactMigration([legacyProfile()], [privateContact()]);
  assert.deepEqual(matching.contactWrites, []);
  assert.equal(matching.publicProfileWrites.length, 1);

  assert.throws(
    () => planSellerContactMigration([legacyProfile()], [privateContact('seller-1', { contactValue: 'other' })]),
    /conflicts with legacy contact/,
  );
});

test('apply backs up all source data, writes and verifies contacts, then removes public fields', async () => {
  const { dependencies, events, state } = memoryDependencies();
  const result = await runSellerContactMigration({
    apply: true, projectId: 'production-looking-id', backupPath: '/tmp/not-written-by-memory-adapter.json',
  }, dependencies);

  assert.equal(result.mode, 'apply');
  assert.deepEqual(events.map(([event]) => event), ['backup', 'contacts', 'profiles']);
  assert.equal(events[0][1].sellerProfiles.length, 1);
  assert.equal(events[0][1].sellerContacts.length, 0);
  assert.deepEqual(state.profiles[0].data, { displayName: '阿明', createdAt, updatedAt });
  assert.deepEqual(state.contacts[0], privateContact());
});

test('verification mismatch aborts before any public profile cleanup', async () => {
  const { dependencies, events } = memoryDependencies({ verifyOverride: [] });
  await assert.rejects(runSellerContactMigration({
    apply: true, projectId: 'demo-project', backupPath: '/tmp/mismatch.json',
  }, dependencies), /verification failed/);
  assert.deepEqual(events.map(([event]) => event), ['backup', 'contacts']);
});

test('verifies a matching pre-existing Admin Timestamp contact before public cleanup', async () => {
  const timestampCreated = Timestamp.fromDate(createdAt);
  const timestampUpdated = Timestamp.fromDate(updatedAt);
  const profiles = [legacyProfile()];
  const contacts = [privateContact('seller-1', {
    createdAt: timestampCreated,
    updatedAt: timestampUpdated,
  })];
  const events = [];
  const result = await runSellerContactMigration({
    apply: true, projectId: 'demo-project', backupPath: '/tmp/existing-contact.json',
  }, {
    listProfiles: async () => profiles,
    listContacts: async () => contacts,
    backupExists: async () => false,
    writeBackup: async () => { events.push('backup'); },
    writeContactBatch: async () => { events.push('contact-write'); },
    readContacts: async () => contacts,
    writePublicProfileBatch: async () => { events.push('profile-write'); },
  });

  assert.equal(result.contactWriteCount, 0);
  assert.deepEqual(events, ['backup', 'profile-write']);
});

test('contact and public writes are split into bounded batches', async () => {
  const profiles = Array.from({ length: 805 }, (_, index) => legacyProfile(`seller-${index}`));
  const { dependencies, events } = memoryDependencies({ profiles });
  const readContacts = dependencies.readContacts;
  const verificationBatchSizes = [];
  dependencies.readContacts = async (ids) => {
    verificationBatchSizes.push(ids.length);
    return readContacts(ids);
  };
  await runSellerContactMigration({
    apply: true, projectId: 'demo-project', backupPath: '/tmp/batches.json', batchSize: 400,
  }, dependencies);
  const writeEvents = events.filter(([event]) => event === 'contacts' || event === 'profiles');
  assert.deepEqual(writeEvents.map(([, ids]) => ids.length), [400, 400, 5, 400, 400, 5]);
  assert.deepEqual(verificationBatchSizes, [400, 400, 5]);
});

test('rerunning a completed migration is a verified no-op', async () => {
  const publicOnly = [{ id: 'seller-1', data: { displayName: '阿明', createdAt, updatedAt } }];
  const { dependencies, events } = memoryDependencies({ profiles: publicOnly, contacts: [privateContact()] });
  const result = await runSellerContactMigration({
    apply: true, projectId: 'demo-project', backupPath: '/tmp/noop.json',
  }, dependencies);
  assert.equal(result.legacyCount, 0);
  assert.equal(result.contactWriteCount, 0);
  assert.equal(result.publicProfileWriteCount, 0);
  assert.deepEqual(events, []);
});

test('filesystem backup writer refuses overwrite and produces readable JSON before an apply adapter writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seller-contact-migration-'));
  temporaryDirectories.push(directory);
  const backupPath = join(directory, 'backup.json');
  const module = await import('./migrate-seller-contacts.mjs');
  await module.writeJsonBackup(backupPath, { sellerProfiles: [legacyProfile()], sellerContacts: [] });
  const parsed = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(parsed.sellerProfiles[0].id, 'seller-1');
  await assert.rejects(module.writeJsonBackup(backupPath, {}), /already exists/);
});
