import { Type, type Schema } from '@google/genai';
import { z } from 'zod';

// Cada feature tiene DOS esquemas: el `Schema` de genai (fuerza el JSON) y el Zod (valida). Mantenerlos en sync:
// mismas claves, `required` = todas y `propertyOrdering` = orden de las claves (lo comprueba tests/schemas.test.ts).
// Los límites de largo (`maxLength`/`maxItems`) frenan los bucles de repetición del modelo.

/** Límites de largo por campo (también los usa la sanidad de tarjetas). */
export const LIMITS = { front: 60, reading: 80, back: 200, context: 400, example: 200, examples: 3, cards: 15, topicCards: 20, deckName: 40 } as const;

/** String que tolera `null`/ausente como vacío (el modelo a veces manda `null`). */
const Str = z
	.string()
	.nullish()
	.transform((v) => v ?? '');

/** Objeto genai con todas las claves obligatorias y en orden. */
function object(properties: Record<string, Schema>, description?: string): Schema {
	const keys = Object.keys(properties);
	return { type: Type.OBJECT, properties, required: keys, propertyOrdering: keys, ...(description ? { description } : {}) };
}
const str = (description: string, maxLength?: number): Schema => ({ type: Type.STRING, description, ...(maxLength ? { maxLength: String(maxLength) } : {}) });

// --- Tarjeta generada (texto -> tarjeta, foto/texto largo -> tarjetas) ---

/** Caja normalizada 0–1000 [ymin, xmin, ymax, xmax] (formato nativo de Gemini). */
const BoxZ = z
	.array(z.number())
	.length(4)
	.transform((b) => b.map((n) => Math.max(0, Math.min(1000, Math.round(n)))) as [number, number, number, number])
	.refine(([y0, x0, y1, x1]) => y1 > y0 && x1 > x0);

const ExampleZ = z.object({ jp: Str, es: Str });

export const GeneratedCard = z.object({
	front: z.string().trim().min(1), // japonés con furigana estilo Anki: 漢字[かんじ]
	reading: Str,
	back: z.string().trim().min(1), // significado en español
	context: Str,
	examples: z
		.array(ExampleZ)
		.nullish()
		.transform((v) => (v ?? []).filter((e) => e.jp && e.es)),
	/** Solo foto → tarjetas: dónde aparece la palabra en la imagen. Inválida → se descarta. */
	box: BoxZ.optional().catch(undefined),
});
export type GeneratedCard = z.infer<typeof GeneratedCard>;

export const GeneratedCards = z.object({ cards: z.array(GeneratedCard) });
export type GeneratedCards = z.infer<typeof GeneratedCards>;

const cardProperties = {
	front: str('Japonés con furigana estilo Anki, ej: 漢字[かんじ]', LIMITS.front),
	reading: str('Lectura completa en kana (solo hiragana/katakana)', LIMITS.reading),
	back: str('Significado en español, breve', LIMITS.back),
	context: str('Oración original donde aparece o nota de uso', LIMITS.context),
	examples: {
		type: Type.ARRAY,
		maxItems: String(LIMITS.examples),
		description: 'Ejemplos (puede ir vacío)',
		items: object({ jp: str('Oración en japonés con furigana Anki', LIMITS.example), es: str('Traducción al español', LIMITS.example) }),
	},
} satisfies Record<string, Schema>;

export const cardGeminiSchema: Schema = object(cardProperties);

/** Con caja: para foto → tarjetas. */
const cardWithBoxSchema: Schema = object({
	...cardProperties,
	box: {
		type: Type.ARRAY,
		items: { type: Type.INTEGER },
		minItems: '4',
		maxItems: '4',
		description: 'Caja de la palabra en la imagen: [ymin, xmin, ymax, xmax] normalizada 0-1000',
	},
});

const cardsList = (item: Schema): Schema => object({ cards: { type: Type.ARRAY, maxItems: String(LIMITS.cards), items: item } });
export const cardsGeminiSchema: Schema = cardsList(cardGeminiSchema);
export const cardsWithBoxGeminiSchema: Schema = cardsList(cardWithBoxSchema);

/** Tema → tarjetas: nombre de mazo sugerido + hasta 20 tarjetas. */
export const topicGeminiSchema: Schema = object({
	deckName: str('Nombre corto en español para un mazo con estas tarjetas (ej. «Persona 5», «Cocina japonesa»)', LIMITS.deckName),
	cards: { type: Type.ARRAY, maxItems: String(LIMITS.topicCards), items: cardGeminiSchema },
});
export const TopicCards = z.object({ deckName: Str, cards: z.array(z.unknown()) });

const KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s〜～、。]*$/u;
const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Sanidad de una tarjeta ya validada: descarta basura típica de un bucle o de una mala extracción.
 * Devuelve el motivo del descarte o `null` si está bien.
 */
export function cardProblem(c: GeneratedCard): string | null {
	if (!JAPANESE.test(c.front)) return 'el frente no tiene japonés';
	if (c.reading && !KANA.test(c.reading)) return 'la lectura no es kana';
	if (c.front.length > LIMITS.front * 2) return 'frente demasiado largo';
	if (c.reading.length > LIMITS.reading * 2) return 'lectura demasiado larga';
	if (c.back.length > LIMITS.back * 2) return 'significado demasiado largo';
	if (c.context.length > LIMITS.context * 2) return 'contexto demasiado largo';
	return null;
}

/** Valida una tarjeta suelta: la tarjeta o el motivo del descarte. */
export function parseCard(raw: unknown): { card: GeneratedCard } | { problem: string } {
	const r = GeneratedCard.safeParse(raw);
	if (!r.success) return { problem: r.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`).join('; ') };
	const problem = cardProblem(r.data);
	return problem ? { problem } : { card: r.data };
}

/**
 * Valida tarjeta a tarjeta: las inválidas se descartan (con su motivo) en vez de invalidar todo.
 * `raw` puede ser `{cards: [...]}` o directamente el array.
 */
export function parseCards(raw: unknown): { cards: GeneratedCard[]; dropped: string[] } {
	const list = Array.isArray(raw) ? raw : (raw as { cards?: unknown } | null)?.cards;
	if (!Array.isArray(list)) return { cards: [], dropped: ['la respuesta no trae "cards"'] };
	const cards: GeneratedCard[] = [];
	const dropped: string[] = [];
	for (const item of list) {
		const r = parseCard(item);
		if ('card' in r) cards.push(r.card);
		else dropped.push(r.problem);
	}
	return { cards, dropped };
}

// --- Desglose gramatical ---

export const GrammarBreakdown = z.object({
	summary: z.string().trim().min(1),
	/** Nota enfocada a la palabra que el estudiante está aprendiendo. */
	focusNote: Str,
	tokens: z.array(
		z.object({
			surface: z.string(),
			role: Str, // partícula, verbo, sustantivo, etc.
			note: Str,
		}),
	),
});
export type GrammarBreakdown = z.infer<typeof GrammarBreakdown>;

export const grammarGeminiSchema: Schema = object({
	summary: str('Traducción y sentido general en español', 600),
	focusNote: str('Explicación enfocada en cómo se usa la palabra que el estudiante aprende (vacío si no aplica)', 600),
	tokens: {
		type: Type.ARRAY,
		maxItems: '40',
		items: object({
			surface: str('Fragmento japonés', 40),
			role: str('Función gramatical', 60),
			note: str('Explicación / matiz en español', 300),
		}),
	},
});

// --- Juez de producción ---

export const Judgement = z.object({
	verdict: z.enum(['correct', 'partial', 'wrong']),
	suggestedRating: z.coerce.number().int().min(1).max(4),
	/** Qué estuvo bien o mal (partícula, conjugación, registro), en español. */
	feedback: Str,
	/** Respuesta corregida con furigana Anki. */
	corrected: Str,
});
export type Judgement = z.infer<typeof Judgement>;

export const judgeGeminiSchema: Schema = object({
	verdict: { type: Type.STRING, format: 'enum', enum: ['correct', 'partial', 'wrong'], description: 'correct = válida; partial = se entiende pero con error menor; wrong = incorrecta' },
	suggestedRating: { type: Type.INTEGER, description: 'Nota FSRS sugerida: 1 Repetir, 2 Difícil, 3 Bien, 4 Fácil' },
	feedback: str('Explicación breve en español de lo que estuvo bien o mal', 400),
	corrected: str('La respuesta correcta o corregida, con furigana estilo Anki 漢字[かな]', 100),
});

/** Pares genai/Zod (para el test de paridad). */
export const SCHEMA_PAIRS = {
	topic: { gemini: topicGeminiSchema, zod: TopicCards },
	card: { gemini: cardGeminiSchema, zod: GeneratedCard },
	grammar: { gemini: grammarGeminiSchema, zod: GrammarBreakdown },
	judge: { gemini: judgeGeminiSchema, zod: Judgement },
} as const;
