import { describe, expect, test } from 'bun:test';
import { applyRating, fromFsrsCard, newSchedule, previewIntervals, Rating, toFsrsCard } from '$lib/srs/fsrs';

const cfg = { requestRetention: 0.9 };

describe('fsrs', () => {
	test('ida y vuelta Schedule ↔ FsrsCard', () => {
		const s = newSchedule(1, 'recognition', 1_700_000_000_000);
		expect({ ...s, ...fromFsrsCard(toFsrsCard(s)) }).toEqual(s);
	});
	test('applyRating avanza y registra el estado previo', () => {
		const now = 1_700_000_000_000;
		const s = newSchedule(7, 'cloze', now);
		const { next, log } = applyRating(s, Rating.Good, cfg, { now, via: 'typed', durationMs: 1234 });
		expect(next.cardId).toBe(7);
		expect(next.facet).toBe('cloze');
		expect(next.reps).toBe(1);
		expect(log.state).toBe(0);
		expect(log.facet).toBe('cloze');
		expect(log.via).toBe('typed');
		expect(log.durationMs).toBe(1234);
	});
	test('intervalos crecientes Repetir < Difícil ≤ Bien < Fácil', () => {
		const now = 1_700_000_000_000;
		let s = newSchedule(1, 'recognition', now);
		s = applyRating(s, Rating.Good, cfg, { now }).next;
		s = applyRating(s, Rating.Good, cfg, { now: s.due }).next;
		const iv = previewIntervals(s, cfg, s.due);
		expect(iv.again).toBeLessThan(iv.hard);
		expect(iv.hard).toBeLessThanOrEqual(iv.good);
		expect(iv.good).toBeLessThan(iv.easy);
	});
});
