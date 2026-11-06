import { describe, expect, test } from 'bun:test';
import { buildOptions } from '$lib/srs/options';
import type { Card } from '$lib/db/schema';
import { normalizeFront } from '$lib/jp';

let id = 0;
const mk = (front: string, back: string, deckId = 1, reading?: string): Card => ({ id: ++id, deckId, front, back, reading, norm: normalizeFront(front), createdAt: 0 });

describe('opción múltiple', () => {
	const target = mk('食べる', 'comer', 1, 'たべる');
	const pool = [target, mk('飲む', 'beber'), mk('見る', 'ver'), mk('行く', 'ir'), mk('食う', 'comer'), mk('来る', 'venir', 2)];
	test('4 opciones con la correcta y sin otra respuesta válida', () => {
		const opts = buildOptions(target, 'recognition', pool, () => 0.5)!;
		expect(opts).toHaveLength(4);
		expect(opts.some((o) => o.id === target.id)).toBe(true);
		expect(opts.filter((o) => o.back === 'comer')).toHaveLength(1);
	});
	test('null si no hay 3 distractores seguros', () => {
		expect(buildOptions(target, 'recognition', [target, mk('食う', 'comer'), mk('飲む', 'beber')])).toBeNull();
	});
});
