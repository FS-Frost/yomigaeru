import { expect, test } from 'bun:test';
import { addUnique, detectMode, keptCount, orderedProposals, setAllKept } from '$lib/create';
import type { Proposal } from '$lib/proposals';

test.each([
	['猫', 'word'],
	['perro', 'word'],
	['食べる', 'word'],
	['見当がつかない', 'word'],
	['  猫  ', 'word'],
	['', 'word'],
	['¿cómo se dice gato?', 'word'], // sin japonés: siempre una tarjeta
	['猫が好きです。', 'text'],
	['本当？', 'text'],
	['猫\n犬', 'text'],
	['吾輩は猫である名前はまだ無いどこで生れたかとんと見当がつかぬ', 'text'], // > 25 caracteres
	['吾輩は猫である。名前はまだ無い。', 'text'],
	['I like 猫 very much.', 'text'],
] as const)('detectMode(%p) → %s', (input, mode) => {
	expect(detectMode(input)).toBe(mode);
});

const prop = (front: string, dup = false): Proposal => ({
	front,
	reading: '',
	back: 'x',
	context: '',
	examples: [],
	keep: !dup,
	dups: dup ? [{ id: 1, deckId: 1, front, back: 'y', createdAt: 0, norm: front }] : [],
	dupAction: dup ? 'skip' : 'create',
});

test('addUnique no repite frentes entre grupos (normalizados)', () => {
	const a = { proposals: [prop('猫[ねこ]')] };
	const b = { proposals: [] as Proposal[] };
	const added = addUnique([a, b], b, [prop('猫'), prop('犬'), prop('犬[いぬ]')]);
	expect(added.map((p) => p.front)).toEqual(['犬']);
	expect(b.proposals).toHaveLength(1);
});

test('setAllKept y keptCount respetan duplicadas descartadas', () => {
	const g = [{ proposals: [prop('猫'), prop('犬', true)] }, { proposals: [prop('鳥')] }];
	setAllKept(g, false);
	expect(keptCount(g)).toBe(0);
	setAllKept(g, true);
	expect(keptCount(g)).toBe(2);
	setAllKept(g, true, false);
	expect(keptCount(g)).toBe(3);
});

test('orderedProposals pone duplicadas al final conservando el índice', () => {
	const ps = [prop('a', true), prop('b'), prop('c', true), prop('d')];
	expect(orderedProposals(ps, true).map((x) => x.i)).toEqual([1, 3, 0, 2]);
	expect(orderedProposals(ps, false).map((x) => x.i)).toEqual([0, 1, 2, 3]);
});
