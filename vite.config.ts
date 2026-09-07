import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [tailwindcss()],
  server: { host: '0.0.0.0', port: 5300, strictPort: true },
  preview: { host: '0.0.0.0', port: 5300, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: { input: { world: resolve(import.meta.dirname, 'index.html'), legacy: resolve(import.meta.dirname, 'legacy.html') } },
  },
})
