import { describe, expect, test } from 'bun:test';
import { parseFurigana, stripFurigana } from '$lib/furigana';

describe('furigana', () => {
	test('parsea ruby y texto plano', () => {
		expect(parseFurigana('私[わたし]は 学生[がくせい]です')).toEqual([{ base: '私', rt: 'わたし' }, { base: 'は ' }, { base: '学生', rt: 'がくせい' }, { base: 'です' }]);
	});
	test('sin marcas devuelve un único segmento', () => {
		expect(parseFurigana('ありがとう')).toEqual([{ base: 'ありがとう' }]);
	});
	test('stripFurigana quita las lecturas', () => {
		expect(stripFurigana('食[た]べる')).toBe('食べる');
		expect(stripFurigana('私[わたし]は 学生[がくせい]')).toBe('私は 学生');
	});
});
