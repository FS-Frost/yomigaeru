import { GoogleGenAI, type GenerateContentConfig, type GenerateContentResponse, type Schema } from '@google/genai';
import { getSetting } from '$lib/db/settings';
import { assertBudget, BudgetError, recordUsage, type Feature } from './usage';

/** Error con mensaje en español listo para mostrar. */
export class GeminiError extends Error {}

export interface InlineImage {
	mimeType: string;
	/** Datos en base64 sin el prefijo `data:...;base64,`. */
	base64: string;
}

let client: { key: string; ai: GoogleGenAI } | null = null;

/** ¿Hay API key configurada? */
export async function hasGemini(): Promise<boolean> {
	return !!(await getSetting('apiKey'));
}

async function getClient(): Promise<GoogleGenAI> {
	const apiKey = await getSetting('apiKey');
	if (!apiKey) throw new GeminiError('Falta la API key de Gemini. Configúrala en Ajustes.');
	// Se reutiliza la instancia mientras la key no cambie.
	if (client?.key !== apiKey) client = { key: apiKey, ai: new GoogleGenAI({ apiKey }) };
	return client.ai;
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
	const s = errorStatus(e);
	return s === 429 || s === 500 || s === 502 || s === 503 || s === 504;
}

/** Mensaje en español para un error de Gemini. */
export function errorMessage(e: unknown): string {
	if (e instanceof GeminiError || e instanceof BudgetError) return e.message;
	const raw = e instanceof Error ? e.message : String(e);
	const status = errorStatus(e);
	if (status === 500 || status === 502 || status === 503 || status === 504) return 'Gemini no está disponible ahora mismo. Inténtalo de nuevo en unos segundos.';
	if (status === 429) return 'Gemini limitó las peticiones (cuota o demasiadas seguidas). Espera un poco y reintenta.';
	if (status === 401 || status === 403) return 'Gemini rechazó la API key (revísala en Ajustes; si la restringiste por dominio, incluye esta dirección).';
	if (status === 404) return 'El modelo de Gemini configurado no existe (revísalo en Ajustes).';
	if (/failed to fetch|network/i.test(raw)) return 'Sin conexión: la IA necesita internet.';
	// Mensajes JSON anidados del SDK: extraer el texto legible.
	const inner = raw
		.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g)
		?.pop()
		?.replace(/^"message"\s*:\s*"/, '')
		.replace(/"$/, '');
	const msg = inner ? inner.replace(/\\+n/g, ' ').replace(/\\+"/g, '"').replace(/\\+/g, '') : raw;
	return `Error de Gemini: ${msg.length > 300 ? msg.slice(0, 300) + '…' : msg}`;
}

/** Reintenta `fn` ante errores pasajeros (1 s, 3 s). */
export async function withRetry<T>(fn: () => Promise<T>, delays = [1000, 3000]): Promise<T> {
	for (let i = 0; ; i++) {
		try {
			return await fn();
		} catch (e) {
			if (i >= delays.length || !isTransient(e)) throw e;
			await new Promise((r) => setTimeout(r, delays[i]));
		}
	}
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * generateContent con presupuesto, reintentos y registro de uso (también si falla).
 * Lanza siempre `GeminiError` con mensaje en español.
 */
export async function generateTracked(opts: { feature: Feature; model?: string; parts: Part[]; config: GenerateContentConfig }): Promise<GenerateContentResponse> {
	const model = opts.model ?? (await getSetting('geminiModel'));
	try {
		await assertBudget();
		const ai = await getClient();
		const res = await withRetry(() => ai.models.generateContent({ model, contents: [{ role: 'user', parts: opts.parts }], config: opts.config }));
		await recordUsage({ feature: opts.feature, model, usage: res.usageMetadata });
		return res;
	} catch (err) {
		if (err instanceof GeminiError || err instanceof BudgetError) throw new GeminiError(err.message);
		await recordUsage({ feature: opts.feature, model, ok: false });
		throw new GeminiError(errorMessage(err));
	}
}

/** Extrae JSON aunque el modelo lo envuelva en ```json … ```. */
export function parseJsonLoose(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
		if (m) return JSON.parse(m[0]);
		throw new GeminiError('La IA devolvió una respuesta con un formato inesperado. Inténtalo de nuevo.');
	}
}

/**
 * Llama a Gemini forzando salida JSON con `responseSchema` y devuelve el objeto parseado
 * (sin validar). Los llamadores lo validan con Zod.
 */
export async function generateJson(opts: { feature: Feature; prompt: string; schema: Schema; image?: InlineImage; useSearch?: boolean }): Promise<unknown> {
	const model = await getSetting('geminiModel');
	const parts: Part[] = [{ text: opts.prompt }];
	if (opts.image) parts.push({ inlineData: { mimeType: opts.image.mimeType, data: opts.image.base64 } });

	const config: GenerateContentConfig = { responseMimeType: 'application/json', responseSchema: opts.schema };
	// La búsqueda web (grounding) solo es compatible con salida JSON en la serie Gemini 3.
	if (opts.useSearch && model.startsWith('gemini-3')) config.tools = [{ googleSearch: {} }];

	const res = await generateTracked({ feature: opts.feature, model, parts, config });
	const text = res.text;
	if (!text) throw new GeminiError('Respuesta vacía de Gemini.');
	return parseJsonLoose(text);
}

/** Valida con Zod y traduce el fallo a un error en español. */
export function validate<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
	try {
		return schema.parse(value);
	} catch {
		throw new GeminiError('La IA devolvió una respuesta con un formato inesperado. Inténtalo de nuevo.');
	}
}
