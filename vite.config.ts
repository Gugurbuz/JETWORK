import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', 'VITE_');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env': env,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: true,
      allowedHosts: 'all',
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
