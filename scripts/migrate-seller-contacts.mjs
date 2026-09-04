import { open, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_BATCH_SIZE = 400;
const legacyFields = ['contactType', 'contactValue', 'createdAt', 'displayName', 'updatedAt'];
const publicFields = ['createdAt', 'displayName', 'updatedAt'];
const contactFields = ['contactType', 'contactValue', 'createdAt', 'updatedAt'];
const contactTypes = new Set(['line', 'discord', 'threads', 'facebook']);
const identifierUrlPrefix = /^(?:[a-z][a-z\d+.-]*:|www\.|line\.me(?:\/|$)|discord\.(?:com|gg)(?:\/|$))/iu;
const facebookHosts = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com']);
const threadsHosts = new Set(['threads.net', 'www.threads.net']);
const reservedFacebookPaths = new Set(['events', 'groups', 'marketplace', 'pages', 'reel', 'share', 'watch']);

export class MigrationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationValidationError';
  }
}

function exactFields(data, expected) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const fields = Object.keys(data).sort();
  return fields.length === expected.length && fields.every((field, index) => field === expected[index]);
}

function asDate(value, field, id) {
  const date = value instanceof Date ? value : value?.toDate?.();
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw new MigrationValidationError(`${id} has an invalid ${field}.`);
  }
  return date;
}

function validateId(id) {
  if (typeof id !== 'string' || id.length < 1 || id.length > 128 || id.trim() !== id) {
    throw new MigrationValidationError('A seller profile has an invalid document ID.');
  }
}

