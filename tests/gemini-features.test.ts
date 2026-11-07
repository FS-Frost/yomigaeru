// Integración: las funciones reales de IA (ajustes, presupuesto, registro de uso, streaming, reintento,
// validación) con un doble del SDK y IndexedDB en memoria. Sin red.
// IndexedDB en memoria: lo instala tests/setup.ts (preload de bunfig.toml) antes de cargar Dexie.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { db } from '$lib/db/schema';
import { setSetting } from '$lib/db/settings';
import { _setTestClient } from '$lib/gemini/client';
import { generateCardFromText } from '$lib/gemini/generateCard';
import { explainGrammar } from '$lib/gemini/grammar';
import { imageToCards, textToCards } from '$lib/gemini/imageToCards';
import { judgeAnswer } from '$lib/gemini/judge';
import { synthesizeJapanese } from '$lib/gemini/tts';

type Req = { model: string; contents: { parts: { text?: string }[] }[]; config: Record<string, unknown> };
type Reply = string | Error | { text: string; finish?: string };
let replies: Reply[] = [];
let requests: Req[] = [];

/** Doble del SDK: cada llamada consume la siguiente respuesta; el texto llega partido en trozos. */
const fake = {
	models: {
		async generateContentStream(req: Req) {
			requests.push(req);
			const r = replies.shift();
			if (r === undefined) throw new Error('sin respuesta preparada');
			if (r instanceof Error) throw r;
			const { text, finish = 'STOP' } = typeof r === 'string' ? { text: r } : r;
			const signal = req.config.abortSignal as AbortSignal | undefined;
			return (async function* () {
				for (let i = 0; i < text.length; i += 25) {
					if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
					const last = i + 25 >= text.length;
					yield { text: text.slice(i, i + 25), candidates: last ? [{ finishReason: finish }] : [{}], usageMetadata: last ? { promptTokenCount: 100, candidatesTokenCount: 50 } : undefined };
				}
			})();
		},
		async generateContent(req: Req) {
			requests.push(req);
			const r = replies.shift();
			if (r instanceof Error) throw r;
			return {
				candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: btoa('\x00\x01'.repeat(100)) } }] } }],
				usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 200 },
			};
		},
	},
};

const card = (front: string, reading = 'ねこ') => ({ front, reading, back: 'gato', context: '猫が好き', examples: [] });
const cards = (...cs: object[]) => JSON.stringify({ cards: cs });

beforeEach(async () => {
	await db.open();
	await Promise.all([db.settings.clear(), db.geminiUsage.clear()]);
	await setSetting('apiKey', 'test-key');
	await setSetting('geminiModel', 'gemini-3.5-flash');
	_setTestClient(fake);
	replies = [];
	requests = [];
});
afterEach(() => _setTestClient(null));

