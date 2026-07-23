import { GoogleGenAI, type Schema } from '@google/genai';
import { getSetting } from '$lib/db/settings';

export class GeminiError extends Error {}

export interface InlineImage {
	mimeType: string;
	/** Datos en base64 sin el prefijo `data:...;base64,`. */
	base64: string;
}

async function getClient(): Promise<GoogleGenAI> {
	const apiKey = await getSetting('apiKey');
	if (!apiKey) throw new GeminiError('Falta la API key de Gemini. Configúrala en Ajustes.');
	return new GoogleGenAI({ apiKey });
}

/**
 * Llama a Gemini forzando salida JSON validada por `responseSchema` y devuelve
 * el texto JSON crudo. Los llamadores lo validan con Zod.
 */
export async function generateJson(opts: { prompt: string; schema: Schema; image?: InlineImage; useSearch?: boolean }): Promise<string> {
	const genAI = await getClient();
	const model = await getSetting('geminiModel');

	const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: opts.prompt }];
	if (opts.image) {
		parts.push({ inlineData: { mimeType: opts.image.mimeType, data: opts.image.base64 } });
	}

	const config: Record<string, unknown> = { responseMimeType: 'application/json', responseSchema: opts.schema };
	// La búsqueda web (grounding) solo es compatible con salida JSON en la serie Gemini 3.
	// Con modelos anteriores se omite para evitar el error 400 (degradación silenciosa).
	if (opts.useSearch && model.startsWith('gemini-3')) {
		config.tools = [{ googleSearch: {} }];
	}

	try {
		const res = await genAI.models.generateContent({
			model,
			contents: [{ role: 'user', parts }],
			config,
		});
		const text = res.text;
		if (!text) throw new GeminiError('Respuesta vacía de Gemini.');
		return text;
	} catch (err) {
		if (err instanceof GeminiError) throw err;
		const msg = err instanceof Error ? err.message : String(err);
		throw new GeminiError(`Error al llamar a Gemini: ${msg}`);
	}
}
