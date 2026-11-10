import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next's tsconfig keeps `jsx: preserve` for its own compiler; Vite 8's parser
  // refuses preserved JSX, so the component tests tell it to compile JSX here.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': new URL('./src/', import.meta.url).pathname },
  },
});
