import Dexie from 'dexie';
import { db, type Card, type Schedule } from '$lib/db/schema';
import { getSetting } from '$lib/db/settings';
import { newQuota, interleave, type Quota } from './quota';
import { SESSION_LIMIT, startOfDay } from './constants';

export interface DueItem {
	card: Card;
	schedule: Schedule;
	/** Atajo para `interleave`. */
	cardId: number;
}

/** Programaciones de repaso (no nuevas) vencidas en o antes de `now`, ordenadas por `due`. */
async function dueReviewSchedules(now: number): Promise<Schedule[]> {
	const parts = await Promise.all([1, 2, 3].map((st) => db.schedules.where('[state+due]').between([st, Dexie.minKey], [st, now], true, true).toArray()));
	return parts.flat().sort((a, b) => a.due - b.due);
}

/** Programaciones nuevas (state 0), en orden de creación. */
async function newSchedules(): Promise<Schedule[]> {
	const rows = await db.schedules.where('[state+due]').between([0, Dexie.minKey], [0, Dexie.maxKey]).toArray();
	return rows.sort((a, b) => a.due - b.due || a.cardId - b.cardId);
}

/** Nuevas introducidas hoy: logs de hoy cuyo estado previo era New. */
export async function introducedToday(now = Date.now(), deckCardIds?: Set<number>): Promise<number> {
	const logs = await db.reviewLogs.where('reviewedAt').aboveOrEqual(startOfDay(now)).toArray();
	return logs.filter((l) => l.state === 0 && (!deckCardIds || deckCardIds.has(l.cardId))).length;
}

/** Tarjetas activas (no suspendidas), opcionalmente de un mazo, indexadas por id. */
async function activeCards(deckId?: number): Promise<Map<number, Card>> {
	const coll = deckId === undefined ? db.cards.toCollection() : db.cards.where('deckId').equals(deckId);
	const map = new Map<number, Card>();
	await coll.each((c) => {
		if (!c.suspended) map.set(c.id!, c);
	});
	return map;
}

export interface QueueSummary {
	/** Repasos vencidos (no nuevos). */
	reviews: number;
	/** Nuevas disponibles en total (sin cupo). */
	newAvailable: number;
	/** Nuevas que entran hoy (tras cupo y freno). */
	newToday: number;
	quota: Quota;
}

async function deckQuotaLimit(deckId?: number): Promise<number> {
	if (deckId !== undefined) {
		const deck = await db.decks.get(deckId);
		if (deck?.newPerDay != null) return deck.newPerDay;
	}
	return getSetting('newPerDay');
}

async function build(now: number, deckId?: number) {
	const cards = await activeCards(deckId);
	const join = (s: Schedule): DueItem | null => {
		const card = cards.get(s.cardId);
		return card ? { card, schedule: s, cardId: s.cardId } : null;
	};
	const reviews = (await dueReviewSchedules(now)).map(join).filter((x): x is DueItem => !!x);
	const fresh = (await newSchedules()).map(join).filter((x): x is DueItem => !!x);
	const perDay = await deckQuotaLimit(deckId);
	const intro = await introducedToday(now, deckId === undefined ? undefined : new Set(cards.keys()));
	const quota = newQuota(perDay, intro, reviews.length);
	return { reviews, fresh, quota };
}

/** Resumen de la cola (Inicio y mazos). */
export async function queueSummary(now = Date.now(), deckId?: number): Promise<QueueSummary> {
	const { reviews, fresh, quota } = await build(now, deckId);
	return { reviews: reviews.length, newAvailable: fresh.length, newToday: Math.min(quota.left, fresh.length), quota };
}

/** Pendientes totales de hoy (repasos + nuevas con cupo). */
export async function countDue(now = Date.now(), deckId?: number): Promise<number> {
	const s = await queueSummary(now, deckId);
	return s.reviews + s.newToday;
}

/**
 * Sesión de estudio: repasos vencidos por `due` con las nuevas del cupo intercaladas,
 * sin dos caras de la misma tarjeta seguidas.
 */
export async function getSession(now = Date.now(), deckId?: number, limit = SESSION_LIMIT): Promise<{ items: DueItem[]; summary: QueueSummary }> {
	const { reviews, fresh, quota } = await build(now, deckId);
	const newItems = fresh.slice(0, quota.left);
	const items = interleave(reviews, newItems).slice(0, limit);
	return {
		items,
		summary: { reviews: reviews.length, newAvailable: fresh.length, newToday: newItems.length, quota },
	};
}
