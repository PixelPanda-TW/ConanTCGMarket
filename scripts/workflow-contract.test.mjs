import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
const firebaseVariableNames = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];
const productionFirebaseEnvironment = Object.fromEntries(firebaseVariableNames.map((name) => (
  [name, `\${{ vars.${name} }}`]
)));

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

function visitValues(value, path, visitor) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitValues(item, `${path}[${index}]`, visitor));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    visitor(key, child, `${path}.${key}`);
    visitValues(child, `${path}.${key}`, visitor);
  }
}

function assertNoFailureTolerance(candidate, { requireAbsent = false } = {}) {
  let occurrences = 0;
  visitValues(candidate, 'workflow', (key, value, path) => {
    if (key === 'continue-on-error') {
      occurrences += 1;
      assert.equal(value, false, `${path} must not tolerate failures unless set to literal false`);
    }
  });
  if (requireAbsent) assert.equal(occurrences, 0, 'current workflow must omit continue-on-error entirely');
}

function assertNoCredentialExpression(value, jobName) {
  for (const match of value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    assert.doesNotMatch(
      match[1],
      /\b(?:vars|secrets)\s*(?:\.|\[)/i,
      `${jobName} must not reference repository variables or secrets`,
    );
  }
}

function assertCredentialIsolation(candidate) {
  assert.equal(candidate.env, undefined, 'workflow-level credential environment is forbidden');
  for (const jobName of ['quality', 'rules', 'e2e', 'smoke']) {
    const job = candidate.jobs[jobName];
    visitValues(job, `workflow.jobs.${jobName}`, (key, value) => {
      assert.doesNotMatch(key, /GMAIL/i, `${jobName} must not receive Gmail credentials`);
      if (typeof value !== 'string') return;
      assertNoCredentialExpression(value, jobName);
      assert.doesNotMatch(value, /GMAIL/i, `${jobName} must not receive Gmail credentials`);
    });
  }
  assert.deepEqual(stepNamed(candidate.jobs.quality, 'Run quality gates').env, safeFirebaseEnvironment);
  assert.equal(candidate.jobs.rules.env, undefined);
  assert.equal(candidate.jobs.e2e.env, undefined);
  assert.equal(candidate.jobs.smoke.env, undefined);
}

function assertDeployWiring(candidate) {
  const deploy = candidate.jobs.deploy;
  assert.deepEqual(deploy.outputs, {
    page_url: '${{ steps.deployment.outputs.page_url }}',
  });
  assert.deepEqual(deploy.environment, {
    name: 'github-pages',
    url: '${{ steps.deployment.outputs.page_url }}',
  });
  const validationStep = stepNamed(deploy, 'Validate Firebase configuration');
  assert.deepEqual({
    name: validationStep.name,
    shell: validationStep.shell,
    env: validationStep.env,
  }, {
    name: 'Validate Firebase configuration',
    shell: 'bash',
    env: productionFirebaseEnvironment,
  });
  assert.equal(typeof validationStep.run, 'string');
  const configuredEnvironment = Object.fromEntries(firebaseVariableNames.map((name) => [name, 'configured']));
  const configured = spawnSync('/bin/bash', ['-c', validationStep.run], {
    encoding: 'utf8',
    env: configuredEnvironment,
  });
  assert.equal(configured.status, 0, configured.stderr);
  for (const missingName of firebaseVariableNames) {
    const missingEnvironment = { ...configuredEnvironment };
    delete missingEnvironment[missingName];
    const missing = spawnSync('/bin/bash', ['-c', validationStep.run], {
      encoding: 'utf8',
      env: missingEnvironment,
    });
    assert.notEqual(missing.status, 0, `${missingName} must be required`);
    assert.match(missing.stderr, new RegExp(`Missing required repository variable: ${missingName}`));
  }
  assert.deepEqual(stepNamed(deploy, 'Build production Pages artifact'), {
    name: 'Build production Pages artifact',
    run: 'npm run build',
    env: productionFirebaseEnvironment,
  });
  assert.deepEqual(stepNamed(deploy, 'Upload Pages artifact'), {
    name: 'Upload Pages artifact',
    uses: 'actions/upload-pages-artifact@v3',
    with: { path: 'dist' },
  });
  assert.deepEqual(stepNamed(deploy, 'Deploy Pages'), {
    name: 'Deploy Pages',
    id: 'deployment',
    uses: 'actions/deploy-pages@v4',
  });
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
  assertNoFailureTolerance(workflow, { requireAbsent: true });
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
  assert.equal(stepNamed(deploy, 'Install dependencies').run, 'npm ci');
  assertDeployWiring(workflow);
});

test('keeps workflow and test-job credentials isolated from production', () => {
  for (const jobName of ['quality', 'rules', 'e2e', 'smoke']) {
    const job = jobNamed(jobName);
    if (jobName !== 'smoke') assert.deepEqual(job.permissions, undefined);
  }
  assertCredentialIsolation(workflow);
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
  assert.equal(
    stepNamed(smoke, 'Upload smoke evidence').uses,
    'actions/upload-artifact@v4',
  );
});

test('rejects failure-tolerance, credential, and Pages-action mutations', async (t) => {
  await t.test('continue-on-error cannot make a gate advisory', () => {
    const mutated = structuredClone(workflow);
    stepNamed(mutated.jobs.e2e, 'Run Emulator E2E')['continue-on-error'] = true;
    assert.throws(() => assertNoFailureTolerance(mutated), /continue-on-error.*must not tolerate failures/);

    const expressionMutation = structuredClone(workflow);
    stepNamed(expressionMutation.jobs.smoke, 'Run read-only deployment smoke')['continue-on-error'] = '${{ true }}';
    assert.throws(() => assertNoFailureTolerance(expressionMutation), /continue-on-error.*must not tolerate failures/);
  });

  await t.test('workflow and E2E environments cannot gain repository credentials', () => {
    const workflowEnvMutation = structuredClone(workflow);
    workflowEnvMutation.env = { GMAIL_CLIENT_SECRET: '${{ secrets.GMAIL_CLIENT_SECRET }}' };
    assert.throws(() => assertCredentialIsolation(workflowEnvMutation), /workflow-level credential environment/);

    const e2eEnvMutation = structuredClone(workflow);
    stepNamed(e2eEnvMutation.jobs.e2e, 'Run Emulator E2E').env = {
      VITE_FIREBASE_PROJECT_ID: '${{ vars.VITE_FIREBASE_PROJECT_ID }}',
    };
    assert.throws(() => assertCredentialIsolation(e2eEnvMutation), /must not reference repository variables or secrets/);

    const bracketMutation = structuredClone(workflow);
    stepNamed(bracketMutation.jobs.rules, 'Test Firebase Rules').env = {
      GATE_INPUT: "${{ format('{0}', secrets['DEPLOY_TOKEN']) }}",
    };
    assert.throws(() => assertCredentialIsolation(bracketMutation), /must not reference repository variables or secrets/);
  });

  await t.test('generic artifacts cannot replace the Pages artifact', () => {
    const mutated = structuredClone(workflow);
    stepNamed(mutated.jobs.deploy, 'Upload Pages artifact').uses = 'actions/upload-artifact@v4';
    assert.throws(() => assertDeployWiring(mutated));
  });
});
