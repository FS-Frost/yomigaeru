import { describe, expect, test } from 'bun:test';
import { costOf, priceFor } from '$lib/gemini/pricing';
import { base64ToBytes, pcmToWav, rateFromMime } from '$lib/media/wav';

describe('precios', () => {
	test('prefijo con sufijo de versión', () => {
		expect(priceFor('gemini-3-flash-preview')).toEqual(priceFor('gemini-3-flash'));
		expect(priceFor('gemini-2.5-flash-preview-tts')?.output).toBe(10);
	});
	test('un modelo distinto no hereda (tts ≠ flash)', () => {
		expect(priceFor('gemini-2.5-flash-tts-x')).toBeNull();
	});
	test('precio propio gana', () => {
		expect(priceFor('gemini-3-flash-preview', { 'gemini-3-flash-preview': { input: 1, output: 1 } })).toEqual({ input: 1, output: 1 });
	});
	test('costo con caché', () => {
		expect(costOf({ input: 1, output: 2 }, 1_000_000, 500_000, 0)).toBeCloseTo(2);
		expect(costOf({ input: 1, output: 0 }, 1_000_000, 0, 1_000_000)).toBeCloseTo(0.25);
		expect(costOf(null, 1, 1)).toBeNull();
	});
});

describe('wav', () => {
	test('cabecera RIFF correcta', async () => {
		const b = new Uint8Array(await pcmToWav(new Uint8Array(100), 24000).arrayBuffer());
		expect(b.length).toBe(144);
		expect(String.fromCharCode(...b.slice(0, 4))).toBe('RIFF');
		expect(new DataView(b.buffer).getUint32(24, true)).toBe(24000);
	});
	test('helpers', () => {
		expect(rateFromMime('audio/L16;codec=pcm;rate=16000')).toBe(16000);
		expect([...base64ToBytes('AQI=')]).toEqual([1, 2]);
	});
});
