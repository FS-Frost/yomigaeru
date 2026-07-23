import { db, type Deck } from './schema';

export async function listDecks(): Promise<Deck[]> {
	return db.decks.orderBy('createdAt').reverse().toArray();
}

export async function createDeck(name: string, description = ''): Promise<number> {
	return db.decks.add({ name, description, createdAt: Date.now() }) as Promise<number>;
}

export async function updateDeck(id: number, changes: Partial<Omit<Deck, 'id'>>): Promise<void> {
	await db.decks.update(id, changes);
}

/** Borra el mazo y en cascada sus tarjetas, estado FSRS y logs. */
export async function deleteDeck(id: number): Promise<void> {
	await db.transaction('rw', db.decks, db.cards, db.fsrsData, db.reviewLogs, async () => {
		const cardIds = await db.cards.where('deckId').equals(id).primaryKeys();
		await db.fsrsData.bulkDelete(cardIds as number[]);
		await db.reviewLogs
			.where('cardId')
			.anyOf(cardIds as number[])
			.delete();
		await db.cards.where('deckId').equals(id).delete();
		await db.decks.delete(id);
	});
}

export async function countCards(deckId: number): Promise<number> {
	return db.cards.where('deckId').equals(deckId).count();
}