function normalizePathSegments(pathname) {
  const raw = pathname.split('/');
  if (raw.shift() !== '') return null;
  if (raw.at(-1) === '') raw.pop();
  if (raw.length === 0 || raw.some((segment) => segment.length === 0)) return null;
  try {
    const decoded = raw.map((segment) => decodeURIComponent(segment));
    return decoded.some((segment) => segment.length === 0 || /[/?#]/u.test(segment)) ? null : decoded;
  } catch {
    return null;
  }
}

function parseSecureUrl(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && hosts.has(url.hostname.toLowerCase())
      && !url.username && !url.password && !url.port && !url.hash ? url : null;
  } catch {
    return null;
  }
}

function normalizeContact(contactType, rawValue) {
  if (!contactTypes.has(contactType) || typeof rawValue !== 'string') return null;
  const value = rawValue.trim();
  if (!value) return null;
  if (contactType === 'line' || contactType === 'discord') {
    return Array.from(value).length <= 100 && !/\s/u.test(value) && !identifierUrlPrefix.test(value)
      ? value : null;
  }
  if (contactType === 'facebook') {
    const url = parseSecureUrl(value, facebookHosts);
    const segments = url ? normalizePathSegments(url.pathname) : null;
    if (!url || !segments) return null;
    if (segments.length === 1 && segments[0].toLowerCase() !== 'profile.php') {
      return !url.search && !reservedFacebookPaths.has(segments[0].toLowerCase())
        ? `https://www.facebook.com/${encodeURIComponent(segments[0])}` : null;
    }
    const query = [...url.searchParams.entries()];
    return segments.length === 1 && segments[0].toLowerCase() === 'profile.php'
      && query.length === 1 && query[0][0] === 'id' && query[0][1].trim()
      ? `https://www.facebook.com/profile.php?id=${encodeURIComponent(query[0][1].trim())}` : null;
  }
  const url = parseSecureUrl(value, threadsHosts);
  const segments = url ? normalizePathSegments(url.pathname) : null;
  if (!url || url.search || !segments || segments.length !== 1 || !segments[0].startsWith('@')) return null;
  const handle = segments[0].slice(1);
  return handle && !/\s/u.test(handle) ? `https://www.threads.net/@${encodeURIComponent(handle)}` : null;
}

function readPublic(id, data) {
  if (typeof data.displayName !== 'string' || data.displayName.length < 1
    || data.displayName.length > 80 || data.displayName.trim() !== data.displayName) {
    throw new MigrationValidationError(`${id} has an invalid displayName.`);
  }
  return {
    displayName: data.displayName,
    createdAt: asDate(data.createdAt, 'createdAt', id),
    updatedAt: asDate(data.updatedAt, 'updatedAt', id),
  };
}

function readContact(id, data) {
  const canonical = normalizeContact(data.contactType, data.contactValue);
  if (!canonical || canonical !== data.contactValue) {
    throw new MigrationValidationError(`${id} has a noncanonical seller contact.`);
  }
  return {
    contactType: data.contactType,
    contactValue: canonical,
    createdAt: asDate(data.createdAt, 'createdAt', id),
    updatedAt: asDate(data.updatedAt, 'updatedAt', id),
  };
}

function recordsById(records, label) {
  const map = new Map();
  for (const record of records) {
    validateId(record.id);
    if (map.has(record.id)) throw new MigrationValidationError(`Duplicate ${label} ${record.id}.`);
    map.set(record.id, record.data);
  }
  return map;
}

export function planSellerContactMigration(profiles, contacts) {
  const contactMap = recordsById(contacts, 'seller contact');
  const profileIds = new Set();
  const contactWrites = [];
  const publicProfileWrites = [];
  let legacyCount = 0;

  for (const record of profiles) {
    validateId(record.id);
    if (profileIds.has(record.id)) throw new MigrationValidationError(`Duplicate seller profile ${record.id}.`);
    profileIds.add(record.id);
    const existingRawContact = contactMap.get(record.id);
    const existingContact = existingRawContact === undefined ? null : (() => {
      if (!exactFields(existingRawContact, contactFields)) {
        throw new MigrationValidationError(`${record.id} has a malformed existing private contact.`);
      }
      return readContact(record.id, existingRawContact);
    })();

    if (exactFields(record.data, legacyFields)) {
      legacyCount += 1;
      const publicData = readPublic(record.id, record.data);
      const legacyContact = readContact(record.id, record.data);
      if (existingContact && (existingContact.contactType !== legacyContact.contactType
        || existingContact.contactValue !== legacyContact.contactValue)) {
        throw new MigrationValidationError(`${record.id} existing private contact conflicts with legacy contact.`);
      }
      if (!existingContact) contactWrites.push({ id: record.id, data: legacyContact });
      publicProfileWrites.push({ id: record.id, data: publicData });
      continue;
    }

    if (exactFields(record.data, publicFields)) {
      readPublic(record.id, record.data);
      if (!existingContact) {
        throw new MigrationValidationError(`${record.id} is public-only but has no private contact.`);
      }
      continue;
    }
    throw new MigrationValidationError(`${record.id} has unsupported or extra seller profile fields.`);
  }

  return { sourceCount: profiles.length, legacyCount, contactWrites, publicProfileWrites };
}

function chunks(records, size) {
  const result = [];
  for (let index = 0; index < records.length; index += size) result.push(records.slice(index, index + size));
  return result;
}

function contactsMatch(expected, actual) {
  if (expected.length !== actual.length) return false;
  const actualMap = new Map(actual.map((record) => [record.id, record.data]));
  return expected.every((record) => {
    const found = actualMap.get(record.id);
    if (!found || !exactFields(found, contactFields)) return false;
    try {
      const expectedValue = readContact(record.id, record.data);
      const actualValue = readContact(record.id, found);
      return actualValue.contactType === expectedValue.contactType
        && actualValue.contactValue === expectedValue.contactValue
        && actualValue.createdAt.valueOf() === expectedValue.createdAt.valueOf()
        && actualValue.updatedAt.valueOf() === expectedValue.updatedAt.valueOf();
    } catch {
      return false;
    }
  });
}

export async function runSellerContactMigration(options, dependencies) {
  const apply = options.apply === true;
  if (apply && (typeof options.projectId !== 'string' || !options.projectId.trim())) {
    throw new Error('Apply mode requires an explicit project ID.');
  }
  if (apply && (typeof options.backupPath !== 'string' || !options.backupPath.trim())) {
    throw new Error('Apply mode requires an explicit backup path.');
  }
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 400) {
    throw new Error('Batch size must be an integer from 1 to 400.');
  }

  const [profiles, contacts] = await Promise.all([
    dependencies.listProfiles(), dependencies.listContacts(),
  ]);
  const plan = planSellerContactMigration(profiles, contacts);
  const result = {
    mode: apply ? 'apply' : 'dry-run',
    sourceCount: plan.sourceCount,
    legacyCount: plan.legacyCount,
    contactWriteCount: plan.contactWrites.length,
    publicProfileWriteCount: plan.publicProfileWrites.length,
  };
  if (!apply || (plan.contactWrites.length === 0 && plan.publicProfileWrites.length === 0)) return result;

  if (await dependencies.backupExists(options.backupPath)) {
    throw new Error(`Backup path already exists: ${options.backupPath}`);
  }
  await dependencies.writeBackup(options.backupPath, {
    projectId: options.projectId,
    createdAt: new Date().toISOString(),
    sellerProfiles: profiles,
    sellerContacts: contacts,
  });
  for (const batch of chunks(plan.contactWrites, batchSize)) await dependencies.writeContactBatch(batch);
  const verifyIds = plan.publicProfileWrites.map((record) => record.id);
  const expectedContacts = verifyIds.map((id) =>
    plan.contactWrites.find((record) => record.id === id)
      ?? contacts.find((record) => record.id === id));
  if (expectedContacts.some((record) => !record)) {
    throw new Error('Private contact verification failed before public cleanup.');
  }
  const verified = [];
  for (const idBatch of chunks(verifyIds, batchSize)) {
    verified.push(...await dependencies.readContacts(idBatch));
  }
  if (!contactsMatch(expectedContacts, verified)) {
    throw new Error('Private contact verification failed before public cleanup.');
  }
  for (const batch of chunks(plan.publicProfileWrites, batchSize)) {
    await dependencies.writePublicProfileBatch(batch);
  }
  return result;
}

