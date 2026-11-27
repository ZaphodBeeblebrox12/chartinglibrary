import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const apiTarget = env.VITE_OPTIONS_API_TARGET || 'http://127.0.0.1:8000'

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/ws': {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      clearMocks: true,
    },
  }
})
