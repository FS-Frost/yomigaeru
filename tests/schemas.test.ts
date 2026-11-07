import { describe, expect, test } from 'bun:test';
import type { Schema } from '@google/genai';
import { cardsGeminiSchema, cardsWithBoxGeminiSchema, Judgement, parseCard, parseCards, SCHEMA_PAIRS } from '$lib/gemini/schemas';

/** Recorre un Schema de genai comprobando required = propertyOrdering = claves en cada objeto. */
function checkObjects(s: Schema, path = '$'): void {
	if (s.type === 'OBJECT' && s.properties) {
		const keys = Object.keys(s.properties);
		expect({ path, required: s.required }).toEqual({ path, required: keys });
		expect({ path, order: s.propertyOrdering }).toEqual({ path, order: keys });
		for (const [k, v] of Object.entries(s.properties)) checkObjects(v, `${path}.${k}`);
	}
	if (s.items) checkObjects(s.items, `${path}[]`);
}

describe('paridad genai ↔ Zod', () => {
	for (const [name, { gemini, zod }] of Object.entries(SCHEMA_PAIRS)) {
		test(`${name}: mismas claves`, () => {
			const g = Object.keys(gemini.properties ?? {}).sort();
			// `box` existe solo en la variante con imagen (cardsWithBoxGeminiSchema).
			const z = Object.keys(zod.shape)
				.filter((k) => k !== 'box')
				.sort();
			expect(g).toEqual(z);
		});
		test(`${name}: required y propertyOrdering completos`, () => checkObjects(gemini));
	}
	test('listas de tarjetas', () => {
		checkObjects(cardsGeminiSchema);
		checkObjects(cardsWithBoxGeminiSchema);
		expect(cardsGeminiSchema.properties?.cards.maxItems).toBe('15');
	});
});

describe('parseCard / parseCards', () => {
	const ok = { front: '猫[ねこ]', reading: 'ねこ', back: 'gato', context: '', examples: [] };

	test('null en opcionales → vacío', () => {
		const r = parseCard({ ...ok, reading: null, context: null, examples: null });
		expect('card' in r && r.card).toMatchObject({ reading: '', context: '', examples: [] });
	});

	test('faltan opcionales → defaults', () => {
		const r = parseCard({ front: '猫', back: 'gato' });
		expect('card' in r).toBe(true);
	});

	test('ejemplos incompletos se filtran', () => {
		const r = parseCard({
			...ok,
			examples: [
				{ jp: 'a', es: '' },
				{ jp: 'b', es: 'c' },
			],
		});
		expect('card' in r && r.card.examples).toEqual([{ jp: 'b', es: 'c' }]);
	});

	test.each([
		[{ ...ok, front: '' }, 'front'],
		[{ ...ok, back: '  ' }, 'back'],
		[{ ...ok, front: 'cat' }, 'japonés'],
		[{ ...ok, reading: 'わがはいConstants.ts' }, 'kana'],
		[{ ...ok, reading: 'わ'.repeat(200) }, 'larga'],
	])('descarta %#', (raw, why) => {
		const r = parseCard(raw);
		expect('problem' in r && r.problem).toContain(why);
	});

	test('caja inválida se descarta pero la tarjeta queda', () => {
		const r = parseCard({ ...ok, box: [500, 500, 100, 100] });
		expect('card' in r && r.card.box).toBeUndefined();
		const r2 = parseCard({ ...ok, box: [10, 20, 1200, 40.6] });
		expect('card' in r2 && r2.card.box).toEqual([10, 20, 1000, 41]);
	});

	test('lectura con katakana, ー y espacios es válida', () => {
		expect('card' in parseCard({ ...ok, front: 'コーヒー', reading: 'コーヒー' })).toBe(true);
		expect('card' in parseCard({ ...ok, front: '見当[けんとう]がつかぬ', reading: 'けんとう が つかぬ' })).toBe(true);
	});

	test('parseCards: acepta array o {cards}, informa descartes', () => {
		expect(parseCards([ok]).cards).toHaveLength(1);
		const r = parseCards({ cards: [ok, { front: 'x' }] });
		expect(r.cards).toHaveLength(1);
		expect(r.dropped).toHaveLength(1);
		expect(parseCards({ nope: 1 }).dropped[0]).toContain('cards');
	});
});

test('Judgement tolera null y nota como string', () => {
	expect(Judgement.parse({ verdict: 'partial', suggestedRating: '2', feedback: null, corrected: null })).toEqual({ verdict: 'partial', suggestedRating: 2, feedback: '', corrected: '' });
});
