import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const rootUrl = new URL('../', import.meta.url);

function evaluateConfig(path, environment = {}) {
  const script = [
    `import config from ${JSON.stringify(new URL(path, rootUrl).href)};`,
    'const projects = config.projects.map(({ name, testMatch, testIgnore, use }) => ({',
    '  name, testMatch: testMatch ?? null, testIgnore: testIgnore ?? null,',
    '  browserName: use?.defaultBrowserType ?? null, isMobile: use?.isMobile ?? null,',
    '}));',
    'console.log(JSON.stringify({',
    '  testDir: config.testDir, testMatch: config.testMatch ?? null, testIgnore: config.testIgnore ?? null, timeout: config.timeout,',
    '  expectTimeout: config.expect?.timeout ?? null, fullyParallel: config.fullyParallel ?? null,',
    '  forbidOnly: config.forbidOnly, retries: config.retries,',
    '  failOnFlakyTests: config.failOnFlakyTests, workers: config.workers,',
    '  reporter: config.reporter, outputDir: config.outputDir, use: config.use,',
    '  projects, webServer: config.webServer ?? null,',
    '}));',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--experimental-transform-types', '--input-type=module', '--eval', script], {
    cwd: new URL('.', rootUrl),
    encoding: 'utf8',
    env: { ...process.env, CI: undefined, ...environment },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function listProject(project) {
  const result = spawnSync(process.execPath, [
    './node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.config.ts', '--project', project, '--list',
  ], {
    cwd: new URL('.', rootUrl),
    encoding: 'utf8',
    env: process.env,
  });
  const output = `${result.stdout}${result.stderr}`;

  assert.ok(result.status === 0 || /No tests found/.test(output), output);
  return output;
}

test('local config evaluation clears an inherited CI environment', () => {
  const originalCi = process.env.CI;
  process.env.CI = 'true';
  try {
    const config = evaluateConfig('playwright.config.ts');

    assert.equal(config.forbidOnly, false);
    assert.equal(config.retries, 0);
    assert.equal(config.failOnFlakyTests, false);
  } finally {
    if (originalCi === undefined) delete process.env.CI;
    else process.env.CI = originalCi;
  }
});

test('keeps the approved reliability and browser matrix', () => {
  const config = evaluateConfig('playwright.config.ts');

  assert.deepEqual(config, {
    testDir: './e2e',
    testMatch: null,
    testIgnore: ['**/smoke.spec.ts'],
    timeout: 30_000,
    expectTimeout: 10_000,
    fullyParallel: false,
    forbidOnly: false,
    retries: 0,
    failOnFlakyTests: false,
    workers: 1,
    reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
    outputDir: 'test-results',
    use: {
      baseURL: 'http://127.0.0.1:4173/ConanTCGMarket/',
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
    },
    projects: [
      { name: 'chromium', testIgnore: ['**/smoke.spec.ts', '**/mobile-forms.spec.ts'], testMatch: null, browserName: 'chromium', isMobile: false },
      { name: 'webkit-iphone', testIgnore: null, testMatch: ['**/mobile-forms.spec.ts'], browserName: 'webkit', isMobile: true },
    ],
    webServer: {
      command: 'npm run dev -- --mode e2e --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173/ConanTCGMarket/',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  });
});

test('keeps the production smoke suite isolated and read-only', () => {
  const config = evaluateConfig('playwright.smoke.config.ts', { PLAYWRIGHT_BASE_URL: 'https://example.com/' });

  assert.deepEqual(config, {
    testDir: './e2e',
    testMatch: '**/smoke.spec.ts',
    testIgnore: null,
    timeout: 30_000,
    expectTimeout: 10_000,
    fullyParallel: null,
    forbidOnly: false,
    retries: 0,
    failOnFlakyTests: false,
    workers: 1,
    reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
    outputDir: 'test-results',
    use: {
      baseURL: 'https://example.com/',
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
    },
    projects: [{ name: 'production-smoke', testIgnore: null, testMatch: null, browserName: 'chromium', isMobile: false }],
    webServer: null,
  });
});

test('Playwright discovery gates support specs once in Chromium and excludes smoke', () => {
  const chromium = listProject('chromium');
  const webkit = listProject('webkit-iphone');

  assert.match(chromium, /support\/emulator-state\.spec\.ts/);
  assert.match(chromium, /support\/auth\.spec\.ts/);
  assert.doesNotMatch(webkit, /support\/.*\.spec\.ts/);
  assert.doesNotMatch(chromium, /smoke\.spec\.ts/);
  assert.doesNotMatch(webkit, /smoke\.spec\.ts/);
});

test('uses one retry and preserves failure artifacts in CI', () => {
  const fullConfig = evaluateConfig('playwright.config.ts', { CI: '1' });
  const smokeConfig = evaluateConfig('playwright.smoke.config.ts', {
    CI: '1',
    PLAYWRIGHT_BASE_URL: 'https://example.com/',
  });

  for (const config of [fullConfig, smokeConfig]) {
    assert.equal(config.forbidOnly, true);
    assert.equal(config.retries, 1);
    assert.equal(config.failOnFlakyTests, true);
    assert.equal(config.workers, 1);
    assert.deepEqual(config.use, {
      ...config.use,
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
    });
  }
  assert.equal(fullConfig.webServer.reuseExistingServer, false);
});

test('requires a smoke base URL at configuration evaluation', () => {
  const script = `import ${JSON.stringify(new URL('playwright.smoke.config.ts', rootUrl).href)};`;
  const result = spawnSync(process.execPath, ['--experimental-transform-types', '--input-type=module', '--eval', script], {
    cwd: new URL('.', rootUrl),
    encoding: 'utf8',
    env: { ...process.env, PLAYWRIGHT_BASE_URL: '' },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PLAYWRIGHT_BASE_URL is required/);
});

test('accepts only a single HTTPS or loopback HTTP smoke base URL', async () => {
  const { parseSmokeBaseUrl } = await import(new URL('run-smoke.mjs', import.meta.url));

  assert.equal(parseSmokeBaseUrl(['--base-url', 'https://example.com/app']).href, 'https://example.com/app');
  assert.equal(parseSmokeBaseUrl(['--base-url', 'http://127.0.0.1:4173/app']).href, 'http://127.0.0.1:4173/app');
  assert.equal(parseSmokeBaseUrl(['--base-url', 'http://[::1]:4173/app']).href, 'http://[::1]:4173/app');
  for (const args of [
    [],
    ['--base-url'],
    ['--base-url', 'http://example.com'],
    ['--base-url', 'ftp://localhost'],
    ['--base-url', 'https://user:password@example.com'],
    ['--base-url', 'https://example.com', '--base-url', 'https://other.example.com'],
    ['--base-url', 'https://example.com', '--project', 'chromium'],
  ]) {
    assert.throws(() => parseSmokeBaseUrl(args));
  }
});
