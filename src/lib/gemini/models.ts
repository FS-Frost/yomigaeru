// Modelos de Gemini: lista curada (con etiqueta y costo aproximado) + clasificación de `models.list`.
// Puro: se prueba en tests/models.test.ts. Precios en pricing.ts.

export type ModelKind = 'text' | 'tts';

export interface ModelOption {
	id: string;
	/** Etiqueta corta (Recomendado, Rápido y barato…). */
	tag?: string;
	/** Descripción en español para el selector. */
	note?: string;
}

/** Recomendados para texto/visión con salida JSON (verificados con `bun run test:gemini`). */
export const CURATED_TEXT: ModelOption[] = [
	{ id: 'gemini-3.8-flash', tag: 'Recomendado', note: 'Rápido, buena calidad y lectura de imágenes' },
	{ id: 'gemini-3.1-flash-lite', tag: 'Rápido y barato', note: 'Un tercio del costo; algo menos preciso' },
	{ id: 'gemini-3.1-pro-preview', tag: 'Máxima calidad', note: 'Más lento y ~3× más caro' },
	{ id: 'gemini-2.5-flash-lite', tag: 'El más barato', note: 'Generación anterior; sin búsqueda web' },
];

/** Recomendados para audio natural (TTS). */
export const CURATED_TTS: ModelOption[] = [
	{ id: 'gemini-3.8-flash-tts', tag: 'Recomendado', note: 'Voz más natural' },
	{ id: 'gemini-3.8-flash-lite-tts', tag: 'Más barato', note: '~⅓ menos por audio' },
	{ id: 'gemini-2.5-flash-preview-tts', tag: 'Anterior', note: 'Generación anterior' },
];

export const RECOMMENDED = { text: CURATED_TEXT[0].id, tts: CURATED_TTS[0].id } as const;

/** Lo mínimo de cada entrada de `ai.models.list()`. */
export interface ListedModel {
	name?: string;
	displayName?: string;
	supportedActions?: string[];
}

/** Familias que no sirven para texto JSON ni para TTS (imagen, embeddings, live, robótica…). */
const EXCLUDE = /(embedding|image|banana|live|native-audio|transcribe|robotics|computer-use|customtools|omni|aqa|imagen|veo|lyria|gemma|learnlm)/;

/**
 * Separa la lista de la API en modelos de texto y de voz utilizables con `generateContent`.
 * Ordena de más nuevo a más viejo (por versión) y los alias `-latest` al final.
 */
export function classifyModels(list: ListedModel[]): { text: ModelOption[]; tts: ModelOption[] } {
	const text: ModelOption[] = [];
	const tts: ModelOption[] = [];
	for (const m of list) {
		const id = (m.name ?? '').replace(/^models\//, '');
		if (!id.startsWith('gemini-')) continue;
		if (m.supportedActions && !m.supportedActions.includes('generateContent')) continue;
		if (id.includes('-tts')) tts.push({ id, note: m.displayName });
		else if (!EXCLUDE.test(id)) text.push({ id, note: m.displayName });
	}
	const version = (id: string) => Number(id.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
	const sort = (a: ModelOption, b: ModelOption) => Number(a.id.includes('latest')) - Number(b.id.includes('latest')) || version(b.id) - version(a.id) || a.id.localeCompare(b.id);
	return { text: text.sort(sort), tts: tts.sort(sort) };
}

/**
 * Opciones del selector: curadas primero (con etiqueta), luego las de la API que no estén ya,
 * y el valor guardado si no aparece en ninguna (marcado «no disponible» si la lista de la API se cargó).
 */
export function modelOptions(kind: ModelKind, current: string, listed: ModelOption[] | null): (ModelOption & { group: 'curated' | 'api' | 'current' })[] {
	const curated = kind === 'text' ? CURATED_TEXT : CURATED_TTS;
	const out: (ModelOption & { group: 'curated' | 'api' | 'current' })[] = curated.map((m) => ({ ...m, group: 'curated' }));
	const ids = new Set(out.map((m) => m.id));
	for (const m of listed ?? []) {
		if (ids.has(m.id)) continue;
		ids.add(m.id);
		out.push({ ...m, group: 'api' });
	}
	if (current && !ids.has(current)) out.push({ id: current, group: 'current', tag: listed ? 'no disponible' : 'actual' });
	return out;
}
