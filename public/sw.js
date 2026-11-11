// Propriétaire : Eya — Service Worker (volet PWA)
// Rôle : garder une copie de l'application dans le cache pour qu'elle se lance sans connexion.
// Ce fichier est dans public/ : Vite le copie tel quel à la racine (/sw.js), sans le renommer.

// Changer ce numéro à chaque modification de sw.js ou du catalogue : l'ancien cache sera supprimé.
const CACHE_VERSION = 'v1';
const CACHE_NAME = `smartmirror-${CACHE_VERSION}`;

// « Coquille » de l'application : fichiers indispensables, téléchargés dès l'installation.
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
  '/assets/garments/catalog.json',
];

// ─── 1. INSTALLATION : remplir le cache ───────────────────────────────────────
self.addEventListener('install', (event) => {
  // waitUntil : le navigateur attend la fin de la promesse avant de considérer le SW installé.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL); // si un de ces fichiers manque, l'installation échoue (voulu)

    // Vite renomme les JS/CSS avec une empreinte (ex. /assets/index-a1b2c3.js).
    // On ne connaît pas ces noms à l'avance : on les lit dans index.html.
    const html = await (await cache.match('/')).text();
    const built = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    await cache.addAll(built);

    // Textures listées dans le catalogue : facultatives (une texture absente ne bloque pas l'installation).
    const catalog = await (await cache.match('/assets/garments/catalog.json')).json();
    const textures = catalog.garments.map((g) => g.texture).filter(Boolean);
    await Promise.allSettled(textures.map(async (url) => {
      const res = await fetch(url);
      // Pour un fichier absent, certains serveurs renvoient index.html avec le code 200 : on vérifie le type.
      if (res.ok && res.headers.get('content-type')?.startsWith('image/')) await cache.put(url, res);
    }));

    // Activer la nouvelle version tout de suite, sans attendre la fermeture des onglets.
    await self.skipWaiting();
  })());
});

// ─── 2. ACTIVATION : supprimer les anciens caches ─────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith('smartmirror-') && n !== CACHE_NAME).map((n) => caches.delete(n)),
    );
    // Prendre le contrôle des pages déjà ouvertes (sinon il faudrait recharger).
    await self.clients.claim();
  })());
});

// ─── 3. FETCH : intercepter chaque requête ────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;            // on ne met en cache que les lectures
  if (!request.url.startsWith('http')) return;     // ignorer chrome-extension://, data:, etc.

  if (request.mode === 'navigate') {
    // La page HTML : on préfère le réseau (pour avoir la dernière version), le cache sert de secours.
    event.respondWith(networkFirst(request));
  } else {
    // JS, CSS, images, modèle MediaPipe, OpenCV.js… : fichiers versionnés, le cache suffit.
    event.respondWith(cacheFirst(request));
  }
});

/** Réseau d'abord ; hors ligne → copie en cache. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('/', response.clone()); // une seule page dans cette application
    return response;
  } catch {
    return (await cache.match('/')) ?? Response.error();
  }
}

/** Cache d'abord ; sinon réseau, et on garde une copie pour la prochaine fois. */
async function cacheFirst(request) {
  // ignoreVary : Vite charge JS/CSS avec l'attribut crossorigin (en-tête Origin envoyé), et le serveur
  // répond « Vary: Origin ». Sans cette option, la copie téléchargée à l'installation (sans Origin)
  // ne serait jamais retrouvée → page sans JS ni CSS hors ligne.
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // « opaque » = réponse d'un autre domaine sans CORS (ex. <script src> vers un CDN) : on la garde aussi.
    if (response.ok || response.type === 'opaque') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()); // clone : un corps de réponse ne peut être lu qu'une fois
    }
    return response;
  } catch {
    return Response.error(); // hors ligne et jamais téléchargé : rien à proposer
  }
}
