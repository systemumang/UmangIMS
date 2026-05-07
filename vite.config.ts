import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

export default defineConfig(async ({command, mode}) => {
  const env = loadEnv(mode, '.', '');

  const plugins = [react(), tailwindcss()];
  if (command === 'serve') {
    // Keep backend middleware out of production builds (Hostinger build image
    // cannot load native sqlite3 bindings used by the dev API).
    plugins.push(await excelApiPlugin());
  }

  return {
    plugins,
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

async function excelApiPlugin(): Promise<Plugin> {
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
