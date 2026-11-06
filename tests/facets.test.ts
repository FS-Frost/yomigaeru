import { describe, expect, test } from 'bun:test';
import { activeFacets, buildCloze, eligibleFacets } from '$lib/srs/facets';

describe('caras', () => {
	const card = { front: '食[た]べる', context: '毎日[まいにち]パンを食[た]べる。\n寿司を食べる — Como sushi' };
	test('cloze sobre la línea que contiene la palabra', () => {
		const c = buildCloze(card)!;
		expect(c.word).toBe('食べる');
		expect(c.before).toBe('毎日パンを');
		expect(c.after).toBe('。');
		expect(c.full).toBe('毎日[まいにち]パンを食[た]べる。');
	});
	test('quita la traducción de los ejemplos', () => {
		expect(buildCloze({ front: '寿司', context: '寿司を食べる — Como sushi' })!.after).toBe('を食べる');
	});
	test('sin la palabra en el contexto no hay cloze', () => {
		expect(buildCloze({ front: '猫', context: '犬がいる' })).toBeNull();
		expect(eligibleFacets({ front: '猫', context: '犬がいる' })).not.toContain('cloze');
	});
	test('visual solo con imagen; recognition siempre', () => {
		expect(eligibleFacets({ front: '猫', imageId: 3 })).toContain('visual');
		expect(activeFacets({ front: '猫' }, ['visual', 'cloze'])).toEqual(['recognition']);
		expect(activeFacets({ front: '猫', imageId: 1 }, ['visual'])).toEqual(['recognition', 'visual']);
	});
});
