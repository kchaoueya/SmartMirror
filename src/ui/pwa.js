// Propriétaire : Eya — volet PWA : enregistrement du Service Worker et badge « Hors ligne ».

/**
 * Enregistre public/sw.js.
 * Uniquement en production (npm run build + npm run preview) : en développement, le cache
 * empêcherait de voir les modifications du code (Vite recharge les fichiers à chaque sauvegarde).
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[PWA] Service Worker non pris en charge par ce navigateur.');
    return;
  }
  if (!import.meta.env.PROD) {
    console.info('[PWA] Service Worker désactivé en développement.');
    return;
  }
  // Après le chargement de la page, pour ne pas ralentir le démarrage.
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.info('[PWA] Service Worker enregistré, portée :', reg.scope);
    } catch (e) {
      console.error('[PWA] Échec de l\'enregistrement du Service Worker :', e);
    }
  });
}

/** Affiche le badge « Hors ligne » quand la connexion est perdue, le cache quand elle revient. */
export function setupOfflineBadge(badge = document.getElementById('offline-badge')) {
  const update = () => { badge.hidden = navigator.onLine; };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update(); // état au lancement (l'application peut démarrer déjà hors ligne)
}
