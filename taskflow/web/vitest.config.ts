import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts: vitest bundles its own vite types, which clash with the
// vite 8 plugin types if both live in one config.
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
  esbuild: { jsx: 'automatic' },
})
