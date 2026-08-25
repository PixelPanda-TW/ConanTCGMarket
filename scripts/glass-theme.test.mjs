import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('defines the glassmorphic color tokens in light and dark modes', () => {
  for (const selector of [':root', '.dark']) {
    const section = styles.slice(styles.indexOf(selector), styles.indexOf('}', styles.indexOf(selector)) + 1);
    for (const token of ['--background:', '--foreground:', '--primary:', '--secondary:', '--muted:', '--accent:', '--destructive:', '--border:', '--input:', '--ring:', '--card:', '--success:', '--warning:', '--info:']) {
      assert.ok(section.includes(token), `${selector} should define ${token}`);
    }
  }
});

test('uses the design-system radius, component tokens, and accessible focus ring', () => {
  assert.match(styles, /--radius:\s*0\.625rem/);
  assert.match(styles, /button\s*\{[\s\S]*?border-radius:\s*var\(--radius\)/);
  assert.match(styles, /input,[\s\S]*?textarea\s*\{[\s\S]*?border:\s*1px solid hsl\(var\(--input\)/);
  assert.match(styles, /outline:\s*2px solid currentColor;[\s\S]*?outline-offset:\s*2px/);
});
