import { base } from '$app/paths';
import { version } from '$app/environment';
import { app } from '$lib/state/app.svelte';
import { INBOX_CACHE } from './inbox-core';

const TARGET_KEY = 'yomigaeru.updateTarget';

/**
 * Solicita almacenamiento persistente para que el navegador no borre IndexedDB
 * bajo presión de espacio. Devuelve el estado final de persistencia.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
	if (await navigator.storage.persisted()) return true;
	return navigator.storage.persist();
}

let registration: ServiceWorkerRegistration | null = null;

/** Registra el service worker (solo en build) y avisa cuando hay una versión nueva esperando. */
export async function registerServiceWorker(): Promise<void> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
	if (import.meta.env.DEV) return; // el SW solo se construye en build
	checkFailedUpdate();
	try {
		registration = await navigator.serviceWorker.register(`${base}/service-worker.js`, { scope: `${base}/` });
	} catch (err) {
		console.error('SW registration failed', err);
		return;
	}
	const reg = registration;
	if (reg.waiting && navigator.serviceWorker.controller) notifyUpdate();
	reg.addEventListener('updatefound', () => {
		const sw = reg.installing;
		sw?.addEventListener('statechange', () => {
			// Solo es «actualización» si ya había un SW controlando la página.
			if (sw.state === 'installed' && navigator.serviceWorker.controller) notifyUpdate();
		});
	});
	// Buscar versiones nuevas al volver a la pestaña y cada 30 min.
	const check = () => reg.update().catch(() => {});
	document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
	setInterval(check, 30 * 60_000);
}

function notifyUpdate() {
	app.toast('Hay una versión nueva de Yomigaeru.', 'info', {
		key: 'update',
		persistent: true,
		action: { label: 'Actualizar', run: () => void applyUpdate() },
	});
}

/** Versión publicada ahora mismo (sin caché). null si no hay red. */
async function publishedVersion(): Promise<string | null> {
	try {
		const res = await fetch(`${base}/_app/version.json`, { cache: 'reload' });
		if (!res.ok) return null;
		return ((await res.json()) as { version: string }).version;
	} catch {
		return null;
	}
}

/** Activa la versión en espera y recarga. Comprueba antes que GitHub Pages ya la publicó. */
export async function applyUpdate(): Promise<void> {
	app.toast('Actualizando…', 'info', { key: 'update', persistent: true });
	const published = await publishedVersion();
	if (published === null) {
		app.toast('Sin conexión: no se puede actualizar ahora.', 'warn', { key: 'update', action: { label: 'Reintentar', run: () => void applyUpdate() } });
		return;
	}
	if (published === version && !registration?.waiting) {
		app.toast('La versión nueva aún se está publicando. Prueba en unos minutos.', 'warn', { key: 'update', action: { label: 'Reintentar', run: () => void applyUpdate() } });
		return;
	}
	try {
		sessionStorage.setItem(TARGET_KEY, published);
	} catch {
		// Sin sessionStorage: no se podrá detectar un fallo tras recargar.
	}
	const waiting = registration?.waiting;
	if (!waiting) {
		location.reload();
		return;
	}
	navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
	waiting.postMessage('SKIP_WAITING');
}

/** Tras recargar: si la versión esperada no llegó, ofrece «Forzar». */
function checkFailedUpdate() {
	let target: string | null;
	try {
		target = sessionStorage.getItem(TARGET_KEY);
		sessionStorage.removeItem(TARGET_KEY);
	} catch {
		return;
	}
	if (!target || target === version) return;
	app.toast('La actualización no se aplicó.', 'error', {
		detail: 'Puedes forzarla: se vuelve a descargar la app sin tocar tus datos.',
		action: { label: 'Forzar', run: () => void forceReload() },
	});
}

/** Desregistra el SW y borra sus cachés (no los datos de IndexedDB) y recarga. */
export async function forceReload(): Promise<void> {
	const regs = await navigator.serviceWorker?.getRegistrations?.();
	for (const r of regs ?? []) await r.unregister();
	for (const key of await caches.keys()) {
		if (key.startsWith('yomigaeru-') && key !== INBOX_CACHE) await caches.delete(key);
	}
	location.reload();
}
