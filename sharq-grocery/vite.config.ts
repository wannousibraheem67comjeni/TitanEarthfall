import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode single` inlines every script, style and font into one HTML file, which is
// what the claude.ai artifact build publishes. The default mode is a normal static build.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile({ removeViteModuleLoader: true })] : [],
  build: {
    target: 'es2022',
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
