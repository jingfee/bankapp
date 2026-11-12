import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** Runs the tuning tool with the repo's own TypeScript setup. It is not part of `pnpm test`. */
export default defineConfig({
  test: {
    include: ['tools/**/*.tune.ts'],
    setupFiles: ['reflect-metadata'],
    testTimeout: 600_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
