import { generateJson, type InlineImage, type Stage } from './client';
import { resilientCards, type CardsResult } from './cardgen';
import type { GeminiError } from './errors';
import { CARD_LOOP, imagePrompt, textPrompt, type RefineOptions } from './request';
import { cardsGeminiSchema, cardsWithBoxGeminiSchema, type GeneratedCard } from './schemas';

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
