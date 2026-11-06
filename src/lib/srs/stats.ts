// Estadísticas a partir de `schedules` y `reviewLogs`. Las agregaciones son funciones puras (testeadas).
import { db, type Card, type ReviewLog, type Schedule } from '$lib/db/schema';
import { DAY_MS, LEECH_LAPSES, MASTERED_DAYS, startOfDay } from './constants';

export type ItemStatus = 'new' | 'learning' | 'review' | 'mastered';

export function statusOf(s: Pick<Schedule, 'state' | 'stability'>): ItemStatus {
	if (s.state === 0) return 'new';
	if (s.state === 1 || s.state === 3) return 'learning';
	return s.stability >= MASTERED_DAYS ? 'mastered' : 'review';
}

/** Repasos previstos por día en los próximos `days` días (el día 0 incluye lo atrasado). */
export function forecast(schedules: Pick<Schedule, 'state' | 'due'>[], days: number, now = Date.now()): number[] {
	const start = startOfDay(now);
	const out = new Array(days).fill(0);
	for (const s of schedules) {
		if (s.state === 0) continue;
		const i = Math.max(0, Math.floor((s.due - start) / DAY_MS));
		if (i < days) out[i]++;
	}
	return out;
}

/** Repasos por día en los últimos `days` días (índice 0 = hace days-1 días, último = hoy). */
export function reviewsPerDay(logs: Pick<ReviewLog, 'reviewedAt'>[], days: number, now = Date.now()): number[] {
	const today = startOfDay(now);
	const out = new Array(days).fill(0);
	for (const l of logs) {
		const ago = Math.floor((today - startOfDay(l.reviewedAt)) / DAY_MS);
		if (ago >= 0 && ago < days) out[days - 1 - ago]++;
	}
	return out;
}

/** Racha actual (días seguidos con algún repaso, contando hoy o ayer) y racha máxima. */
export function streaks(logs: Pick<ReviewLog, 'reviewedAt'>[], now = Date.now()): { current: number; best: number } {
	// Claves de día local (YYYY-M-D): inmunes a los cambios de horario de verano.
	const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	const prev = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
	const days = new Set(logs.map((l) => key(new Date(l.reviewedAt))));
	if (!days.size) return { current: 0, best: 0 };
	const sorted = [...new Set(logs.map((l) => startOfDay(l.reviewedAt)))].sort((a, b) => a - b);
	let best = 1;
	let run = 1;
	for (let i = 1; i < sorted.length; i++) {
		run = key(prev(new Date(sorted[i]))) === key(new Date(sorted[i - 1])) ? run + 1 : 1;
		best = Math.max(best, run);
	}
	let d = new Date(startOfDay(now));
	if (!days.has(key(d))) d = prev(d);
	let current = 0;
	while (days.has(key(d))) {
		current++;
		d = prev(d);
	}
	return { current, best };
}

/**
 * Retención real: aciertos (nota ≥ 2) entre repasos de caras que ya estaban en Review
 * y cuyo repaso anterior fue hace ≥ 1 día (excluye pasos de aprendizaje del mismo día).
 */
export function retention(logs: Pick<ReviewLog, 'state' | 'rating' | 'elapsed_days' | 'reviewedAt'>[], since = 0): { rate: number | null; n: number } {
	const eligible = logs.filter((l) => l.reviewedAt >= since && l.state === 2 && l.elapsed_days >= 1);
	if (!eligible.length) return { rate: null, n: 0 };
	return { rate: eligible.filter((l) => l.rating >= 2).length / eligible.length, n: eligible.length };
}

export interface Stats {
	forecast: number[];
	perDay: number[];
	streak: { current: number; best: number };
	retention30: { rate: number | null; n: number };
	retentionAll: { rate: number | null; n: number };
	status: Record<ItemStatus, number>;
	totalReviews: number;
	avgSeconds: number | null;
	decks: { id: number; name: string; cards: number; due: number; leeches: number; suspended: number }[];
	leeches: { card: Card; lapses: number }[];
}

export async function loadStats(now = Date.now()): Promise<Stats> {
	const [schedules, logs, cards, decks] = await Promise.all([db.schedules.toArray(), db.reviewLogs.toArray(), db.cards.toArray(), db.decks.toArray()]);
	const cardById = new Map(cards.map((c) => [c.id!, c]));
	const status: Record<ItemStatus, number> = { new: 0, learning: 0, review: 0, mastered: 0 };
	for (const s of schedules) status[statusOf(s)]++;
	const timed = logs.filter((l) => l.durationMs != null && l.durationMs > 0 && l.durationMs < 5 * 60_000);
	const lapsesByCard = new Map<number, number>();
	for (const s of schedules) lapsesByCard.set(s.cardId, Math.max(lapsesByCard.get(s.cardId) ?? 0, s.lapses));
	const leeches = [...lapsesByCard]
		.filter(([, l]) => l >= LEECH_LAPSES)
		.map(([id, lapses]) => ({ card: cardById.get(id)!, lapses }))
		.filter((x) => x.card)
		.sort((a, b) => b.lapses - a.lapses);
	return {
		forecast: forecast(
			schedules.filter((s) => !cardById.get(s.cardId)?.suspended),
			30,
			now,
		),
		perDay: reviewsPerDay(logs, 30, now),
		streak: streaks(logs, now),
		retention30: retention(logs, now - 30 * DAY_MS),
		retentionAll: retention(logs),
		status,
		totalReviews: logs.length,
		avgSeconds: timed.length ? timed.reduce((a, l) => a + l.durationMs!, 0) / timed.length / 1000 : null,
		decks: decks.map((d) => {
			const ids = new Set(cards.filter((c) => c.deckId === d.id).map((c) => c.id!));
			return {
				id: d.id!,
				name: d.name,
				cards: ids.size,
				due: schedules.filter((s) => ids.has(s.cardId) && s.state !== 0 && s.due <= now && !cardById.get(s.cardId)?.suspended).length,
				leeches: leeches.filter((l) => ids.has(l.card.id!)).length,
				suspended: cards.filter((c) => c.deckId === d.id && c.suspended).length,
			};
		}),
		leeches,
	};
}
