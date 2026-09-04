import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

const websiteRoot = resolve(import.meta.dirname)
const root = resolve(websiteRoot, '.site')
const base = process.env.SITE_BASE || '/ashveil/'
const outDir = process.env.SITE_OUT_DIR
  ? resolve(process.env.SITE_OUT_DIR)
  : resolve(websiteRoot, 'dist')

export default defineConfig({
  root,
  base,
  publicDir: resolve(websiteRoot, 'public'),
  plugins: [tailwindcss()],
  server: { port: 5295, strictPort: true },
  preview: { port: 5295, strictPort: true },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        home: resolve(root, 'index.html'),
        design: resolve(root, 'design/index.html'),
        brand: resolve(root, 'brand/index.html'),
        notFound: resolve(root, '404.html'),
      },
    },
  },
})
