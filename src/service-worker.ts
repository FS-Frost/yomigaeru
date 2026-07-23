/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

// $app/paths no está disponible en el SW: derivamos el base path de la propia
// ubicación del worker (servido en `<base>/service-worker.js`).
const BASE = sw.location.pathname.replace(/\/service-worker\.js$/, '');
const SHELL = `${BASE}/`;

const CACHE = `yomigaeru-${version}`;
// Shell de la app + assets estáticos + páginas prerenderizadas.
const PRECACHE = [...build, ...files, ...prerendered];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll([...PRECACHE, SHELL]);
			await sw.skipWaiting();
		})(),
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})(),
	);
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;

	const url = new URL(req.url);
	// No interceptamos orígenes externos (p.ej. la API de Gemini).
	if (url.origin !== sw.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			// Assets versionados: cache-first (inmutables).
			if (PRECACHE.includes(url.pathname)) {
				const hit = await cache.match(url.pathname);
				if (hit) return hit;
			}

			// Navegación: red primero, fallback al shell cacheado (offline-first).
			if (req.mode === 'navigate') {
				try {
					return await fetch(req);
				} catch {
					return (await cache.match(SHELL)) ?? Response.error();
				}
			}

			// Resto: red con relleno de caché, fallback a caché si offline.
			try {
				const res = await fetch(req);
				if (res.ok && res.type === 'basic') cache.put(req, res.clone());
				return res;
			} catch {
				const hit = await cache.match(req);
				if (hit) return hit;
				return Response.error();
			}
		})(),
	);
});
