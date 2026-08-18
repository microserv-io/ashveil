import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

/**
 * The harness serves the game's own art and stylesheet, because a frame drawn
 * without them is not the frame the budget is being spent on.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  publicDir: '../public',
  plugins: [tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { port: 5276, strictPort: true, host: true },
})
