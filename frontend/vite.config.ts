import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
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
})
