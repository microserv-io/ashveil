import { join } from 'node:path'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

/**
 * Its own port so it runs alongside the game on :5273, the Deck spike on :5274 and
 * the art spike on :5275. Bound to every interface because the review happens over
 * the tailnet, not on this machine's screen.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [tailwindcss()],
  // Shares the game's models rather than keeping a second copy.
  publicDir: join(import.meta.dirname, '..', '..', 'public'),
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { port: 5277, strictPort: true, host: '0.0.0.0' },
})
