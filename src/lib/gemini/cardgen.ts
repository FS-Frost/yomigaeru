// Generación de varias tarjetas tolerante a fallos (pura: recibe la función que llama a la IA).
// Emite cada tarjeta en cuanto llega completa; ante un bucle, un corte o JSON inválido conserva lo
// válido y reintenta UNA vez; las tarjetas del reintento se fusionan sin duplicar.
import { normalizeFront } from '$lib/jp';
import { GeminiError, isBadOutput } from './errors';
import { parseCard, type GeneratedCard } from './schemas';
import { extractCompleteItems } from './stream';

/** Instrucción extra del reintento automático. */
export const RETRY_HINT = 'IMPORTANTE: la respuesta anterior se atascó repitiendo texto. Sé breve: cada campo corto, sin repetir fragmentos, y cierra el JSON.';

/**
 * Una pasada: `attempt` 0 = normal, 1 = reintento (añade `RETRY_HINT` al prompt).
 * `onText` recibe el texto acumulado. Devuelve el JSON final parseado.
 */
export type CardsAttempt = (attempt: number, onText: (text: string) => void) => Promise<unknown>;

export interface CardsResult {
	cards: GeneratedCard[];
	/** Motivos de las propuestas descartadas por inválidas. */
	dropped: string[];
	/** Aviso si el resultado es parcial (bucle, corte, cancelación). */
	warning?: GeminiError;
	/** ¿Hubo reintento automático? */
	retried: boolean;
}

export async function resilientCards(run: CardsAttempt, opts: { onCard?: (c: GeneratedCard) => void; onRetry?: (e: GeminiError) => void } = {}): Promise<CardsResult> {
	const cards: GeneratedCard[] = [];
	const dropped: string[] = [];
	const seen = new Set<string>();
	let retried = false;

	const take = (c: GeneratedCard) => {
		const k = normalizeFront(c.front);
		if (seen.has(k)) return;
		seen.add(k);
		cards.push(c);
		opts.onCard?.(c);
	};
	/** Procesa los objetos de `items` a partir del índice `from`; devuelve el nuevo índice. */
	const fromItems = (items: unknown[], from: number): number => {
		for (let i = from; i < items.length; i++) {
			const r = parseCard(items[i]);
			if ('card' in r) take(r.card);
			else dropped.push(r.problem);
		}
		return Math.max(from, items.length);
	};
	const fromText = (text: string, from: number) => fromItems(extractCompleteItems(text, 'cards'), from);

	for (let attempt = 0; attempt < 2; attempt++) {
		let done = 0;
		try {
			const final = await run(attempt, (text) => (done = fromText(text, done)));
			const list = Array.isArray(final) ? final : (final as { cards?: unknown } | null)?.cards;
			if (!Array.isArray(list)) throw new GeminiError(null, { code: 'invalid', detail: 'La respuesta no trae "cards".' });
			// Lo que no llegó por streaming (o todo, si el stream no partió el array).
			fromItems(list, done);
			if (!cards.length && dropped.length) throw new GeminiError(null, { code: 'invalid', detail: `Propuestas inválidas: ${dropped.slice(0, 5).join(' | ')}` });
			return { cards, dropped, retried };
		} catch (e) {
			const err = e instanceof GeminiError ? e : new GeminiError(e instanceof Error ? e.message : String(e), { cause: e });
			if (err.partial) fromText(err.partial, done);
			if (err.code === 'aborted') {
				if (cards.length) return { cards, dropped, warning: err, retried };
				throw err;
			}
			if (attempt === 0 && isBadOutput(err)) {
				retried = true;
				opts.onRetry?.(err);
				continue;
			}
			if (cards.length) return { cards, dropped, warning: err, retried };
			throw err;
		}
	}
	/* c8 ignore next */
	return { cards, dropped, retried };
}

/** Para respuestas de un solo objeto: reintenta una vez si la salida vino defectuosa. */
export async function retryOnBadOutput<T>(run: (attempt: number) => Promise<T>): Promise<T> {
	try {
		return await run(0);
	} catch (e) {
		if (!isBadOutput(e)) throw e;
		return run(1);
	}
}
