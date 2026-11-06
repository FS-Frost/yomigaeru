import { describe, expect, test } from 'bun:test';
import { cardsToTsv, guessColumns, htmlToText, mapRows, parseTable } from '$lib/anki';

describe('anki', () => {
	test('TSV exportado se vuelve a leer igual', () => {
		const tsv = cardsToTsv([{ front: '食[た]べる', back: 'comer', reading: 'たべる', context: 'línea 1\nlínea 2' }], 'Mi mazo');
		const t = parseTable(tsv, 'x.tsv');
		expect(t.deck).toBe('Mi mazo');
		expect(mapRows(t, guessColumns(t))).toEqual([{ front: '食[た]べる', back: 'comer', reading: 'たべる', context: 'línea 1\nlínea 2' }]);
	});
	test('CSV con comillas y detección por contenido', () => {
		const t = parseTable('"comer, alimentarse",食べる\nbeber,飲む\n', 'a.csv');
		const map = guessColumns(t);
		expect(map.front).toBe(1);
		expect(map.back).toBe(0);
		expect(mapRows(t, map)[0]).toEqual({ front: '食べる', back: 'comer, alimentarse', reading: undefined, context: undefined });
	});
	test('htmlToText', () => {
		expect(htmlToText('<b>a</b><br>b&nbsp;&amp;c')).toBe('a\nb &c');
	});
});
