import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss()],
  server: { port: 5273, strictPort: true },
  build: { target: 'es2022' },
})
