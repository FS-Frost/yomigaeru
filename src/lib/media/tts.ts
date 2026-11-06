import { stripFurigana } from '$lib/furigana';
import { getAllSettings } from '$lib/db/settings';

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
		// Algunos navegadores nunca disparan el evento si no hay voces.
		setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1500);
	});
}

/** Voces japonesas (lang ja*). */
export async function listJapaneseVoices(): Promise<SpeechSynthesisVoice[]> {
	return (await listVoices()).filter((v) => v.lang.toLowerCase().startsWith('ja'));
}

/** Voces españolas (lang es*). */
export async function listSpanishVoices(): Promise<SpeechSynthesisVoice[]> {
	return (await listVoices()).filter((v) => v.lang.toLowerCase().startsWith('es'));
}

let currentAudio: HTMLAudioElement | null = null;

/** Detiene cualquier lectura en curso (voz del sistema o audio guardado). */
export function stopSpeaking(): void {
	if (ttsSupported()) window.speechSynthesis.cancel();
	if (currentAudio) {
		currentAudio.pause();
		URL.revokeObjectURL(currentAudio.src);
		currentAudio = null;
	}
}

/** Reproduce un audio guardado (Gemini TTS). */
export function playBlob(blob: Blob): Promise<void> {
	stopSpeaking();
	const audio = new Audio(URL.createObjectURL(blob));
	currentAudio = audio;
	return new Promise((resolve) => {
		audio.onended = () => resolve();
		audio.onerror = () => resolve();
		audio.play().catch(() => resolve());
	});
}

/**
 * Pronuncia texto japonés. Si hay audio guardado lo usa; si no, la voz elegida en ajustes
 * (o la primera ja-JP). Limpia marcas de furigana antes de hablar.
 */
export async function speakJapanese(text: string, audio?: Blob): Promise<void> {
	if (audio) return playBlob(audio);
	if (!ttsSupported()) return;
	const clean = stripFurigana(text).trim();
	if (!clean) return;
	stopSpeaking();
	const { ttsVoiceURI, ttsRate } = await getAllSettings();
	const utter = new SpeechSynthesisUtterance(clean);
	utter.lang = 'ja-JP';
	utter.rate = ttsRate;
	const voices = await listJapaneseVoices();
	const voice = voices.find((v) => v.voiceURI === ttsVoiceURI) ?? voices[0];
	if (voice) utter.voice = voice;
	window.speechSynthesis.speak(utter);
}

const JP = /[぀-ヿ㐀-鿿々ー]/;

/**
 * Trocea un texto mixto en tramos de un solo idioma (ref. sensei `client/tts.ts`). Quita la
 * furigana para que el japonés suene con voz japonesa y el español con la española.
 */
export function splitByLanguage(text: string): { lang: 'ja' | 'es'; text: string }[] {
	const clean = stripFurigana(text).replace(/\s+/g, ' ').trim();
	const out: { lang: 'ja' | 'es'; text: string }[] = [];
	let cur = '';
	let lang: 'ja' | 'es' | null = null;
	for (const ch of clean) {
		// Signos y espacios no cambian de idioma: se pegan al tramo en curso.
		const l: 'ja' | 'es' | null = JP.test(ch) ? 'ja' : /[\p{L}\p{N}]/u.test(ch) ? 'es' : null;
		if (l && lang && l !== lang) {
			if (cur.trim()) out.push({ lang, text: cur.trim() });
			cur = '';
		}
		if (l) lang = l;
		cur += ch;
	}
	if (cur.trim() && lang) out.push({ lang, text: cur.trim() });
	return out.filter((t) => t.text.replace(/[\s、。・「」（）!?¡¿.,;:—-]/g, ''));
}

/** Lee en voz alta un texto mixto español/japonés; se resuelve al terminar. */
export async function speakMixed(text: string): Promise<void> {
	if (!ttsSupported()) return;
	stopSpeaking();
	const parts = splitByLanguage(text);
	if (!parts.length) return;
	const { ttsVoiceURI, ttsVoiceEsURI, ttsRate } = await getAllSettings();
	const [ja, es] = await Promise.all([listJapaneseVoices(), listSpanishVoices()]);
	const jaVoice = ja.find((v) => v.voiceURI === ttsVoiceURI) ?? ja[0];
	const esVoice = es.find((v) => v.voiceURI === ttsVoiceEsURI) ?? es.find((v) => /es-(es|mx|us|419|cl)/i.test(v.lang)) ?? es[0];
	return new Promise((resolve) => {
		parts.forEach((p, i) => {
			const u = new SpeechSynthesisUtterance(p.text);
			u.lang = p.lang === 'ja' ? 'ja-JP' : 'es-ES';
			const v = p.lang === 'ja' ? jaVoice : esVoice;
			if (v) u.voice = v;
			u.rate = p.lang === 'ja' ? ttsRate * 0.95 : Math.min(1.2, ttsRate + 0.05);
			if (i === parts.length - 1) {
				u.onend = () => resolve();
				u.onerror = () => resolve();
			}
			window.speechSynthesis.speak(u);
		});
	});
}
