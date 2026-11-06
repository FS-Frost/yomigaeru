// Opción múltiple: distractores sacados de las propias tarjetas del alumno.
// Ref. sensei `srs/options.ts`: nunca ofrecer un distractor que también sea respuesta válida.
import { kanjiIn, meaningMatches, normalizeFront, normalizeReading } from '$lib/jp';
import type { Card, Facet } from '$lib/db/schema';

/** ¿La cara pregunta por el significado (respuesta en español) o por la palabra (en japonés)? */
export function answerKind(facet: Facet): 'meaning' | 'word' {
	return facet === 'recognition' || facet === 'visual' ? 'meaning' : 'word';
}

function sharesKanji(a: Card, b: Card): number {
	const ka = new Set(kanjiIn(normalizeFront(a.front)));
	return kanjiIn(normalizeFront(b.front)).filter((k) => ka.has(k)).length;
}

/** ¿`other` sería una respuesta válida para `target` (y por tanto un mal distractor)? */
function isAlsoValid(target: Card, other: Card, kind: 'meaning' | 'word'): boolean {
	if (other.norm === target.norm) return true;
	if (kind === 'meaning') return meaningMatches(other.back, [target.back]) || meaningMatches(target.back, [other.back]);
	if (target.reading && other.reading && normalizeReading(target.reading) === normalizeReading(other.reading)) return true;
	return false;
}

/**
 * Elige hasta 3 distractores y devuelve las 4 opciones barajadas (la correcta incluida),
 * o null si no hay suficientes distractores seguros (entonces se cae a revelar).
 * Preferencia: mismo mazo y que compartan kanji (más confundibles), luego el resto.
 */
export function buildOptions(target: Card, facet: Facet, pool: Card[], rand: () => number = Math.random): Card[] | null {
	const kind = answerKind(facet);
	const seen = new Set<string>([kind === 'meaning' ? target.back.trim() : target.norm]);
	const candidates = pool.filter((c) => c.id !== target.id && !isAlsoValid(target, c, kind));
	const scored = candidates.map((c) => ({ c, score: (c.deckId === target.deckId ? 2 : 0) + Math.min(2, sharesKanji(target, c)) + rand() * 1.5 })).sort((a, b) => b.score - a.score);
	const picked: Card[] = [];
	for (const { c } of scored) {
		const label = kind === 'meaning' ? c.back.trim() : c.norm;
		if (seen.has(label)) continue;
		seen.add(label);
		picked.push(c);
		if (picked.length === 3) break;
	}
	if (picked.length < 3) return null;
	const all = [target, ...picked];
	for (let i = all.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[all[i], all[j]] = [all[j], all[i]];
	}
	return all;
}
