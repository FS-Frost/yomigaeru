import Dexie, { type EntityTable } from 'dexie';
import type { GrammarBreakdown } from '$lib/gemini/schemas';
import { normalizeFront } from '$lib/jp';

// Estado FSRS: 0 New, 1 Learning, 2 Review, 3 Relearning (coincide con ts-fsrs State).
export type FsrsState = 0 | 1 | 2 | 3;

/**
 * Caras (facetas) de una tarjeta; cada una tiene su propia programación FSRS.
 * - recognition: japonés → significado (siempre activa).
 * - cloze: oración de contexto con la palabra oculta → producir la palabra.
 * - production: significado en español → escribir en japonés (juez IA).
 * - visual: recorte de la foto donde apareció → reconocer la palabra.
 */
export type Facet = 'recognition' | 'cloze' | 'production' | 'visual';
export const FACETS: Facet[] = ['recognition', 'cloze', 'production', 'visual'];

/** Caja normalizada 0–1000 en formato Gemini: [ymin, xmin, ymax, xmax]. */
export type Box = [number, number, number, number];

/** Cómo se respondió un repaso. */
export type AnswerVia = 'reveal' | 'typed' | 'choice' | 'judge';

export interface Deck {
	id?: number;
	name: string;
	description?: string;
	/** Cupo propio de nuevas por día (anula el ajuste global si está definido). */
	newPerDay?: number;
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
	/** Frase de ejemplo o nota gramatical. Si contiene la palabra, habilita la cara cloze. */
	context?: string;
	/** Frente normalizado (indexado) para detectar duplicados. Ver `normalizeFront`. */
	norm: string;
	/** Imagen de contexto (tabla `images`, compartida por las tarjetas de una misma foto). */
	imageId?: number;
	/** Región de la palabra dentro de la imagen. */
	box?: Box;
	/** Caras activas. `recognition` siempre se incluye. */
	facets?: Facet[];
	/** Suspendida: no entra en las sesiones. */
	suspended?: boolean;
	/** Audio natural generado (Gemini TTS) guardado offline. */
	audioBlob?: Blob;
	/** Desglose gramatical IA cacheado. */
	grammar?: GrammarBreakdown;
	/** Epoch ms en que se guardó el desglose gramatical cacheado. */
	grammarSavedAt?: number;
	/** Solo v1: imagen embebida por tarjeta. Se migra a `images` en v2. */
	imageBlob?: Blob;
	createdAt: number;
}

/**
 * Programación FSRS de una cara de una tarjeta. Campos de ts-fsrs `Card`;
 * `due` y `last_review` como epoch ms para poder indexar/ordenar.
 */
export interface Schedule {
	id?: number;
	cardId: number;
	facet: Facet;
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

/** Solo v1 (tabla `fsrsData`, una programación por tarjeta). Se migra a `schedules`. */
export type LegacyFsrsData = Omit<Schedule, 'id' | 'facet'>;

export interface ReviewLog {
	id?: number;
	cardId: number;
	facet: Facet;
	/** Rating aplicado (ts-fsrs Rating: 1 Again, 2 Hard, 3 Good, 4 Easy). */
	rating: number;
	/** Estado PREVIO al repaso (ts-fsrs). state 0 = era nueva. */
	state: FsrsState;
	due: number;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	last_elapsed_days: number;
	scheduled_days: number;
	reviewedAt: number;
	/** Cómo se respondió (null en logs antiguos). */
	via?: AnswerVia;
	/** Tiempo hasta responder, en ms. */
	durationMs?: number;
}

export interface ImageRow {
	id?: number;
	blob: Blob;
	createdAt: number;
}

export type BackupKind = 'auto' | 'manual' | 'pre-import' | 'pre-reset';

export interface BackupRow {
	id?: number;
	kind: BackupKind;
	createdAt: number;
	size: number;
	/** Conteos por tabla en el momento de la copia. */
	counts: Record<string, number>;
	/** true si excluye imágenes y audio. */
	light: boolean;
	/** Huella para no repetir copias automáticas sin cambios. */
	fingerprint: string;
	blob: Blob;
}

export interface GeminiUsage {
	id?: number;
	at: number;
	feature: string;
	model: string;
	promptTokens: number;
	outputTokens: number;
	cachedTokens: number;
	ok: boolean;
	/** Costo estimado con el precio vigente al llamar; null = modelo sin precio. */
	costUsd: number | null;
}

export interface Setting {
	key: string;
	value: unknown;
}

export type YomiDB = Dexie & {
	decks: EntityTable<Deck, 'id'>;
	cards: EntityTable<Card, 'id'>;
	schedules: EntityTable<Schedule, 'id'>;
	reviewLogs: EntityTable<ReviewLog, 'id'>;
	images: EntityTable<ImageRow, 'id'>;
	backups: EntityTable<BackupRow, 'id'>;
	geminiUsage: EntityTable<GeminiUsage, 'id'>;
	settings: EntityTable<Setting, 'key'>;
};

/** Tablas de datos del usuario (todas menos `backups`), en orden de restauración. */
export const DATA_TABLES = ['decks', 'cards', 'schedules', 'reviewLogs', 'images', 'geminiUsage', 'settings'] as const;

/**
 * Declara todas las versiones del schema. Se aplica a la base real y a bases temporales
 * (importar un backup antiguo lo abre aparte para que Dexie lo migre a la versión actual).
 */
export function applySchema(d: Dexie): YomiDB {
	d.version(1).stores({
		decks: '++id, name, createdAt',
		cards: '++id, deckId, createdAt',
		fsrsData: 'cardId, due, state, [state+due]',
		reviewLogs: '++id, cardId, reviewedAt',
		settings: 'key',
	});

	// v2: caras con programación propia, imágenes compartidas, duplicados, copias y uso de Gemini.
	d.version(2)
		.stores({
			cards: '++id, deckId, createdAt, norm',
			schedules: '++id, &[cardId+facet], cardId, due, [state+due]',
			reviewLogs: '++id, cardId, reviewedAt, [cardId+facet]',
			images: '++id, createdAt',
			backups: '++id, kind, createdAt',
			geminiUsage: '++id, at, feature',
		})
		.upgrade(async (tx) => {
			// 1. fsrsData (una por tarjeta) → schedules con cara `recognition`.
			const legacy = (await tx.table('fsrsData').toArray()) as LegacyFsrsData[];
			await tx.table('schedules').bulkAdd(legacy.map((f) => ({ ...f, facet: 'recognition' })));
			// 2. Logs antiguos: cara `recognition`.
			await tx
				.table('reviewLogs')
				.toCollection()
				.modify((l: ReviewLog) => {
					l.facet = 'recognition';
				});
			// 3. imageBlob embebido → tabla images; 4. frente normalizado.
			const cards = (await tx.table('cards').toArray()) as Card[];
			for (const c of cards) {
				if (c.imageBlob) {
					c.imageId = (await tx.table('images').add({ blob: c.imageBlob, createdAt: c.createdAt })) as number;
					delete c.imageBlob;
				}
				c.norm = normalizeFront(c.front);
				c.facets = ['recognition'];
				await tx.table('cards').put(c);
			}
		});

	// v3: se elimina la tabla v1 una vez migrada (no se puede borrar en la misma versión que la lee).
	d.version(3).stores({ fsrsData: null });
	return d as YomiDB;
}

export const db = applySchema(new Dexie('yomigaeru'));
