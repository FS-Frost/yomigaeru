/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { build, files, prerendered, version } from '$service-worker';
import { INBOX_CACHE, INBOX_META } from '$lib/inbox-core';

const sw = self as unknown as ServiceWorkerGlobalScope;

// $app/paths no está disponible en el SW: derivamos el base path de la propia
// ubicación del worker (servido en `<base>/service-worker.js`).
const BASE = sw.location.pathname.replace(/\/service-worker\.js$/, '');
const SHELL = `${BASE}/`;

const CACHE = `yomigaeru-${version}`;
// Shell de la app + assets estáticos + páginas prerenderizadas.
const PRECACHE = [...build, ...files, ...prerendered];
// Cachés que sobreviven a las versiones (la bandeja de compartir).
const KEPT = new Set([INBOX_CACHE]);

sw.addEventListener('install', (event) => {
	// Sin skipWaiting: la versión nueva espera a que la página la active (toast «Actualizar»),
	// así una pestaña abierta no pierde los chunks de su versión a mitad de sesión.
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			// Sin duplicados: `prerendered` ya trae el shell (`<base>/`) y addAll rechaza URLs repetidas
			// (InvalidStateError), lo que dejaba el SW sin instalar.
			await cache.addAll([...new Set([...PRECACHE, SHELL])]);
		})(),
	);
});

sw.addEventListener('message', (event) => {
	if (event.data === 'SKIP_WAITING') sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE && !KEPT.has(key)) await caches.delete(key);
			}
			await sw.clients.claim();
		})(),
	);
});

/**
 * Compartir hacia Yomigaeru (manifest `share_target`, POST multipart a <base>/compartir):
 * se guarda en la caché-bandeja y se redirige a /compartir, que la lee (lib/inbox.ts).
 */
async function receiveShare(req: Request): Promise<Response> {
	const form = await req.formData();
	const cache = await caches.open(INBOX_CACHE);
	const meta: { title?: string; text?: string; url?: string; files: { key: string; name: string; type: string }[] } = {
		title: (form.get('title') as string) || undefined,
		text: (form.get('text') as string) || undefined,
		url: (form.get('url') as string) || undefined,
		files: [],
	};
	let i = 0;
	for (const f of form.getAll('files')) {
		if (!(f instanceof File)) continue;
		const key = `${BASE}/__inbox/${i++}`;
		await cache.put(key, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream' } }));
		meta.files.push({ key, name: f.name, type: f.type });
	}
	await cache.put(`${BASE}${INBOX_META}`, new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }));
	return Response.redirect(`${BASE}/compartir?compartido=1`, 303);
}

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	const url = new URL(req.url);
	// No interceptamos orígenes externos (p.ej. la API de Gemini).
	if (url.origin !== sw.location.origin) return;

	if (req.method === 'POST' && url.pathname.replace(/\/$/, '') === `${BASE}/compartir`) {
		event.respondWith(receiveShare(req).catch(() => Response.redirect(`${BASE}/compartir?error=1`, 303)));
		return;
	}
	if (req.method !== 'GET') return;

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
