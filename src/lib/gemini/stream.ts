// Utilidades puras para respuestas JSON en streaming: extraer objetos completos de un array
// a medio llegar, detectar bucles de repetición (el modelo repitiendo un fragmento sin fin) y
// consumir el stream del SDK (sin depender de él: recibe cualquier iterable de fragmentos).
import { classifyError, finishError, geminiError, GeminiError, snippet } from './errors';

export type Stage = 'sending' | 'thinking' | 'writing' | 'done';

export interface UsageLike {
	promptTokenCount?: number;
	candidatesTokenCount?: number;
	thoughtsTokenCount?: number;
	cachedContentTokenCount?: number;
}

/** Lo mínimo que se usa de cada fragmento de `generateContentStream`. */
export interface ChunkLike {
	text?: string;
	candidates?: { finishReason?: string }[];
	usageMetadata?: UsageLike;
	promptFeedback?: { blockReason?: string };
}

export interface ConsumeOptions {
	onStage?: (s: Stage) => void;
	/** Texto acumulado tras cada fragmento. */
	onText?: (text: string) => void;
	/** Se llama siempre al terminar (bien o mal) con el último `usageMetadata`. */
	onUsage?: (usage: UsageLike | undefined, ok: boolean) => void | Promise<void>;
	loop?: LoopCheck;
	/** Corta la petición en curso (se llama al detectar un bucle). */
	abort?: () => void;
	/** Señal del usuario (Cancelar). */
	signal?: AbortSignal;
}

/**
 * Consume un stream de respuesta JSON: acumula texto, avisa etapas, corta bucles y valida el
 * `finishReason`. Devuelve el JSON parseado. Los errores son `GeminiError` con `partial`.
 */
export async function consumeJsonStream(chunks: AsyncIterable<ChunkLike>, opts: ConsumeOptions = {}): Promise<unknown> {
	let text = '';
	let usage: UsageLike | undefined;
	let finish: string | undefined;
	let block: string | undefined;
	let loopReason: string | null = null;
	let ok = false;
	opts.onStage?.('thinking');
	try {
		try {
			for await (const chunk of chunks) {
				if (chunk.usageMetadata) usage = chunk.usageMetadata;
				finish = chunk.candidates?.[0]?.finishReason ?? finish;
				block = chunk.promptFeedback?.blockReason ?? block;
				const t = chunk.text ?? '';
				if (!t) continue;
				if (!text) opts.onStage?.('writing');
				text += t;
				opts.onText?.(text);
				loopReason = detectLoop(text, opts.loop);
				if (loopReason) {
					opts.abort?.();
					break;
				}
			}
		} catch (e) {
			if (!loopReason) {
				if (opts.signal?.aborted) throw geminiError('aborted').withPartial(text);
				throw classifyError(e).withPartial(text);
			}
		}
		if (loopReason) throw new GeminiError(null, { code: 'loop', detail: `${loopReason}. Recibido: ${snippet(text, 150)}`, partial: text });
		if (opts.signal?.aborted) throw geminiError('aborted').withPartial(text);
		if (block) throw geminiError('safety', `blockReason=${block}`).withPartial(text);
		const fin = finishError(finish, text ? snippet(text, 150) : undefined);
		if (fin) throw fin.withPartial(text);
		if (!text.trim()) throw geminiError('empty', `finishReason=${finish ?? '—'}`);
		const parsed = parseJsonLoose(text);
		ok = true;
		opts.onStage?.('done');
		return parsed;
	} finally {
		await opts.onUsage?.(usage, ok);
	}
}

/** Extrae JSON aunque el modelo lo envuelva en ```json … ```. Lanza `invalid` con detalle. */
export function parseJsonLoose(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (e1) {
		const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
		if (m) {
			try {
				return JSON.parse(m[0]);
			} catch {
				// sigue abajo
			}
		}
		throw new GeminiError(null, { code: 'invalid', detail: `JSON inválido (${(e1 as Error).message}): ${snippet(text, 150)}`, partial: text });
	}
}

/**
 * Objetos completos del array `key` (primer nivel) dentro de un JSON incompleto, en orden.
 * Ej.: `{"cards":[{"a":1},{"b":` → `[{a:1}]`. Respeta strings y escapes. Los objetos que no
 * se pueden parsear se omiten.
 */
export function extractCompleteItems(text: string, key: string): unknown[] {
	const m = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(text);
	if (!m) return [];
	const out: unknown[] = [];
	let depth = 0;
	let inStr = false;
	let esc = false;
	let start = -1;
	for (let i = m.index + m[0].length; i < text.length; i++) {
		const ch = text[i];
		if (inStr) {
			if (esc) esc = false;
			else if (ch === '\\') esc = true;
			else if (ch === '"') inStr = false;
			continue;
		}
		if (ch === '"') inStr = true;
		else if (ch === '{' || ch === '[') {
			if (depth === 0 && ch === '{') start = i;
			depth++;
		} else if (ch === '}' || ch === ']') {
			if (depth === 0) break; // fin del array
			depth--;
			if (depth === 0 && ch === '}' && start >= 0) {
				try {
					out.push(JSON.parse(text.slice(start, i + 1)));
				} catch {
					// objeto mal formado: se omite
				}
				start = -1;
			}
		}
	}
	return out;
}

/** Valor de un campo string (`"key": "…"`) ya cerrado dentro de un JSON a medio llegar; `null` si aún no está. */
export function extractString(text: string, key: string): string | null {
	const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
	if (!m) return null;
	try {
		return JSON.parse(`"${m[1]}"`) as string;
	} catch {
		return null;
	}
}

export interface LoopCheck {
	/** Largo máximo de un valor string antes de considerarlo un bucle. */
	maxString?: number;
	/** Largo máximo de toda la respuesta. */
	maxTotal?: number;
}

/** Fragmento de 2–30 caracteres repetido ≥ 8 veces seguidas. */
const REPEAT = /([^]{2,30}?)\1{7,}/u;

/**
 * ¿La respuesta JSON (posiblemente incompleta) muestra un bucle de repetición?
 * Solo mira dentro de los strings (la indentación del JSON no cuenta). Devuelve el motivo o `null`.
 */
export function detectLoop(text: string, opts: LoopCheck = {}): string | null {
	const maxString = opts.maxString ?? 1200;
	const maxTotal = opts.maxTotal ?? 60_000;
	if (text.length > maxTotal) return `respuesta de ${text.length} caracteres (máx. ${maxTotal})`;
	let inStr = false;
	let esc = false;
	let start = 0;
	const check = (s: string): string | null => {
		if (s.length > maxString) return `un campo de ${s.length} caracteres (máx. ${maxString})`;
		if (s.length >= 16) {
			const r = REPEAT.exec(s.slice(-600));
			if (r) return `repetición de «${r[1]}»`;
		}
		return null;
	};
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inStr) {
			if (esc) esc = false;
			else if (ch === '\\') esc = true;
			else if (ch === '"') {
				inStr = false;
				const why = check(text.slice(start, i));
				if (why) return why;
			}
		} else if (ch === '"') {
			inStr = true;
			start = i + 1;
		}
	}
	// String abierto al final (el bucle suele estar ahí).
	return inStr ? check(text.slice(start)) : null;
}
