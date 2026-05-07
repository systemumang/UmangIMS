import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

export default defineConfig(({command, mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), ...(command === 'serve' ? [excelApiPlugin()] : [])],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});

function excelApiPlugin(): Plugin {
  return {
    name: 'excel-api',
    async configureServer(server) {
      const {createApiApp} = await import('./src/server/api');
      server.middlewares.use('/api', createApiApp());
    },
    async configurePreviewServer(server) {
      const {createApiApp} = await import('./src/server/api');
      server.middlewares.use('/api', createApiApp());
    },
  };
}
