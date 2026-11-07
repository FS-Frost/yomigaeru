// Bandeja de entrada: lo compartido hacia Yomigaeru (el SW lo guarda en caché) o abierto con
// Yomigaeru (File Handling, `launchQueue`). /compartir lo lee, elige destino y lo deja en
// `pending` para esa pantalla. Ref. sensei `client/inbox.ts`.
import { base } from '$app/paths';
import { INBOX_CACHE, INBOX_META } from './inbox-core';

export type Incoming = { title?: string; text?: string; url?: string; files: File[] };

/** Lee y vacía lo compartido (Share Target). null si no hay nada. */
export async function takeShared(): Promise<Incoming | null> {
	if (typeof caches === 'undefined') return null;
	const cache = await caches.open(INBOX_CACHE);
	const metaRes = await cache.match(`${base}${INBOX_META}`);
	if (!metaRes) return null;
	const meta = (await metaRes.json()) as { title?: string; text?: string; url?: string; files: { key: string; name: string; type: string }[] };
	const files: File[] = [];
	for (const f of meta.files) {
		const r = await cache.match(f.key);
		if (r) files.push(new File([await r.blob()], f.name, { type: f.type }));
	}
	await caches.delete(INBOX_CACHE);
	return { title: meta.title, text: meta.text, url: meta.url, files };
}

type LaunchParams = { files: { getFile(): Promise<File> }[] };
type LaunchQueue = { setConsumer(cb: (p: LaunchParams) => void): void };

/** Archivos abiertos con Yomigaeru desde el sistema («Abrir con»). */
export function onOpenedFiles(cb: (files: File[]) => void): void {
	const lq = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
	lq?.setConsumer(async (p) => {
		if (!p.files?.length) return;
		cb(await Promise.all(p.files.map((h) => h.getFile())));
	});
}

// Entrega a la pantalla de destino (navegación SPA: mismo documento).
export type PendingTarget = 'crear' | 'ajustes' | 'mazos';
export type Pending = { to: PendingTarget; text?: string; title?: string; files: File[]; long?: boolean };
let pending: Pending | null = null;

export function setPending(p: Pending): void {
	pending = p;
}

/** La pantalla `to` recoge lo que le llegó (una sola vez). */
export function takePending(to: PendingTarget): Pending | null {
	if (pending?.to !== to) return null;
	const p = pending;
	pending = null;
	return p;
}

/** Texto útil de lo compartido: el texto, o el título si no hay texto. Las URLs sueltas no sirven. */
export function sharedText(x: Incoming): string {
	return [x.text, x.text ? '' : x.title].filter(Boolean).join('\n').trim();
}
