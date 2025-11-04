import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/Creative-Foraging-Detection-Media-Pipe/',
  server: {
    port: 3000
  }
})
