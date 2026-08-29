import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['core/**/*.test.ts', 'runtime/**/*.test.ts'],
  },
});
