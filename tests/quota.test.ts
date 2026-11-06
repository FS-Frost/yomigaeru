import { describe, expect, test } from 'bun:test';
import { interleave, newQuota, separateSiblings } from '$lib/srs/quota';
import { BRAKE_HALF, BRAKE_STOP } from '$lib/srs/constants';

describe('cupo de nuevas', () => {
	test('sin freno', () => {
		expect(newQuota(20, 5, 10)).toEqual({ left: 15, limit: 20, brake: 'none' });
	});
	test('freno a la mitad', () => {
		expect(newQuota(20, 0, BRAKE_HALF)).toEqual({ left: 10, limit: 10, brake: 'half' });
	});
	test('freno total', () => {
		expect(newQuota(20, 0, BRAKE_STOP).left).toBe(0);
	});
	test('nunca negativo', () => {
		expect(newQuota(10, 30, 0).left).toBe(0);
	});
});

describe('intercalado', () => {
	test('una nueva cada N repasos', () => {
		const r = [1, 2, 3, 4, 5, 6].map((cardId) => ({ cardId, k: 'r' }));
		const n = [10, 11].map((cardId) => ({ cardId, k: 'n' }));
		expect(
			interleave(r, n, 3)
				.map((x) => x.k)
				.join(''),
		).toBe('rrrnrrrn');
	});
	test('las nuevas sobrantes van al final', () => {
		expect(interleave([{ cardId: 1 }], [{ cardId: 2 }, { cardId: 3 }], 4).map((x) => x.cardId)).toEqual([1, 2, 3]);
	});
	test('separa caras de la misma tarjeta', () => {
		expect(separateSiblings([{ cardId: 1 }, { cardId: 1 }, { cardId: 2 }]).map((x) => x.cardId)).toEqual([1, 2, 1]);
	});
});
