import { Type, type Schema } from '@google/genai';
import { z } from 'zod';

// --- Tarjeta generada (texto -> tarjeta, foto -> tarjetas) ---

export const GeneratedCard = z.object({
	front: z.string(), // japonés con furigana estilo Anki: 漢字[かんじ]
	reading: z.string().default(''),
	back: z.string(), // significado en español
	context: z.string().default(''),
	examples: z.array(z.object({ jp: z.string(), es: z.string() })).default([]),
});
export type GeneratedCard = z.infer<typeof GeneratedCard>;

export const GeneratedCards = z.object({ cards: z.array(GeneratedCard) });
export type GeneratedCards = z.infer<typeof GeneratedCards>;

const cardSchema: Schema = {
	type: Type.OBJECT,
	properties: {
		front: { type: Type.STRING, description: 'Japonés con furigana estilo Anki, ej: 漢字[かんじ]' },
		reading: { type: Type.STRING, description: 'Lectura completa en kana' },
		back: { type: Type.STRING, description: 'Significado en español' },
		context: { type: Type.STRING, description: 'Nota gramatical o de uso' },
		examples: {
			type: Type.ARRAY,
			items: {
				type: Type.OBJECT,
				properties: { jp: { type: Type.STRING }, es: { type: Type.STRING } },
				required: ['jp', 'es'],
			},
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
