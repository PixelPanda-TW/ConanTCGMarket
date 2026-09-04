import { expect, test } from '@playwright/test';
import { getAuth } from 'firebase-admin/auth';

import { lookupAuthEmulatorUid, setEmulatorAdminClaim } from './auth';
import {
  E2E_PROJECT_ID,
  getEmulatorAdminApp,
  resetEmulators,
} from './emulator-state';

test('finds existing Auth Emulator users and returns null for missing users', async () => {
  await resetEmulators();
  try {
    await expect(lookupAuthEmulatorUid('missing@example.test', false)).resolves.toBeNull();
    const created = await getAuth(getEmulatorAdminApp()).createUser({
      email: 'found@example.test',
      displayName: 'Found Seller',
    });

    await expect(lookupAuthEmulatorUid('found@example.test', true)).resolves.toBe(created.uid);
  } finally {
    await resetEmulators();
  }
});

test('rejects an unsafe project before attempting an Admin Auth lookup', async () => {
  const originalProject = process.env.GCLOUD_PROJECT;
  process.env.GCLOUD_PROJECT = 'production-project';
  try {
    await expect(lookupAuthEmulatorUid('seller@example.test', false))
      .rejects.toThrow(`Unsafe E2E project.`);
  } finally {
    if (originalProject === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = originalProject;
  }

  expect(E2E_PROJECT_ID).toBe('demo-conan-tcg-e2e');
});

test('sets and removes only an Emulator admin claim', async () => {
  await resetEmulators();
  try {
    const auth = getAuth(getEmulatorAdminApp());
    const created = await auth.createUser({ email: 'admin@example.test' });
    await setEmulatorAdminClaim(created.uid, true);
    await expect(auth.getUser(created.uid)).resolves.toMatchObject({ customClaims: { admin: true } });
    await setEmulatorAdminClaim(created.uid, false);
    const user = await auth.getUser(created.uid);
    expect(user.customClaims?.admin).toBeUndefined();
  } finally {
    await resetEmulators();
  }
});

test('rejects unsafe and malformed Emulator claim changes before Admin Auth', async () => {
  const originalProject = process.env.GCLOUD_PROJECT;
  process.env.GCLOUD_PROJECT = 'production-project';
  try {
    await expect(setEmulatorAdminClaim('uid', true)).rejects.toThrow('Unsafe E2E project.');
  } finally {
    if (originalProject === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = originalProject;
  }
  await expect(setEmulatorAdminClaim('', true)).rejects.toThrow('valid Emulator UID');
});
