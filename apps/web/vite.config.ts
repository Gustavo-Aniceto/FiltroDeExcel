import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), '');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      // O proxy faz o navegador enxergar API e frontend na MESMA origem em
      // desenvolvimento. Isso e o que permite testar o cookie httpOnly de
      // refresh sem esbarrar em restricoes de cookie cross-site -- exatamente
      // como sera em producao, com ambos atras do mesmo dominio.
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:3333',
          changeOrigin: true,
        },
      },
    },
    build: {
      sourcemap: true,
      // A grade virtualizada e as bibliotecas de grafico vao pesar; separar os
      // vendors mantem o cache do navegador util entre deploys.
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            query: ['@tanstack/react-query'],
          },
        },
      },
    },
  };
});
