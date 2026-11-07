// Lógica pura de «Crear» (entrada única): decidir 1 tarjeta o varias, y operar sobre los grupos
// de propuestas (uno por texto o por foto). Probado en tests/create.test.ts.
import { hasJapanese, normalizeFront } from '$lib/jp';
import type { Proposal } from '$lib/proposals';

export type CreateMode = 'word' | 'text';

/** Largo máximo (sin espacios) para tratar la entrada como una sola palabra/expresión. */
export const WORD_MAX = 25;
/** Máximo de fotos por tanda. */
export const MAX_PHOTOS = 10;

/**
 * ¿Una tarjeta o varias?
 * - Sin japonés (p. ej. «perro») → 1 tarjeta: se busca la palabra.
 * - Una línea corta (≤ 25) sin puntuación de oración → 1 tarjeta (猫, 食べる, 見当がつかない).
 * - Con 。！？!?. , varias líneas o más larga → varias (猫が好きです。, un párrafo).
 */
export function detectMode(input: string): CreateMode {
	const t = input.trim();
	if (!t) return 'word';
	if (!hasJapanese(t)) return 'word';
	if (/\n/.test(t)) return 'text';
	if (/[。！？!?．.]/.test(t)) return 'text';
	return t.replace(/\s/g, '').length <= WORD_MAX ? 'word' : 'text';
}

export type GroupStatus = 'pending' | 'running' | 'done' | 'error';

export interface CreateGroup {
	id: string;
	kind: 'word' | 'text' | 'image';
	/** Texto de origen (palabra o texto largo). */
	text?: string;
	/** Foto (ya recortada y comprimida) para imagen → tarjetas. */
	image?: Blob;
	status: GroupStatus;
	error?: string;
	proposals: Proposal[];
	/** Adjuntar la foto a las tarjetas (cara «Imagen»). */
	attachImage?: boolean;
}

let seq = 0;
export function groupId(): string {
	return `g${Date.now().toString(36)}${(seq++).toString(36)}`;
}

/** Cuántas propuestas se van a guardar. */
export function keptCount(groups: Pick<CreateGroup, 'proposals'>[]): number {
	return groups.reduce((a, g) => a + g.proposals.filter((p) => p.keep).length, 0);
}

/** Marca o desmarca todas; con `skipDups`, las duplicadas quedan desmarcadas al marcar todas. */
export function setAllKept(groups: Pick<CreateGroup, 'proposals'>[], keep: boolean, skipDups = true): void {
	for (const g of groups) for (const p of g.proposals) p.keep = keep && !(skipDups && p.dups.length && p.dupAction === 'skip');
}

/** Agrega propuestas a un grupo sin repetir frentes ya presentes en cualquier grupo. Devuelve las añadidas. */
export function addUnique(groups: Pick<CreateGroup, 'proposals'>[], target: Pick<CreateGroup, 'proposals'>, incoming: Proposal[]): Proposal[] {
	const seen = new Set(groups.flatMap((g) => g.proposals.map((p) => normalizeFront(p.front))));
	const added: Proposal[] = [];
	for (const p of incoming) {
		const k = normalizeFront(p.front);
		if (seen.has(k)) continue;
		seen.add(k);
		target.proposals.push(p);
		added.push(p);
	}
	return added;
}

/** Orden de revisión: como vinieron, o con las duplicadas al final. */
export function orderedProposals(ps: Proposal[], dupsLast: boolean): { p: Proposal; i: number }[] {
	const list = ps.map((p, i) => ({ p, i }));
	return dupsLast ? [...list.filter((x) => !x.p.dups.length), ...list.filter((x) => x.p.dups.length)] : list;
}
