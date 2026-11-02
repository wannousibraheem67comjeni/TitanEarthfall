import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the production build can be hosted from any sub-path.
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
