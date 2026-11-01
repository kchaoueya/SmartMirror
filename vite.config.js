import { defineConfig } from 'vite';

// localhost est un contexte sécurisé : caméra et WebGPU fonctionnent sans HTTPS.
// Pour tester sur téléphone (S6, extension), ajouter @vitejs/plugin-basic-ssl.
export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'es2022' },
});
