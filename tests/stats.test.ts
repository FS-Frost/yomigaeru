import { describe, expect, test } from 'bun:test';
import { forecast, retention, reviewsPerDay, statusOf, streaks } from '$lib/srs/stats';
import { startOfDay } from '$lib/srs/constants';

const DAY = 86_400_000;
const now = new Date(2026, 10, 6, 15, 0).getTime();
const today = startOfDay(now);
const dayAt = (offset: number) => new Date(2026, 10, 6 + offset, 12, 0).getTime();

describe('estadísticas', () => {
	test('forecast: lo atrasado cuenta hoy; nuevas no', () => {
		const f = forecast(
			[
				{ state: 2, due: today - 5 * DAY },
				{ state: 2, due: today + DAY + 10 },
				{ state: 0, due: today },
			],
			3,
			now,
		);
		expect(f).toEqual([1, 1, 0]);
	});
	test('repasos por día', () => {
		expect(reviewsPerDay([{ reviewedAt: dayAt(0) }, { reviewedAt: dayAt(-1) }, { reviewedAt: dayAt(-1) }], 3, now)).toEqual([0, 2, 1]);
	});
	test('rachas', () => {
		const logs = [-5, -4, -2, -1, 0].map((o) => ({ reviewedAt: dayAt(o) }));
		expect(streaks(logs, now)).toEqual({ current: 3, best: 3 });
		expect(streaks([{ reviewedAt: dayAt(-1) }], now).current).toBe(1);
		expect(streaks([{ reviewedAt: dayAt(-3) }], now).current).toBe(0);
	});
	test('retención solo de repasos espaciados en Review', () => {
		const r = retention([
			{ state: 2, rating: 3, elapsed_days: 3, reviewedAt: 1 },
			{ state: 2, rating: 1, elapsed_days: 5, reviewedAt: 1 },
			{ state: 1, rating: 1, elapsed_days: 0, reviewedAt: 1 },
		]);
		expect(r).toEqual({ rate: 0.5, n: 2 });
	});
	test('statusOf', () => {
		expect(statusOf({ state: 0, stability: 0 })).toBe('new');
		expect(statusOf({ state: 2, stability: 30 })).toBe('mastered');
		expect(statusOf({ state: 3, stability: 30 })).toBe('learning');
	});
});
