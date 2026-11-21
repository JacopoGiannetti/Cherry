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
        if (url.startsWith('/app') && !url.includes('.') && !url.startsWith('/app/index.html')) {
          req.url = '/app/index.html';
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
        app: resolve(__dirname, 'app/index.html'),
      },
    },
  },
});
