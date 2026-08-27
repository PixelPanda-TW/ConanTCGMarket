import { expect, test as base } from '@playwright/test';

import { resetEmulators } from './emulator-state';

export const test = base.extend<{ emulators: true }>({
  emulators: [async ({}, use) => {
    await resetEmulators();
    try {
      await use(true);
    } finally {
      await resetEmulators();
    }
  }, { auto: true }],
});

export { expect };
