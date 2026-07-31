import { copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/** Copies the built index.html to 404.html so GitHub Pages' SPA fallback can serve it for unknown paths. */
function spaFallback404(): Plugin {
  return {
    name: 'spa-fallback-404',
    apply: 'build',
    async closeBundle() {
      const dir = fileURLToPath(new URL('./dist', import.meta.url))
      await copyFile(path.join(dir, 'index.html'), path.join(dir, '404.html'))
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: mode === 'browser' ? '/floor-plan-editor/' : '/',
  plugins: [vue(), tailwindcss(), ...(mode === 'browser' ? [spaFallback404()] : [])],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:47825',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    poolOptions: {
      forks: {
        // Node >= 23 ships its own global localStorage, which shadows jsdom's
        // Storage in the workers and breaks every test touching localStorage.
        execArgv: ['--no-experimental-webstorage'],
      },
    },
  },
}))
