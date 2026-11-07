import { expect, test } from 'bun:test';
import { classifyModels, CURATED_TEXT, CURATED_TTS, modelOptions } from '$lib/gemini/models';
import { priceFor } from '$lib/gemini/pricing';
import { GEMINI_VOICES } from '$lib/gemini/voices';

// Fixture recortado de `models.list` real (2026-11-06).
const LISTED = [
	['gemini-2.5-flash', 'generateContent,countTokens'],
	['gemini-2.5-flash-preview-tts', 'countTokens,generateContent'],
	['gemini-flash-latest', 'generateContent'],
	['gemini-2.5-flash-image', 'generateContent'],
	['gemini-3.8-flash', 'generateContent'],
	['gemini-3.8-flash-tts', 'generateContent'],
	['gemini-3.1-pro-preview-customtools', 'generateContent'],
	['gemini-embedding-001', 'embedContent'],
	['gemini-3.1-flash-live-preview', 'bidiGenerateContent'],
	['gemini-robotics-er-2-preview', 'generateContent'],
	['gemini-3.5-transcribe', 'generateContent'],
	['gemini-nano-banana-2.1', 'generateContent'],
	['gemini-3.1-flash-lite', 'generateContent'],
	['gemini-2.5-flash-native-audio-latest', 'bidiGenerateContent'],
	['imagen-4', 'predict'],
].map(([id, actions]) => ({ name: `models/${id}`, supportedActions: actions.split(',') }));

test('classifyModels separa texto y voz, descarta lo que no sirve y ordena por versión', () => {
	const c = classifyModels(LISTED);
	expect(c.text.map((m) => m.id)).toEqual(['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest']);
	expect(c.tts.map((m) => m.id)).toEqual(['gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts']);
});

test('modelOptions: curadas primero, sin repetir, y el actual si no está', () => {
	const listed = classifyModels(LISTED).text;
	const opts = modelOptions('text', 'gemini-viejo', listed);
	expect(opts[0]).toMatchObject({ id: CURATED_TEXT[0].id, group: 'curated', tag: 'Recomendado' });
	expect(new Set(opts.map((o) => o.id)).size).toBe(opts.length);
	expect(opts.at(-1)).toMatchObject({ id: 'gemini-viejo', group: 'current', tag: 'no disponible' });
	expect(modelOptions('text', 'gemini-viejo', null).at(-1)?.tag).toBe('actual');
	expect(modelOptions('tts', CURATED_TTS[1].id, null).filter((o) => o.group === 'current')).toHaveLength(0);
});

test('todos los modelos curados tienen precio y la voz TTS no hereda el de texto', () => {
	for (const m of [...CURATED_TEXT, ...CURATED_TTS]) expect(priceFor(m.id)).not.toBeNull();
	expect(priceFor('gemini-3.8-flash-tts')?.output).toBe(9);
	expect(priceFor('gemini-3.8-flash')?.output).toBe(3.75);
	expect(priceFor('gemini-3.1-flash-lite-preview')?.input).toBe(0.25);
});

test('30 voces únicas con estilo', () => {
	expect(GEMINI_VOICES).toHaveLength(30);
	expect(new Set(GEMINI_VOICES.map((v) => v.name)).size).toBe(30);
	expect(GEMINI_VOICES.every((v) => v.style)).toBe(true);
});
