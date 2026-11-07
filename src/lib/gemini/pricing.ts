// Precios de Gemini (USD por millón de tokens) para estimar costos. Ref. sensei `gemini/pricing.ts`.
// Son estimaciones: la factura real está en Google AI Studio. Editables por modelo en Ajustes.

export interface Price {
	input: number;
	output: number;
	/** Precio de tokens de entrada leídos de caché (si no, 25 % de input). */
	cached?: number;
}

/**
 * Precios por defecto (tier de pago estándar, tabla oficial al 2026-11-06) por prefijo de modelo.
 * Google anunció subidas para algunos desde el 2026-12-01: se editan por modelo en Ajustes.
 */
export const DEFAULT_PRICES: Record<string, Price> = {
	'gemini-4-argon': { input: 2, output: 10 },
	'gemini-3.8-flash': { input: 0.75, output: 3.75 },
	'gemini-3.8-flash-tts': { input: 0.5, output: 9 },
	'gemini-3.8-flash-lite-tts': { input: 0.5, output: 6 },
	'gemini-3.6-flash': { input: 0.75, output: 3.75 },
	'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
	'gemini-3.1-pro': { input: 2, output: 12 },
	'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
	'gemini-3.1-flash-tts': { input: 1, output: 20 },
	'gemini-3-pro': { input: 2, output: 12 },
	'gemini-3-flash': { input: 0.5, output: 3 },
	'gemini-2.5-pro': { input: 1.25, output: 10 },
	'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
	'gemini-2.5-flash-preview-tts': { input: 0.5, output: 10 },
	'gemini-2.5-pro-preview-tts': { input: 1, output: 20 },
	'gemini-2.5-flash': { input: 0.3, output: 2.5 },
	'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

/**
 * Precio de un modelo: primero el propio del usuario, luego el prefijo más largo de la tabla.
 * Un prefijo solo vale si lo que sigue es un sufijo de versión (`-preview`, `-001`…), para que
 * `…-flash-tts` no herede el de `…-flash`.
 */
export function priceFor(model: string, custom: Record<string, Price> = {}): Price | null {
	if (custom[model]) return custom[model];
	const table = { ...DEFAULT_PRICES, ...custom };
	let best: string | null = null;
	for (const key of Object.keys(table)) {
		if (model === key || (model.startsWith(key) && /^-(preview|latest|exp|\d)/.test(model.slice(key.length)))) {
			if (!best || key.length > best.length) best = key;
		}
	}
	return best ? table[best] : null;
}

/** Costo en USD de una llamada. */
export function costOf(price: Price | null, promptTokens: number, outputTokens: number, cachedTokens = 0): number | null {
	if (!price) return null;
	const cachedPrice = price.cached ?? price.input * 0.25;
	const fresh = Math.max(0, promptTokens - cachedTokens);
	return (fresh * price.input + cachedTokens * cachedPrice + outputTokens * price.output) / 1_000_000;
}

export function fmtUsd(v: number | null): string {
	if (v == null) return 'sin precio';
	if (v === 0) return '$0';
	if (v < 0.01) return `$${v.toFixed(4)}`;
	return `$${v.toFixed(2)}`;
}
