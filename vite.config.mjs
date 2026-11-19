import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import basicSsl from '@vitejs/plugin-basic-ssl';

// localhost est un contexte sécurisé : caméra, WebGPU, WebXR et Service Worker fonctionnent sans HTTPS.
// Pour ouvrir le projet depuis un AUTRE appareil (téléphone, autre PC du réseau) il faut HTTPS :
//   npm run dev:https      → https://<IP du PC>:5173
//   npm run preview:https  → https://<IP du PC>:4173 (version construite)
//
// Certificat :
//  1. certs/dev-cert.pem + certs/dev-key.pem s'ils existent (mkcert, voir README) : reconnus par le PC,
//     donc pas d'avertissement et le Service Worker fonctionne aussi en HTTPS ;
//  2. sinon certificat auto-signé (plugin-basic-ssl) : avertissement à accepter dans le navigateur,
//     et Chrome refuse alors d'enregistrer le Service Worker.
// Les fichiers de certs/ sont propres à chaque PC et ne sont jamais committés (.gitignore).
const CERT = 'certs/dev-cert.pem';
const KEY = 'certs/dev-key.pem';
const hasLocalCert = existsSync(CERT) && existsSync(KEY);

export default defineConfig(({ mode }) => {
  const https = mode === 'https' && hasLocalCert
    ? { cert: readFileSync(CERT), key: readFileSync(KEY) }
    : undefined;
  return {
    plugins: mode === 'https' && !hasLocalCert ? [basicSsl({ name: 'smartmirror-ar' })] : [],
    server: { host: true, port: 5173, https },
    preview: { host: true, port: 4173, https },
    build: { target: 'es2022' },
  };
});
