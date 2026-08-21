import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['web/**', 'happy-dom']
    ],
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts', 'web/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
