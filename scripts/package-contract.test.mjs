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
