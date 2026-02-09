import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/__tests__/**',
        '**/__mocks__/**',
        '**/*.d.ts',
        'src/types/**',
        'src/di/container-config.ts',
        'src/di/index.ts',
        'src/di/types.ts',
        'src/main.ts',
        'src/constants/index.ts',
        'src/test-utils/**',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
  define: {
    SCRIPT_VERSION: JSON.stringify('test-version'),
  },
});
