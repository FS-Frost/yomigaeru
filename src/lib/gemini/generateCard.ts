import { generateJson, validate, type Stage } from './client';
import { retryOnBadOutput } from './cardgen';
import { GeminiError } from './errors';
import { CARD_LOOP, wordPrompt } from './request';
import { cardGeminiSchema, cardProblem, GeneratedCard } from './schemas';

/** Genera una tarjeta completa a partir de una palabra/frase japonesa o en español. */
export async function generateCardFromText(input: string, opts: { signal?: AbortSignal; onStage?: (s: Stage) => void } = {}): Promise<GeneratedCard> {
	return retryOnBadOutput(async (attempt) => {
		const raw = await generateJson({ feature: 'generateCard', prompt: wordPrompt(input, attempt), schema: cardGeminiSchema, maxOutputTokens: 4096, loop: CARD_LOOP, ...opts });
		const card = validate(GeneratedCard, raw);
		const problem = cardProblem(card);
		if (problem) throw new GeminiError(null, { code: 'invalid', detail: `Tarjeta descartada: ${problem}` });
		return card;
	});
}
