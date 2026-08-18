import { defineConfig } from 'vite'

/** Its own port so it can run alongside the game on :5273 and the Deck spike on :5274. */
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { port: 5275, strictPort: true, host: true },
})
