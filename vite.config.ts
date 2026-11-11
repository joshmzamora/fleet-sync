import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    // Optional local shared server. Without it, the full browser demo still runs.
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true } },
  },
})