describe('textToCards', () => {
	test('streaming: tarjetas en vivo, petición con esquema, tope y razonamiento bajo; uso registrado', async () => {
		replies = [cards(card('猫[ねこ]'), card('犬[いぬ]', 'いぬ'))];
		const live: string[] = [];
		const stages: string[] = [];
		const r = await textToCards('猫と犬', { onCard: (c) => live.push(c.front), onStage: (s) => stages.push(s) });
		expect(live).toEqual(['猫[ねこ]', '犬[いぬ]']);
		expect(r.cards).toHaveLength(2);
		expect(stages).toEqual(['sending', 'thinking', 'writing', 'done']);
		const cfg = requests[0].config;
		expect(cfg.responseMimeType).toBe('application/json');
		expect((cfg.responseSchema as { required: string[] }).required).toEqual(['cards']);
		expect(cfg.maxOutputTokens).toBe(8192);
		expect(cfg.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
		expect(cfg.tools).toBeUndefined(); // búsqueda web apagada por defecto
		const usage = await db.geminiUsage.toArray();
		expect(usage).toHaveLength(1);
		expect(usage[0]).toMatchObject({ feature: 'textToCards', model: 'gemini-3.5-flash', ok: true, promptTokens: 100 });
	});

	test('el bucle real se corta, se conserva lo válido y se reintenta una vez', async () => {
		const loop = cards(card('猫[ねこ]')).slice(0, -2) + ',{"front":"吾輩[わがはい]","reading":"' + 'わがはい'.repeat(400);
		replies = [loop, cards(card('猫[ねこ]'), card('吾輩[わがはい]', 'わがはい'))];
		let retried = 0;
		const r = await textToCards('吾輩は猫である', { onRetry: () => retried++ });
		expect(retried).toBe(1);
		expect(r.cards.map((c) => c.front)).toEqual(['猫[ねこ]', '吾輩[わがはい]']);
		expect(requests).toHaveLength(2);
		expect(requests[1].contents[0].parts[0].text).toContain('se atascó repitiendo');
		const usage = await db.geminiUsage.toArray();
		expect(usage.map((u) => u.ok)).toEqual([false, true]);
	});

	test('MAX_TOKENS dos veces sin nada válido → error truncated', async () => {
		replies = [
			{ text: '{"cards":[{"front":"猫', finish: 'MAX_TOKENS' },
			{ text: '{"cards":[{"front":"猫', finish: 'MAX_TOKENS' },
		];
		await expect(textToCards('x')).rejects.toMatchObject({ code: 'truncated' });
	});

	test('búsqueda web activada con Gemini 3 → tools; con 2.5 no', async () => {
		await setSetting('webSearch', true);
		replies = [cards(card('猫'))];
		await textToCards('猫');
		expect(requests[0].config.tools).toEqual([{ googleSearch: {} }]);
		await setSetting('geminiModel', 'gemini-2.5-flash');
		replies = [cards(card('猫'))];
		await textToCards('猫');
		expect(requests[1].config.tools).toBeUndefined();
		expect(requests[1].config.thinkingConfig).toBeUndefined();
	});

	test('503 al iniciar se reintenta solo (backoff)', async () => {
		replies = [Object.assign(new Error('{"error":{"code":503}}'), { status: 503 }), cards(card('猫'))];
		const r = await textToCards('猫');
		expect(r.cards).toHaveLength(1);
	}, 10_000);

	test('cancelar a mitad conserva lo recibido', async () => {
		const ctrl = new AbortController();
		replies = [cards(card('猫[ねこ]'), card('犬[いぬ]', 'いぬ'), card('鳥[とり]', 'とり'))];
		const r = await textToCards('x', {
			signal: ctrl.signal,
			onCard: () => ctrl.abort(),
		});
		expect(r.cards.length).toBeGreaterThanOrEqual(1);
		expect(r.warning?.code).toBe('aborted');
	});
});

test('imageToCards pide la caja y la valida', async () => {
	replies = [cards({ ...card('猫'), box: [10, 20, 30, 40] }, { ...card('犬'), box: [50, 50, 10, 10] })];
	const r = await imageToCards({ mimeType: 'image/jpeg', base64: 'AAAA' });
	expect(r.cards[0].box).toEqual([10, 20, 30, 40]);
	expect(r.cards[1].box).toBeUndefined();
	expect(requests[0].contents[0].parts).toHaveLength(2);
});

test('generateCardFromText reintenta una tarjeta basura', async () => {
	replies = [JSON.stringify(card('猫', 'わがはいConstants.ts')), JSON.stringify(card('猫[ねこ]'))];
	const c = await generateCardFromText('neko');
	expect(c.front).toBe('猫[ねこ]');
	expect(requests).toHaveLength(2);
});

test('judgeAnswer y explainGrammar validan con Zod', async () => {
	replies = [JSON.stringify({ verdict: 'partial', suggestedRating: 2, feedback: 'casi', corrected: '猫[ねこ]' })];
	expect(await judgeAnswer({ front: '猫[ねこ]', back: 'gato', reading: 'ねこ', context: '' }, 'ねこ')).toMatchObject({ verdict: 'partial', suggestedRating: 2 });
	replies = [JSON.stringify({ summary: 'Me gustan los gatos', focusNote: null, tokens: [{ surface: '猫', role: 'sustantivo', note: 'gato' }] })];
	expect((await explainGrammar('猫が好き')).focusNote).toBe('');
});

test('judgeAnswer con respuesta inválida dos veces → invalid con detalle', async () => {
	replies = [JSON.stringify({ verdict: 'quizá' }), JSON.stringify({ verdict: 'quizá' })];
	const e = await judgeAnswer({ front: '猫', back: 'gato', reading: '', context: '' }, 'x').catch((x) => x);
	expect(e.code).toBe('invalid');
	expect(e.detail).toContain('verdict');
});

test('synthesizeJapanese devuelve un WAV', async () => {
	const wav = await synthesizeJapanese('猫[ねこ]');
	expect(wav.type).toBe('audio/wav');
	expect(wav.size).toBe(44 + 200);
});

describe('errores previos a la llamada (no se registran)', () => {
	test('sin key', async () => {
		await setSetting('apiKey', '');
		_setTestClient(null);
		await expect(textToCards('x')).rejects.toMatchObject({ code: 'no-key', action: 'settings' });
		expect(await db.geminiUsage.count()).toBe(0);
	});

	test('presupuesto superado con bloqueo', async () => {
		await setSetting('monthlyBudgetUsd', 0.01);
		await setSetting('budgetHardStop', true);
		await db.geminiUsage.add({ at: Date.now(), feature: 'textToCards', model: 'm', promptTokens: 0, outputTokens: 0, cachedTokens: 0, ok: true, costUsd: 1 });
		await expect(textToCards('x')).rejects.toMatchObject({ code: 'budget' });
	});

	test('sin conexión', async () => {
		const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
		Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
		try {
			await expect(textToCards('x')).rejects.toMatchObject({ code: 'offline' });
		} finally {
			if (desc) Object.defineProperty(globalThis, 'navigator', desc);
		}
	});
});

test('la API key nunca aparece en errores', async () => {
	replies = [Object.assign(new Error('bad https://x?key=AIzaSyA1234567890abcdefghijklmnop'), { status: 400 })];
	const e = await textToCards('x').catch((x) => x);
	expect(JSON.stringify({ m: e.message, d: e.detail })).not.toContain('AIzaSyA1234567890abcdefghijklmnop');
});
