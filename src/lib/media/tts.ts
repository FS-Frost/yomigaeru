import { stripFurigana } from '$lib/furigana';
import { getSetting } from '$lib/db/settings';

/** ¿El navegador soporta síntesis de voz? */
export function ttsSupported(): boolean {
	return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Voces disponibles. speechSynthesis las carga async: reintenta al evento voiceschanged. */
export function listVoices(): Promise<SpeechSynthesisVoice[]> {
	return new Promise((resolve) => {
		if (!ttsSupported()) return resolve([]);
		const existing = window.speechSynthesis.getVoices();
		if (existing.length) return resolve(existing);
		window.speechSynthesis.addEventListener('voiceschanged', () => resolve(window.speechSynthesis.getVoices()), { once: true });
	});
}

/** Voces japonesas (lang ja*). */
export async function listJapaneseVoices(): Promise<SpeechSynthesisVoice[]> {
	const voices = await listVoices();
	return voices.filter((v) => v.lang.toLowerCase().startsWith('ja'));
}

/**
 * Pronuncia texto japonés. Usa la voz elegida en ajustes (ttsVoiceURI) o la
 * primera voz ja-JP disponible. Limpia marcas de furigana antes de hablar.
 */
export async function speakJapanese(text: string): Promise<void> {
	if (!ttsSupported()) return;
	const clean = stripFurigana(text).trim();
	if (!clean) return;

	window.speechSynthesis.cancel();
	const utter = new SpeechSynthesisUtterance(clean);
	utter.lang = 'ja-JP';
	utter.rate = 0.95;

	const voices = await listJapaneseVoices();
	const preferredURI = await getSetting('ttsVoiceURI');
	const voice = voices.find((v) => v.voiceURI === preferredURI) ?? voices[0];
	if (voice) utter.voice = voice;

	window.speechSynthesis.speak(utter);
}
