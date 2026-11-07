import { describe, expect, test } from 'bun:test';
import { resilientCards, retryOnBadOutput, type CardsAttempt } from '$lib/gemini/cardgen';
import { GeminiError } from '$lib/gemini/errors';

const card = (front: string, extra: Record<string, unknown> = {}) => ({ front, reading: 'ねこ', back: 'x', context: '', examples: [], ...extra });
const json = (...cards: object[]) => JSON.stringify({ cards });

describe('resilientCards', () => {
	test('emite cada tarjeta al llegar completa, sin duplicar con el final', async () => {
		const seen: string[] = [];
		const full = json(card('猫'), card('犬'));
		const run: CardsAttempt = async (_a, onText) => {
			for (let i = 1; i <= full.length; i++) onText(full.slice(0, i));
			return JSON.parse(full);
		};
		const r = await resilientCards(run, { onCard: (c) => seen.push(c.front) });
		expect(seen).toEqual(['猫', '犬']);
		expect(r.cards.map((c) => c.front)).toEqual(['猫', '犬']);
		expect(r.retried).toBe(false);
	});

	test('una tarjeta inválida se descarta sin invalidar las demás', async () => {
		const r = await resilientCards(async () => ({ cards: [card('猫'), card('dog'), card('犬', { reading: 'わがはいConstants.ts' }), { front: null }] }));
		expect(r.cards.map((c) => c.front)).toEqual(['猫']);
		expect(r.dropped).toHaveLength(3);
	});

	test('bucle: conserva lo recibido, reintenta UNA vez y fusiona sin duplicar', async () => {
		const attempts: number[] = [];
		let retried = 0;
		const run: CardsAttempt = async (attempt, onText) => {
			attempts.push(attempt);
			if (attempt === 0) {
				const partial = json(card('猫')).slice(0, -2) + ',{"front":"吾輩","reading":"わがはいわがはい';
				onText(partial);
				throw new GeminiError(null, { code: 'loop', partial });
			}
			return { cards: [card('猫'), card('犬')] };
		};
		const r = await resilientCards(run, { onRetry: () => retried++ });
		expect(attempts).toEqual([0, 1]);
		expect(retried).toBe(1);
		expect(r.cards.map((c) => c.front)).toEqual(['猫', '犬']);
		expect(r.retried).toBe(true);
		expect(r.warning).toBeUndefined();
	});

	test('dos fallos seguidos: devuelve lo válido con aviso', async () => {
		const run: CardsAttempt = async (attempt) => {
			if (attempt === 0) throw new GeminiError(null, { code: 'truncated', partial: json(card('猫')).slice(0, -2) });
			throw new GeminiError(null, { code: 'loop', partial: '' });
		};
		const r = await resilientCards(run);
		expect(r.cards.map((c) => c.front)).toEqual(['猫']);
		expect(r.warning?.code).toBe('loop');
	});

	test('dos fallos sin nada válido: lanza', async () => {
		const run: CardsAttempt = async () => {
			throw new GeminiError(null, { code: 'invalid' });
		};
		await expect(resilientCards(run)).rejects.toMatchObject({ code: 'invalid' });
	});

	test('errores no recuperables (auth) no reintentan', async () => {
		let n = 0;
		const run: CardsAttempt = async () => {
			n++;
			throw new GeminiError(null, { code: 'auth' });
		};
		await expect(resilientCards(run)).rejects.toMatchObject({ code: 'auth' });
		expect(n).toBe(1);
	});

	test('cancelar: conserva lo recibido sin reintentar', async () => {
		let n = 0;
		const r = await resilientCards(async () => {
			n++;
			throw new GeminiError(null, { code: 'aborted', partial: json(card('猫')).slice(0, -2) });
		});
		expect(n).toBe(1);
		expect(r.cards).toHaveLength(1);
		expect(r.warning?.code).toBe('aborted');
	});

	test('cancelar sin nada: lanza aborted', async () => {
		await expect(resilientCards(async () => Promise.reject(new GeminiError(null, { code: 'aborted' })))).rejects.toMatchObject({ code: 'aborted' });
	});

	test('respuesta sin "cards" → invalid y reintento', async () => {
		let n = 0;
		const r = await resilientCards(async () => (n++ === 0 ? { otra: 1 } : { cards: [card('猫')] }));
		expect(r.cards).toHaveLength(1);
		expect(r.retried).toBe(true);
	});

	test('lista vacía válida = sin tarjetas, sin error', async () => {
		const r = await resilientCards(async () => ({ cards: [] }));
		expect(r.cards).toEqual([]);
	});
});

test('retryOnBadOutput reintenta solo salidas defectuosas', async () => {
	let n = 0;
	expect(await retryOnBadOutput(async (a) => (n++, a === 0 ? Promise.reject(new GeminiError(null, { code: 'loop' })) : 'ok'))).toBe('ok');
	expect(n).toBe(2);
	await expect(retryOnBadOutput(async () => Promise.reject(new GeminiError(null, { code: 'quota' })))).rejects.toMatchObject({ code: 'quota' });
});
