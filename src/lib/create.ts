// Lógica pura de «Crear» (entrada única): decidir 1 tarjeta, varias o un tema, y operar sobre los
// grupos de propuestas (uno por texto, tema o foto). Probado en tests/create.test.ts.
import { hasJapanese, normalizeFront } from '$lib/jp';
import type { Proposal } from '$lib/proposals';

/**
 * - word: una palabra o expresión → 1 tarjeta (猫, «perro», «buenos días»).
 * - text: extraer de un texto japonés → varias (猫が好きです。, un párrafo).
 * - topic: vocabulario sobre un tema descrito en español → varias («anime persona 5»).
 */
export type CreateMode = 'word' | 'text' | 'topic';

export type TopicLevel = 'beginner' | 'intermediate' | 'advanced';
export const TOPIC_LEVELS: Record<TopicLevel, string> = { beginner: 'Principiante', intermediate: 'Intermedio', advanced: 'Avanzado' };
export const TOPIC_COUNTS = [5, 10, 20] as const;
export interface TopicOptions {
	count: number;
	level: TopicLevel;
}
export const TOPIC_DEFAULTS: TopicOptions = { count: 10, level: 'intermediate' };
/** Cuántas tarjetas propias se envían para que la IA no las repita. */
export const TOPIC_EXCLUDE_MAX = 300;

/** Palabras que delatan que se pide un tema y no traducir una expresión. */
const TOPIC_HINTS = /\b(tema|temas|vocabulario|palabras|sobre|acerca|relacionad[oa]s?|anime|manga|juego|videojuego|serie|series|pel[ií]cula|novela|libro|canci[oó]n|banda|j-?pop|k-?pop)\b/i;

/** Largo máximo (sin espacios) para tratar la entrada como una sola palabra/expresión. */
export const WORD_MAX = 25;
/** Máximo de fotos por tanda. */
export const MAX_PHOTOS = 10;

/**
 * ¿Una tarjeta, varias o un tema?
 * - Sin japonés: tema si hay 3+ palabras o una pista («tema», «vocabulario de», «sobre», «anime»…)
 *   → «anime persona 5», «ir al médico»; si no, 1 tarjeta → «perro», «buenos días», «cocina japonesa».
 * - Con japonés: una línea corta (≤ 25) sin puntuación de oración → 1 tarjeta (猫, 食べる);
 *   con 。！？!?. , varias líneas o más larga → varias (猫が好きです。, un párrafo).
 */
export function detectMode(input: string): CreateMode {
	const t = input.trim();
	if (!t) return 'word';
	if (!hasJapanese(t)) {
		const words = t.split(/\s+/).filter(Boolean).length;
		return words >= 3 || TOPIC_HINTS.test(t) ? 'topic' : 'word';
	}
	if (/\n/.test(t)) return 'text';
	if (/[。！？!?．.]/.test(t)) return 'text';
	return t.replace(/\s/g, '').length <= WORD_MAX ? 'word' : 'text';
}

export type GroupStatus = 'pending' | 'running' | 'done' | 'error';

export interface CreateGroup {
	id: string;
	kind: 'word' | 'text' | 'topic' | 'image';
	/** Texto de origen (palabra, texto largo o tema). */
	text?: string;
	/** Solo tema: cantidad y nivel pedidos. */
	topic?: TopicOptions;
	/** Solo tema: nombre de mazo sugerido por la IA («Persona 5»). */
	deckName?: string;
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

/** Nombre de mazo limpio a partir de la sugerencia de la IA o del propio tema. */
export function topicDeckName(suggested: string | undefined, topic: string): string {
	const clean = (x: string) => x.replace(/\s+/g, ' ').trim().slice(0, 40);
	const name = clean(suggested ?? '') || clean(topic.replace(/^(vocabulario|palabras|tema)\s+(de|sobre)\s+/i, ''));
	return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Generadas por IA';
}
