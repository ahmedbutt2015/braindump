import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/story-integration.test.ts'],
    testTimeout: 120_000,   // 2 min per chapter — HF cold start can be ~20s
    hookTimeout: 30_000,
    setupFiles: ['__tests__/story-setup.ts'],
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
})
