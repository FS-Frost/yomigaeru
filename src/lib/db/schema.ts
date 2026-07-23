import Dexie, { type EntityTable } from 'dexie';
import type { GrammarBreakdown } from '$lib/gemini/schemas';

// Estado FSRS: 0 New, 1 Learning, 2 Review, 3 Relearning (coincide con ts-fsrs State).
export type FsrsState = 0 | 1 | 2 | 3;

export interface Deck {
	id?: number;
	name: string;
	description?: string;
	createdAt: number;
}

export interface Card {
	id?: number;
	deckId: number;
	/** Texto principal en japonés. Puede incluir marcas de furigana (ver lib/furigana). */
	front: string;
	/** Traducción / significado en español. */
	back: string;
	/** Lectura pura en hiragana/katakana. */
	reading?: string;
	/** Frase de ejemplo o nota gramatical. */
	context?: string;
	/** Imagen de contexto comprimida (foto-a-tarjeta). */
	imageBlob?: Blob;
	/** Desglose gramatical IA cacheado (campo no indexado; no requiere versión de Dexie). */
	grammar?: GrammarBreakdown;
	/** Epoch ms en que se guardó el desglose gramatical cacheado. */
	grammarSavedAt?: number;
	createdAt: number;
}

/**
 * Estado de programación FSRS por tarjeta. Los campos replican ts-fsrs `Card`.
 * `due` y `last_review` se guardan como epoch ms para poder indexar/ordenar.
 */
export interface FsrsData {
	cardId: number;
	due: number;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	scheduled_days: number;
	learning_steps: number;
	reps: number;
	lapses: number;
	state: FsrsState;
	last_review?: number;
}

export interface ReviewLog {
	id?: number;
	cardId: number;
	/** Rating aplicado (ts-fsrs Rating: 1 Again, 2 Hard, 3 Good, 4 Easy). */
	rating: number;
	state: FsrsState;
	due: number;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	last_elapsed_days: number;
	scheduled_days: number;
	reviewedAt: number;
}

export interface Setting {
	key: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	value: unknown;
}

export const db = new Dexie('yomigaeru') as Dexie & {
	decks: EntityTable<Deck, 'id'>;
	cards: EntityTable<Card, 'id'>;
	fsrsData: EntityTable<FsrsData, 'cardId'>;
	reviewLogs: EntityTable<ReviewLog, 'id'>;
	settings: EntityTable<Setting, 'key'>;
};

db.version(1).stores({
	decks: '++id, name, createdAt',
	cards: '++id, deckId, createdAt',
	fsrsData: 'cardId, due, state, [state+due]',
	reviewLogs: '++id, cardId, reviewedAt',
	settings: 'key',
});
