import { newSchedule } from '$lib/srs/fsrs';
import { activeFacets } from '$lib/srs/facets';
import { normalizeFront } from '$lib/jp';
import { DAY_MS } from '$lib/srs/constants';
import { getSetting } from './settings';
import { db, type Card, type Facet, type ReviewLog, type Schedule } from './schema';

export type NewCard = Omit<Card, 'id' | 'createdAt' | 'norm'>;

/** Copia completa de una tarjeta y su progreso, para poder deshacer un borrado. */
export interface CardSnapshot {
	card: Card;
	schedules: Schedule[];
	logs: ReviewLog[];
}

export async function listCards(deckId: number): Promise<Card[]> {
	return db.cards.where('deckId').equals(deckId).reverse().sortBy('createdAt');
}

export async function getCard(id: number): Promise<Card | undefined> {
	return db.cards.get(id);
}

/** Inserta la tarjeta con sus caras (las pedidas o las por defecto que admita). Debe ir dentro de una transacción. */
async function insertCard(card: NewCard, now: number, defaults: Facet[]): Promise<number> {
	const facets = activeFacets(card, card.facets ?? defaults);
	const id = (await db.cards.add({ ...card, facets, norm: normalizeFront(card.front), createdAt: now })) as number;
	await db.schedules.bulkAdd(facets.map((f) => newSchedule(id, f, now)));
	return id;
}

/** Crea la tarjeta y la programación inicial (New) de cada cara activa. */
export async function createCard(card: NewCard): Promise<number> {
	const defaults = await getSetting('defaultFacets');
	return db.transaction('rw', db.cards, db.schedules, () => insertCard(card, Date.now(), defaults));
}

/** Inserta varias tarjetas (import / foto / texto) con su programación. */
export async function createCards(cards: NewCard[]): Promise<number[]> {
	const defaults = await getSetting('defaultFacets');
	return db.transaction('rw', db.cards, db.schedules, async () => {
		const now = Date.now();
		const ids: number[] = [];
		for (const c of cards) ids.push(await insertCard(c, now, defaults));
		return ids;
	});
}

/**
 * Actualiza la tarjeta y sincroniza sus caras: crea programación para las nuevas y
 * borra la de las que dejan de estar activas (o de ser posibles, p. ej. sin contexto).
 */
export async function updateCard(id: number, changes: Partial<Omit<Card, 'id'>>): Promise<void> {
	await db.transaction('rw', db.cards, db.schedules, async () => {
		const current = await db.cards.get(id);
		if (!current) return;
		const merged = { ...current, ...changes };
		const facets = activeFacets(merged);
		const patch: Partial<Card> = { ...changes, facets };
		if (changes.front !== undefined) patch.norm = normalizeFront(changes.front);
		await db.cards.update(id, patch);
		const existing = await db.schedules.where('cardId').equals(id).toArray();
		const have = new Set(existing.map((s) => s.facet));
		const now = Date.now();
		const add = facets.filter((f) => !have.has(f)).map((f) => newSchedule(id, f, now));
		if (add.length) await db.schedules.bulkAdd(add);
		const drop = existing.filter((s) => !facets.includes(s.facet)).map((s) => s.id!);
		if (drop.length) await db.schedules.bulkDelete(drop);
	});
}

/** Borra una tarjeta devolviendo una copia completa (tarjeta + programación + logs) para deshacer. */
export async function deleteCardWithSnapshot(id: number): Promise<CardSnapshot | null> {
	return db.transaction('rw', db.cards, db.schedules, db.reviewLogs, async () => {
		const card = await db.cards.get(id);
		if (!card) return null;
		const schedules = await db.schedules.where('cardId').equals(id).toArray();
		const logs = await db.reviewLogs.where('cardId').equals(id).toArray();
		await db.schedules.where('cardId').equals(id).delete();
		await db.reviewLogs.where('cardId').equals(id).delete();
		await db.cards.delete(id);
		return { card, schedules, logs };
	});
}

/** Restaura una tarjeta borrada preservando ids y progreso. */
export async function restoreCard(snap: CardSnapshot): Promise<void> {
	await db.transaction('rw', db.cards, db.schedules, db.reviewLogs, async () => {
		await db.cards.put(snap.card);
		if (snap.schedules.length) await db.schedules.bulkPut(snap.schedules);
		if (snap.logs.length) await db.reviewLogs.bulkPut(snap.logs);
	});
}

/** Tarjetas existentes con el mismo frente normalizado (en cualquier mazo). */
export async function findDuplicates(front: string, exceptId?: number): Promise<Card[]> {
	const norm = normalizeFront(front);
	if (!norm) return [];
	const rows = await db.cards.where('norm').equals(norm).toArray();
	return rows.filter((c) => c.id !== exceptId);
}

/** Grupos de duplicados de toda la colección (≥ 2 tarjetas con el mismo frente). */
export async function duplicateGroups(): Promise<Card[][]> {
	const by = new Map<string, Card[]>();
	await db.cards.each((c) => {
		if (!c.norm) return;
		const list = by.get(c.norm) ?? [];
		list.push(c);
		by.set(c.norm, list);
	});
	return [...by.values()].filter((g) => g.length > 1);
}

/** Añade al contexto de una tarjeta existente el de otra (fusionar duplicados), sin repetir líneas. */
export async function mergeContext(targetId: number, extra: string | undefined): Promise<void> {
	const t = await db.cards.get(targetId);
	if (!t || !extra?.trim()) return;
	const lines = new Set((t.context ?? '').split('\n').filter(Boolean));
	for (const l of extra.split('\n')) if (l.trim()) lines.add(l.trim());
	await updateCard(targetId, { context: [...lines].join('\n') });
}

/** Suspende o reanuda una tarjeta (no entra en sesiones mientras está suspendida). */
export async function setSuspended(id: number, suspended: boolean): Promise<void> {
	await db.cards.update(id, { suspended });
}

/** Pausa todas las caras de una tarjeta `days` días (mueve `due`, sin tocar estabilidad). */
export async function pauseCard(id: number, days: number, now = Date.now()): Promise<void> {
	const until = now + days * DAY_MS;
	await db.schedules
		.where('cardId')
		.equals(id)
		.modify((s) => {
			if (s.due < until) s.due = until;
		});
}

/** Mueve una tarjeta a otro mazo. */
export async function moveCard(id: number, deckId: number): Promise<void> {
	await db.cards.update(id, { deckId });
}
