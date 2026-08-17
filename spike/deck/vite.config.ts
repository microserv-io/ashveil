import { defineConfig } from 'vite'

/**
 * The spike builds to a self-contained bundle with relative paths, so it can be
 * loaded from a file:// URL inside a desktop shell as well as served over HTTP.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { port: 5274, strictPort: true, host: true },
})
