import { stripFurigana } from '$lib/furigana';
import { getSetting } from '$lib/db/settings';
import { base64ToBytes, pcmToWav, rateFromMime } from '$lib/media/wav';
import { GeminiError, generateTracked } from './client';

/**
 * Audio natural con un modelo TTS de Gemini. Devuelve un WAV listo para guardar en la tarjeta
 * (así suena offline y sin depender de las voces del sistema).
 */
export async function synthesizeJapanese(text: string, opts: { voice?: string; model?: string } = {}): Promise<Blob> {
	const clean = stripFurigana(text).trim();
	if (!clean) throw new GeminiError('No hay texto que leer.', { code: 'invalid', action: 'none' });
	const model = opts.model ?? (await getSetting('ttsModel'));
	const voiceName = opts.voice ?? (await getSetting('ttsGeminiVoice'));
	const res = await generateTracked({
		feature: 'tts',
		model,
		parts: [{ text: `Lee en japonés con pronunciación natural y clara, a velocidad de estudio: ${clean}` }],
		config: {
			responseModalities: ['AUDIO'],
			speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
		},
	});
	const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
	if (!part?.inlineData?.data)
		throw new GeminiError('Gemini no devolvió audio. Revisa el modelo de voz en Ajustes.', {
			code: 'empty',
			action: 'settings',
			detail: `finishReason=${res.candidates?.[0]?.finishReason ?? '—'}`,
		});
	return pcmToWav(base64ToBytes(part.inlineData.data), rateFromMime(part.inlineData.mimeType));
}
