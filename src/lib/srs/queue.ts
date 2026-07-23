import { db, type Card, type FsrsData } from '$lib/db/schema';

export interface DueCard {
	card: Card;
	fsrs: FsrsData;
}

/** IDs de tarjetas cuyo repaso vence en o antes de `now`. */
async function dueCardIds(now: number): Promise<number[]> {
	return db.fsrsData.where('due').belowOrEqual(now).primaryKeys() as Promise<number[]>;
}

/** Cantidad de tarjetas pendientes (opcionalmente filtrada por mazo). */
export async function countDue(now: number = Date.now(), deckId?: number): Promise<number> {
	const ids = await dueCardIds(now);
	if (deckId === undefined) return ids.length;
	let n = 0;
	for (const id of ids) {
		const card = await db.cards.get(id);
		if (card?.deckId === deckId) n++;
	}
	return n;
}

/**
 * Tarjetas a repasar, ordenadas por vencimiento ascendente.
 * `limit` acota el tamaño de la sesión.
 */
export async function getDueCards(now: number = Date.now(), deckId?: number, limit = 100): Promise<DueCard[]> {
	const rows = await db.fsrsData.where('due').belowOrEqual(now).sortBy('due');
	const out: DueCard[] = [];
	for (const fsrs of rows) {
		if (out.length >= limit) break;
		const card = await db.cards.get(fsrs.cardId);
		if (!card) continue;
		if (deckId !== undefined && card.deckId !== deckId) continue;
		out.push({ card, fsrs });
	}
	return out;
}
