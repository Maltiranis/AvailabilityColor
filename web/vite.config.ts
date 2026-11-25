import { defineConfig } from 'vite';

// base './' : l'app fonctionne aussi bien à la racine d'un domaine que dans un sous-dossier (GitHub Pages).
export default defineConfig({
  base: './',
  server: { host: 'localhost', port: 5173 },
});
