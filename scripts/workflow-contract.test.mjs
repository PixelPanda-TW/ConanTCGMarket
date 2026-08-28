import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

const workflowUrl = new URL('../.github/workflows/deploy.yml', import.meta.url);
const workflow = parse(await readFile(workflowUrl, 'utf8'));
const jobs = workflow.jobs;
const safeFirebaseEnvironment = {
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-conan-tcg-e2e.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-conan-tcg-e2e',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-conan-tcg-e2e.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:e2e000000000000000000',
};

function jobNamed(name) {
  const job = jobs[name];
  assert.ok(job, `${name} job is required`);
  return job;
}

function stepNamed(job, name) {
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `${name} step is required`);
  return step;
}

function assertNode22(job) {
  assert.deepEqual(stepNamed(job, 'Setup Node'), {
    name: 'Setup Node',
    uses: 'actions/setup-node@v4',
    with: { 'node-version': 22, cache: 'npm' },
  });
}

function assertArtifact(job, { name, condition, paths }) {
  const step = job.steps.find((candidate) => candidate.uses === 'actions/upload-artifact@v4');
  assert.ok(step, `${name} artifact upload is required`);
  assert.equal(step.if, condition);
  assert.equal(step.with.name, name);
  assert.equal(step.with['retention-days'], 14);
  assert.equal(step.with['if-no-files-found'], 'ignore');
  assert.deepEqual(
    step.with.path.trim().split('\n').map((path) => path.trim()),
    paths,
  );
}

test('runs the exact quality, Rules, and E2E gates for pull requests and main pushes', () => {
  assert.deepEqual(workflow.on, {
    pull_request: { branches: ['main'] },
    push: { branches: ['main'] },
  });
  assert.deepEqual(Object.keys(jobs), ['quality', 'rules', 'e2e', 'deploy', 'smoke']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(workflow.concurrency, {
    group: 'pages-${{ github.workflow }}-${{ github.ref }}',
    'cancel-in-progress': true,
  });

  for (const jobName of ['quality', 'rules', 'e2e', 'deploy', 'smoke']) {
    assert.equal(jobs[jobName]['runs-on'], 'ubuntu-latest');
    assertNode22(jobs[jobName]);
  }

  assert.equal(stepNamed(jobs.quality, 'Install frontend dependencies').run, 'npm ci');
  assert.equal(stepNamed(jobs.quality, 'Install Functions dependencies').run, 'npm --prefix functions ci');
  assert.equal(stepNamed(jobs.quality, 'Run quality gates').run, 'npm run test:quality');

  assert.equal(stepNamed(jobs.rules, 'Install dependencies').run, 'npm ci');
  assert.equal(stepNamed(jobs.rules, 'Test Firebase Rules').run, 'npm run test:rules');

  assert.equal(jobs.e2e['timeout-minutes'], 20);
  assert.equal(stepNamed(jobs.e2e, 'Install frontend dependencies').run, 'npm ci');
  assert.equal(stepNamed(jobs.e2e, 'Install Functions dependencies').run, 'npm --prefix functions ci');
  assert.equal(stepNamed(jobs.e2e, 'Install Playwright browsers').run, 'npx playwright install --with-deps chromium webkit');
  assert.equal(stepNamed(jobs.e2e, 'Run Emulator E2E').run, 'npm run test:e2e');
});

test('deploys only a gated main push with the minimum Pages permissions', () => {
  const deploy = jobNamed('deploy');
  assert.deepEqual(deploy.needs, ['quality', 'rules', 'e2e']);
  assert.equal(deploy.if, "github.event_name == 'push' && github.ref == 'refs/heads/main'");
  assert.deepEqual(deploy.permissions, {
    contents: 'read',
    pages: 'write',
    'id-token': 'write',
  });
  assert.deepEqual(deploy.outputs, {
    page_url: '${{ steps.deployment.outputs.page_url }}',
  });
  assert.deepEqual(deploy.environment, {
    name: 'github-pages',
    url: '${{ steps.deployment.outputs.page_url }}',
  });
  assert.equal(stepNamed(deploy, 'Install dependencies').run, 'npm ci');
  assert.equal(stepNamed(deploy, 'Build production Pages artifact').run, 'npm run build');
  assert.deepEqual(stepNamed(deploy, 'Upload Pages artifact').with, { path: 'dist' });
  assert.deepEqual(stepNamed(deploy, 'Deploy Pages'), {
    name: 'Deploy Pages',
    id: 'deployment',
    uses: 'actions/deploy-pages@v4',
  });
});

test('uses only fail-closed demo configuration in test jobs', () => {
  for (const jobName of ['quality', 'rules', 'e2e', 'smoke']) {
    const job = jobNamed(jobName);
    const serializedJob = JSON.stringify(job);
    assert.doesNotMatch(serializedJob, /\$\{\{\s*(?:vars|secrets)\./);
    assert.doesNotMatch(serializedJob, /GMAIL/);
    if (jobName !== 'smoke') assert.deepEqual(job.permissions, undefined);
  }
  assert.deepEqual(stepNamed(jobs.quality, 'Run quality gates').env, safeFirebaseEnvironment);
  assert.equal(jobs.rules.env, undefined);
  assert.equal(jobs.e2e.env, undefined);
  assert.equal(jobs.smoke.env, undefined);
});

test('retains browser and Emulator failure evidence for fourteen days', () => {
  assertArtifact(jobNamed('rules'), {
    name: 'rules-emulator-logs',
    condition: 'failure()',
    paths: ['*-debug.log'],
  });
  assertArtifact(jobNamed('e2e'), {
    name: 'e2e-artifacts',
    condition: 'always()',
    paths: ['playwright-report/', 'test-results/', '*-debug.log'],
  });
  assertArtifact(jobNamed('smoke'), {
    name: 'production-smoke-artifacts',
    condition: 'always()',
    paths: ['playwright-report/', 'test-results/'],
  });
});

test('runs a read-only smoke only after deployment using its exact Pages URL', () => {
  const smoke = jobNamed('smoke');
  assert.equal(smoke.needs, 'deploy');
  assert.equal(smoke.if, "github.event_name == 'push' && github.ref == 'refs/heads/main'");
  assert.deepEqual(smoke.permissions, { contents: 'read' });
  assert.equal(stepNamed(smoke, 'Install dependencies').run, 'npm ci');
  assert.equal(stepNamed(smoke, 'Install Chromium').run, 'npx playwright install --with-deps chromium');
  assert.equal(
    stepNamed(smoke, 'Run read-only deployment smoke').run,
    'npm run test:smoke -- --base-url "${{ needs.deploy.outputs.page_url }}"',
  );
});
