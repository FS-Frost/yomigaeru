// Clasificación de errores para mostrarlos al usuario (puro: probado en tests/errors.test.ts).
// Une errores de IA (GeminiError), de IndexedDB/Dexie y cualquier otro en un formato común.
import { GeminiError, redact } from '$lib/gemini/errors';

/** Qué ofrecerle al usuario junto al mensaje. */
export type ErrorAction = 'retry' | 'settings' | 'backups' | 'reload' | 'none';

export interface UserError {
	message: string;
	/** Detalle técnico (plegable, copiable). Sin datos sensibles. */
	tech?: string;
	action: ErrorAction;
	/** Clave para no repetir el mismo aviso. */
	key: string;
}

/** Nombre del error (Dexie anida el original en `inner`). */
function names(e: unknown): string[] {
	const out: string[] = [];
	let cur = e as { name?: string; inner?: unknown } | null;
	for (let i = 0; cur && i < 4; i++) {
		if (cur.name) out.push(cur.name);
		cur = cur.inner as typeof cur;
	}
	return out;
}

const text = (e: unknown) => redact(e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** Mensaje claro para errores de IndexedDB. `null` si no lo es. */
export function classifyDbError(e: unknown): UserError | null {
	const n = names(e);
	const msg = String((e as Error)?.message ?? e);
	const tech = text(e);
	if (n.includes('QuotaExceededError') || /quota/i.test(msg))
		return { message: 'Almacenamiento lleno: borra copias antiguas o tarjetas con imágenes/audio que no uses.', tech, action: 'backups', key: 'db-quota' };
	if (n.includes('MissingAPIError') || /IndexedDB API missing|indexedDB is not defined/i.test(msg))
		return { message: 'Este navegador no permite guardar datos (¿modo privado?). Abre Yomigaeru en una ventana normal.', tech, action: 'none', key: 'db-missing' };
	if (n.includes('VersionError') || /blocked|upgrade/i.test(msg))
		return { message: 'Hay otra pestaña con una versión anterior de Yomigaeru abierta. Ciérrala y recarga.', tech, action: 'reload', key: 'db-version' };
	if (n.includes('DatabaseClosedError')) return { message: 'La base de datos se cerró (actualización en otra pestaña). Recarga la página.', tech, action: 'reload', key: 'db-closed' };
	if (n.includes('DataCloneError')) return { message: 'No se pudo guardar: dato con un formato no admitido (es un error de la app).', tech, action: 'none', key: 'db-clone' };
	if (n.includes('OpenFailedError') || n.includes('InvalidStateError') || n.includes('UnknownError'))
		return { message: 'No se pudo acceder a los datos guardados. Recarga la página; si sigue, reinicia el navegador.', tech, action: 'reload', key: 'db-open' };
	if (n.includes('ConstraintError')) return { message: 'Ya existe un elemento igual.', tech, action: 'none', key: 'db-constraint' };
	return null;
}

/** Cualquier error → mensaje para el usuario. `fallback` describe qué se intentaba hacer. */
export function describeError(e: unknown, fallback = 'Algo falló'): UserError {
	if (e instanceof GeminiError) {
		const action: ErrorAction = e.action === 'settings' ? 'settings' : e.action === 'retry' ? 'retry' : 'none';
		return { message: e.message, tech: e.detail ? `${e.code} · ${redact(e.detail)}` : e.code, action, key: `ai-${e.code}` };
	}
	const db = classifyDbError(e);
	if (db) return db;
	if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) return { message: 'Sin conexión.', tech: text(e), action: 'retry', key: 'net' };
	return { message: fallback, tech: e == null ? undefined : text(e), action: 'retry', key: `err-${fallback}` };
}
