// Errores tipados de Gemini. Puro (sin SDK ni Dexie) para poder probarlo con `bun test`.

export type GeminiCode =
	| 'no-key'
	| 'offline'
	| 'budget'
	| 'auth'
	| 'quota'
	| 'unavailable'
	| 'model-not-found'
	| 'bad-request'
	| 'safety'
	| 'recitation'
	| 'truncated'
	| 'loop'
	| 'invalid'
	| 'empty'
	| 'aborted'
	| 'unknown';

/** Qué puede hacer el usuario: reintentar, ir a Ajustes o nada. */
export type GeminiAction = 'retry' | 'settings' | 'none';

const INFO: Record<GeminiCode, { message: string; action: GeminiAction }> = {
	'no-key': { message: 'Falta la API key de Gemini. Configúrala en Ajustes.', action: 'settings' },
	offline: { message: 'Sin conexión: la IA necesita internet.', action: 'retry' },
	budget: { message: 'Se alcanzó el presupuesto mensual de Gemini.', action: 'settings' },
	auth: { message: 'Gemini rechazó la API key (revísala en Ajustes; si la restringiste por dominio, incluye esta dirección).', action: 'settings' },
	quota: { message: 'Gemini limitó las peticiones (cuota o demasiadas seguidas). Espera un poco y reintenta.', action: 'retry' },
	unavailable: { message: 'Gemini no está disponible ahora mismo. Inténtalo de nuevo en unos segundos.', action: 'retry' },
	'model-not-found': { message: 'El modelo de Gemini configurado no existe o no está disponible para tu key. Elige otro en Ajustes.', action: 'settings' },
	'bad-request': { message: 'Gemini rechazó la petición.', action: 'retry' },
	safety: { message: 'Gemini bloqueó la respuesta por sus filtros de seguridad. Prueba con otro contenido.', action: 'none' },
	recitation: { message: 'Gemini cortó la respuesta por parecerse demasiado a un texto protegido. Reintenta o acorta el texto.', action: 'retry' },
	truncated: { message: 'La respuesta de la IA quedó cortada (demasiado larga). Reintenta o usa un texto más corto.', action: 'retry' },
	loop: { message: 'La IA se atascó repitiendo texto y se cortó la respuesta. Reintenta.', action: 'retry' },
	invalid: { message: 'La IA devolvió una respuesta con un formato inesperado. Reintenta.', action: 'retry' },
	empty: { message: 'Gemini devolvió una respuesta vacía. Reintenta.', action: 'retry' },
	aborted: { message: 'Generación cancelada.', action: 'none' },
	unknown: { message: 'Error de Gemini.', action: 'retry' },
};

/** Error con mensaje en español listo para mostrar, código y detalle técnico. */
export class GeminiError extends Error {
	readonly code: GeminiCode;
	readonly action: GeminiAction;
	/** Detalle técnico (status, finishReason, fragmento de la respuesta). Nunca incluye la API key. */
	readonly detail?: string;
	/** Texto recibido antes del fallo (streaming): permite rescatar lo que ya llegó completo. */
	readonly partial?: string;