export async function writeJsonBackup(path, payload) {
  let handle;
  try {
    handle = await open(path, 'wx');
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`Backup path already exists: ${path}`);
    throw error;
  } finally {
    await handle?.close();
  }
}

async function pathExists(path) {
  try { await stat(path); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function parseArguments(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') options.apply = true;
    else if (argument === '--project') options.projectId = argv[++index];
    else if (argument === '--backup') options.backupPath = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.projectId) throw new Error('Pass --project with an explicit Firebase project ID.');
  return options;
}

async function runCli() {
  const options = parseArguments(process.argv.slice(2));
  const app = getApps().find((candidate) => candidate.name === 'seller-contact-migration')
    ?? initializeApp({ projectId: options.projectId }, 'seller-contact-migration');
  const firestore = getFirestore(app);
  const dependencies = {
    listProfiles: async () => (await firestore.collection('sellerProfiles').get()).docs
      .map((document) => ({ id: document.id, data: document.data() })),
    listContacts: async () => (await firestore.collection('sellerContacts').get()).docs
      .map((document) => ({ id: document.id, data: document.data() })),
    backupExists: pathExists,
    writeBackup: writeJsonBackup,
    async writeContactBatch(records) {
      const batch = firestore.batch();
      for (const record of records) batch.set(firestore.collection('sellerContacts').doc(record.id), record.data);
      await batch.commit();
    },
    async readContacts(ids) {
      if (ids.length === 0) return [];
      const snapshots = await firestore.getAll(...ids.map((id) => firestore.collection('sellerContacts').doc(id)));
      return snapshots.filter((snapshot) => snapshot.exists)
        .map((snapshot) => ({ id: snapshot.id, data: snapshot.data() }));
    },
    async writePublicProfileBatch(records) {
      const batch = firestore.batch();
      for (const record of records) batch.set(firestore.collection('sellerProfiles').doc(record.id), record.data);
      await batch.commit();
    },
  };
  const result = await runSellerContactMigration(options, dependencies);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
