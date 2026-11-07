import { describe, expect, test } from 'bun:test';
import { GeminiError } from '$lib/gemini/errors';
import { consumeJsonStream, detectLoop, extractCompleteItems, extractString, parseJsonLoose, type ChunkLike } from '$lib/gemini/stream';

const FULL = JSON.stringify(
	{
		cards: [
			{ front: '猫[ねこ]', reading: 'ねこ', back: 'gato', context: '「猫」が{好き}だ\\n"sí"', examples: [] },
			{ front: '犬[いぬ]', reading: 'いぬ', back: 'perro', context: '', examples: [{ jp: 'a', es: 'b' }] },
			{ front: '鳥[とり]', reading: 'とり', back: 'pájaro', context: '', examples: [] },
		],
	},
	null,
	2,
);

/** Salida real (recortada) del bucle visto con gemini-3-flash-preview el 2026-11-06. */
const LOOP_FIXTURE =
	'{\n  "cards": [\n    {\n      "front": "吾輩[わがはい]",\n      "back": "Yo (pronombre arcaico)",\n      "reading": "わがはいConstants.tsわがはいわがはいConstants.ts' + 'わがはい'.repeat(300);

describe('extractCompleteItems', () => {
	test('JSON completo → todos los objetos', () => {
		expect(extractCompleteItems(FULL, 'cards')).toHaveLength(3);
	});

	test('cortado en cualquier posición: solo objetos completos, en orden y sin errores', () => {
		let prev = 0;
		for (let i = 0; i <= FULL.length; i++) {
			const items = extractCompleteItems(FULL.slice(0, i), 'cards') as { front: string }[];
			expect(items.length).toBeGreaterThanOrEqual(prev);
			prev = items.length;
			if (items[0]) expect(items[0].front).toBe('猫[ねこ]');
		}
		expect(prev).toBe(3);
	});

	test('llaves y comillas escapadas dentro de strings no confunden', () => {
		const items = extractCompleteItems('{"cards":[{"a":"} ] {","b":"\\"}"},{"c":1}', 'cards');
		expect(items).toEqual([{ a: '} ] {', b: '"}' }, { c: 1 }]);
	});

	test('sin la clave → vacío', () => {
		expect(extractCompleteItems('{"otra":[{"a":1}]}', 'cards')).toEqual([]);
	});

	test('objeto mal formado se omite', () => {
		expect(extractCompleteItems('{"cards":[{"a":01},{"b":2}]}', 'cards')).toEqual([{ b: 2 }]);
	});
});

describe('detectLoop', () => {
	test('detecta el bucle real', () => {
		expect(detectLoop(LOOP_FIXTURE)).toMatch(/repetición|caracteres/);
	});

	test('detecta el bucle temprano (string abierto, ~60 caracteres)', () => {
		const early = '{"cards":[{"front":"吾輩","reading":"' + 'わがはい'.repeat(9);
		expect(detectLoop(early)).toContain('repetición');
	});

	test('sin falsos positivos con texto normal ni con la indentación del JSON', () => {
		expect(detectLoop(FULL)).toBeNull();
		const normal = JSON.stringify(
			{ cards: [{ context: '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。' }] },
			null,
			8,
		);
		expect(detectLoop(normal)).toBeNull();
	});

	test('campo demasiado largo', () => {
		expect(detectLoop(`{"a":"${'あいうえおかきくけこ'.repeat(20)}"}`, { maxString: 100 })).toContain('caracteres');
	});

	test('respuesta total demasiado larga', () => {
		expect(detectLoop('x'.repeat(200), { maxTotal: 100 })).toContain('respuesta');
	});
});

async function* chunks(parts: string[], last: Partial<ChunkLike> = {}): AsyncGenerator<ChunkLike> {
	for (let i = 0; i < parts.length; i++) {
		const end = i === parts.length - 1;
		yield { text: parts[i], ...(end ? { candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } } : {}), ...(end ? last : {}) };
	}
}
/** Espera que la promesa falle y devuelve el error tipado. */
const fail = (p: Promise<unknown>): Promise<GeminiError> =>
	p.then(
		() => {
			throw new Error('no lanzó');
		},
		(e: GeminiError) => e,
	);
