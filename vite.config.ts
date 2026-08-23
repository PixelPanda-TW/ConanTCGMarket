import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/ConanTCGMarket/',
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
