import { stripFurigana } from '$lib/furigana';
import { generateJson } from './client';
import { Judgement, judgementGeminiSchema } from './schemas';

/**
 * Evalúa la respuesta de producción del alumno contra el significado esperado.
 * Acepta sinónimos y variaciones gramaticalmente correctas.
 */
export async function judgeAnswer(opts: { expectedMeaning: string; expectedJapanese: string; userAnswer: string }): Promise<Judgement> {
	const prompt = `Eres un evaluador de japonés justo pero riguroso. El alumno debía producir en japonés algo con este significado.
Significado esperado (español): "${opts.expectedMeaning}"
Respuesta modelo (japonés): "${stripFurigana(opts.expectedJapanese)}"
Respuesta del alumno: "${opts.userAnswer}"

Evalúa si la respuesta del alumno es correcta y natural (acepta sinónimos y estructuras alternativas válidas).
- "correct": true/false.
- "score": 0 a 100.
- "feedback": explicación breve en español (qué estuvo bien/mal).
- "correctedAnswer": versión corregida o mejorada en japonés (vacío si ya es correcta).
Responde solo con el JSON.`;

	const raw = await generateJson({ prompt, schema: judgementGeminiSchema });
	return Judgement.parse(JSON.parse(raw));
}
