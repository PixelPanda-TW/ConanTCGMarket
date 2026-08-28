import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  isCallExpression,
  isElementAccessExpression,
  isIdentifier,
  isImportDeclaration,
  isPropertyAccessExpression,
  isStringLiteral,
} from 'typescript/unstable/ast';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API } from 'typescript/unstable/sync';

const rootUrl = new URL('../', import.meta.url);
const smokeFile = fileURLToPath(new URL('e2e/smoke.spec.ts', rootUrl));
const forbiddenCallName = /^(?:click|dblclick|fill|press|check|uncheck|selectOption|setInputFiles|fetch|post|put|patch|signIn|signOut|create|update|delete|remove|upload|subscribe|save|commit|write|mutate|submit)(?:[A-Z_].*)?$/i;
const forbiddenSetterName = /^set[A-Z_]/;

function callName(expression) {
  if (isIdentifier(expression)) return expression.text;
  if (isPropertyAccessExpression(expression)) return expression.name.text;
  if (isElementAccessExpression(expression) && isStringLiteral(expression.argumentExpression)) {
    return expression.argumentExpression.text;
  }
  return null;
}

function validateSmokeSourceFile(sourceFile) {
  const imports = sourceFile.statements.filter(isImportDeclaration);
  assert.ok(imports.length > 0, 'smoke spec must import Playwright');
  for (const declaration of imports) {
    assert.ok(isStringLiteral(declaration.moduleSpecifier));
    assert.equal(
      declaration.moduleSpecifier.text,
      '@playwright/test',
      'smoke spec may import only @playwright/test',
    );
  }

  function visit(node) {
    if (isCallExpression(node)) {
      const name = callName(node.expression);
      assert.equal(
        forbiddenCallName.test(name ?? '') || forbiddenSetterName.test(name ?? ''),
        false,
        `smoke spec must not call ${name ?? 'an unknown mutation helper'}`,
      );
    }
    node.forEachChild(visit);
  }
  visit(sourceFile);
}

function withProjectSourceFile(callback) {
  const api = new API({ cwd: fileURLToPath(rootUrl) });
  try {
    const snapshot = api.updateSnapshot({ openFiles: [smokeFile] });
    try {
      const project = snapshot.getDefaultProjectForFile(smokeFile);
      assert.ok(project, 'smoke spec must belong to a TypeScript project');
      const sourceFile = project.program.getSourceFile(smokeFile);
      assert.ok(sourceFile, 'TypeScript must parse the smoke spec');
      callback(sourceFile);
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}

function withVirtualSourceFile(source, callback) {
  const virtualFile = '/smoke-contract/smoke.spec.ts';
  const api = new API({
    cwd: '/smoke-contract',
    fs: createVirtualFileSystem({ [virtualFile]: source }),
  });
  try {
    const snapshot = api.updateSnapshot({ openFiles: [virtualFile] });
    try {
      const project = snapshot.getDefaultProjectForFile(virtualFile);
      assert.ok(project);
      const sourceFile = project.program.getSourceFile(virtualFile);
      assert.ok(sourceFile);
      callback(sourceFile);
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}

test('smoke AST allows only Playwright and read-only calls', () => {
  withProjectSourceFile(validateSmokeSourceFile);
});

test('smoke AST rejects support imports and interaction mutations', async (t) => {
  await t.test('support auth import', () => {
    withVirtualSourceFile(`
      import { test } from '@playwright/test';
      import { signIn } from './support/auth';
      test('unsafe', () => signIn());
    `, (sourceFile) => {
      assert.throws(() => validateSmokeSourceFile(sourceFile), /may import only @playwright\/test/);
    });
  });

  for (const mutation of [
    "page.getByRole('button').click()",
    "page['click']()",
    "page.getByLabel('email').fill('unsafe@example.com')",
    "request.post('/write')",
    "fetch('/write', { method: 'POST' })",
    'signIn()',
    'setNotificationEmailDailyEnabled()',
    'uploadListing()',
  ]) {
    await t.test(mutation, () => {
      withVirtualSourceFile(`
        import { test } from '@playwright/test';
        test('unsafe', async ({ page }) => { await ${mutation}; });
      `, (sourceFile) => {
        assert.throws(() => validateSmokeSourceFile(sourceFile), /must not call/);
      });
    });
  }
});
