// Constantes compartidas entre el service worker y la página para la bandeja de «compartir».
// Sin imports de SvelteKit: el SW también lo importa.

export const INBOX_CACHE = 'yomigaeru-inbox';
/** Ruta (relativa al base) del JSON con los metadatos de lo compartido. */
export const INBOX_META = '/__inbox/meta.json';

export type FileKind = 'image' | 'text' | 'backup' | 'anki' | 'other';

/** Clasifica un archivo recibido por nombre y tipo. */
export function fileKind(name: string, type: string): FileKind {
	const n = name.toLowerCase();
	if (type.startsWith('image/')) return 'image';
	if (n.endsWith('.json') || type === 'application/json') return 'backup';
	if (n.endsWith('.apkg') || n.endsWith('.tsv') || n.endsWith('.csv') || type === 'text/csv' || type === 'text/tab-separated-values') return 'anki';
	if (n.endsWith('.txt') || type.startsWith('text/')) return 'text';
	return 'other';
}
