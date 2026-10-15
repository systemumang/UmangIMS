import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    // The production server hosts the API and UI together. In development the
    // Vite server needs to forward API calls to Express instead of returning
    // index.html with a misleading HTTP 200 response.
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
        '/uploads': {
          target: env.VITE_API_TARGET || 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
      },
    },
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
  };
});
