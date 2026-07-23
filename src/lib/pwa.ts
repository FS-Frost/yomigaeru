import { base } from '$app/paths';

/**
 * Solicita almacenamiento persistente para que el navegador no borre IndexedDB
 * bajo presión de espacio. Devuelve el estado final de persistencia.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
	if (await navigator.storage.persisted()) return true;
	return navigator.storage.persist();
}

/** Registra el service worker (offline-first). Scope = base path del sitio. */
export async function registerServiceWorker(): Promise<void> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
	if (import.meta.env.DEV) return; // el SW solo se construye en build
	try {
		await navigator.serviceWorker.register(`${base}/service-worker.js`, { scope: `${base}/` });
	} catch (err) {
		console.error('SW registration failed', err);
	}
}
