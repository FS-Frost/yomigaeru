import { Type, type Schema } from '@google/genai';
import { z } from 'zod';

// Cada feature tiene DOS esquemas: el `Schema` de genai (fuerza el JSON) y el Zod (valida). Mantenerlos en sync.

// --- Tarjeta generada (texto -> tarjeta, foto/texto largo -> tarjetas) ---

/** Caja normalizada 0–1000 [ymin, xmin, ymax, xmax] (formato nativo de Gemini). */
const BoxZ = z
	.array(z.number())
	.length(4)
	.transform((b) => b.map((n) => Math.max(0, Math.min(1000, Math.round(n)))) as [number, number, number, number])
	.refine(([y0, x0, y1, x1]) => y1 > y0 && x1 > x0);

export const GeneratedCard = z.object({
	front: z.string(), // japonés con furigana estilo Anki: 漢字[かんじ]
	reading: z.string().default(''),
	back: z.string(), // significado en español
	context: z.string().default(''),
	examples: z.array(z.object({ jp: z.string(), es: z.string() })).default([]),
	/** Solo foto → tarjetas: dónde aparece la palabra en la imagen. Inválida → se descarta. */
	box: BoxZ.optional().catch(undefined),
});
export type GeneratedCard = z.infer<typeof GeneratedCard>;

export const GeneratedCards = z.object({ cards: z.array(GeneratedCard) });
export type GeneratedCards = z.infer<typeof GeneratedCards>;

const cardProperties = {
	front: { type: Type.STRING, description: 'Japonés con furigana estilo Anki, ej: 漢字[かんじ]' },
	reading: { type: Type.STRING, description: 'Lectura completa en kana' },
	back: { type: Type.STRING, description: 'Significado en español' },
	context: { type: Type.STRING, description: 'Oración original donde aparece o nota de uso' },
	examples: {
		type: Type.ARRAY,
		items: {
			type: Type.OBJECT,
			properties: { jp: { type: Type.STRING }, es: { type: Type.STRING } },
			required: ['jp', 'es'],
		},
	},
} satisfies Record<string, Schema>;

const cardSchema: Schema = { type: Type.OBJECT, properties: cardProperties, required: ['front', 'back'] };

/** Con caja: para foto → tarjetas. */
const cardWithBoxSchema: Schema = {
	type: Type.OBJECT,
	properties: {
		...cardProperties,
		box: {
			type: Type.ARRAY,
			items: { type: Type.INTEGER },
			description: 'Caja de la palabra en la imagen: [ymin, xmin, ymax, xmax] normalizada 0-1000',
		},
	},
	required: ['front', 'back'],
};

export const cardGeminiSchema = cardSchema;

export const cardsGeminiSchema: Schema = {
	type: Type.OBJECT,
	properties: { cards: { type: Type.ARRAY, items: cardSchema } },
	required: ['cards'],
};

export const cardsWithBoxGeminiSchema: Schema = {
	type: Type.OBJECT,
	properties: { cards: { type: Type.ARRAY, items: cardWithBoxSchema } },
	required: ['cards'],
};

// --- Desglose gramatical ---

export const GrammarBreakdown = z.object({
	summary: z.string(),
	/** Nota enfocada a la palabra que el estudiante está aprendiendo. */
	focusNote: z.string().default(''),
	tokens: z.array(
		z.object({
			surface: z.string(),
			role: z.string(), // partícula, verbo, sustantivo, etc.
			note: z.string(),
		}),
	),
});
export type GrammarBreakdown = z.infer<typeof GrammarBreakdown>;

export const grammarGeminiSchema: Schema = {
	type: Type.OBJECT,
	properties: {
		summary: { type: Type.STRING, description: 'Traducción y sentido general en español' },
		focusNote: { type: Type.STRING, description: 'Explicación enfocada en cómo se usa la palabra que el estudiante aprende (vacío si no aplica)' },
		tokens: {
			type: Type.ARRAY,
			items: {
				type: Type.OBJECT,
				properties: {
					surface: { type: Type.STRING, description: 'Fragmento japonés' },
					role: { type: Type.STRING, description: 'Función gramatical' },
					note: { type: Type.STRING, description: 'Explicación / matiz en español' },
				},
				required: ['surface', 'role', 'note'],
			},
		},
	},
	required: ['summary', 'tokens'],
};

// --- Juez de producción ---

export const Judgement = z.object({
	verdict: z.enum(['correct', 'partial', 'wrong']),
	suggestedRating: z.number().int().min(1).max(4),
	/** Qué estuvo bien o mal (partícula, conjugación, registro), en español. */
	feedback: z.string(),
	/** Respuesta corregida con furigana Anki. */
	corrected: z.string().default(''),
});
export type Judgement = z.infer<typeof Judgement>;

export const judgeGeminiSchema: Schema = {
	type: Type.OBJECT,
	properties: {
		verdict: { type: Type.STRING, enum: ['correct', 'partial', 'wrong'], description: 'correct = válida; partial = se entiende pero con error menor; wrong = incorrecta' },
		suggestedRating: { type: Type.INTEGER, description: 'Nota FSRS sugerida: 1 Repetir, 2 Difícil, 3 Bien, 4 Fácil' },
		feedback: { type: Type.STRING, description: 'Explicación breve en español de lo que estuvo bien o mal' },
		corrected: { type: Type.STRING, description: 'La respuesta correcta o corregida, con furigana estilo Anki 漢字[かな]' },
	},
	required: ['verdict', 'suggestedRating', 'feedback', 'corrected'],
};
