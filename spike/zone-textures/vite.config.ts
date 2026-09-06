import { join } from 'node:path'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [tailwindcss()],
  publicDir: join(import.meta.dirname, '..', '..', 'public', 'textures', 'first-zone'),
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { port: 5297, strictPort: true, host: '0.0.0.0' },
})
