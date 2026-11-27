import { defineConfig } from 'vitest/config';

// Live tests against ICP mainnet. Run with: npm run test:live
export default defineConfig({
  test: {
    include: ['tests/live/**/*.live.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
