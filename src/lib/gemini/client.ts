import { GoogleGenAI, type GenerateContentConfig, type GenerateContentResponse, type Schema } from '@google/genai';
import { getAllSettings, getSetting } from '$lib/db/settings';
import { classifyError, geminiError, GeminiError, isTransient } from './errors';
import { buildJsonRequest, type InlineImage } from './request';
import { consumeJsonStream, type LoopCheck, type Stage, type UsageLike } from './stream';
import { assertBudget, recordUsage, type Feature } from './usage';

// Reexportados por compatibilidad: las rutas importan desde aquí.
export { GeminiError, errorMessage, classifyError, isTransient, errorStatus } from './errors';
export { parseJsonLoose } from './stream';
export type { Stage } from './stream';
export { isGen3Plus, type InlineImage } from './request';

let client: { key: string; ai: GoogleGenAI } | null = null;
/** Solo tests: sustituye el SDK por un doble (`models.generateContent[Stream]`). */
let testClient: GoogleGenAI | null = null;
export function _setTestClient(ai: unknown): void {
	testClient = ai as GoogleGenAI | null;
}

/** ¿Hay API key configurada? */
export async function hasGemini(): Promise<boolean> {
	return !!(await getSetting('apiKey'));
}

/** Cliente del SDK (reutilizado mientras la key no cambie). `key` permite probar una key sin guardarla. */
export async function geminiClient(key?: string): Promise<GoogleGenAI> {
	const apiKey = key ?? (await getSetting('apiKey'));
	if (!apiKey) throw geminiError('no-key');
	if (testClient) return testClient;
	if (key) return new GoogleGenAI({ apiKey });
	if (client?.key !== apiKey) client = { key: apiKey, ai: new GoogleGenAI({ apiKey }) };
	return client.ai;
}

/** Sin conexión (si el navegador lo sabe): falla al instante en vez de esperar al timeout. */
function assertOnline(): void {
	if (typeof navigator !== 'undefined' && navigator.onLine === false) throw geminiError('offline');
}

/** Reintenta `fn` ante errores pasajeros (1 s, 3 s). */
export async function withRetry<T>(fn: () => Promise<T>, delays = [1000, 3000], signal?: AbortSignal): Promise<T> {
	for (let i = 0; ; i++) {
		try {
			return await fn();
		} catch (e) {
			if (i >= delays.length || !isTransient(e) || signal?.aborted) throw e;
			await new Promise((r) => setTimeout(r, delays[i]));
		}
	}
}

/** Errores que ocurren antes de llamar (no consumen cuota): no se registran. */
const notCalled = (e: GeminiError) => e.code === 'no-key' || e.code === 'offline' || e.code === 'budget';

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * generateContent con presupuesto, reintentos y registro de uso (también si falla).
 * Lanza siempre `GeminiError`. Para respuestas no-JSON (audio).
 */
export async function generateTracked(opts: { feature: Feature; model?: string; parts: Part[]; config: GenerateContentConfig }): Promise<GenerateContentResponse> {
	const model = opts.model ?? (await getSetting('geminiModel'));
	try {
		assertOnline();
		await assertBudget();
		const ai = await geminiClient();
		const res = await withRetry(() => ai.models.generateContent({ model, contents: [{ role: 'user', parts: opts.parts }], config: opts.config }));
		await recordUsage({ feature: opts.feature, model, usage: res.usageMetadata });
		return res;
	} catch (err) {
		const e = classifyError(err);
		if (!notCalled(e)) await recordUsage({ feature: opts.feature, model, ok: false });
		throw e;
	}
}

export interface JsonOptions {
	feature: Feature;
	prompt: string;
	schema: Schema;
	image?: InlineImage;
	/** Tope de tokens de salida (frena bucles y su costo). */
	maxOutputTokens?: number;
	loop?: LoopCheck;
	signal?: AbortSignal;
	onStage?: (s: Stage) => void;
	/** Texto JSON acumulado (para mostrar tarjetas a medida que llegan). */
	onText?: (text: string) => void;
}

/**
 * Llama a Gemini en streaming forzando JSON con `responseSchema` y devuelve el objeto parseado
 * (sin validar: los llamadores validan con Zod). Corta bucles de repetición al vuelo, respeta el
 * `finishReason` y registra el uso siempre. Lanza `GeminiError` (con `partial` si llegó algo).
 */
export async function generateJson(opts: JsonOptions): Promise<unknown> {
	const { geminiModel: model, webSearch } = await getAllSettings();
	const req = buildJsonRequest({ model, prompt: opts.prompt, schema: opts.schema, image: opts.image, webSearch, maxOutputTokens: opts.maxOutputTokens });

	const controller = new AbortController();
	const onAbort = () => controller.abort();
	opts.signal?.addEventListener('abort', onAbort);

	let recorded = false;
	const record = async (usage: UsageLike | undefined, ok: boolean) => {
		if (recorded) return;
		recorded = true;
		await recordUsage({ feature: opts.feature, model, usage, ok });
	};

	try {
		assertOnline();
		await assertBudget();
		const ai = await geminiClient();
		opts.onStage?.('sending');
		const stream = await withRetry(() => ai.models.generateContentStream({ model, ...req, config: { ...req.config, abortSignal: controller.signal } }), undefined, opts.signal);
		return await consumeJsonStream(stream, {
			onStage: opts.onStage,
			onText: opts.onText,
			loop: opts.loop,
			signal: opts.signal,
			abort: () => controller.abort(),
			onUsage: (u, ok) => record(u, ok),
		});
	} catch (err) {
		const e = classifyError(err);
		if (!notCalled(e)) await record(undefined, false);
		if (opts.signal?.aborted && e.code !== 'aborted') throw geminiError('aborted').withPartial(e.partial ?? '');
		throw e;
	} finally {
		opts.signal?.removeEventListener('abort', onAbort);
	}
}

/** Valida con Zod y traduce el fallo a un `GeminiError` con el detalle del problema. */
export function validate<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown): T {
	const r = schema.safeParse(value);
	if (r.success) return r.data;
	const detail = r.error.issues
		.slice(0, 5)
		.map((i) => `${i.path.map(String).join('.') || '(raíz)'}: ${i.message}`)
		.join('; ');
	throw new GeminiError(null, { code: 'invalid', detail });
}
