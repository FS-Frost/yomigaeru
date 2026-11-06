// Utilidades de japonés y comparación de respuestas (portado y adaptado de sensei `lib/jp.ts`).
import { toHiragana, toKana, isKana, isKanji as wkIsKanji } from 'wanakana';
import { stripFurigana } from './furigana';

/** true si el carácter es un kanji (CJK + 々). */
export function isKanjiChar(ch: string): boolean {
	return wkIsKanji(ch) || ch === '々';
}

export function hasKanji(s: string): boolean {
	return [...s].some(isKanjiChar);
}

/** Kanji distintos de un texto. */
export function kanjiIn(s: string): string[] {
	return [...new Set([...s].filter((c) => isKanjiChar(c) && c !== '々'))];
}

/** ¿Contiene algún carácter japonés (kana o kanji)? */
export function hasJapanese(s: string): boolean {
	return /[぀-ヿ㐀-鿿々]/.test(s);
}

/** Katakana → hiragana sin tocar el resto (a diferencia de wanakana, no convierte romaji). */
export function kataToHira(s: string): string {
	return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * Forma normalizada de un frente para detectar duplicados: sin furigana, NFKC,
 * sin espacios ni puntuación japonesa, katakana como hiragana.
 */
export function normalizeFront(front: string): string {
	return kataToHira(stripFurigana(front).normalize('NFKC'))
		.replace(/[\s。、・「」『』（）()!?！？.,]/g, '')
		.toLowerCase();
}

/** Normaliza una lectura: katakana → hiragana, romaji → kana, sin espacios ni puntos. */
export function normalizeReading(s: string): string {
	const clean = s.trim().replace(/[\s.\-・－]/g, '');
	return kataToHira(toHiragana(clean, { passRomaji: false }));
}

/** Convierte romaji a kana mientras se escribe (IME de wanakana). */
export function romajiToKana(s: string): string {
	return toKana(s, { IMEMode: true });
}

/** Normaliza texto en español para comparar significados. */
export function normalizeMeaning(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/\(.*?\)/g, '')
		.replace(/^(el|la|los|las|un|una|unos|unas|to|a|an|the)\s+/, '')
		.replace(/[^a-z0-9ñ ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	const m = a.length;
	const n = b.length;
	if (!m) return n;
	if (!n) return m;
	let prev = Array.from({ length: n + 1 }, (_, i) => i);
	for (let i = 1; i <= m; i++) {
		const cur = [i];
		for (let j = 1; j <= n; j++) {
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = cur;
	}
	return prev[n];
}

/** Partes de un significado: "agua; líquido, fluido / jugo" → 4 opciones. */
export function meaningParts(raw: string): string[] {
	return raw
		.split(/[;,/、・\n]/)
		.map(normalizeMeaning)
		.filter(Boolean);
}

/** ¿La respuesta coincide con algún significado aceptado? Tolera tildes, artículos y erratas leves. */
export function meaningMatches(answer: string, accepted: string[]): boolean {
	const a = normalizeMeaning(answer);
	if (!a) return false;
	for (const raw of accepted) {
		const parts = [normalizeMeaning(raw), ...meaningParts(raw)].filter(Boolean);
		for (const m of parts) {
			if (a === m) return true;
			const tol = m.length <= 4 ? 0 : m.length <= 8 ? 1 : 2;
			if (levenshtein(a, m) <= tol) return true;
		}
	}
	return false;
}

/** ¿La respuesta coincide con alguna lectura aceptada (kana o romaji)? */
export function readingMatches(answer: string, accepted: string[]): boolean {
	const a = normalizeReading(answer);
	return a.length > 0 && accepted.some((r) => r && normalizeReading(r) === a);
}

/** ¿La respuesta escrita en japonés coincide con la palabra (forma o lectura)? */
export function japaneseMatches(answer: string, front: string, reading?: string): boolean {
	const a = normalizeFront(answer);
	if (!a) return false;
	if (a === normalizeFront(front)) return true;
	const r = reading ? normalizeReading(reading) : '';
	return !!r && normalizeReading(answer) === r;
}

export { isKana, toHiragana };
