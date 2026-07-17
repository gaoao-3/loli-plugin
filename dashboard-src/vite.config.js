import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: '/dashboard/',
  build: {
    outDir: path.resolve(__dirname, '../dashboard'),
    emptyOutDir: true,
  },
})
