import { newFsrsData } from '$lib/srs/fsrs';
import { db, type Card, type FsrsData, type ReviewLog } from './schema';

export type NewCard = Omit<Card, 'id' | 'createdAt'>;

/** Copia completa de una tarjeta y su progreso, para poder deshacer un borrado. */
export interface CardSnapshot {
	card: Card;
	fsrs?: FsrsData;
	logs: ReviewLog[];
}

export async function listCards(deckId: number): Promise<Card[]> {
	return db.cards.where('deckId').equals(deckId).reverse().sortBy('createdAt');
}

export async function getCard(id: number): Promise<Card | undefined> {
	return db.cards.get(id);
}

/** Crea la tarjeta y su estado FSRS inicial (New) en una transacción. */
export async function createCard(card: NewCard): Promise<number> {
	return db.transaction('rw', db.cards, db.fsrsData, async () => {
		const now = Date.now();
		const id = (await db.cards.add({ ...card, createdAt: now })) as number;
		await db.fsrsData.add(newFsrsData(id, now));
		return id;
	});
}

/** Inserta varias tarjetas (import / foto-a-tarjeta) con su estado FSRS. */
export async function createCards(cards: NewCard[]): Promise<number[]> {
	return db.transaction('rw', db.cards, db.fsrsData, async () => {
		const now = Date.now();
		const ids: number[] = [];
		for (const c of cards) {
			const id = (await db.cards.add({ ...c, createdAt: now })) as number;
			await db.fsrsData.add(newFsrsData(id, now));
			ids.push(id);
		}
		return ids;
	});
}

export async function updateCard(id: number, changes: Partial<Omit<Card, 'id'>>): Promise<void> {
	await db.cards.update(id, changes);
}

export async function deleteCard(id: number): Promise<void> {
	await db.transaction('rw', db.cards, db.fsrsData, db.reviewLogs, async () => {
		await db.fsrsData.delete(id);
		await db.reviewLogs.where('cardId').equals(id).delete();
		await db.cards.delete(id);
	});
}

/** Borra una tarjeta devolviendo una copia completa (tarjeta + FSRS + logs) para deshacer. */
export async function deleteCardWithSnapshot(id: number): Promise<CardSnapshot | null> {
	return db.transaction('rw', db.cards, db.fsrsData, db.reviewLogs, async () => {
		const card = await db.cards.get(id);
		if (!card) return null;
		const fsrs = await db.fsrsData.get(id);
		const logs = await db.reviewLogs.where('cardId').equals(id).toArray();
		await db.fsrsData.delete(id);
		await db.reviewLogs.where('cardId').equals(id).delete();
		await db.cards.delete(id);
		return { card, fsrs, logs };
	});
}

/** Restaura una tarjeta borrada preservando su id y su progreso FSRS. */
export async function restoreCard(snap: CardSnapshot): Promise<void> {
	await db.transaction('rw', db.cards, db.fsrsData, db.reviewLogs, async () => {
		await db.cards.put(snap.card);
		if (snap.fsrs) await db.fsrsData.put(snap.fsrs);
		if (snap.logs.length) await db.reviewLogs.bulkPut(snap.logs);
	});
}
