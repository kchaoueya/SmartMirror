import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// localhost est un contexte sécurisé : caméra, WebGPU, WebXR et Service Worker fonctionnent sans HTTPS.
// Pour ouvrir le projet depuis un AUTRE appareil (téléphone, autre PC du réseau) il faut HTTPS :
//   npm run dev:https      → https://<IP du PC>:5173
//   npm run preview:https  → https://<IP du PC>:4173 (version construite)
// Le certificat est auto-signé (plugin-basic-ssl) : le navigateur affiche un avertissement à accepter.
// Limite : Chrome refuse d'enregistrer un Service Worker avec un certificat auto-signé, donc le test
// hors ligne (PWA) se fait toujours en http://localhost (npm run build puis npm run preview).
export default defineConfig(({ mode }) => ({
  plugins: mode === 'https' ? [basicSsl({ name: 'smartmirror-ar' })] : [],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: 'es2022' },
}));
