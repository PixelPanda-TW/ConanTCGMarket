import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/rules/**/*.test.ts'] },
});
