import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
  build: {
    outDir: path.resolve(__dirname, '../core/dashboard'),
    emptyOutDir: true,
  },
})
