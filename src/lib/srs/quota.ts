// Cupo diario de nuevas y freno por carga (funciones puras, testeadas).
import { BRAKE_HALF, BRAKE_STOP, NEW_EVERY } from './constants';

export type Brake = 'none' | 'half' | 'stop';

export interface Quota {
	/** Nuevas que aún pueden entrar hoy. */
	left: number;
	/** Cupo efectivo de hoy tras el freno. */
	limit: number;
	brake: Brake;
}

/**
 * Cupo de nuevas para hoy.
 * @param perDay cupo configurado
 * @param introducedToday nuevas ya introducidas hoy
 * @param dueReviews repasos vencidos (no nuevos) pendientes
 */
export function newQuota(perDay: number, introducedToday: number, dueReviews: number): Quota {
	const brake: Brake = dueReviews >= BRAKE_STOP ? 'stop' : dueReviews >= BRAKE_HALF ? 'half' : 'none';
	const limit = brake === 'stop' ? 0 : brake === 'half' ? Math.floor(perDay / 2) : perDay;
	return { left: Math.max(0, limit - introducedToday), limit, brake };
}

/** Explicación en español del cupo (para Inicio y estudio). */
export function quotaMessage(q: Quota, dueReviews: number): string | null {
	if (q.brake === 'stop') return `Hoy no entran nuevas: tienes ${dueReviews} repasos pendientes (≥ ${BRAKE_STOP}).`;
	if (q.brake === 'half') return `Cupo de nuevas a la mitad: tienes ${dueReviews} repasos pendientes (≥ ${BRAKE_HALF}).`;
	return null;
}

/**
 * Mezcla repasos y nuevas: una nueva cada `every` repasos, y evita que dos caras de la
 * misma tarjeta queden seguidas cuando hay alternativa.
 */
export function interleave<T extends { cardId: number }>(reviews: T[], fresh: T[], every = NEW_EVERY): T[] {
	const merged: T[] = [];
	let r = 0;
	let n = 0;
	while (r < reviews.length || n < fresh.length) {
		for (let i = 0; i < every && r < reviews.length; i++) merged.push(reviews[r++]);
		if (n < fresh.length) merged.push(fresh[n++]);
	}
	return separateSiblings(merged);
}

/** Reordena mínimamente para que no haya dos elementos seguidos de la misma tarjeta. */
export function separateSiblings<T extends { cardId: number }>(items: T[]): T[] {
	const out = [...items];
	for (let i = 1; i < out.length; i++) {
		if (out[i].cardId !== out[i - 1].cardId) continue;
		const j = out.findIndex((x, k) => k > i && x.cardId !== out[i - 1].cardId && (k + 1 >= out.length || out[k + 1].cardId !== out[i].cardId));
		if (j > i) [out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}