	constructor(message: string | null, opts: { code?: GeminiCode; detail?: string; action?: GeminiAction; cause?: unknown; partial?: string } = {}) {
		const code = opts.code ?? 'unknown';
		super(message ?? INFO[code].message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
		this.name = 'GeminiError';
		this.code = code;
		this.action = opts.action ?? INFO[code].action;
		this.detail = opts.detail;
		this.partial = opts.partial;
	}

	/** Copia con el texto parcial adjunto. */
	withPartial(partial: string): GeminiError {
		return new GeminiError(this.message, { code: this.code, detail: this.detail, action: this.action, cause: this.cause, partial });
	}
}

/** Crea un error con el mensaje por defecto de su código. */
export function geminiError(code: GeminiCode, detail?: string, cause?: unknown): GeminiError {
	return new GeminiError(null, { code, detail, cause });
}

/** Salida defectuosa del modelo (vale la pena un reintento automático). */
export function isBadOutput(e: unknown): e is GeminiError {
	return e instanceof GeminiError && (e.code === 'loop' || e.code === 'truncated' || e.code === 'invalid' || e.code === 'empty');
}

/** Quita cualquier cosa con forma de API key de Google (AIza…) de un texto. */
export function redact(text: string): string {
	return text.replace(/AIza[0-9A-Za-z_-]{20,}/g, 'AIza…').replace(/([?&]key=)[^&\s"]+/g, '$1…');
}

/** Código HTTP de un error del SDK, si se puede deducir. */
export function errorStatus(e: unknown): number | null {
	const any = e as { status?: number; code?: number } | null;
	if (typeof any?.status === 'number') return any.status;
	if (typeof any?.code === 'number') return any.code;
	const raw = e instanceof Error ? e.message : String(e);
	const m = raw.match(/"code"\s*:\s*(\d{3})/) ?? raw.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
	return m ? Number(m[1]) : null;
}

/** Errores pasajeros: vale la pena reintentar. */
export function isTransient(e: unknown): boolean {
	if (e instanceof GeminiError) return e.code === 'unavailable' || e.code === 'quota';
	const s = errorStatus(e);
	return s === 429 || s === 500 || s === 502 || s === 503 || s === 504;
}

/** Texto legible de los mensajes JSON anidados que devuelve el SDK. */
function innerMessage(raw: string): string {
	const inner = raw
		.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g)
		?.pop()
		?.replace(/^"message"\s*:\s*"/, '')
		.replace(/"$/, '');
	const msg = inner ? inner.replace(/\\+n/g, ' ').replace(/\\+"/g, '"').replace(/\\+/g, '') : raw;
	return msg.length > 300 ? msg.slice(0, 300) + '…' : msg;
}

/** Convierte cualquier error (SDK, red, abort) en un `GeminiError`. */
export function classifyError(e: unknown): GeminiError {
	if (e instanceof GeminiError) return e;
	const name = (e as { name?: string } | null)?.name;
	if (name === 'BudgetError') return new GeminiError((e as Error).message, { code: 'budget' });
	const raw = redact(e instanceof Error ? e.message : String(e));
	if (name === 'AbortError' || /aborted|abort/i.test(raw)) return geminiError('aborted', raw, e);
	const status = errorStatus(e);
	const detail = status ? `HTTP ${status}: ${raw}` : raw;
	if (status === 500 || status === 502 || status === 503 || status === 504) return geminiError('unavailable', detail, e);
	if (status === 429) return geminiError('quota', detail, e);
	if (status === 401 || status === 403) return geminiError('auth', detail, e);
	// La API devuelve 400 con API_KEY_INVALID para keys mal escritas.
	if (/API_KEY_INVALID|API key not valid/i.test(raw)) return geminiError('auth', detail, e);
	if (status === 404) return geminiError('model-not-found', detail, e);
	if (/failed to fetch|networkerror|network error|load failed|err_internet/i.test(raw)) return geminiError('offline', detail, e);
	if (status === 400) return new GeminiError(`Gemini rechazó la petición: ${innerMessage(raw)}`, { code: 'bad-request', detail, cause: e });
	return new GeminiError(`Error de Gemini: ${innerMessage(raw)}`, { code: 'unknown', detail, cause: e });
}

/** Error según el `finishReason` de la respuesta, o `null` si terminó bien. */
export function finishError(reason: string | undefined, detail?: string): GeminiError | null {
	switch (reason) {
		case undefined:
		case 'STOP':
		case 'FINISH_REASON_UNSPECIFIED':
			return null;
		case 'MAX_TOKENS':
			return geminiError('truncated', `finishReason=MAX_TOKENS${detail ? `; ${detail}` : ''}`);
		case 'SAFETY':
		case 'PROHIBITED_CONTENT':
		case 'BLOCKLIST':
		case 'SPII':
		case 'IMAGE_SAFETY':
			return geminiError('safety', `finishReason=${reason}`);
		case 'RECITATION':
			return geminiError('recitation', `finishReason=${reason}`);
		default:
			return geminiError('invalid', `finishReason=${reason}${detail ? `; ${detail}` : ''}`);
	}
}

/** Mensaje en español para cualquier error (compatibilidad con código anterior). */
export function errorMessage(e: unknown): string {
	if (e instanceof Error && e.name === 'BudgetError') return e.message;
	return classifyError(e).message;
}

/** Fragmento corto del inicio y el final de una respuesta, para el detalle técnico. */
export function snippet(text: string, n = 300): string {
	const t = redact(text);
	return t.length <= n * 2 ? t : `${t.slice(0, n)} … [${t.length - n * 2} caracteres] … ${t.slice(-n)}`;
}
