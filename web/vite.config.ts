import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/** In sviluppo /app/qualunque-cosa serve la SPA (in produzione lo fa _redirects). */
function appFallback(): Plugin {
  return {
    name: 'app-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url || '';
        if ((url === '/app' || url.startsWith('/app/') || url.startsWith('/app?')) && !url.split('?')[0].includes('.')) {
          req.url = '/app.html';
        }
        next();
      });
    },
  };
}

// Due pagine: la landing (/) e la web app (/app/*, SPA).
export default defineConfig({
  plugins: [react(), appFallback()],
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        // La landing nuova, in prova su /next (non collegata da nessuna parte, noindex).
        next: resolve(__dirname, 'next.html'),
        app: resolve(__dirname, 'app.html'),
      },
      // Nomi col punto (non col trattino): file mai scaricati prima, così nessun browser
      // usa una vecchia risposta sbagliata rimasta in cache per lo stesso nome.
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
});
