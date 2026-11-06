import { describe, expect, test } from 'bun:test';
import { japaneseMatches, kataToHira, meaningMatches, normalizeFront, normalizeReading, readingMatches, romajiToKana } from '$lib/jp';

describe('jp', () => {
	test('normalizeFront ignora furigana, espacios y katakana', () => {
		expect(normalizeFront('食[た]べる')).toBe('食べる');
		expect(normalizeFront(' カタカナ ')).toBe('かたかな');
		expect(normalizeFront('私[わたし]は 学生[がくせい]。')).toBe('私は学生');
	});
	test('kataToHira no toca romaji', () => {
		expect(kataToHira('テストabc')).toBe('てすとabc');
	});
	test('lecturas: romaji y katakana equivalen', () => {
		expect(normalizeReading('taberu')).toBe('たべる');
		expect(readingMatches('タベル', ['たべる'])).toBe(true);
		expect(readingMatches('tabemasu', ['たべる'])).toBe(false);
	});
	test('significados: tildes, artículos, erratas y acepciones', () => {
		expect(meaningMatches('comer', ['comer; alimentarse'])).toBe(true);
		expect(meaningMatches('alimentarse', ['comer; alimentarse'])).toBe(true);
		expect(meaningMatches('el estudiante', ['estudiante'])).toBe(true);
		expect(meaningMatches('estudiamte', ['estudiante'])).toBe(true);
		expect(meaningMatches('cancion', ['canción'])).toBe(true);
		expect(meaningMatches('perro', ['gato'])).toBe(false);
	});
	test('japaneseMatches acepta forma o lectura', () => {
		expect(japaneseMatches('食べる', '食[た]べる', 'たべる')).toBe(true);
		expect(japaneseMatches('たべる', '食[た]べる', 'たべる')).toBe(true);
		expect(japaneseMatches('のむ', '食[た]べる', 'たべる')).toBe(false);
	});
	test('IME romaji → kana', () => {
		expect(romajiToKana('taberu')).toBe('たべる');
	});
});
