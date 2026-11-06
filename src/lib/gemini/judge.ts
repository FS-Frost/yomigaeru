import { stripFurigana } from '$lib/furigana';
import type { Card } from '$lib/db/schema';
import { generateJson, validate } from './client';
import { Judgement, judgeGeminiSchema } from './schemas';

/**
 * Juez de producción: el alumno vio el significado en español (y quizá una frase) y escribió
 * en japonés. Gemini evalúa con matiz (partícula, conjugación, registro) y sugiere la nota FSRS.
 */
export async function judgeAnswer(card: Pick<Card, 'front' | 'back' | 'reading' | 'context'>, answer: string): Promise<Judgement> {
	const target = stripFurigana(card.front);
	const prompt = `Eres un profesor de japonés que corrige a un estudiante hispanohablante.
Se le pidió escribir en japonés la expresión que significa: «${card.back}».
Respuesta esperada: ${target}${card.reading ? ` (lectura: ${card.reading})` : ''}.
${card.context ? `Contexto de la tarjeta: ${stripFurigana(card.context)}\n` : ''}Respuesta del estudiante: «${answer.trim()}»

Evalúa:
- "verdict": "correct" si es la expresión esperada o una alternativa igual de natural y con el mismo significado (también en kana en lugar de kanji); "partial" si se entiende pero tiene un error menor (okurigana, partícula, conjugación, registro, kanji equivocado con la lectura correcta); "wrong" si no corresponde.
- "suggestedRating": 3 (Bien) o 4 (Fácil) si es correcta, 2 (Difícil) si es parcial, 1 (Repetir) si es incorrecta.
- "feedback": 1-3 frases en español, concretas: qué estuvo bien y qué corregir.
- "corrected": la forma correcta con furigana estilo Anki (漢字[かな]).
Responde solo con el JSON.`;

	const raw = await generateJson({ feature: 'judge', prompt, schema: judgeGeminiSchema });
	return validate(Judgement, raw);
}
