import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import type { FsrsData, FsrsState, ReviewLog } from '$lib/db/schema';

export { Rating, State };

/** Botones de la UI mapeados a los grados de ts-fsrs. */
export const RATINGS = {
	again: Rating.Again,
	hard: Rating.Hard,
	good: Rating.Good,
	easy: Rating.Easy,
} as const;

export type RatingKey = keyof typeof RATINGS;

function makeScheduler(requestRetention = 0.9) {
	return fsrs(generatorParameters({ request_retention: requestRetention, enable_fuzz: true }));
}

/** ts-fsrs Card (con Date) -> FsrsData persistible (con epoch ms). */
function fromFsrsCard(cardId: number, card: FsrsCard): FsrsData {
	return {
		cardId,
		due: card.due.getTime(),
		stability: card.stability,
		difficulty: card.difficulty,
		elapsed_days: card.elapsed_days,
		scheduled_days: card.scheduled_days,
		learning_steps: card.learning_steps,
		reps: card.reps,
		lapses: card.lapses,
		state: card.state as FsrsState,
		last_review: card.last_review?.getTime(),
	};
}

/** FsrsData persistido -> ts-fsrs Card (con Date). */
function toFsrsCard(data: FsrsData): FsrsCard {
	return {
		due: new Date(data.due),
		stability: data.stability,
		difficulty: data.difficulty,
		elapsed_days: data.elapsed_days,
		scheduled_days: data.scheduled_days,
		learning_steps: data.learning_steps,
		reps: data.reps,
		lapses: data.lapses,
		state: data.state as State,
		last_review: data.last_review ? new Date(data.last_review) : undefined,
	};
}

/** Estado FSRS inicial para una tarjeta recién creada. */
export function newFsrsData(cardId: number, now: number = Date.now()): FsrsData {
	return fromFsrsCard(cardId, createEmptyCard(new Date(now)));
}

/**
 * Aplica una calificación a la tarjeta y devuelve el nuevo estado + log.
 * `requestRetention` proviene de los ajustes del usuario (meta de retención).
 */
export function applyRating(data: FsrsData, rating: Grade, now: number = Date.now(), requestRetention = 0.9): { next: FsrsData; log: Omit<ReviewLog, 'id'> } {
	const scheduler = makeScheduler(requestRetention);
	const { card, log } = scheduler.next(toFsrsCard(data), new Date(now), rating);
	return {
		next: fromFsrsCard(data.cardId, card),
		log: {
			cardId: data.cardId,
			rating: log.rating,
			state: log.state as FsrsState,
			due: log.due.getTime(),
			stability: log.stability,
			difficulty: log.difficulty,
			elapsed_days: log.elapsed_days,
			last_elapsed_days: log.last_elapsed_days,
			scheduled_days: log.scheduled_days,
			reviewedAt: now,
		},
	};
}

/** Previsualiza el intervalo (en días) de cada botón sin mutar nada. */
export function previewIntervals(data: FsrsData, now: number = Date.now(), requestRetention = 0.9): Record<RatingKey, number> {
	const scheduler = makeScheduler(requestRetention);
	const record = scheduler.repeat(toFsrsCard(data), new Date(now));
	return {
		again: record[Rating.Again].card.scheduled_days,
		hard: record[Rating.Hard].card.scheduled_days,
		good: record[Rating.Good].card.scheduled_days,
		easy: record[Rating.Easy].card.scheduled_days,
	};
}
