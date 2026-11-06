import { db, type Deck } from './schema';
import { gcImages } from './images';

export async function listDecks(): Promise<Deck[]> {
	return db.decks.orderBy('createdAt').reverse().toArray();
}

export async function createDeck(name: string, description = ''): Promise<number> {
	return db.decks.add({ name, description, createdAt: Date.now() }) as Promise<number>;
}

export async function updateDeck(id: number, changes: Partial<Omit<Deck, 'id'>>): Promise<void> {
	await db.decks.update(id, changes);
}

/** Borra el mazo y en cascada sus tarjetas, programación y logs; luego las imágenes huérfanas. */
export async function deleteDeck(id: number): Promise<void> {
	await db.transaction('rw', db.decks, db.cards, db.schedules, db.reviewLogs, async () => {
		const cardIds = (await db.cards.where('deckId').equals(id).primaryKeys()) as number[];
		await db.schedules.where('cardId').anyOf(cardIds).delete();
		await db.reviewLogs.where('cardId').anyOf(cardIds).delete();
		await db.cards.where('deckId').equals(id).delete();
		await db.decks.delete(id);
	});
	await gcImages();
}

export async function countCards(deckId: number): Promise<number> {
	return db.cards.where('deckId').equals(deckId).count();
}

/** Busca un mazo por nombre exacto o lo crea. */
export async function ensureDeckByName(name: string): Promise<number> {
	const found = await db.decks.where('name').equals(name).first();
	return found?.id ?? createDeck(name);
}
