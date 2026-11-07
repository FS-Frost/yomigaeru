import { generateJson, type InlineImage, type Stage } from './client';
import { resilientCards, type CardsResult } from './cardgen';
import type { GeminiError } from './errors';
import { CARD_LOOP, imagePrompt, textPrompt, topicPrompt, type RefineOptions, type TopicRequest } from './request';
import { cardsGeminiSchema, cardsWithBoxGeminiSchema, LIMITS, TopicCards, topicGeminiSchema, type GeneratedCard } from './schemas';
import { extractString } from './stream';

export type { RefineOptions } from './request';

export interface GenOptions extends RefineOptions {
	signal?: AbortSignal;
	onStage?: (s: Stage) => void;
	/** Cada tarjeta válida en cuanto llega completa. */
	onCard?: (c: GeneratedCard) => void;
	/** Se va a reintentar automáticamente por una salida defectuosa. */
	onRetry?: (e: GeminiError) => void;
}

/** Detecta japonés en una imagen y propone tarjetas, con la caja de cada palabra. Llegan en vivo por `onCard`. */
export async function imageToCards(image: InlineImage, opts: GenOptions = {}): Promise<CardsResult> {
	return resilientCards(
		(attempt, onText) =>
			generateJson({ feature: 'imageToCards', prompt: imagePrompt(opts, attempt), schema: cardsWithBoxGeminiSchema, image, signal: opts.signal, onStage: opts.onStage, onText, loop: CARD_LOOP }),
		{ onCard: opts.onCard, onRetry: opts.onRetry },
	);
}

/** Igual que `imageToCards` pero desde un texto japonés pegado (letra, subtítulo, artículo). */
export async function textToCards(text: string, opts: GenOptions = {}): Promise<CardsResult> {
	return resilientCards(
		(attempt, onText) =>
			generateJson({ feature: 'textToCards', prompt: textPrompt(text, opts, attempt), schema: cardsGeminiSchema, signal: opts.signal, onStage: opts.onStage, onText, loop: CARD_LOOP }),
		{ onCard: opts.onCard, onRetry: opts.onRetry },
	);
}

export type TopicGenOptions = Omit<GenOptions, 'instruction' | 'previous'> &
	TopicRequest & {
		/** Nombre de mazo sugerido, en cuanto llega. */
		onDeckName?: (name: string) => void;
	};

/** Tema en español → tarjetas de vocabulario + nombre de mazo sugerido. Llegan en vivo por `onCard`. */
export async function topicToCards(topic: string, opts: TopicGenOptions): Promise<CardsResult & { deckName: string }> {
	let deckName = '';
	const seeName = (text: string) => {
		const n = extractString(text, 'deckName');
		if (n && n !== deckName) {
			deckName = n;
			opts.onDeckName?.(n);
		}
	};
	const result = await resilientCards(
		async (attempt, onText) => {
			const raw = await generateJson({
				feature: 'topicToCards',
				prompt: topicPrompt(topic, opts, attempt),
				schema: topicGeminiSchema,
				signal: opts.signal,
				onStage: opts.onStage,
				onText: (t) => (seeName(t), onText(t)),
				loop: CARD_LOOP,
				// 20 tarjetas con frase de ejemplo rondan los 7k tokens.
				maxOutputTokens: opts.count > LIMITS.cards ? 12_000 : 8192,
			});
			const parsed = TopicCards.safeParse(raw);
			if (parsed.success && parsed.data.deckName) seeName(JSON.stringify({ deckName: parsed.data.deckName }));
			return raw;
		},
		{ onCard: opts.onCard, onRetry: opts.onRetry },
	);
	return { ...result, deckName };
}
