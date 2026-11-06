import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card as FsrsCard, type Grade, type FSRS } from 'ts-fsrs';
import type { AnswerVia, Facet, FsrsState, ReviewLog, Schedule } from '$lib/db/schema';

export { Rating, State };
export type { Grade };

/** Botones de la UI mapeados a los grados de ts-fsrs. */
export const RATINGS = {
	again: Rating.Again,
	hard: Rating.Hard,
	good: Rating.Good,
	easy: Rating.Easy,
} as const;

export type RatingKey = keyof typeof RATINGS;

/** Configuración del programador: retención objetivo y parámetros calibrados opcionales. */
export interface SchedulerConfig {
	requestRetention: number;
	params?: number[] | null;
}

const cache = new Map<string, FSRS>();

/** Programador memoizado por configuración. */
export function schedulerFor(cfg: SchedulerConfig, fuzz = true): FSRS {
	const key = JSON.stringify([cfg.requestRetention, cfg.params ?? null, fuzz]);
	let s = cache.get(key);
	if (!s) {
		s = fsrs(
			generatorParameters({
				request_retention: cfg.requestRetention,
				enable_fuzz: fuzz,
				...(cfg.params?.length ? { w: cfg.params } : {}),
			}),
		);
		cache.set(key, s);
	}
	return s;
}

/** ts-fsrs Card (con Date) → campos persistibles (epoch ms). */
export function fromFsrsCard(card: FsrsCard): Omit<Schedule, 'id' | 'cardId' | 'facet'> {
	return {
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

/** Schedule persistido → ts-fsrs Card (con Date). */
export function toFsrsCard(data: Omit<Schedule, 'id' | 'cardId' | 'facet'>): FsrsCard {
	// Datos importados o corruptos (dificultad/estabilidad fuera de rango en una cara ya vista)
	// harían lanzar a ts-fsrs y romperían la sesión: se acotan a valores válidos.
	const seen = data.state !== 0;
	return {
		due: new Date(data.due),
		stability: seen ? Math.max(0.01, data.stability || 0.01) : data.stability,
		difficulty: seen ? Math.min(10, Math.max(1, data.difficulty || 5)) : data.difficulty,
		elapsed_days: data.elapsed_days,
		scheduled_days: data.scheduled_days,
		learning_steps: data.learning_steps,
		reps: data.reps,
		lapses: data.lapses,
		state: data.state as State,
		last_review: data.last_review ? new Date(data.last_review) : undefined,
	};
}

/** Programación inicial (New) de una cara. */
export function newSchedule(cardId: number, facet: Facet, now: number = Date.now()): Schedule {
	return { cardId, facet, ...fromFsrsCard(createEmptyCard(new Date(now))) };
}

/** Aplica una calificación y devuelve la nueva programación + log. */
export function applyRating(data: Schedule, rating: Grade, cfg: SchedulerConfig, opts: { now?: number; via?: AnswerVia; durationMs?: number } = {}): { next: Schedule; log: Omit<ReviewLog, 'id'> } {
	const now = opts.now ?? Date.now();
	const { card, log } = schedulerFor(cfg).next(toFsrsCard(data), new Date(now), rating);
	return {
		next: { ...data, ...fromFsrsCard(card) },
		log: {
			cardId: data.cardId,
			facet: data.facet,
			rating: log.rating,
			state: log.state as FsrsState,
			due: log.due.getTime(),
			stability: log.stability,
			difficulty: log.difficulty,
			elapsed_days: log.elapsed_days,
			last_elapsed_days: log.last_elapsed_days,
			scheduled_days: log.scheduled_days,
			reviewedAt: now,
			via: opts.via,
			durationMs: opts.durationMs,
		},
	};
}

/** Previsualiza el intervalo (en días) de cada botón sin mutar nada. */
export function previewIntervals(data: Schedule, cfg: SchedulerConfig, now: number = Date.now()): Record<RatingKey, number> {
	const record = schedulerFor(cfg).repeat(toFsrsCard(data), new Date(now));
	const days = (r: Grade) => (record[r].card.due.getTime() - now) / 86_400_000;
	return {
		again: days(Rating.Again),
		hard: days(Rating.Hard),
		good: days(Rating.Good),
		easy: days(Rating.Easy),
	};
}
