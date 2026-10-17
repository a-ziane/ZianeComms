import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Next.js preserves JSX for its own compiler; component regression tests need JSX transformed here.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