const split = (s: string, n: number) => Array.from({ length: Math.ceil(s.length / n) }, (_, i) => s.slice(i * n, i * n + n));

describe('consumeJsonStream', () => {
	test('acumula, avisa etapas y texto, y registra uso', async () => {
		const stages: string[] = [];
		const texts: string[] = [];
		let usage: unknown;
		const out = await consumeJsonStream(chunks(split(FULL, 17)), { onStage: (s) => stages.push(s), onText: (t) => texts.push(t), onUsage: (u, ok) => void (usage = { u, ok }) });
		expect((out as { cards: unknown[] }).cards).toHaveLength(3);
		expect(stages).toEqual(['thinking', 'writing', 'done']);
		expect(texts.at(-1)).toBe(FULL);
		expect(usage).toEqual({ u: { promptTokenCount: 10, candidatesTokenCount: 20 }, ok: true });
	});

	test('bucle → corta (abort), lanza loop con el parcial y registra el uso', async () => {
		let aborted = false;
		let ok: boolean | undefined;
		const parts = split(LOOP_FIXTURE, 40);
		const err = await fail(consumeJsonStream(chunks(parts), { abort: () => (aborted = true), onUsage: (_u, k) => void (ok = k) }));
		expect(err).toBeInstanceOf(GeminiError);
		expect(err.code).toBe('loop');
		expect(err.partial!.length).toBeLessThan(LOOP_FIXTURE.length);
		expect(aborted).toBe(true);
		expect(ok).toBe(false);
	});

	test('MAX_TOKENS → truncated con parcial', async () => {
		const err = await fail(consumeJsonStream(chunks([FULL.slice(0, 120)], { candidates: [{ finishReason: 'MAX_TOKENS' }] })));
		expect(err.code).toBe('truncated');
		expect(err.partial).toBe(FULL.slice(0, 120));
	});

	test('bloqueo del prompt → safety', async () => {
		const err = await fail(consumeJsonStream(chunks([''], { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] })));
		expect(err.code).toBe('safety');
	});

	test('sin texto → empty', async () => {
		const err = await fail(consumeJsonStream(chunks([''])));
		expect(err.code).toBe('empty');
	});

	test('JSON roto sin finishReason malo → invalid con detalle', async () => {
		const err = await fail(consumeJsonStream(chunks(['{"cards":[{"front":'])));
		expect(err.code).toBe('invalid');
		expect(err.detail).toContain('JSON inválido');
	});

	test('error de red a mitad → clasificado, con parcial', async () => {
		async function* broken(): AsyncGenerator<ChunkLike> {
			yield { text: '{"cards":[' };
			throw Object.assign(new Error('{"error":{"code":503,"message":"overloaded"}}'), { status: 503 });
		}
		const err = await fail(consumeJsonStream(broken()));
		expect(err.code).toBe('unavailable');
		expect(err.partial).toBe('{"cards":[');
	});

	test('cancelado por el usuario → aborted', async () => {
		const ctrl = new AbortController();
		async function* slow(): AsyncGenerator<ChunkLike> {
			yield { text: '{"cards":[' };
			ctrl.abort();
			throw Object.assign(new Error('aborted'), { name: 'AbortError' });
		}
		const err = await fail(consumeJsonStream(slow(), { signal: ctrl.signal }));
		expect(err.code).toBe('aborted');
	});
});

test('parseJsonLoose tolera ```json y lanza invalid con detalle', () => {
	expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
	try {
		parseJsonLoose('nada');
		throw new Error('no lanzó');
	} catch (e) {
		expect((e as GeminiError).code).toBe('invalid');
	}
});

test('extractString lee un campo ya cerrado de un JSON a medio llegar', () => {
	expect(extractString('{"deckName":"Persona \\"5\\"","cards":[{"front":"怪', 'deckName')).toBe('Persona "5"');
	expect(extractString('{"deckName":"Pers', 'deckName')).toBeNull();
	expect(extractString('{"cards":[]}', 'deckName')).toBeNull();
});
