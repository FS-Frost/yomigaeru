// Caras de una tarjeta: cuáles admite y cómo se construye el cloze.
import { stripFurigana } from '$lib/furigana';
import type { Card, Facet } from '$lib/db/schema';

export const FACET_LABELS: Record<Facet, string> = {
	recognition: 'Reconocer',
	cloze: 'Completar frase',
	production: 'Producir (escribir en japonés)',
	visual: 'Imagen',
};

/** Palabra objetivo sin furigana. */
export function targetWord(card: Pick<Card, 'front'>): string {
	return stripFurigana(card.front).trim();
}

/** Línea del contexto que contiene la palabra (el contexto puede traer ejemplos en otras líneas). */
export function clozeSource(card: Pick<Card, 'front' | 'context'>): string | null {
	const word = targetWord(card);
	if (!word || !card.context) return null;
	for (const line of card.context.split('\n')) {
		if (stripFurigana(line).includes(word)) return line;
	}
	return null;
}

export interface Cloze {
	before: string;
	after: string;
	/** Frase completa con furigana (para el reverso). */
	full: string;
	word: string;
}

/**
 * Oculta la palabra en la frase de contexto. Se trabaja sobre el texto sin furigana
 * para no partir marcas `漢字[かな]`; el reverso muestra la frase original completa.
 */
export function buildCloze(card: Pick<Card, 'front' | 'context'>): Cloze | null {
	const line = clozeSource(card);
	if (!line) return null;
	const word = targetWord(card);
	const plain = stripFurigana(line);
	// La traducción de los ejemplos va tras « — »: no forma parte de la frase japonesa.
	const jp = plain.split(' — ')[0];
	const i = jp.indexOf(word);
	if (i < 0) return null;
	return { before: jp.slice(0, i), after: jp.slice(i + word.length), full: line.split(' — ')[0], word };
}

/** Caras que la tarjeta puede tener según su contenido. */
export function eligibleFacets(card: Pick<Card, 'front' | 'context' | 'imageId'>): Facet[] {
	const out: Facet[] = ['recognition', 'production'];
	if (clozeSource(card)) out.push('cloze');
	if (card.imageId != null) out.push('visual');
	return out;
}

/** Caras activas efectivas: las pedidas que la tarjeta admite, con `recognition` siempre. */
export function activeFacets(card: Pick<Card, 'front' | 'context' | 'imageId' | 'facets'>, wanted?: Facet[]): Facet[] {
	const eligible = new Set(eligibleFacets(card));
	const req = new Set<Facet>(['recognition', ...(wanted ?? card.facets ?? [])]);
	return [...req].filter((f) => eligible.has(f));
}
